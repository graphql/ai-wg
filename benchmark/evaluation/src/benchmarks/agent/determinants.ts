/**
 * Cache-key derivation for the agent benchmark — the single source of truth shared
 * by the runner's LIVE path and the full-board reader (so the two cannot drift).
 *
 * This module is PLUMBING, not a grading determinant: it composes the determinant
 * hashes into a per-cell cache key, but its own source is NOT folded into any hash.
 * That is deliberate — the key folds only BEHAVIORAL inputs (the validator/coords/
 * session/prompt/tools/mock/answer source, the budgets, the schema SDL, the query
 * content), so editing this composer never invalidates a cached record.
 *
 * The cacheKey composition is byte-identical to the historical runner.ts version
 * EXCEPT that `validatorSourceHash`'s file set drops `runner.ts` — the accepted-
 * answers grading logic now lives in `answer.ts` (hashed), so the runner genuinely
 * no longer decides pass/fail and must not be in the hash.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { computeJobCacheKey } from '../../core/shared/result-cache.ts';
import { SEARCH_INPUT_SCHEMA, EXECUTE_INPUT_SCHEMA, ANSWER_INPUT_SCHEMA } from './tools.ts';
import type {
    AgentModelDef,
    AgentPromptDef,
    EmbeddingSetup,
    QueryDef,
    StrategyDef,
} from '../../core/types.ts';

function sha256(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

/** The STATIC determinant hashes — the same for every cell of a run. */
export interface StaticDeterminants {
    /** Hash of the fixed tool INPUT schemas (the contract the model fills in). */
    toolSchemaHash: string;
    /** Hash of ALL harness source that decides pass/fail: validator + coord walk +
     *  session loop + prompt builder + tool defs + the shaped-mock executor + the
     *  deterministic structured-answer grader (answer.ts). NOT runner.ts. */
    validatorSourceHash: string;
    /** Hash of the fixed embedding setup (model + field/type template sourceHashes). */
    embedSetupHash: string;
}

/**
 * The behavioral source files folded into `validatorSourceHash`, relative to this
 * module. Exported so a test can assert `runner.ts` is NOT in the set.
 */
export const VALIDATOR_SOURCE_FILES: readonly string[] = [
    'validator.ts',
    'coords.ts',
    'session.ts',
    'prompt.ts',
    'tools.ts',
    'answer.ts',
];

/** Hash of the whole mock-server module (engine + every resolver map) so changing a
 *  resolver busts the job cache exactly like the validator/coords/session source. */
const MOCK_MODULE_FILES: readonly string[] = [
    'mock/types.ts',
    'mock/seed.ts',
    'mock/store.ts',
    'mock/coverage.ts',
    'mock/default-resolver.ts',
    'mock/attach.ts',
    'mock/executor.ts',
    'mock/index.ts',
    'mock/resolvers/common.ts',
    'mock/resolvers/registry.ts',
    'mock/resolvers/github.ts',
    'mock/resolvers/gitlab.ts',
    'mock/resolvers/linear.ts',
    'mock/resolvers/shopify.ts',
    'mock/resolvers/shopify.data.ts',
    'mock/resolvers/singapore.ts',
];

function mockModuleSourceHash(): string {
    const h = createHash('sha256');
    for (const f of MOCK_MODULE_FILES)
        h.update(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'));
    return h.digest('hex');
}

/** Compute the static (per-run) determinant hashes (R5). */
export function computeStaticDeterminants(setup: EmbeddingSetup): StaticDeterminants {
    const toolSchemaHash = sha256(
        JSON.stringify([SEARCH_INPUT_SCHEMA, EXECUTE_INPUT_SCHEMA, ANSWER_INPUT_SCHEMA]),
    );
    // Folds ALL harness source that decides pass/fail. The runner is excluded: it is
    // pure plumbing now (accepted-answers assembly moved to answer.ts).
    const h = createHash('sha256');
    for (const f of VALIDATOR_SOURCE_FILES) {
        h.update(readFileSync(new URL(`./${f}`, import.meta.url), 'utf8'));
    }
    h.update(mockModuleSourceHash());
    const validatorSourceHash = h.digest('hex');
    const embedSetupHash = sha256(
        [
            setup.model.sourceHash ?? setup.model.id,
            setup.template.sourceHash ?? setup.template.id,
            setup.typeTemplate.sourceHash ?? setup.typeTemplate.id,
        ].join('\0'),
    );
    return { toolSchemaHash, validatorSourceHash, embedSetupHash };
}

/** Hash of a schema's SDL (per-schema determinant). */
export function computeSchemaSdlHash(sdl: string): string {
    return sha256(sdl);
}

/** Hash of a query's gradable content (per-query determinant). Sorted arrays keep
 *  the hash order-stable. The reference operation is never shown to the model, but
 *  it affects entity pinning / legacy answer derivation; explicit answer keys affect
 *  grading/tool shape — both are folded. */
export function computeQueryContentHash(query: QueryDef): string {
    const content = JSON.stringify({
        query: query.query,
        queries: query.queries ?? null,
        schemaId: query.schemaId,
        category: query.category,
        mustInclude: [...query.mustInclude].sort(),
        mustExclude: [...(query.mustExclude ?? [])].sort(),
        shouldInclude: [...(query.shouldInclude ?? [])].sort(),
        targetFields: [...(query.targetFields ?? [])].sort(),
        targetTypes: [...(query.targetTypes ?? [])].sort(),
        operation: query.operation ?? null,
        answerSchema: query.answerSchema ?? null,
        answer: query.answer ?? null,
        answers: query.answers ?? null,
    });
    return sha256(content);
}

/** Budget options that fold into the cache key + the configHash. */
export interface BudgetOpts {
    maxTurns: number;
    maxToolCalls: number;
    maxCostUsd: number;
    temperature: number;
    nSamples: number;
    seed: number;
}

/** The ordered budget tag — folded into both the cache key and the configHash. */
export function computeBudgetTag(opts: BudgetOpts): string[] {
    return [
        String(opts.maxTurns),
        String(opts.maxToolCalls),
        String(opts.maxCostUsd),
        String(opts.temperature),
        String(opts.nSamples),
        String(opts.seed),
    ];
}

/** Short config hash folding the strategy's defaultConfig + the loop budgets +
 *  temperature (§3.3 configHash). Sorted keys keep it stable. */
export function computeConfigHash(strategy: StrategyDef, budgetTag: readonly string[]): string {
    const cfg = strategy.defaultConfig ?? {};
    const ordered = JSON.stringify(cfg, Object.keys(cfg).sort());
    return createHash('sha256')
        .update(ordered)
        .update('\0')
        .update(budgetTag.join('\0'))
        .digest('hex')
        .slice(0, 12);
}

/** The per-cell identity that, together with the static + per-schema/query
 *  determinants, fully determines a cache key. */
export interface CellIdentity {
    agentModel: AgentModelDef;
    strategy: StrategyDef;
    prompt: AgentPromptDef;
    query: QueryDef;
    sampleIndex: number;
}

/** Everything (besides the cell identity) the key composition reads. */
export interface CacheKeyDeterminants {
    statics: StaticDeterminants;
    budgets: BudgetOpts;
    /** Schema SDL hash, keyed by schemaId. */
    schemaSdlHashes: Map<string, string>;
    /** Query content hash, keyed by queryId. */
    queryContentHashes: Map<string, string>;
}

/**
 * Compose ONE cell's cache key. Byte-identical (modulo the runner.ts drop in
 * `validatorSourceHash`) to the historical inline composition, so the LIVE path and
 * the board reader produce the SAME key for the same inputs.
 */
export function computeCellCacheKey(cell: CellIdentity, d: CacheKeyDeterminants): string {
    const { agentModel: m, strategy: strat, prompt, query: q, sampleIndex } = cell;
    return computeJobCacheKey([
        'agent',
        m.id,
        m.sourceHash ?? m.id,
        strat.id,
        strat.sourceHash ?? strat.id,
        prompt.id,
        prompt.sourceHash ?? prompt.id,
        d.statics.embedSetupHash,
        d.statics.toolSchemaHash,
        d.statics.validatorSourceHash,
        String(d.budgets.maxTurns),
        String(d.budgets.maxToolCalls),
        String(d.budgets.maxCostUsd),
        String(d.budgets.temperature),
        String(d.budgets.nSamples),
        String(d.budgets.seed),
        String(sampleIndex),
        d.schemaSdlHashes.get(q.schemaId)!,
        d.queryContentHashes.get(q.id)!,
    ]);
}
