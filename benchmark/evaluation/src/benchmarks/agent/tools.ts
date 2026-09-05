/**
 * The agent benchmark's two tools — `search` and `execute` — as the model sees
 * them (name + description + JSON-Schema input) and as the session runs them.
 *
 *   search(searchQuery): embed the NL query, run the configured slicer strategy,
 *     UNION its selectedCoords into the session's accumulated set (R11), then
 *     buildSlice over the union and return the compact sub-schema SDL.
 *   execute(query): validate the submitted GraphQL document against the FULL
 *     schema (parse → validate → coverage) and return the result.
 *
 * The tool input schemas are LITERAL JSON Schema objects (not zod-derived) so the
 * schema text — and therefore its hash in the cache key (R5) — stays stable.
 *
 * Tool descriptions restate the §6 system-prompt contract tersely; they are
 * hashed into the cache key too, so wording changes invalidate stale traces.
 */
import { buildSlice, DEFAULT_SLICE_FLOOR } from '../../core/shared/slice.ts';
import type { ToolDef } from './clients/types.ts';
import type { Validator, ValidatorResult } from './validator.ts';
import type { SchemaSnapshot, StrategyDef } from '../../core/types.ts';

export const SEARCH_TOOL_NAME = 'search' as const;
export const EXECUTE_TOOL_NAME = 'execute_graphql_operation' as const;
export const ANSWER_TOOL_NAME = 'answer' as const;

/** JSON Schema for `search`. The model passes ONE natural-language intent, or an
 *  ARRAY of focused intents — each is embedded as a SEPARATE cosine search and the
 *  results are merged into one slice (multi-`q`). */
export const SEARCH_INPUT_SCHEMA = {
    type: 'object',
    properties: {
        searchQuery: {
            anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' }, minItems: 1 }],
            description:
                'One or more NATURAL-LANGUAGE descriptions of the schema elements you need (types, fields, ' +
                'arguments) — NOT GraphQL. Pass an ARRAY of several FOCUSED intents when the question spans ' +
                'distinct domains/entities (e.g. ["the author email of an issue","taxi availability nearby"]): ' +
                'each runs as a separate search and the results merge into one slice. A single string for one intent.',
        },
    },
    required: ['searchQuery'],
    additionalProperties: false,
} as const;

/** JSON Schema for `execute`. The model submits a complete GraphQL operation. */
export const EXECUTE_INPUT_SCHEMA = {
    type: 'object',
    properties: {
        query: {
            type: 'string',
            description:
                'A complete, valid GraphQL operation document that answers the user question.',
        },
        variables: {
            type: 'object',
            additionalProperties: true,
            description: 'Optional GraphQL variables object.',
        },
    },
    required: ['query'],
    additionalProperties: false,
} as const;

/** Stable PLACEHOLDER schema for `answer`, used only for the static tool-schema hash
 *  (R5). The REAL `answer` input schema is per-query: its `answer` property comes
 *  from the YAML answerSchema when present, otherwise the legacy operation-derived
 *  shape. The per-query shape is folded into the query-content cache key, so this
 *  placeholder stays fixed. */
export const ANSWER_INPUT_SCHEMA = {
    type: 'object',
    properties: {
        answer: {
            type: 'object',
            description:
                'Your final answer to the question, filled in with the actual values you ' +
                'retrieved. Submit this once your query results answer the question.',
        },
    },
    required: ['answer'],
    additionalProperties: false,
} as const;

export interface SearchInput {
    searchQuery: string | string[];
}

export interface ExecuteInput {
    query: string;
    variables?: Record<string, unknown>;
}

export interface AnswerInput {
    /** The structured answer object, matching this question's per-query answer schema. */
    answer: unknown;
}

/**
 * Build the three ToolDefs from a prompt's descriptions. The descriptions come from
 * the selected AgentPromptDef (the prompt axis), so different prompts can phrase the
 * tool contract differently. The `search`/`execute` input schemas are fixed; the
 * `answer` schema is PER-QUERY — its `answer` property is the structured shape from
 * the YAML answerSchema when present, otherwise the legacy operation-derived shape.
 * The model is forced to commit an answer in exactly the shape the deterministic
 * grader deep-equals against. The runner builds these once per cell and the session
 * passes them every turn.
 */
export function buildToolDefs(
    searchDescription: string,
    executeDescription: string,
    answerDescription: string,
    answerSchema: Record<string, unknown>,
): ToolDef[] {
    return [
        {
            name: SEARCH_TOOL_NAME,
            description: searchDescription,
            inputSchema: SEARCH_INPUT_SCHEMA as unknown as Record<string, unknown>,
        },
        {
            name: EXECUTE_TOOL_NAME,
            description: executeDescription,
            inputSchema: EXECUTE_INPUT_SCHEMA as unknown as Record<string, unknown>,
        },
        {
            name: ANSWER_TOOL_NAME,
            description: answerDescription,
            inputSchema: {
                type: 'object',
                properties: { answer: answerSchema },
                required: ['answer'],
                additionalProperties: false,
            },
        },
    ];
}

/**
 * Per-session ports the tools need. Pure: no I/O of its own beyond the injected
 * `embed`. `accumulatedCoords` is mutated in place across `search` calls (R11);
 * the returned slice is always rebuilt over the UNION so what the model sees
 * grows monotonically and is exactly what `execute` is graded against.
 */
export interface ToolContext {
    snapshot: SchemaSnapshot;
    strategy: StrategyDef;
    /** Full schema SDL the slice is rendered from. */
    sdl: string;
    /** Embed an NL query, returning the vector + token count for cost accounting (R4). */
    embed: (text: string) => Promise<{ vec: Float32Array; tokens: number }>;
    /** Union of every strategy.run() selectedCoords seen so far (R11). Mutated by runSearch. */
    accumulatedCoords: Set<string>;
    /** Cosine floor for relevance-pruned args / input fields / enum values. */
    sliceFloor: number;
}

/**
 * Run one search. Accepts ONE intent or an ARRAY of focused intents (multi-`q`):
 * each is embedded as a separate cosine search and the slicer merges them on the
 * MAX signal per coord (the same multi-embedding path the strategy benchmark uses
 * for multi-request queries). UNIONs the selected coords into ctx.accumulatedCoords
 * (R11), then buildSlice over the union with element relevance = max cosine across
 * the intents. Returns the slice SDL, embedding spend, and the NEW coords this
 * search added (empty ⇒ the "nothing new" / empty-diff signal upstream).
 */
export async function runSearch(
    ctx: ToolContext,
    searchQuery: string | string[],
): Promise<{ sdl: string; embedTokens: number; newCoords: string[] }> {
    const queries = (Array.isArray(searchQuery) ? searchQuery : [searchQuery])
        .map((s) => s.trim())
        .filter(Boolean);
    if (queries.length === 0) queries.push('');

    // Embed each intent (R4: sum the tokens across intents).
    const embedded = await Promise.all(queries.map((q) => ctx.embed(q)));
    const vecs = embedded.map((e) => e.vec);
    const embedTokens = embedded.reduce((a, e) => a + e.tokens, 0);

    // Strategies read embedding/embeddings/snapshot/config; must list empty (free text).
    const result = await ctx.strategy.run({
        snapshot: ctx.snapshot,
        query: {
            id: 'agent-search',
            schemaId: ctx.snapshot.schema.id,
            category: 'agent',
            query: queries.join(' '),
            queries,
            mustInclude: [],
            embedding: vecs[0]!,
            embeddings: vecs,
        },
        config: ctx.strategy.defaultConfig ?? {},
    });

    // R11: accumulate over the union. Track the coords NOT already present.
    const newCoords: string[] = [];
    for (const c of result.selectedCoords) {
        if (!ctx.accumulatedCoords.has(c)) {
            ctx.accumulatedCoords.add(c);
            newCoords.push(c);
        }
    }

    // Compact render: prune optional args / input fields / enum values by element
    // relevance = MAX cosine across the intents (mirror the worker's multi-query
    // render), floored at ctx.sliceFloor. Required + pagination args always kept.
    // Deprecated members are hidden from the schema shown to the agent.
    const relMaps = vecs.map((v) => ctx.snapshot.cosineToQueryElements(v));
    const rel = (key: string): number => {
        let mx = -1;
        for (const m of relMaps) {
            const v = m.get(key);
            if (v !== undefined && v > mx) mx = v;
        }
        return mx;
    };
    const sdl = buildSlice(ctx.sdl, [...ctx.accumulatedCoords], {
        relevance: rel,
        argFloor: ctx.sliceFloor,
        inputFloor: ctx.sliceFloor,
        enumFloor: ctx.sliceFloor,
        stripDeprecated: true,
    });

    return { sdl, embedTokens, newCoords };
}

/** Run one execute: validate the submitted GraphQL document (parse → validate →
 *  coverage) against the full schema. */
export function runExecute(validator: Validator, query: string): ValidatorResult {
    return validator.check(query);
}

export { DEFAULT_SLICE_FLOOR };
