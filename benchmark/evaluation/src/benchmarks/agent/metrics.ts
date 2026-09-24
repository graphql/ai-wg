/**
 * Agent-benchmark records, report shapes, and cohort aggregation.
 *
 * This is a NEW report family — neither `RunReport` (perfect%) nor
 * `RankRunReport` (recall@K). It is success%-centric with cost/turn
 * distributions and a failure taxonomy (§3.3, §3.5).
 *
 * `aggregateAgentCohort` groups raw rows by `(chatModelId, strategyId)` and
 * produces one `AgentConfigSummary` per cohort. The headline denominator is the
 * SATISFIABLE row count (unsatisfiable bare-union queries are carved out, R1):
 * `successPct = successes / rowCountSatisfiable`, with a 95% Wilson interval.
 * Means are taken over satisfiable rows; `totalCostUsd`, the `failBreakdown`,
 * and the cost/turn distributions cover ALL rows in the cohort.
 */
import type { DistributionStats } from '../../core/types.ts';
import { distributionStats } from '../strategies/metrics.ts';
import type { Usage } from './clients/types.ts';

export type ToolKind = 'search' | 'execute' | 'answer' | 'none';

export type FailReason =
    | 'budget_turns'
    | 'budget_tool_calls'
    | 'budget_cost'
    | 'budget_tokens'
    | 'no_tool_call_loop'
    | 'api_error'
    | 'parse'
    | 'validate'
    | 'coverage' // last execute's failing kind, if it ended on a budget cap
    | 'wrong_answer' // the model answered but deep-equal vs expected failed
    | 'no_answer' // the model ran queries but never submitted an answer
    | 'never_executed'
    | 'unsatisfiable_ceiling';

/** One model round-trip, recorded for trace/debug + per-turn cost forensics. */
export interface AgentTurn {
    index: number; // 1-based
    tool: ToolKind;
    /** For search: the searchQuery. For execute: a hash/preview of the submitted query. */
    toolInputPreview?: string;
    /** For execute: the validator outcome kind, or 'ok'. */
    validatorKind?: 'ok' | 'parse' | 'validate' | 'coverage';
    /** For execute coverage failures: the missing must coords (for trace). */
    missingCoords?: string[];
    /** For search turns: the coords this search NEWLY added (empty ⇒ empty-diff). */
    searchNewCoords?: string[];
    /** For the answer turn: a preview of the submitted answer. */
    answer?: string;
    /** Per-turn token usage — the locked `Usage` shape from ./clients/types.ts. */
    usage: Usage;
    costUsd: number;
    /** Wall-time spent in this turn's model API call (createTurn), ms. */
    apiMs?: number;
}

export interface AgentRunRecord {
    schemaId: string;
    queryId: string;
    category: string;
    chatModelId: string;
    strategyId: string;
    promptId: string; // the agent-prompt axis (default | …)
    configHash: string; // short hash of (strategy defaultConfig + budgets + temperature)
    sampleIndex: number; // 0..nSamples-1 (R6)

    success: boolean; // = the submitted answer deep-equals the expected value
    failReason?: FailReason; // absent iff success

    // answer (the GATE — deterministic structured-answer deep-equal)
    /** The model's submitted structured answer, JSON-stringified (absent if it never
     *  called `answer`). */
    submittedAnswer?: string;
    /** The expected answer value, JSON-stringified — YAML answer key or legacy derived value. */
    expectedAnswer?: string;
    /** Whether the submitted answer deep-equals the expected value (absent if no answer). */
    answerCorrect?: boolean;

    // loop counters
    turns: number;
    searchCalls: number;
    executeAttempts: number; // total execute calls (valid + invalid)
    queriesUsed: number; // valid queries that contributed coverage ("how many it needed")
    invalidQueries: number; // execute calls rejected at parse/validate
    emptySearches: number; // search turns that added 0 new coords (thrash)
    oneShot: boolean; // success with exactly 1 valid query and 0 invalid
    firstExecuteRecall: number; // musts covered by the FIRST valid query / total
    /** Path (relative to the run dir) to the full verbatim conversation transcript. */
    transcriptPath?: string;
    /** Retrieval ceiling: uncovered musts whose field WAS retrieved (agent error). */
    missingRetrieved: number;
    /** Retrieval ceiling: uncovered musts NEVER retrieved (slicer/search gap). */
    missingNotRetrieved: number;
    /** Uncovered musts on a row that executed ZERO valid queries — selection never
     *  happened, so NOT attributable to agent-vs-retrieval (ask-the-user/never-execute). */
    neverSelected: number;

    // token + cost accounting (R4: embed* included in totalCostUsd)
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    chatCostUsd: number;
    embedTokens: number;
    embedCostUsd: number;
    totalCostUsd: number; // chatCostUsd + embedCostUsd

    // grading forensics (NOT in the pass gate — R2)
    mustTotal: number;
    mustHits: number; // |coverage of final submitted query ∩ mustInclude|
    mustMissing: number;
    finalMustRecall: number; // mustHits/mustTotal (1.0 when mustTotal===0)
    /** Over-selection signal: how many submitted coords matched a mustExclude pattern. */
    excludeViolations: number;
    /** Coord count of the final submitted query (proxy for over-selection vs the oracle). */
    finalQueryCoordCount: number;
    /** Classification from §4.4 — true iff this query has a structurally-unsatisfiable must. */
    unsatisfiable: boolean;

    latencyMs: number; // total session wall-clock (incl. local tool work)
    apiMs: number; // wall-time spent INSIDE model API calls (the bound)
    /** Every coord the model RETRIEVED via search (the union of all slices). Lets us
     *  tell "search surfaced it but the model didn't select it" from "never retrieved". */
    retrievedCoords: string[];
    turnsTrace: AgentTurn[]; // full per-turn trace
    error?: string; // populated on api_error
}

export interface WilsonCI {
    lo: number;
    hi: number;
}

export interface AgentConfigSummary {
    chatModelId: string;
    strategyId: string;
    promptId: string;
    configHash: string;

    rowCount: number; // all rows for this cohort (all samples)
    rowCountSatisfiable: number; // rows excluding unsatisfiable==true (headline denominator, R1)
    /** distinct (schema,query) cells, for the effective-n note (R7). */
    distinctQueries: number;

    // HEADLINE
    successPct: number; // successes / rowCountSatisfiable
    successCI: WilsonCI; // 95% Wilson on (successes, rowCountSatisfiable)

    // central tendencies (over satisfiable rows)
    meanTurns: number;
    meanSearchCalls: number;
    meanExecuteAttempts: number;
    meanQueriesUsed: number; // mean valid queries to reach the result
    meanInvalidQueries: number; // mean rejected queries before getting it right
    meanApiMs: number; // mean model-API time per session (the latency bound)
    meanLatencyMs: number; // mean total session wall-clock
    // ── diagnostics (the 3 lenses) ──
    oneShotPct: number; // fraction of satisfiable rows that succeeded in ONE valid query, 0 invalid
    meanFirstExecuteRecall: number; // mean musts covered by the first valid query
    thrashRate: number; // empty searches / total searches across the cohort
    /** Retrieval-ceiling split over ALL uncovered musts in the cohort. */
    coverageGapAgent: number; // missing musts that WERE retrieved (agent didn't select) → fix the agent
    coverageGapRetrieval: number; // missing musts NEVER retrieved → fix the slicer/search
    coverageGapNeverSelected: number; // missing musts on zero-valid-query rows → fix the loop/prompt, NOT attributable
    meanInputTokens: number;
    meanOutputTokens: number;
    meanCacheReadTokens: number;
    meanCacheCreationTokens: number;
    meanEmbedTokens: number;
    meanChatCostUsd: number;
    meanEmbedCostUsd: number;
    meanTotalCostUsd: number;
    totalCostUsd: number; // sum over all rows in cohort — the bill for this cohort
    // token totals over ALL rows in the cohort (the volume behind the bill)
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheReadTokens: number;
    totalCacheCreationTokens: number;
    totalEmbedTokens: number;

    turnStats: DistributionStats; // reuse DistributionStats from core/types.ts
    costStats: DistributionStats; // totalCostUsd per row

    // failure taxonomy (counts over ALL rows incl. unsatisfiable)
    failBreakdown: Record<FailReason, number>;

    meanFinalMustRecall: number; // forensic (R2): how close failures got
    meanExcludeViolations: number; // forensic over-selection signal
}

export interface AgentRunReport {
    schemaVersion: 1;
    generatedAt: string;
    benchmarkType: 'agent';
    /** Fixed embedding setup used inside search (NOT varied). */
    fixed: {
        embeddingModel: string; // 'openai-3-small'
        fieldTemplate: string; // 'coord-return-desc'
        typeTemplate: string; // 'name-desc'
        maxTurns: number;
        maxToolCalls: number;
        maxCostUsd: number;
        temperature: number;
        nSamples: number;
        seed: number;
    };
    schemas: ReadonlyArray<{ id: string; name: string; description?: string }>;
    categories: ReadonlyArray<{ id: string; name: string; description?: string }>;
    chatModels: ReadonlyArray<{ id: string; name: string; provider: string; modelName: string }>;
    strategies: ReadonlyArray<{ id: string; name: string }>;
    /** The prompt axis cohort dimension. */
    prompts: ReadonlyArray<{ id: string; name: string }>;
    /** The unsatisfiable carve-out, documented in the report (R1). */
    unsatisfiableQueryIds: string[];
    /** The full-board denominator inputs (cache-as-ledger). A cohort's coverage is
     *  `rowCount / (queryCount × nSamples)`; the reporter flags missing cells. */
    board: {
        /** Board queries (cherry|full set, before the unsatisfiable carve). */
        queryCount: number;
        /** Satisfiable board queries (the headline-eligible denominator). */
        satisfiableCount: number;
    };
    summary: AgentConfigSummary[];
    rows: AgentRunRecord[];
}

/** Every FailReason key, so a fresh `failBreakdown` is dense (all zero). */
const FAIL_REASONS: readonly FailReason[] = [
    'wrong_answer',
    'no_answer',
    'budget_turns',
    'budget_tool_calls',
    'budget_cost',
    'budget_tokens',
    'no_tool_call_loop',
    'api_error',
    'parse',
    'validate',
    'coverage',
    'never_executed',
    'unsatisfiable_ceiling',
];

function emptyFailBreakdown(): Record<FailReason, number> {
    const out = {} as Record<FailReason, number>;
    for (const r of FAIL_REASONS) out[r] = 0;
    return out;
}

/**
 * 95% Wilson score interval (z = 1.96) for `successes` out of `n`, clamped to
 * [0, 1]. With `n === 0` the interval collapses to {0, 0} (no evidence).
 */
export function wilson(successes: number, n: number): WilsonCI {
    if (n <= 0) return { lo: 0, hi: 0 };
    const z = 1.96;
    const z2 = z * z;
    const phat = successes / n;
    const denom = 1 + z2 / n;
    const center = (phat + z2 / (2 * n)) / denom;
    const margin = (z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n)) / denom;
    const clamp = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
    return { lo: clamp(center - margin), hi: clamp(center + margin) };
}

function mean(xs: ReadonlyArray<number>): number {
    return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/**
 * Aggregate raw agent rows into one summary per `(chatModelId, strategyId)`
 * cohort. Insertion order of first appearance is preserved.
 */
export function aggregateAgentCohort(records: AgentRunRecord[]): AgentConfigSummary[] {
    const groups = new Map<string, AgentRunRecord[]>();
    const order: string[] = [];
    for (const r of records) {
        const key = `${r.chatModelId} ${r.strategyId} ${r.promptId}`;
        let bucket = groups.get(key);
        if (!bucket) {
            bucket = [];
            groups.set(key, bucket);
            order.push(key);
        }
        bucket.push(r);
    }

    const out: AgentConfigSummary[] = [];
    for (const key of order) {
        const rows = groups.get(key)!;
        const satisfiable = rows.filter((r) => !r.unsatisfiable);

        const successes = satisfiable.filter((r) => r.success).length;
        const rowCountSatisfiable = satisfiable.length;
        const successPct = rowCountSatisfiable === 0 ? 0 : successes / rowCountSatisfiable;

        const distinctKeys = new Set<string>();
        for (const r of rows) distinctKeys.add(`${r.schemaId} ${r.queryId}`);

        const failBreakdown = emptyFailBreakdown();
        for (const r of rows) {
            if (r.failReason) failBreakdown[r.failReason] += 1;
        }

        out.push({
            chatModelId: rows[0]!.chatModelId,
            strategyId: rows[0]!.strategyId,
            promptId: rows[0]!.promptId,
            configHash: rows[0]!.configHash,

            rowCount: rows.length,
            rowCountSatisfiable,
            distinctQueries: distinctKeys.size,

            successPct,
            successCI: wilson(successes, rowCountSatisfiable),

            meanTurns: mean(satisfiable.map((r) => r.turns)),
            meanSearchCalls: mean(satisfiable.map((r) => r.searchCalls)),
            meanExecuteAttempts: mean(satisfiable.map((r) => r.executeAttempts)),
            meanQueriesUsed: mean(satisfiable.map((r) => r.queriesUsed)),
            meanInvalidQueries: mean(satisfiable.map((r) => r.invalidQueries)),
            meanApiMs: mean(satisfiable.map((r) => r.apiMs)),
            meanLatencyMs: mean(satisfiable.map((r) => r.latencyMs)),
            oneShotPct:
                rowCountSatisfiable === 0
                    ? 0
                    : satisfiable.filter((r) => r.oneShot).length / rowCountSatisfiable,
            meanFirstExecuteRecall: mean(satisfiable.map((r) => r.firstExecuteRecall)),
            thrashRate: (() => {
                const s = satisfiable.reduce((a, r) => a + r.searchCalls, 0);
                return s === 0 ? 0 : satisfiable.reduce((a, r) => a + r.emptySearches, 0) / s;
            })(),
            coverageGapAgent: satisfiable.reduce((a, r) => a + r.missingRetrieved, 0),
            coverageGapRetrieval: satisfiable.reduce((a, r) => a + r.missingNotRetrieved, 0),
            coverageGapNeverSelected: satisfiable.reduce((a, r) => a + r.neverSelected, 0),
            meanInputTokens: mean(satisfiable.map((r) => r.inputTokens)),
            meanOutputTokens: mean(satisfiable.map((r) => r.outputTokens)),
            meanCacheReadTokens: mean(satisfiable.map((r) => r.cacheReadInputTokens)),
            meanCacheCreationTokens: mean(satisfiable.map((r) => r.cacheCreationInputTokens)),
            meanEmbedTokens: mean(satisfiable.map((r) => r.embedTokens)),
            meanChatCostUsd: mean(satisfiable.map((r) => r.chatCostUsd)),
            meanEmbedCostUsd: mean(satisfiable.map((r) => r.embedCostUsd)),
            meanTotalCostUsd: mean(satisfiable.map((r) => r.totalCostUsd)),
            totalCostUsd: rows.reduce((a, r) => a + r.totalCostUsd, 0),
            totalInputTokens: rows.reduce((a, r) => a + r.inputTokens, 0),
            totalOutputTokens: rows.reduce((a, r) => a + r.outputTokens, 0),
            totalCacheReadTokens: rows.reduce((a, r) => a + r.cacheReadInputTokens, 0),
            totalCacheCreationTokens: rows.reduce((a, r) => a + r.cacheCreationInputTokens, 0),
            totalEmbedTokens: rows.reduce((a, r) => a + r.embedTokens, 0),

            turnStats: distributionStats(rows.map((r) => r.turns)),
            costStats: distributionStats(rows.map((r) => r.totalCostUsd)),

            failBreakdown,

            meanFinalMustRecall: mean(satisfiable.map((r) => r.finalMustRecall)),
            meanExcludeViolations: mean(satisfiable.map((r) => r.excludeViolations)),
        });
    }
    return out;
}
