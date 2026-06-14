/**
 * Public contracts between framework (core/) and strategies.
 *
 * Strategies MAY import from this file. They MUST NOT import from any other
 * core/* module or from any other strategies/*. Cosine math, scoring, etc.
 * live inside each strategy folder — duplicate as needed.
 */

// ─── On-disk schema/query/strategy definitions ────────────────────────────

export interface SchemaMeta {
    id: string;
    name: string;
    description?: string;
}

export interface SchemaDef extends SchemaMeta {
    sdl: string; // raw GraphQL SDL
}

export interface CategoryMeta {
    id: string;
    name: string;
    description?: string;
}

export interface QueryDef {
    id: string;
    schemaId: string;
    category: string;
    query: string;
    /** Optional decomposed sub-queries for a multi-request ask (e.g. issues + PRs).
     *  When present, a strategy may slice on the MAX signal across all of them so
     *  the shared structural insurance is paid once. Absent ⇒ single `query`. */
    queries?: string[];
    mustInclude: string[];
    mustExclude?: string[];
    shouldInclude?: string[];
    /** Semantic ANSWER leaf fields ("Type.field"). Scored in field-embedding space. */
    targetFields?: string[];
    /** Semantic ANSWER types (bare type names). Scored in type-embedding space. */
    targetTypes?: string[];
    /** The reference GraphQL operation. Present in every query YAML for authoring/
     *  documentation and the strategy benchmarks. The agent benchmark NEVER uses it —
     *  not shown to the model, not used for grading. */
    operation?: string;
    /** JSON Schema for the `answer` tool — the contract the model fills in. This is the
     *  ONLY answer-related thing the model sees. A `description` on a property can state
     *  e.g. required ordering. */
    answerSchema?: Record<string, unknown>;
    /** The expected answer — the literal value the submitted answer is graded against
     *  (tolerant structural match). Sole source of truth; never derived from `operation`. */
    answer?: unknown;
    /** Additional acceptable answers, for questions with more than one correct answer
     *  (e.g. a legitimate field synonym, or an alternative valid value). The submitted
     *  answer passes if it matches `answer` OR any entry here. Literal values, not operations. */
    answers?: unknown[];
    notes?: string;
}

export interface StrategyMeta {
    id: string;
    name: string;
    description: string;
    /** Single default config for the strategy. */
    defaultConfig?: Record<string, unknown>;
}

// ─── Snapshot passed to every strategy ────────────────────────────────────

export interface FieldDef {
    coord: string; // "Type.field"
    parent: string;
    field: string;
    returnType: string; // unwrapped name (no ! or [])
    isList: boolean;
    isNonNull: boolean;
}

export interface SchemaSnapshot {
    schema: SchemaDef;
    fields: ReadonlyArray<FieldDef>;
    fieldByCoord: ReadonlyMap<string, FieldDef>;
    fieldsByType: ReadonlyMap<string, ReadonlyArray<FieldDef>>;
    rootTypes: ReadonlySet<string>; // typically just "Query"
    /** Pre-embedded vectors for every field coord present in `fields`. */
    fieldEmbeddings: ReadonlyMap<string, Float32Array>;
    /** Cosine similarity from a query embedding to every field coord. */
    cosineToQuery(queryEmbedding: Float32Array): Map<string, number>;
    /** Object/interface type names (introspection excluded — same filter as fields). */
    types: ReadonlyArray<string>;
    /** Pre-embedded vectors for every type present in `types`. */
    typeEmbeddings: ReadonlyMap<string, Float32Array>;
    /** Cosine similarity from a query embedding to every type embedding (mirror of cosineToQuery). */
    cosineToQueryTypes(queryEmbedding: Float32Array): Map<string, number>;
    /**
     * Pre-embedded vectors for every embeddable sub-element — keyed
     * `arg:Type.field(argName)`, `in:InputType.field`, `enum:EnumType.VALUE`.
     * Powers the cosine-aware buildSlice (relevance-pruned optional args /
     * input fields / enum values).
     */
    elementEmbeddings: ReadonlyMap<string, Float32Array>;
    /** Cosine similarity from a query embedding to every sub-element (mirror of cosineToQuery). */
    cosineToQueryElements(queryEmbedding: Float32Array): Map<string, number>;
}

// ─── Strategy I/O ─────────────────────────────────────────────────────────

export interface StrategyInput {
    snapshot: SchemaSnapshot;
    /** `embedding` is the primary (combined-NL) query vector — back-compat for
     *  single-query strategies. `embeddings` is the per-sub-query set (≥1; equals
     *  `[embedding]` when the query has no `queries`), for max-signal slicing. */
    query: QueryDef & { embedding: Float32Array; embeddings: Float32Array[] };
    config: Record<string, unknown>;
}

export interface StrategyResult {
    /** Selected field coordinates ("Type.field"). Dedup before returning. */
    selectedCoords: string[];
    /**
     * Optional non-field members to render verbatim in the slice. Keys:
     *   `arg:<ParentType>.<field>(<argName>)`
     *   `in:<InputType>.<field>`
     *   `enum:<EnumType>.<VALUE>`
     * When present, the slice is built in "explicit members" mode: an optional
     * arg/input-field is rendered iff its key is in this list, and an enum value
     * iff its key is in this list (required args/input-fields always kept).
     * Absent ⇒ existing relevance/full render.
     */
    selectedMembers?: string[];
    /** Optional per-coord notes the strategy wants surfaced in the markdown report. */
    notes?: Record<string, string>;
}

export interface StrategyDef extends StrategyMeta {
    run: (input: StrategyInput) => Promise<StrategyResult> | StrategyResult;
    /** SHA256 of the strategy's index.ts, used by the result cache for invalidation. */
    sourceHash?: string;
}

// ─── Metrics + reporting ──────────────────────────────────────────────────

export interface RowMetrics {
    mustTotal: number;
    mustHits: number;
    mustMissing: number;
    mustRecall: number; // hits / mustTotal (1.0 when mustTotal == 0)
    perfectRecall: boolean; // mustMissing === 0
    shouldRecall: number | null;
    excludeViolations: number;
    sliceTokens: number;
    sliceBytes: number;
    /** Number of selected coordinates ("Type.field") — the coordinate count. */
    selectedCount: number;
    /** Number of type definitions in the rendered slice (type/interface/input/enum/union/scalar). */
    sliceTypeCount: number;
}

export interface RunRecord {
    schemaId: string;
    queryId: string;
    category: string;
    strategyId: string;
    configHash: string;
    metrics: RowMetrics;
    selectedCoords: string[];
    latencyMs: number;
    error?: string;
}

/**
 * Distribution summary for a numeric series. Percentiles use nearest-rank.
 * `samples` is the raw sorted ascending series — kept so downstream tools
 * can re-percentile or plot histograms without re-running.
 */
export interface DistributionStats {
    n: number;
    mean: number;
    min: number;
    p10: number;
    p25: number;
    p50: number;
    p75: number;
    p95: number;
    p99: number;
    max: number;
    samples: number[];
}

export interface ConfigSummary {
    strategyId: string;
    configHash: string;
    rowCount: number;
    rowCountWithMusts: number;
    /** THE headline metric: % of with-musts queries where every must is in the slice. */
    perfectPct: number;
    /** Distribution of mustMissing values — coarse complement of perfectPct. */
    missDistribution: {
        miss0: number;
        miss1: number;
        miss2: number;
        miss3plus: number;
    };
    /** mustRecall stats over rows with mustTotal > 0 (consistent denominator with perfectPct). */
    recallStats: DistributionStats;
    /** sliceTokens stats over ALL rows. */
    tokenStats: DistributionStats;
    /** selectedCount (coordinate count) stats over ALL rows. */
    coordStats: DistributionStats;
    /** sliceTypeCount (types in the rendered slice) stats over ALL rows. */
    typeStats: DistributionStats;
    meanExcludeViol: number;
    meanLatencyMs: number;
}

export interface RunReport {
    schemaVersion: 1;
    generatedAt: string; // ISO timestamp (only place we use a real wall-clock)
    schemas: SchemaMeta[];
    categories: CategoryMeta[];
    strategies: StrategyMeta[];
    summary: ConfigSummary[];
    rows: RunRecord[];
}

// ─── Template + Model definitions (Phase 1: types only) ───────────────────

/**
 * Context handed to a TemplateDef.render call. Lets templates that care about
 * structure (description-aware, type-graph-aware, etc.) reach a little beyond
 * the single field — without giving them the full SDL.
 */
export interface TemplateContext {
    schema: SchemaDef;
    fieldsByType: ReadonlyMap<string, ReadonlyArray<FieldDef>>;
    /** For description-aware templates (default template uses this). null if not available. */
    descriptionFor: (coord: string) => string | null;
}

/**
 * A template is a pure render function: given a field, produce the string we
 * embed for that field. Templates are self-contained — they only depend on
 * core/types.ts. No algorithm code.
 */
export interface TemplateDef {
    id: string;
    name: string;
    description: string;
    /** Which member kinds this template renders. Today eval only has 'field'. */
    applies: ReadonlySet<'field'>;
    render: (field: FieldDef, ctx: TemplateContext) => string;
    /** SHA256 of the template's index.ts, used by the result cache for invalidation. */
    sourceHash?: string;
}

/**
 * Enumerated object/interface type, handed to a TypeTemplateDef.render call.
 * The type-template axis varies what string we embed PER TYPE — independently
 * of the field rendering — so the type-embedding space can be benchmarked on
 * its own. `fieldNames` are the bare field names of this type (no parent), in
 * the order the schema declares them.
 */
export interface TypeDef {
    name: string;
    kind: 'object' | 'interface';
    fieldNames: string[];
}

/**
 * Context handed to a TypeTemplateDef.render call. Mirrors TemplateContext but
 * is scoped to type rendering: it exposes the full field list per type and the
 * type's own description, so description-aware / field-aware type templates can
 * reach a little beyond the bare name without seeing the full SDL.
 */
export interface TypeTemplateContext {
    schema: SchemaDef;
    fieldsByType: ReadonlyMap<string, ReadonlyArray<FieldDef>>;
    /** Description of a TYPE for type-embedding rendering. null if not available. */
    descriptionForType: (typeName: string) => string | null;
}

/**
 * A type template is a pure render function: given a type, produce the string
 * we embed for that type. Type templates are self-contained — they only depend
 * on core/types.ts. No algorithm code. This is the type-space counterpart to
 * TemplateDef (the field-space template).
 */
export interface TypeTemplateDef {
    id: string;
    name: string;
    description: string;
    render: (type: TypeDef, ctx: TypeTemplateContext) => string;
    /** SHA256 of the type template's index.ts, used by the result cache for invalidation. */
    sourceHash?: string;
}

/**
 * A model is pure config — no code. Today only OpenAI is wired up; the
 * provider field is here so adding others later is a config-only change.
 */
export interface ModelDef {
    id: string;
    name: string;
    description: string;
    provider: 'openai';
    modelName: string; // e.g. 'text-embedding-3-small'
    dims: number; // e.g. 1536
    costPerMillionTokens?: number;
    /** SHA256 of the model's meta.json, used by the result cache for invalidation. */
    sourceHash?: string;
}

// ─── Agent (chat) models — the LLM-in-the-loop benchmark axis ──────────────
// Separate from ModelDef (which is OpenAI-embedding-only). Chat models live in
// src/agent-models/ and are loaded by loadAgentModels(); keeping them out of
// src/models/ avoids the embeddings.ts openai-only provider path.

/** Chat-model pricing, USD per 1M tokens. */
export interface ChatPricing {
    inputPerMillion: number;
    outputPerMillion: number;
    /** Anthropic cache write (~1.25× input) / read (~0.1× input). OpenAI: cacheWrite
     *  unused (0); cacheRead is the discounted cached-prompt rate. */
    cacheWritePerMillion: number;
    cacheReadPerMillion: number;
}

export interface AgentModelDef {
    id: string; // 'claude-sonnet-4-6'
    name: string;
    description: string;
    provider: 'anthropic' | 'openai';
    modelName: string; // wire model id, e.g. 'claude-sonnet-4-6'
    maxTokens: number; // per-turn max output tokens
    pricing: ChatPricing;
    /** Explicit prompt-cache control (Anthropic) vs automatic (OpenAI). */
    supportsCacheControl: boolean;
    /** Whether a custom `temperature` is accepted. GPT-5 / o-series reasoning models
     *  reject anything but their default and 400 on `temperature: 0`; set false so the
     *  client omits the param. Defaults to true (omitted ⇒ true). */
    supportsTemperature?: boolean;
    /** SHA256 of meta.json, set by loadAgentModels for cache invalidation. */
    sourceHash?: string;
}

/** A swappable agent PROMPT — the model-facing instruction surface (system prompt
 *  + tool descriptions). A comparison axis alongside chat-model and strategy, so
 *  the benchmark can measure how different promptings drive the search→execute
 *  loop. Lives in src/agent-prompts/<id>/. The user-prompt (question rendering) is
 *  fixed and NOT part of this. */
export interface AgentPromptDef {
    id: string;
    name: string;
    description: string;
    /** The system prompt; the only variable input is the schema name. */
    buildSystem: (opts: { schemaName: string }) => string;
    /** `search` / `execute` / `answer` tool descriptions (they steer the model → part of the prompt). */
    searchToolDescription: string;
    executeToolDescription: string;
    answerToolDescription: string;
    /** SHA256 of index.ts, set by loadAgentPrompts for cache invalidation. */
    sourceHash?: string;
}

/**
 * A (model × field template × type template) triple fully determines how a
 * snapshot is embedded. `template` renders the FIELD space; `typeTemplate`
 * renders the TYPE space. The two are independent axes.
 */
export interface EmbeddingSetup {
    model: ModelDef;
    template: TemplateDef;
    typeTemplate: TypeTemplateDef;
}
