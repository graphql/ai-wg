// AGENT BENCHMARK RUNNER — DELIBERATE DIVERGENCE FROM THE OTHER FOUR CATEGORIES.
// The agent loop is NETWORK-bound (LLM API round-trips), not CPU-bound. Worker
// threads buy nothing for an HTTP-bound loop and add structured-clone friction,
// so we DROP the worker pool / worker.ts / worker-entry.mjs entirely and run
// sessions on the MAIN thread via mapWithConcurrency at LOW concurrency (default
// 4) for rate-limit + cost safety. Snapshots are still warmed once on main (CPU,
// cache-first). The result cache still removes repeat cost across runs (R8).
//
// Flow (§7.5): warm snapshots → pre-hash determinants (incl. system-prompt /
// tool-schema / validator-source hashes, budgets, temperature, nSamples, seed —
// R5) → build cells (agentModel × strategy × query × sampleIndex) with the R1
// unsatisfiable carve-out skipped-but-recorded WITHOUT a session → parallel cache
// read → run live cells on main via mapWithConcurrency(runOneSession) → aggregate.
//
// The DEFAULT query set is the CHERRY-PICK manifest (cherry-pick.json), NOT all
// 816 queries. `opts.fullBench` switches to the full `opts.queries` set. The CLI's
// --query/--schema/--category filters (already applied to opts.queries) compose on
// top of whichever set is selected.
import { readFileSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { encode } from 'gpt-tokenizer';
import { buildSchema } from 'graphql';
import { buildSnapshot } from '../../core/shared/snapshot.ts';
import { embedOne } from '../../core/shared/embeddings.ts';
import { mapWithConcurrency } from '../../core/shared/concurrency.ts';
import { readCached, writeCached } from '../../core/shared/result-cache.ts';
import { makeAnthropicClient } from './clients/anthropic.ts';
import { makeOpenAIClient } from './clients/openai.ts';
import { classifyMusts } from './coords.ts';
import { makeValidator } from './validator.ts';
import { assembleAcceptedAnswers } from './answer.ts';
import {
    computeBudgetTag,
    computeCellCacheKey,
    computeConfigHash,
    computeQueryContentHash,
    computeSchemaSdlHash,
    computeStaticDeterminants,
    type CacheKeyDeterminants,
} from './determinants.ts';
import { makeMockServer } from './mock/index.ts';
import { resolverMapFor } from './mock/resolvers/registry.ts';
import { buildUserPrompt } from './prompt.ts';
import { DEFAULT_SLICE_FLOOR, buildToolDefs, type ToolContext } from './tools.ts';
import { runSession, type SessionBudgets, type SessionMeta } from './session.ts';
import { aggregateAgentCohort, type AgentRunRecord, type AgentRunReport } from './metrics.ts';
import type { ModelClient } from './clients/types.ts';
import type {
    AgentModelDef,
    AgentPromptDef,
    CategoryMeta,
    EmbeddingSetup,
    QueryDef,
    SchemaDef,
    SchemaSnapshot,
    StrategyDef,
} from '../../core/types.ts';

/** Max concurrent provider-bound snapshot warm-ups (CPU + embedding cache). */
const WARM_CONCURRENCY = 8;
/** Default in-flight session count (override of any CPU-based default — R8). */
const DEFAULT_CONCURRENCY = 4;

export interface RunOptions {
    schemas: SchemaDef[];
    categories: CategoryMeta[];
    /** The agent models to run LIVE this invocation (the --model selection). */
    agentModels: AgentModelDef[];
    /** EVERY loaded agent model — the board universe surfaces all of them from the
     *  cache, not just the live selection. CLI filters scope the live run only. */
    allAgentModels: AgentModelDef[];
    strategies: StrategyDef[];
    /** The prompt axis — model × strategy × prompt cohorts. */
    prompts: AgentPromptDef[];
    /** The queries to run LIVE this invocation (--query/--schema/--category filtered). */
    queries: QueryDef[];
    /** The cherry|full board query set, NOT narrowed by --schema/--query/--category.
     *  The board reads the full accumulated board over these. */
    boardQueries: QueryDef[];
    /** Fixed embedding setup used inside `search` (NOT the thing under test). */
    setup: EmbeddingSetup;
    maxTurns: number;
    maxToolCalls: number;
    maxCostUsd: number;
    temperature: number;
    nSamples: number;
    seed: number;
    /** Cap total cells AFTER filtering (cost safety; deterministic order). */
    limit?: number;
    /** Use ALL opts.queries instead of the cherry-pick manifest default. */
    fullBench?: boolean;
    timestampIso: string;
    /** Directory to write full per-conversation transcripts into (skipped if unset). */
    transcriptDir?: string;
    /** In-flight session count. Default 4. */
    concurrency?: number;
    /** Skip the result cache and re-run every cell. */
    noCache?: boolean;
    onProgress?: (msg: string) => void;
}

/** {schemaId: [queryId, ...]} — the default (cherry-pick) cell manifest. */
type CherryPick = Record<string, string[]>;

/** One unit of agent work: (agentModel × strategy × query × sampleIndex). */
interface CellSpec {
    agentModel: AgentModelDef;
    strategy: StrategyDef;
    prompt: AgentPromptDef;
    query: QueryDef;
    sampleIndex: number;
    /** Satisfiable-must list for the validator (classifyMusts(...).satisfiable). */
    satisfiableMusts: string[];
    /** True iff this query has a structurally-unsatisfiable bare-union must (R1). */
    unsatisfiable: boolean;
    configHash: string;
    cacheKey: string;
}

export async function runBenchmark(opts: RunOptions): Promise<AgentRunReport> {
    const log = opts.onProgress ?? ((): void => {});
    const concurrency = opts.concurrency ?? DEFAULT_CONCURRENCY;

    // 1. Warm snapshots once on main, bounded-parallel (cache-first). The
    //    embedding setup is FIXED, so we build one snapshot per schema (not per
    //    agent model). Workers don't exist here — sessions read these directly.
    const snapshots = new Map<string, SchemaSnapshot>();
    await mapWithConcurrency(opts.schemas, WARM_CONCURRENCY, async (s) => {
        log(`[snapshot:main] warming ${s.id} under embed=${opts.setup.model.id}`);
        const snap = await buildSnapshot({
            schema: s,
            template: opts.setup.template,
            typeTemplate: opts.setup.typeTemplate,
            model: opts.setup.model,
        });
        snapshots.set(s.id, snap);
    });

    // 2. Pre-hash per-schema + per-query determinants via the shared composer
    //    (determinants.ts), so the LIVE path and the board reader compute IDENTICAL
    //    keys. Hash over the UNION of the live + board query sets so the board reader
    //    can key every board cell. computeQueryContentHash folds the gradable content
    //    (incl. operation/answer keys) with order-stable sorted arrays.
    const schemaSdlHashes = new Map<string, string>();
    for (const s of opts.schemas) schemaSdlHashes.set(s.id, computeSchemaSdlHash(s.sdl));
    const queryContentHashes = new Map<string, string>();
    for (const q of [...opts.queries, ...opts.boardQueries]) {
        if (!queryContentHashes.has(q.id)) queryContentHashes.set(q.id, computeQueryContentHash(q));
    }

    // 3. Static determinant hashes (R5) — fixed for the whole run. validatorSourceHash
    //    folds ALL harness source that decides pass/fail (validator + coord walk +
    //    session loop + prompt builder + tool defs + mock executor + answer grader);
    //    runner.ts is NOT folded (pure plumbing — accepted-answers moved to answer.ts).
    const statics = computeStaticDeterminants(opts.setup);

    // The full determinant bundle the cache-key composer reads — shared by both the
    // live cell builder and the board reader.
    const determinants: CacheKeyDeterminants = {
        statics,
        budgets: {
            maxTurns: opts.maxTurns,
            maxToolCalls: opts.maxToolCalls,
            maxCostUsd: opts.maxCostUsd,
            temperature: opts.temperature,
            nSamples: opts.nSamples,
            seed: opts.seed,
        },
        schemaSdlHashes,
        queryContentHashes,
    };

    // 4. Select the default cell query set: the cherry-pick manifest unless
    //    fullBench. opts.queries is already --query/--schema/--category filtered;
    //    selectCherryPick intersects with the manifest. (The CLI applies the same
    //    selection up front for an accurate count — this is the idempotent guard.)
    const cellQueries = opts.fullBench ? opts.queries : selectCherryPick(opts.queries);

    // 5. Per-query must classification (R1) — pure, no model. A query with a
    //    bare-union must is recorded WITHOUT a session (unsatisfiable_ceiling).
    const classified = new Map<string, { satisfiable: string[]; unsatisfiable: boolean }>();
    const unsatisfiableQueryIds: string[] = [];
    for (const q of cellQueries) {
        const snap = snapshots.get(q.schemaId);
        if (!snap) continue;
        const schema = buildSchema(snap.schema.sdl, { assumeValid: true });
        const cls = classifyMusts(schema, q.mustInclude);
        classified.set(q.id, {
            satisfiable: cls.satisfiable,
            unsatisfiable: cls.isUnsatisfiableQuery,
        });
        if (cls.isUnsatisfiableQuery && !unsatisfiableQueryIds.includes(q.id)) {
            unsatisfiableQueryIds.push(q.id);
        }
    }

    // 6. Build LIVE cell specs (agentModel × strategy × query × sampleIndex) over the
    //    --model-filtered selection. Each cell's cache key is composed by the shared
    //    determinants module so it matches the board reader byte-for-byte.
    const budgetTag = computeBudgetTag(determinants.budgets);
    let allSpecs: CellSpec[] = [];
    for (const q of cellQueries) {
        const cls = classified.get(q.id);
        if (!cls) continue; // schema missing — skip defensively
        for (const m of opts.agentModels) {
            for (const strat of opts.strategies) {
                const configHash = computeConfigHash(strat, budgetTag);
                for (const prompt of opts.prompts) {
                    for (let sampleIndex = 0; sampleIndex < opts.nSamples; sampleIndex++) {
                        const cacheKey = computeCellCacheKey(
                            { agentModel: m, strategy: strat, prompt, query: q, sampleIndex },
                            determinants,
                        );
                        allSpecs.push({
                            agentModel: m,
                            strategy: strat,
                            prompt,
                            query: q,
                            sampleIndex,
                            satisfiableMusts: cls.satisfiable,
                            unsatisfiable: cls.unsatisfiable,
                            configHash,
                            cacheKey,
                        });
                    }
                }
            }
        }
    }

    // Deterministic order (queryId, modelId, strategyId, sampleIndex) so --limit
    // always carves the same prefix.
    allSpecs.sort(
        (a, b) =>
            a.query.id.localeCompare(b.query.id) ||
            a.agentModel.id.localeCompare(b.agentModel.id) ||
            a.strategy.id.localeCompare(b.strategy.id) ||
            a.prompt.id.localeCompare(b.prompt.id) ||
            a.sampleIndex - b.sampleIndex,
    );

    if (opts.limit != null && opts.limit >= 0 && allSpecs.length > opts.limit) {
        allSpecs = allSpecs.slice(0, opts.limit);
    }

    log(
        `[runner] ${allSpecs.length} cells (carved out ${unsatisfiableQueryIds.length} unsatisfiable queries)`,
    );

    // 7. Skip-but-record the R1-unsatisfiable cells WITHOUT a session, and split
    //    the rest into cache hits vs live cells.
    const skippedRecords: AgentRunRecord[] = [];
    const billableSpecs: CellSpec[] = [];
    for (const spec of allSpecs) {
        if (spec.unsatisfiable) {
            skippedRecords.push(unsatisfiableRecord(spec));
        } else {
            billableSpecs.push(spec);
        }
    }

    const cacheResults = opts.noCache
        ? billableSpecs.map(() => null)
        : await Promise.all(billableSpecs.map((s) => readCached<AgentRunRecord>(s.cacheKey)));

    const cachedRecords: AgentRunRecord[] = [];
    const liveSpecs: CellSpec[] = [];
    for (let i = 0; i < billableSpecs.length; i++) {
        const hit = cacheResults[i];
        // A cached api_error is a TRANSIENT failure (auth / rate-limit / client bug),
        // not a deterministic result — re-run it rather than serving the stale error.
        if (hit && hit.failReason !== 'api_error') cachedRecords.push(hit);
        else liveSpecs.push(billableSpecs[i]!);
    }
    log(`[cache] ${cachedRecords.length} hits, ${liveSpecs.length} misses`);

    // 8. Run live cells on the MAIN thread, bounded by concurrency. Each cell
    //    builds its own ModelClient + ToolContext + Validator, runs the session,
    //    then writes the record to the result cache + the transcript to a file.
    if (opts.transcriptDir) await mkdir(opts.transcriptDir, { recursive: true });
    let completed = 0;
    const liveRecords = await mapWithConcurrency(liveSpecs, concurrency, async (spec) => {
        const record = await runOneSession(spec, opts, snapshots.get(spec.query.schemaId)!);
        // Never cache transient api_error rows — they must re-run next time.
        if (!opts.noCache && record.failReason !== 'api_error')
            await writeCached(spec.cacheKey, record);
        completed++;
        // One line per completed session so a long run visibly progresses.
        const mark = record.success ? 'OK ' : 'XX ';
        const outcome = record.success
            ? `q=${record.queriesUsed} turns=${record.turns}`
            : (record.failReason ?? 'fail');
        log(
            `[agent] ${String(completed).padStart(4)}/${liveSpecs.length} ${mark} ${spec.query.id} ` +
                `(${spec.agentModel.id}/${spec.prompt.id}) ${outcome} ` +
                `${record.searchCalls}s/${record.executeAttempts}x ${(record.apiMs / 1000).toFixed(1)}s-api $${record.totalCostUsd.toFixed(4)}`,
        );
        return record;
    });

    // 9. FULL-BOARD READER (cache-as-ledger). The report shows the ENTIRE accumulated
    //    board from the content-addressed cache — every loaded agent model over the
    //    cherry|full board query set — not just THIS invocation's live selection. The
    //    --model/--schema/--query/--category filters scoped only what ran LIVE above;
    //    the board universe below ignores them so old/expensive models computed in a
    //    prior run still appear. Each board cell's key is recomputed under the SAME
    //    determinants via the SAME composer, so a cell computed under stale logic has a
    //    different key → cache miss → it simply never appears (no masquerading as fresh).
    // The live results this invocation produced, keyed by the cacheKey of the cell that
    // produced them, so the board overlay can apply them by key (live wins). Both cache
    // hits and freshly-run cells use their spec's cacheKey; the unsatisfiable skipped
    // rows are regenerated by the board reader for active models, so they're excluded.
    const liveByKey = new Map<string, AgentRunRecord>();
    for (let i = 0; i < billableSpecs.length; i++) {
        const hit = cacheResults[i];
        if (hit && hit.failReason !== 'api_error') liveByKey.set(billableSpecs[i]!.cacheKey, hit);
    }
    for (let i = 0; i < liveSpecs.length; i++) {
        liveByKey.set(liveSpecs[i]!.cacheKey, liveRecords[i]!);
    }

    const board = await readFullBoard({ opts, determinants, snapshots, liveByKey, log });

    // 10. Aggregate per (chatModelId, strategyId, promptId) cohort over the merged board.
    const summary = aggregateAgentCohort(board.rows);

    return {
        schemaVersion: 1,
        generatedAt: opts.timestampIso,
        benchmarkType: 'agent',
        fixed: {
            embeddingModel: opts.setup.model.id,
            fieldTemplate: opts.setup.template.id,
            typeTemplate: opts.setup.typeTemplate.id,
            maxTurns: opts.maxTurns,
            maxToolCalls: opts.maxToolCalls,
            maxCostUsd: opts.maxCostUsd,
            temperature: opts.temperature,
            nSamples: opts.nSamples,
            seed: opts.seed,
        },
        schemas: opts.schemas.map((s) => ({
            id: s.id,
            name: s.name,
            ...(s.description !== undefined ? { description: s.description } : {}),
        })),
        categories: opts.categories,
        // The board surfaces every ACTIVE agent model (≥1 satisfiable hit or live
        // record), not just the live selection. Look up each active id in allAgentModels.
        chatModels: board.activeModels.map((m) => ({
            id: m.id,
            name: m.name,
            provider: m.provider,
            modelName: m.modelName,
        })),
        strategies: opts.strategies.map((s) => ({ id: s.id, name: s.name })),
        prompts: opts.prompts.map((p) => ({ id: p.id, name: p.name })),
        unsatisfiableQueryIds,
        board: { queryCount: board.queryCount, satisfiableCount: board.satisfiableCount },
        summary,
        rows: board.rows,
    };
}

/** Outcome of {@link assembleBoard}: the merged board rows + the active-model set +
 *  the board denominator inputs for coverage reporting. */
export interface BoardResult {
    rows: AgentRunRecord[];
    activeModels: AgentModelDef[];
    /** Number of board queries (the cherry|full set, before the unsatisfiable carve). */
    queryCount: number;
    /** Number of SATISFIABLE board queries (the headline-eligible denominator). */
    satisfiableCount: number;
}

/** Thin wrapper around {@link assembleBoard} that supplies each board schema's SDL
 *  from the warmed snapshots. The reader needs SDL only to classify musts (pure). */
async function readFullBoard(args: {
    opts: RunOptions;
    determinants: CacheKeyDeterminants;
    snapshots: Map<string, SchemaSnapshot>;
    liveByKey: Map<string, AgentRunRecord>;
    log: (msg: string) => void;
}): Promise<BoardResult> {
    const sdlBySchema = new Map<string, string>();
    for (const [id, snap] of args.snapshots) sdlBySchema.set(id, snap.schema.sdl);
    return assembleBoard({
        determinants: args.determinants,
        allAgentModels: args.opts.allAgentModels,
        strategies: args.opts.strategies,
        prompts: args.opts.prompts,
        nSamples: args.opts.nSamples,
        boardQueries: args.opts.fullBench
            ? args.opts.boardQueries
            : selectCherryPick(args.opts.boardQueries),
        sdlBySchema,
        liveByKey: args.liveByKey,
        log: args.log,
    });
}

/**
 * Build the full accumulated board from the cache (the ledger). The universe is
 * `allAgentModels × strategies × prompts × boardQueries × samples`. Satisfiable cells
 * are read from the cache (a record exists iff that exact cell was ever computed under
 * the current determinants); unsatisfiable cells get a freshly-generated record (never
 * cached). LIVE records from this invocation overlay the cache by cacheKey (live wins —
 * this covers --no-cache and uncached api_error rows). Only ACTIVE models — those with
 * at least one satisfiable cache hit or a live record — are surfaced; never-run models
 * are not shown as empty cohorts.
 *
 * Pure of network/snapshots: it takes each board schema's SDL directly, so it is unit-
 * testable offline by pre-seeding the cache (see scripts/board-ledger-test.ts).
 */
export async function assembleBoard(args: {
    determinants: CacheKeyDeterminants;
    allAgentModels: AgentModelDef[];
    strategies: StrategyDef[];
    prompts: AgentPromptDef[];
    nSamples: number;
    /** The board query set (already cherry|full resolved, NOT --schema/--query filtered). */
    boardQueries: QueryDef[];
    /** Each board schema's SDL (used only for the pure must classification). */
    sdlBySchema: Map<string, string>;
    /** This invocation's live results, keyed by the producing cell's cacheKey (live wins). */
    liveByKey: Map<string, AgentRunRecord>;
    log?: (msg: string) => void;
}): Promise<BoardResult> {
    const {
        determinants,
        allAgentModels,
        strategies,
        prompts,
        nSamples,
        boardQueries,
        sdlBySchema,
        liveByKey,
    } = args;
    const log = args.log ?? ((): void => {});

    // Per-query must classification over the board set (pure, no model). Skip a query
    // whose schema SDL was not supplied (defensive — should not happen for board).
    const classified = new Map<string, { satisfiable: string[]; unsatisfiable: boolean }>();
    for (const q of boardQueries) {
        if (classified.has(q.id)) continue;
        const sdl = sdlBySchema.get(q.schemaId);
        if (!sdl) continue;
        const schema = buildSchema(sdl, { assumeValid: true });
        const cls = classifyMusts(schema, q.mustInclude);
        classified.set(q.id, {
            satisfiable: cls.satisfiable,
            unsatisfiable: cls.isUnsatisfiableQuery,
        });
    }

    const budgetTag = computeBudgetTag(determinants.budgets);

    // Build the board universe cells. Split into satisfiable (cache-read) vs
    // unsatisfiable (generated, never cached).
    interface BoardCell {
        spec: CellSpec;
        unsatisfiable: boolean;
    }
    const satisfiableCells: BoardCell[] = [];
    const unsatisfiableCells: BoardCell[] = [];
    let queryCount = 0;
    let satisfiableCount = 0;
    for (const q of boardQueries) {
        const cls = classified.get(q.id);
        if (!cls) continue;
        queryCount++;
        if (!cls.unsatisfiable) satisfiableCount++;
        for (const m of allAgentModels) {
            for (const strat of strategies) {
                const configHash = computeConfigHash(strat, budgetTag);
                for (const prompt of prompts) {
                    for (let sampleIndex = 0; sampleIndex < nSamples; sampleIndex++) {
                        const cacheKey = computeCellCacheKey(
                            { agentModel: m, strategy: strat, prompt, query: q, sampleIndex },
                            determinants,
                        );
                        const spec: CellSpec = {
                            agentModel: m,
                            strategy: strat,
                            prompt,
                            query: q,
                            sampleIndex,
                            satisfiableMusts: cls.satisfiable,
                            unsatisfiable: cls.unsatisfiable,
                            configHash,
                            cacheKey,
                        };
                        if (cls.unsatisfiable)
                            unsatisfiableCells.push({ spec, unsatisfiable: true });
                        else satisfiableCells.push({ spec, unsatisfiable: false });
                    }
                }
            }
        }
    }

    // Read satisfiable cells from the cache. A hit means that exact cell was computed
    // under the current determinants. Stale api_error rows are NOT board evidence — the
    // live overlay re-supplies any fresh one for the cells that ran this invocation.
    const hits = await Promise.all(
        satisfiableCells.map((c) => readCached<AgentRunRecord>(c.spec.cacheKey)),
    );
    const boardHits = new Map<string, AgentRunRecord>();
    const activeModelIds = new Set<string>();
    for (let i = 0; i < satisfiableCells.length; i++) {
        const rec = hits[i];
        if (!rec || rec.failReason === 'api_error') continue;
        const cell = satisfiableCells[i]!;
        boardHits.set(cell.spec.cacheKey, rec);
        activeModelIds.add(cell.spec.agentModel.id);
    }

    // Overlay every LIVE record by its cacheKey (live wins). This covers --no-cache and
    // uncached api_error rows that aren't on disk. A live record also activates its model.
    for (const [key, rec] of liveByKey) {
        boardHits.set(key, rec);
        activeModelIds.add(rec.chatModelId);
    }

    // A model is active iff it has ≥1 satisfiable hit OR a live record. Generate the
    // unsatisfiable carve-out records ONLY for active models (never surface a model that
    // was never run as a board of empty unsatisfiable rows).
    const unsatisfiableForActive: AgentRunRecord[] = [];
    for (const cell of unsatisfiableCells) {
        if (activeModelIds.has(cell.spec.agentModel.id)) {
            unsatisfiableForActive.push(unsatisfiableRecord(cell.spec));
        }
    }

    const activeModels = allAgentModels.filter((m) => activeModelIds.has(m.id));
    const rows = [...boardHits.values(), ...unsatisfiableForActive];
    log(
        `[board] ${boardHits.size} satisfiable cells present + ${unsatisfiableForActive.length} carve-out rows ` +
            `over ${activeModels.length} active model(s); board universe = ${satisfiableCells.length} satisfiable cells`,
    );

    return { rows, activeModels, queryCount, satisfiableCount };
}

/**
 * Build + run ONE session: the ModelClient (per provider), the ToolContext (warm
 * snapshot, strategy, fixed embed shim, fresh accumulated coords, sliceFloor),
 * the Validator (from the satisfiable musts), and the system + user prompts.
 */
async function runOneSession(
    spec: CellSpec,
    opts: RunOptions,
    snapshot: SchemaSnapshot,
): Promise<AgentRunRecord> {
    const client = makeClient(spec.agentModel);

    // R4 embed-accounting shim: wrap embedOne(model, fieldTemplate, text) and
    // return {vec, tokens}; tokens estimated via gpt-tokenizer encode().length.
    // The query embeds under the FIELD-template namespace (the search space the
    // slicer ranks against), matching the strategy benchmarks.
    const embedModel = opts.setup.model;
    const embedTemplate = opts.setup.template;
    const embedCostPerMillion = embedModel.costPerMillionTokens ?? 0;
    const embed = async (text: string): Promise<{ vec: Float32Array; tokens: number }> => {
        const vec = await embedOne(embedModel, embedTemplate, text);
        let tokens: number;
        try {
            tokens = encode(text).length;
        } catch {
            tokens = Math.ceil(text.length / 4);
        }
        return { vec, tokens };
    };

    const tools: ToolContext = {
        snapshot,
        strategy: spec.strategy,
        sdl: snapshot.schema.sdl,
        embed,
        accumulatedCoords: new Set<string>(),
        sliceFloor: DEFAULT_SLICE_FLOOR,
    };

    const schema = buildSchema(snapshot.schema.sdl, { assumeValid: true });
    const validator = makeValidator({ schema, mustInclude: spec.satisfiableMusts });

    // This query's mock GraphQL server: real graphql-js execution over the schema's resolver map +
    // a fresh deterministic store per execute(). `execute` returns the shaped `data` the model reads.
    const mockServer = makeMockServer(schema, resolverMapFor(spec.query.schemaId));

    // Expected answer(s) come ONLY from the row's literal `answer` (+ optional `answers`
    // alternatives). The gold `operation` is NEVER consulted for grading — the agent is
    // measured purely on whether the data it reports matches the question's stated answer.
    // If the mock returns wrong data, fix the mock; if more than one answer is correct, add
    // it to `answers`; if order matters, say so in the answerSchema description. The
    // accepted-answers assembly lives in answer.ts (the hashed grading home).
    const answerSchema: Record<string, unknown> = (spec.query.answerSchema as
        | Record<string, unknown>
        | undefined) ?? { type: 'object' };
    const { expectedAnswer, acceptedAnswers, gradable } = assembleAcceptedAnswers(spec.query);
    if (!gradable) {
        console.warn(
            `[agent] ${spec.query.id}: no gradable literal answer — add answer:/answers: to the YAML.`,
        );
    }

    const system = spec.prompt.buildSystem({ schemaName: snapshot.schema.name });
    const toolDefs = buildToolDefs(
        spec.prompt.searchToolDescription,
        spec.prompt.executeToolDescription,
        spec.prompt.answerToolDescription,
        answerSchema,
    );
    const userPrompt = buildUserPrompt(spec.query);

    const budgets: SessionBudgets = {
        maxTurns: opts.maxTurns,
        maxToolCalls: opts.maxToolCalls,
        maxCostUsd: opts.maxCostUsd,
        temperature: opts.temperature,
        maxOutputTokens: spec.agentModel.maxTokens,
    };

    const meta: SessionMeta = {
        schemaId: spec.query.schemaId,
        queryId: spec.query.id,
        category: spec.query.category,
        chatModelId: spec.agentModel.id,
        strategyId: spec.strategy.id,
        promptId: spec.prompt.id,
        configHash: spec.configHash,
        sampleIndex: spec.sampleIndex,
        mustTotal: spec.satisfiableMusts.length,
        unsatisfiable: spec.unsatisfiable,
    };

    const { record, transcript } = await runSession({
        client,
        tools,
        toolDefs,
        validator,
        mockExecute: (q, v) => mockServer.execute(q, v),
        musts: spec.satisfiableMusts,
        system,
        userPrompt,
        expectedAnswer,
        acceptedAnswers,
        meta,
        budgets,
        pricing: spec.agentModel.pricing,
        provider: spec.agentModel.provider,
    });

    // R4: thread the SEARCH embedding spend into the bill. The session counts
    // embed tokens; the runner owns the embedModel rate, so we price it here.
    record.embedCostUsd = (record.embedTokens / 1e6) * embedCostPerMillion;
    record.totalCostUsd = record.chatCostUsd + record.embedCostUsd;

    // Write the full verbatim transcript to its own file; reference it from the record.
    if (opts.transcriptDir) {
        const safe =
            `${spec.query.id}__${spec.agentModel.id}__${spec.prompt.id}__s${spec.sampleIndex}`.replace(
                /[^\w.-]/g,
                '_',
            );
        await writeFile(join(opts.transcriptDir, `${safe}.md`), transcript, 'utf8');
        record.transcriptPath = `transcripts/${safe}.md`;
    }
    return record;
}

/** Pick the provider client for an agent model. */
function makeClient(model: AgentModelDef): ModelClient {
    return model.provider === 'anthropic' ? makeAnthropicClient(model) : makeOpenAIClient(model);
}

/** Record an R1-unsatisfiable cell WITHOUT running a session (§7.4). */
function unsatisfiableRecord(spec: CellSpec): AgentRunRecord {
    const mustTotal = spec.satisfiableMusts.length;
    return {
        schemaId: spec.query.schemaId,
        queryId: spec.query.id,
        category: spec.query.category,
        chatModelId: spec.agentModel.id,
        strategyId: spec.strategy.id,
        promptId: spec.prompt.id,
        configHash: spec.configHash,
        sampleIndex: spec.sampleIndex,

        success: false,
        failReason: 'unsatisfiable_ceiling',

        turns: 0,
        searchCalls: 0,
        executeAttempts: 0,
        queriesUsed: 0,
        invalidQueries: 0,
        emptySearches: 0,
        oneShot: false,
        firstExecuteRecall: 0,
        missingRetrieved: 0,
        missingNotRetrieved: 0,
        neverSelected: 0,

        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        chatCostUsd: 0,
        embedTokens: 0,
        embedCostUsd: 0,
        totalCostUsd: 0,

        mustTotal,
        mustHits: 0,
        mustMissing: mustTotal,
        finalMustRecall: mustTotal === 0 ? 1 : 0,
        excludeViolations: 0,
        finalQueryCoordCount: 0,
        unsatisfiable: true,

        latencyMs: 0,
        apiMs: 0,
        retrievedCoords: [],
        turnsTrace: [],
    };
}

/** Read the cherry-pick manifest sitting next to this runner. */
function loadCherryPick(): CherryPick {
    const raw = readFileSync(new URL('./cherry-pick.json', import.meta.url), 'utf8');
    return JSON.parse(raw) as CherryPick;
}

/** Filter queries to the cherry-pick manifest — the DEFAULT agent query set
 *  (~20/schema). The CLI uses this to select + count before the run; the runner
 *  re-applies it idempotently. Pass --full-bench to skip it (all 816). */
export function selectCherryPick(queries: QueryDef[]): QueryDef[] {
    const cherry = loadCherryPick();
    const wanted = new Set<string>();
    for (const ids of Object.values(cherry)) for (const id of ids) wanted.add(id);
    return queries.filter((q) => wanted.has(q.id));
}
