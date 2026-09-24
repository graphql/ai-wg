/**
 * The AgentSession — a bounded tool-use state machine (§1.2–§1.4, §3.3).
 *
 * `runSession` drives ONE `(chatModel, strategy, query, sampleIndex)` job: it seeds
 * the transcript with the user prompt, then loops
 *   AWAIT_MODEL → ROUTE → (DO_SEARCH | DO_EXECUTE | NO_TOOL) → APPLY_RESULT
 * until it reaches DONE(success) or DONE(fail:<reason>). It has NO I/O of its own —
 * everything is injected: `client` (the provider seam), `tools` (the ToolContext the
 * search/execute handlers run against), and `validator` (parse → validate → coverage).
 *
 * Budgets are pre-checked BEFORE every createTurn so we never pay for a turn past the
 * cap (§1.3). `failReason` follows the precedence in §1.3 and `never_executed` is an
 * orthogonal flag layered onto whichever budget reason fired. Usage accumulates via
 * addUsage; cost via costOf (per-turn AgentTurn + session totals). Grading forensics
 * (finalMustRecall, finalQueryCoordCount, excludeViolations) are computed from the
 * LAST submitted query — they are recorded, NOT part of the pass/fail gate (R2).
 */
import { buildSchema, type GraphQLSchema } from 'graphql';
import type {
    AssistantTurn,
    ChatMessage,
    ContentBlock,
    ModelClient,
    ToolDef,
    ToolUse,
    Usage,
} from './clients/types.ts';
import { addUsage, costOf, ZERO_USAGE } from './clients/cost.ts';
import type { ChatPricing } from '../../core/types.ts';
import type { AgentRunRecord, AgentTurn, FailReason } from './metrics.ts';
import {
    runExecute,
    runSearch,
    SEARCH_TOOL_NAME,
    EXECUTE_TOOL_NAME,
    ANSWER_TOOL_NAME,
    type ToolContext,
} from './tools.ts';
import { submittedCoords } from './coords.ts';
import { answerMatches, isEmptyExpected } from './answer.ts';
import type { Validator, GraphQLErrorEntry } from './validator.ts';

/** Static loop budgets for one session (§1.3 / §7.3). */
export interface SessionBudgets {
    maxTurns: number;
    maxToolCalls: number;
    maxCostUsd: number;
    temperature: number;
    maxOutputTokens: number;
}

/** Identity + grading constants threaded straight into the record. */
export interface SessionMeta {
    schemaId: string;
    queryId: string;
    category: string;
    chatModelId: string;
    strategyId: string;
    promptId: string;
    configHash: string;
    sampleIndex: number;
    /** Count of SATISFIABLE musts (classifyMusts(...).satisfiable.length). */
    mustTotal: number;
    /** Whether this query has a structurally-unsatisfiable must (R1). */
    unsatisfiable: boolean;
}

export interface RunSessionArgs {
    client: ModelClient;
    tools: ToolContext;
    /** Tool defs built from the selected prompt's descriptions (the prompt axis). */
    toolDefs: ToolDef[];
    validator: Validator;
    /** Run a valid query against this query's mock server → the `data` envelope the model sees. */
    mockExecute: (
        query: string,
        variables?: Record<string, unknown>,
    ) => { data?: unknown; errors?: ReadonlyArray<{ message: string }> };
    /** The satisfiable mustInclude coords — coverage is now a DIAGNOSTIC (not the gate). */
    musts: ReadonlyArray<string>;
    system: string;
    userPrompt: string;
    /** The PRIMARY expected answer VALUE — the literal `answer` from the YAML. Recorded/
     *  displayed as the canonical expected value. NEVER shown to the model; it is the
     *  deterministic grading key. */
    expectedAnswer: unknown;
    /** ALL acceptable expected values (the literal `answer` plus any literal `answers`).
     *  Success = the submitted answer tolerantly matches ANY of these (see answerMatches). */
    acceptedAnswers: unknown[];
    meta: SessionMeta;
    budgets: SessionBudgets;
    pricing: ChatPricing;
    provider: 'anthropic' | 'openai';
}

/** Mutable per-session bookkeeping (§3.3). Not serialized; the record is. */
interface SessionState {
    turn: number;
    searchCalls: number;
    executeAttempts: number; // total execute calls (valid + invalid)
    /** Valid queries that contributed coverage — "how many queries it needed". */
    validExecutes: number;
    /** Execute calls rejected at parse/validate — "how many invalid queries". */
    invalidExecutes: number;
    /** Union of mustInclude coords covered across ALL valid queries so far (R: accumulate). */
    coveredMusts: Set<string>;
    consecutiveNoTool: number;
    messages: ChatMessage[];
    usage: Usage;
    chatCostUsd: number;
    embedTokens: number;
    embedCostUsd: number;
    /** Total wall-time spent INSIDE model API calls (createTurn), ms. */
    apiMs: number;
    /** The most recent `execute(query)` document (forensics: final coord count). */
    lastSubmittedQuery: string | null;
    /** Musts covered by the FIRST valid query (null until the first valid execute). */
    firstValidExecuteCovered: number | null;
    /** The model's submitted structured answer (null until it calls `answer`). Graded by
     *  deep-equal against the expected value; never prose. */
    submittedAnswer: unknown;
    /** Whether the model has committed an answer (the structured value may itself be falsy). */
    hasAnswered: boolean;
    /** Every VALID query + the (mock) data it returned — recorded for offline review. */
    attempts: Array<{ query: string; data: unknown }>;
}

const PREVIEW_MAX = 200;

function preview(text: string): string {
    return text.length <= PREVIEW_MAX ? text : `${text.slice(0, PREVIEW_MAX)}…`;
}

/** Rebuild assistant ContentBlock[] from the normalized turn (text + tool_use). */
function assistantContent(turn: AssistantTurn): ContentBlock[] {
    const blocks: ContentBlock[] = [];
    if (turn.text.length > 0) blocks.push({ type: 'text', text: turn.text });
    for (const u of turn.toolUses) {
        blocks.push({ type: 'tool_use', id: u.id, name: u.name, input: u.input });
    }
    return blocks;
}

function toolResult(toolUseId: string, content: string, isError = false): ContentBlock {
    return isError
        ? { type: 'tool_result', toolUseId, content, isError: true }
        : { type: 'tool_result', toolUseId, content };
}

/** The EXECUTE tool IS a GraphQL endpoint — its response to the model is EXACTLY what an
 *  API returns: a `data` envelope (from the query's mock server) for a valid query, or the
 *  `errors` array a real API serializes for an invalid one. It never reveals grading state. */
function graphqlErrorResponse(errors: ReadonlyArray<GraphQLErrorEntry>): string {
    return JSON.stringify({ errors }, null, 2);
}

/**
 * Run one agent session to completion. Never throws on a model/API failure — a
 * persistent createTurn error terminates THIS session with failReason:'api_error'
 * so one bad cell cannot abort a sweep (§5.6).
 */
export async function runSession(
    args: RunSessionArgs,
): Promise<{ record: AgentRunRecord; transcript: string }> {
    const {
        client,
        tools,
        toolDefs,
        validator,
        mockExecute,
        musts,
        system,
        userPrompt,
        expectedAnswer,
        acceptedAnswers,
        meta,
        budgets,
        pricing,
        provider,
    } = args;
    const startedAt = Date.now();
    const allMusts = [...musts];

    const state: SessionState = {
        turn: 0,
        searchCalls: 0,
        executeAttempts: 0,
        validExecutes: 0,
        invalidExecutes: 0,
        coveredMusts: new Set<string>(),
        consecutiveNoTool: 0,
        // START — seed the transcript with the user prompt.
        messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
        usage: { ...ZERO_USAGE },
        chatCostUsd: 0,
        embedTokens: 0,
        embedCostUsd: 0,
        apiMs: 0,
        lastSubmittedQuery: null,
        firstValidExecuteCovered: null,
        submittedAnswer: null,
        hasAnswered: false,
        attempts: [],
    };
    const turnsTrace: AgentTurn[] = [];

    let success = false;
    let answered = false;
    let failReason: FailReason | undefined;
    let apiError: string | undefined;

    // ── Budget pre-check (§1.3): returns the tripped reason, or undefined. Checked
    //    at AWAIT_MODEL entry (BEFORE createTurn) and after each tool runs. Precedence
    //    among budget reasons: cost > tool_calls > turns (tokens optional/off).
    const budgetReason = (): FailReason | undefined => {
        if (state.chatCostUsd + state.embedCostUsd >= budgets.maxCostUsd) return 'budget_cost';
        if (state.searchCalls + state.executeAttempts >= budgets.maxToolCalls)
            return 'budget_tool_calls';
        if (state.turn >= budgets.maxTurns) return 'budget_turns';
        return undefined;
    };

    // ── Main loop ──────────────────────────────────────────────────────────────
    loop: while (true) {
        // AWAIT_MODEL — pre-check budgets BEFORE paying for a turn.
        const tripped = budgetReason();
        if (tripped) {
            failReason = tripped;
            break;
        }

        let turn: AssistantTurn;
        const apiT0 = Date.now();
        try {
            turn = await client.createTurn({
                system,
                tools: toolDefs,
                messages: state.messages,
                maxTokens: budgets.maxOutputTokens,
                temperature: budgets.temperature,
            });
        } catch (err) {
            // Persistent API failure (after the client's own retries): terminate THIS
            // session only, never the sweep (§5.6).
            apiError = err instanceof Error ? err.message : String(err);
            failReason = 'api_error';
            break;
        }
        const turnApiMs = Date.now() - apiT0;
        state.apiMs += turnApiMs;

        state.turn += 1;

        // Accumulate usage + cost for this turn.
        state.usage = addUsage(state.usage, turn.usage);
        const turnCost = costOf(turn.usage, pricing, provider);
        state.chatCostUsd += turnCost;

        // Append the assistant turn to the transcript (text + tool_use blocks).
        const content = assistantContent(turn);
        state.messages.push({ role: 'assistant', content });

        // ROUTE — exactly one tool action per turn.
        const toolUses = turn.toolUses;
        if (toolUses.length === 0) {
            // NO_TOOL — model emitted only text.
            state.consecutiveNoTool += 1;
            turnsTrace.push({
                index: state.turn,
                tool: 'none',
                usage: turn.usage,
                costUsd: turnCost,
                apiMs: turnApiMs,
            });
            // Prose is NOT a gradable answer — the deterministic gate deep-equals the
            // STRUCTURED `answer` tool input against the expected value. A text-only turn
            // is a nudge opportunity, not an answer: tolerate one stray turn, then give up.
            if (state.consecutiveNoTool >= 2) {
                failReason = 'no_tool_call_loop';
                break;
            }
            const nudge =
                state.executeAttempts >= 1
                    ? 'Submit your final answer by calling the `answer` tool with the structured value you retrieved.'
                    : 'Use search or execute to answer the question.';
            state.messages.push({
                role: 'user',
                content: [{ type: 'text', text: nudge }],
            });
            continue;
        }

        // A tool call resets the no-tool counter.
        state.consecutiveNoTool = 0;

        // Take the FIRST tool_use; emit an error tool_result for every ignored extra so
        // the next request has a matching result per tool_use_id (OpenAI 400s otherwise; §5.5).
        const primary = toolUses[0]!;
        const results: ContentBlock[] = [];

        const trace: AgentTurn = {
            index: state.turn,
            tool:
                primary.name === EXECUTE_TOOL_NAME
                    ? 'execute'
                    : primary.name === SEARCH_TOOL_NAME
                      ? 'search'
                      : primary.name === ANSWER_TOOL_NAME
                        ? 'answer'
                        : 'none',
            usage: turn.usage,
            costUsd: turnCost,
            apiMs: turnApiMs,
        };

        if (primary.name === SEARCH_TOOL_NAME) {
            // DO_SEARCH — accepts one intent or an array of focused intents (multi-q).
            const searchQueries = extractSearchQueries(primary);
            trace.toolInputPreview = preview(searchQueries.join(' || '));
            const { sdl, embedTokens, newCoords } = await runSearch(tools, searchQueries);
            state.searchCalls += 1;
            state.embedTokens += embedTokens;
            trace.searchNewCoords = newCoords;
            // Embedding $ (R4) is billed from the embedModel rate, which is NOT in the
            // session contract (ToolContext.embed returns only {vec, tokens}); the runner
            // prices embedTokens. EMPTY-DIFF signal: a search that adds no new coords tells
            // the model it already holds this schema — stop re-searching, execute.
            if (newCoords.length === 0) {
                results.push(toolResult(primary.id, emptyDiffMessage()));
            } else {
                results.push(
                    toolResult(
                        primary.id,
                        `# Retrieved ${newCoords.length} more field(s) of the schema.\n${sdl}`,
                    ),
                );
            }
        } else if (primary.name === EXECUTE_TOOL_NAME) {
            // DO_EXECUTE — run the query against the (mock) API. A VALID query returns a
            // shaped `data` envelope the model reads; an invalid one returns GraphQL
            // `errors`. Coverage of musts is still tracked, but ONLY as a diagnostic —
            // success is decided by deep-equal on the submitted answer, not here.
            const query = extractQuery(primary);
            const variables = extractVariables(primary);
            trace.toolInputPreview = preview(query);
            state.executeAttempts += 1;
            state.lastSubmittedQuery = query;
            const result = runExecute(validator, query);
            if (result.ok) {
                state.validExecutes += 1;
                trace.validatorKind = 'ok';
                for (const m of result.covered) state.coveredMusts.add(m); // diagnostic
                if (state.firstValidExecuteCovered === null)
                    state.firstValidExecuteCovered = state.coveredMusts.size;
                trace.missingCoords = allMusts.filter((m) => !state.coveredMusts.has(m)); // forensics only
                // Real GraphQL response from this query's mock server (deterministic synthetic data,
                // arguments honored). Surface errors too if execution produced any (partial data is fine).
                const exec = mockExecute(query, variables);
                const data = exec.data ?? {};
                state.attempts.push({ query, data });
                const envelope =
                    exec.errors && exec.errors.length
                        ? {
                              data: exec.data ?? null,
                              errors: exec.errors.map((e) => ({ message: e.message })),
                          }
                        : { data };
                results.push(toolResult(primary.id, JSON.stringify(envelope, null, 2)));
            } else {
                state.invalidExecutes += 1;
                trace.validatorKind = result.kind;
                // Exactly what a GraphQL API returns on a bad query: its `errors` array.
                results.push(toolResult(primary.id, graphqlErrorResponse(result.errors), true));
            }
        } else if (primary.name === ANSWER_TOOL_NAME) {
            // DO_ANSWER — the model commits its final STRUCTURED answer (read off retrieved
            // data). This ends the session; the gate deep-equals it against the expected value.
            const ans = extractStructuredAnswer(primary);
            state.submittedAnswer = ans;
            state.hasAnswered = true;
            trace.answer = preview(JSON.stringify(ans));
            results.push(toolResult(primary.id, 'Answer received.'));
            answered = true;
        } else {
            // Unknown tool name — treat as an error result, no counter bump.
            trace.tool = 'none';
            results.push(
                toolResult(
                    primary.id,
                    `Unknown tool "${primary.name}". Call exactly one of: search, execute, answer.`,
                    true,
                ),
            );
        }

        // Error tool_result for every ignored extra tool_use (§5.5).
        appendIgnoredResults(toolUses, results);

        turnsTrace.push(trace);

        // APPLY_RESULT — append the tool_result message(s).
        state.messages.push({ role: 'user', content: results });

        // The model committed an answer → end the loop; the gate grades it below.
        if (answered) break loop;

        // Post-tool budget check (§1.3): terminate before the next AWAIT_MODEL pays.
        const trippedAfter = budgetReason();
        if (trippedAfter) {
            failReason = trippedAfter;
            break loop;
        }
    }

    // never_executed flag — orthogonal to whichever budget reason fired (§1.3). It
    // refines a budget cap (the session hit a cap without ever calling execute); it
    // does NOT override no_tool_call_loop / api_error, which are more specific.
    if (
        !success &&
        state.executeAttempts === 0 &&
        (failReason === 'budget_turns' ||
            failReason === 'budget_tool_calls' ||
            failReason === 'budget_cost' ||
            failReason === 'budget_tokens')
    ) {
        failReason = 'never_executed';
    }

    // ── THE GATE: deterministically grade the submitted answer against the ACCEPTABLE
    //    expected values (the literal YAML `answer` + any literal `answers`).
    //    Success is decided here, not by coordinate coverage — a valid query via ANY path
    //    that yields a content-equal answer passes. No LLM judge: tolerant deterministic
    //    matching (shape/pagination-insensitive), reproducible. If the model never
    //    answered, it fails outright. An empty/undefined expected value can never be the
    //    thing that passes — guard so `answer({})` isn't a spurious match.
    if (state.hasAnswered && !apiError) {
        success = acceptedAnswers.some(
            (expected) =>
                !isEmptyExpected(expected) && answerMatches(expected, state.submittedAnswer),
        );
    }
    // Final failReason for a non-success, non-api_error row.
    if (!success && !apiError && failReason === undefined) {
        failReason = state.hasAnswered ? 'wrong_answer' : 'no_answer';
    }

    // ── Grading forensics (NOT in the gate — R2). ──────────────────────────────
    const forensics = computeForensics(tools.sdl, state, meta.mustTotal, success);

    // ── Diagnostics (the 3 new lenses) ─────────────────────────────────────────
    // Retrieval ceiling: split each UNCOVERED must into "retrieved but not selected"
    // (agent error) vs "never retrieved" (slicer/search gap). CRITICAL: only attribute
    // when SELECTION actually happened — if the session executed ZERO valid queries it
    // never reached selection, so the gaps belong to a separate `neverSelected` bucket,
    // NOT to agent/retrieval (else the split mislabels ask-the-user / never-execute rows
    // as "agent" and the headline lies). Field-level: an arg-must counts as retrieved if
    // its field coord was retrieved.
    const retrieved = tools.accumulatedCoords;
    const fieldOf = (c: string): string => {
        const i = c.indexOf('(');
        return i < 0 ? c : c.slice(0, i);
    };
    const missingMusts = allMusts.filter((m) => !state.coveredMusts.has(m));
    let missingRetrieved = 0;
    let missingNotRetrieved = 0;
    let neverSelected = 0;
    if (state.validExecutes === 0) {
        neverSelected = missingMusts.length;
    } else {
        for (const m of missingMusts)
            if (retrieved.has(m) || retrieved.has(fieldOf(m))) missingRetrieved += 1;
        missingNotRetrieved = missingMusts.length - missingRetrieved;
    }
    // Thrash: search turns that added zero new coords.
    const emptySearches = turnsTrace.filter(
        (t) => t.tool === 'search' && (t.searchNewCoords?.length ?? 0) === 0,
    ).length;
    // One-shot: succeeded with exactly ONE valid query and no rejected queries.
    const oneShot = success && state.validExecutes === 1 && state.invalidExecutes === 0;
    // First-execute recall: musts covered by the FIRST valid query / total.
    const firstExecuteRecall =
        meta.mustTotal === 0 ? 1 : (state.firstValidExecuteCovered ?? 0) / meta.mustTotal;

    const finishedAt = Date.now();
    const totalCostUsd = state.chatCostUsd + state.embedCostUsd;

    const record: AgentRunRecord = {
        schemaId: meta.schemaId,
        queryId: meta.queryId,
        category: meta.category,
        chatModelId: meta.chatModelId,
        strategyId: meta.strategyId,
        promptId: meta.promptId,
        configHash: meta.configHash,
        sampleIndex: meta.sampleIndex,

        success,
        ...(success ? {} : { failReason: failReason ?? 'budget_turns' }),

        ...(state.hasAnswered
            ? {
                  submittedAnswer: JSON.stringify(state.submittedAnswer),
                  answerCorrect: success,
                  expectedAnswer: JSON.stringify(expectedAnswer),
              }
            : {}),

        turns: state.turn,
        searchCalls: state.searchCalls,
        executeAttempts: state.executeAttempts,
        queriesUsed: state.validExecutes,
        invalidQueries: state.invalidExecutes,
        emptySearches,
        oneShot,
        firstExecuteRecall,
        missingRetrieved,
        missingNotRetrieved,
        neverSelected,

        inputTokens: state.usage.inputTokens,
        outputTokens: state.usage.outputTokens,
        cacheCreationInputTokens: state.usage.cacheCreationInputTokens,
        cacheReadInputTokens: state.usage.cacheReadInputTokens,
        chatCostUsd: state.chatCostUsd,
        embedTokens: state.embedTokens,
        embedCostUsd: state.embedCostUsd,
        totalCostUsd,

        mustTotal: meta.mustTotal,
        mustHits: forensics.mustHits,
        mustMissing: forensics.mustMissing,
        finalMustRecall: forensics.finalMustRecall,
        excludeViolations: forensics.excludeViolations,
        finalQueryCoordCount: forensics.finalQueryCoordCount,
        unsatisfiable: meta.unsatisfiable,

        latencyMs: finishedAt - startedAt,
        apiMs: state.apiMs,
        retrievedCoords: [...tools.accumulatedCoords],
        turnsTrace,
        ...(apiError ? { error: apiError } : {}),
    };

    // Full verbatim transcript (every message, every returned SDL slice, every query
    // + validator result) for offline review. The runner writes it to a file and sets
    // record.transcriptPath; it is NOT inlined into results.json.
    const transcript = renderTranscript(system, allMusts, missingMusts, record, state.messages);
    return { record, transcript };
}

/** Render the complete session as readable markdown: header + system prompt + every
 *  turn (assistant text, the FULL tool call, the FULL tool result — i.e. the actual
 *  SDL slice we returned or the validator message) + the outcome. */
function renderTranscript(
    system: string,
    musts: ReadonlyArray<string>,
    missing: ReadonlyArray<string>,
    rec: AgentRunRecord,
    messages: ReadonlyArray<ChatMessage>,
): string {
    const L: string[] = [];
    L.push(`# ${rec.queryId} · ${rec.chatModelId} · prompt=${rec.promptId}`);
    L.push(
        `**${rec.success ? 'SUCCESS' : 'FAIL: ' + (rec.failReason ?? '?')}** — covered ${rec.mustHits}/${rec.mustTotal} musts` +
            ` · ${rec.queriesUsed} valid / ${rec.invalidQueries} invalid queries · ${rec.searchCalls} searches (${rec.emptySearches} empty)` +
            ` · ${rec.turns} turns · ${(rec.apiMs / 1000).toFixed(0)}s api · $${rec.totalCostUsd.toFixed(4)}`,
    );
    if (rec.submittedAnswer !== undefined) {
        L.push(`- **answer:** ${rec.submittedAnswer}`);
        if (rec.expectedAnswer !== undefined) L.push(`- **expected:** ${rec.expectedAnswer}`);
        if (rec.answerCorrect !== undefined) {
            L.push(
                `- **grade:** ${rec.answerCorrect ? 'MATCH ✅' : 'MISMATCH ❌'} (deterministic deep-equal)`,
            );
        }
    }
    L.push(
        `- retrieved ${rec.retrievedCoords.length} coords · answer-data coverage ${rec.mustHits}/${rec.mustTotal}` +
            ` (diagnostic) · first-execute recall ${(rec.firstExecuteRecall * 100) | 0}%`,
    );
    L.push(`- **required musts (diagnostic, ${musts.length}):** ${musts.join(', ')}`);
    if (missing.length)
        L.push(`- **musts not traversed (${missing.length}):** ${missing.join(', ')}`);
    L.push('');
    L.push('<details><summary>system prompt</summary>\n\n```\n' + system + '\n```\n</details>\n');

    let turn = 0;
    for (const msg of messages) {
        if (msg.role === 'assistant') {
            turn += 1;
            const text = msg.content
                .filter((b) => b.type === 'text')
                .map((b) => (b as { text: string }).text)
                .join('\n')
                .trim();
            const tools = msg.content.filter((b) => b.type === 'tool_use') as Array<{
                name: string;
                input: unknown;
            }>;
            L.push(`## Turn ${turn}`);
            if (text) L.push(`**assistant:** ${text}`);
            for (const t of tools) {
                if (t.name === 'search') {
                    const q = (t.input as { searchQuery?: unknown })?.searchQuery;
                    L.push(`**→ search(${JSON.stringify(q)})**`);
                } else if (t.name === EXECUTE_TOOL_NAME) {
                    const q = String((t.input as { query?: unknown })?.query ?? '');
                    const v = (t.input as { variables?: unknown })?.variables;
                    L.push('**→ execute:**\n```graphql\n' + q + '\n```');
                    if (v) L.push(`**→ variables:** ${JSON.stringify(v)}`);
                } else if (t.name === ANSWER_TOOL_NAME) {
                    const a = (t.input as { answer?: unknown })?.answer;
                    L.push(`**→ answer:** ${JSON.stringify(a)}`);
                } else {
                    L.push(`**→ ${t.name}(${JSON.stringify(t.input)})**`);
                }
            }
        } else {
            // user message = tool result(s): the FULL slice / validator output we returned.
            for (const b of msg.content) {
                if (b.type === 'tool_result') {
                    const content = (b as { content: string; isError?: boolean }).content;
                    const tag = (b as { isError?: boolean }).isError
                        ? 'returned (error)'
                        : 'returned';
                    L.push(
                        `**${tag}:**\n\n` +
                            (content.length > 4000
                                ? content.slice(0, 4000) + '\n…[truncated]'
                                : content),
                    );
                } else if (b.type === 'text') {
                    L.push(`**user:** ${(b as { text: string }).text}`);
                }
            }
        }
        L.push('');
    }
    return L.join('\n');
}

/** Append one error tool_result per ignored extra tool_use — every tool_use_id MUST
 *  get a result or the next OpenAI request 400s (§5.5). The first (index 0) was acted on. */
function appendIgnoredResults(toolUses: ToolUse[], into: ContentBlock[]): void {
    for (let i = 1; i < toolUses.length; i++) {
        into.push(
            toolResult(
                toolUses[i]!.id,
                'Ignored: emit exactly ONE tool call per turn. Only the first tool call was executed.',
                true,
            ),
        );
    }
}

/** Pull `searchQuery` from a search tool_use as a string[] — one intent or many
 *  (multi-q). Tolerates a bare string or a malformed/missing input. */
function extractSearchQueries(use: ToolUse): string[] {
    const input = use.input;
    if (input && typeof input === 'object' && 'searchQuery' in input) {
        const v = (input as { searchQuery: unknown }).searchQuery;
        if (typeof v === 'string') return [v];
        if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    }
    return [];
}

/** Empty-diff signal: a search that surfaced no new schema means the model already
 *  holds this part of the schema — break the re-search loop. Says nothing about the
 *  hidden grading state (no "required coordinate" framing). */
function emptyDiffMessage(): string {
    return (
        `No new schema — this search returned nothing beyond what you already retrieved. ` +
        `Search a genuinely different concept if you still need more of the schema; otherwise compose and run your query.`
    );
}

/** Pull `query` from an execute tool_use, tolerating malformed/missing input. */
function extractQuery(use: ToolUse): string {
    const input = use.input;
    if (input && typeof input === 'object' && 'query' in input) {
        const v = (input as { query: unknown }).query;
        if (typeof v === 'string') return v;
    }
    return '';
}

/** Pull `variables` from an execute tool_use — an object if present, else undefined. */
function extractVariables(use: ToolUse): Record<string, unknown> | undefined {
    const input = use.input;
    if (input && typeof input === 'object' && 'variables' in input) {
        const v = (input as { variables: unknown }).variables;
        if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    }
    return undefined;
}

/** Pull the structured `answer` value from an answer tool_use — the object/array/scalar
 *  the deterministic gate deep-equals against the expected value. Returns null when the
 *  input is missing/malformed (graded as a mismatch, never a crash). */
function extractStructuredAnswer(use: ToolUse): unknown {
    const input = use.input;
    if (input && typeof input === 'object' && 'answer' in input) {
        return (input as { answer: unknown }).answer;
    }
    return null;
}

interface Forensics {
    mustHits: number;
    mustMissing: number;
    finalMustRecall: number;
    excludeViolations: number;
    finalQueryCoordCount: number;
}

/**
 * Forensics off the hot path (§3.3 / R2). Derives must coverage from the LAST
 * submitted query: if it passed (ok) all musts are covered; on a coverage miss we
 * have the exact `missing` list; on parse/validate (coverage never reached) or no
 * execute at all, nothing is covered. `finalQueryCoordCount` walks the last query's
 * coords for the over-selection proxy. `excludeViolations` is 0 — the satisfiable
 * mustExclude list is not threaded into the session contract (see deviation note).
 */
function computeForensics(
    sdl: string,
    state: SessionState,
    mustTotal: number,
    success: boolean,
): Forensics {
    // finalQueryCoordCount: coord count of the last submitted query (proxy for over-selection).
    let finalQueryCoordCount = 0;
    if (state.lastSubmittedQuery) {
        let schema: GraphQLSchema | null = null;
        try {
            schema = buildSchema(sdl, { assumeValid: true });
        } catch {
            schema = null;
        }
        if (schema) finalQueryCoordCount = submittedCoords(schema, state.lastSubmittedQuery).size;
    }

    // Accumulated coverage across all valid queries is the source of truth.
    const mustHits = success ? mustTotal : Math.min(mustTotal, state.coveredMusts.size);
    const mustMissing = Math.max(0, mustTotal - mustHits);
    const finalMustRecall = mustTotal === 0 ? 1 : mustHits / mustTotal;

    return {
        mustHits,
        mustMissing,
        finalMustRecall,
        excludeViolations: 0,
        finalQueryCoordCount,
    };
}
