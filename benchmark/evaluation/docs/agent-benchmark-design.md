# Agent Benchmark — Implementation-Ready Design

> **Status:** final spec. Build directly from this. Every identifier, signature, and file path below is grounded in the existing codebase (`src/core/cli.ts`, `src/benchmarks/models/*`, `src/core/shared/*`, `scripts/op-coords.ts`). Where this spec adds net-new code it says so explicitly.

The `agent` benchmark is a fifth category alongside `strategies | templates | type-templates | models`. It runs an **agentic LLM-in-the-loop schema-search game**: a chat model is given a user's natural-language question and two tools — `search` (embeds a query, runs the configured slicer strategy, returns a compact sub-schema SDL) and `execute` (validates the model's GraphQL query against the FULL schema and checks coordinate coverage). The benchmark measures whether the model can drive the search→execute loop to a correct, fully-covering query, and at what cost (turns, tokens, dollars).

**Axes:** `chatModel × strategy × query`. The embedding setup used inside `search` is held FIXED (it is not the thing under test). The varied cohort is `(chatModel, strategy)`.

---

## 0. Resolved decisions from the adversarial review (read this first)

These are binding. Each downstream section implements one of them.

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Where implemented            |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| R1  | **Pre-classify musts into satisfiable vs structurally-unsatisfiable.** Only the **6 bare-union must rows** across 3 union names (`PinnableItem`, `ProjectV2ItemFieldValue`, `DiscountCustomerSelection`) are truly unreachable by any field walk. These queries are **excluded from the headline denominator** and **never started as a session** (would burn full budget for 0% chance).                                                                                                                                                          | §4.4, §4.6, §7.4             |
| R2  | **Grade against `mustInclude` (over-selection allowed), NOT against the oracle `operation`.** ~37 queries have musts richer than their own reference operation; grading against the operation would reject the canonical answer for being _too rich_-incompatible. We grade against musts; the gate therefore rewards a fuller query. We **record** over-selection (`mustExclude` hits, coord count) in the row but it is NOT in the pass/fail gate. The oracle `operation` is loaded only for an offline sanity assert, never shown to the model. | §4.5, §4.6                   |
| R3  | **Walk only spread-reachable selections from the operation root** when collecting a submitted query's coords, so a defined-but-unspread fragment cannot "cover" a missing coord. We still run `validate(specifiedRules)` first (which rejects unused fragments) — but coverage no longer _depends_ on that ordering.                                                                                                                                                                                                                               | §4.2                         |
| R4  | **Count the SEARCH embedding spend.** `embedOne` is wrapped by an embedding-cost accounting shim so the per-`search` embedding tokens/$ are threaded into the run cost (small, usually cache-warm, but the prompt asks).                                                                                                                                                                                                                                                                                                                           | §3 (`EmbedAccounting`), §5.4 |
| R5  | **Cache key fully determines the record.** The key folds: category tag, chatModel id+sourceHash, strategy id+sourceHash, schema SDL hash, query content hash, embedding-setup hashes, **system-prompt text hash, tool-schema hash, validator-source hash, all budgets (maxTurns/maxToolCalls/maxCostUsd), temperature, AND `nSamples`+`seed`**. Editing the prompt or a budget invalidates stale traces.                                                                                                                                           | §7.3                         |
| R6  | **Non-determinism is sampled, not pretended-away.** `nSamples` (default 1) draws are run per cell; `seed` is in the key so re-sampling is deliberate. Report `successPct` with a Wilson 95% CI. `temperature:0` does NOT make tool use deterministic — do not claim it does.                                                                                                                                                                                                                                                                       | §3, §7.5                     |
| R7  | **`-kw` variants are correlated, not independent.** The 816 files are 408 base + 408 keyword-rephrased pairs with IDENTICAL musts. Report treats them as 408 correlated pairs for the effective-n note in the CI; rows are kept separate (phrasing-robustness is a reportable sub-axis), never silently pooled.                                                                                                                                                                                                                                    | §7.5                         |
| R8  | **Network-bound loop runs on the MAIN thread** via `mapWithConcurrency` at LOW concurrency (default 4). NO worker-thread pool, NO `worker.ts`, NO `worker-entry.mjs`. This is the deliberate divergence from the other 4 runners; it is called out in a header comment in `runner.ts`. Snapshots are still warmed once on main (CPU, cache-first).                                                                                                                                                                                                 | §7.1, §7.6                   |
| R9  | **Chat models live in a SEPARATE `src/agent-models/` dir**, NOT `src/models/`. `embeddings.ts::callProvider` throws on any `provider !== 'openai'`; an Anthropic chat model dropped into `src/models/` would break the embedding path. A new `loadAgentModels()` loader + `--list` line that tolerates missing `dims` handles them.                                                                                                                                                                                                                | §2, §3, §7.2                 |
| R10 | **Three-path validator with distinct recoverable messages.** `parse()` THROWS → `kind:'parse'`; `validate()` RETURNS an array (`[]`===valid) → `kind:'validate'`; coverage superset check → `kind:'coverage'`. The coverage message tells the model to **use `search` to locate the missing coords**.                                                                                                                                                                                                                                              | §4, §6                       |
| R11 | **Accumulate-coords-over-the-union.** Each `search` adds the strategy's `selectedCoords` to a running set; the returned slice is rebuilt over the UNION. What the model sees grows monotonically and is exactly what `execute` will be graded against. "Giving the model the union is honest."                                                                                                                                                                                                                                                     | §3 (`SessionState`), §5      |
| R12 | **Loop guards:** `no_tool_call` twice in a row terminates; budgets (turns, tool-calls, cost) terminate. Never start an R1-unsatisfiable session.                                                                                                                                                                                                                                                                                                                                                                                                   | §1, §7.4                     |

---

## 1. Overview + the agent loop as a state machine

### 1.1 What one job is

One **job** = one `(chatModel, strategy, query, sampleIndex)` tuple. It runs ONE `AgentSession`: a bounded tool-use conversation that ends in `success` or one of several `failReason`s. A job produces exactly one `AgentRunRecord`.

### 1.2 The session state machine

`AgentSession` is a **pure state machine with injected ports** (no direct I/O of its own; see §3 `ModelClient`/`ToolRegistry`/`Validator`). States:

```
                         ┌─────────────────────────────────────────┐
                         │                                          │
   START ──► AWAIT_MODEL ─(assistant turn returned)─► ROUTE         │
                  ▲                                     │           │
                  │                                     ├─ tool_use=search  ──► DO_SEARCH ──┐
                  │                                     ├─ tool_use=execute ──► DO_EXECUTE   │
                  │                                     ├─ no tool_use ───────► NO_TOOL      │
                  │                                     │                                    │
                  └──────────── APPLY_RESULT ◄──────────────────────────────────────────────┘
                                     │
       (DO_EXECUTE → validator.ok)   │   (budget/turn/guard tripped)
              ▼                       ▼
            DONE(success)        DONE(fail:<reason>)
```

**State definitions**

- **START** — seed `messages` with the user prompt (the query's NL `query` text, or the joined `queries[]` for multi-request; see §4.7). Initialize `SessionState` (§3): empty `accumulatedCoords`, `turn=0`, counters zeroed, `consecutiveNoTool=0`.
- **AWAIT_MODEL** — call `client.createTurn({ system, tools, messages })`. Increment `turn`. Accumulate `Usage` (§5.3) into the record. **Pre-check budgets BEFORE the call** so we never pay for a turn past the cap.
- **ROUTE** — inspect the assistant turn:
    - exactly one `tool_use` block for `search` → **DO_SEARCH**
    - exactly one `tool_use` block for `execute` → **DO_EXECUTE**
    - > 1 tool_use block → take the FIRST, ignore the rest, append a tool_result error for each ignored id (OpenAI requires a result per `tool_call_id` or the next request 400s; see §5.5). Surfaced as a soft nudge, not a hard fail.
    - 0 tool_use blocks (model emitted only text) → **NO_TOOL**.
- **DO_SEARCH** — run `tools.search(input.searchQuery)` (§5.1): `embedOne` the query (cost-accounted, R4), run `strategy.run(...)`, union `selectedCoords` into `accumulatedCoords` (R11), `buildSlice` over the union, return the SDL string as the tool_result. `searchCalls++`.
- **DO_EXECUTE** — run `validator.check(input.query)` (§4): parse → validate → coverage. `executeAttempts++`. If `ok`, → **DONE(success)**. Else append the kind-specific error message as the tool_result (§6) and → **APPLY_RESULT**.
- **NO_TOOL** — `consecutiveNoTool++`. If `consecutiveNoTool >= 2` → **DONE(fail:`no_tool_call_loop`)**. Else append a user nudge ("You must call exactly one tool: search or execute.") and → **AWAIT_MODEL**. Any tool call resets `consecutiveNoTool=0`.
- **APPLY_RESULT** — append the assistant turn + the tool_result message(s), then → **AWAIT_MODEL**.
- **DONE** — terminal. Build `AgentRunRecord`.

### 1.3 Termination conditions (checked at AWAIT_MODEL entry and after each tool)

| Condition                                          | `failReason`            | Notes                                                                            |
| -------------------------------------------------- | ----------------------- | -------------------------------------------------------------------------------- |
| `execute` validator returns `ok`                   | — (success)             | only success path                                                                |
| `turn >= maxTurns`                                 | `budget_turns`          | default `maxTurns = 12`                                                          |
| `searchCalls + executeAttempts >= maxToolCalls`    | `budget_tool_calls`     | default `maxToolCalls = 20`                                                      |
| `costUsd >= maxCostUsd`                            | `budget_cost`           | default `maxCostUsd = 0.50` per session                                          |
| `inputTokens+outputTokens... ` over `maxTokens`    | `budget_tokens`         | optional; default off (cost cap dominates)                                       |
| `consecutiveNoTool >= 2`                           | `no_tool_call_loop`     | R12                                                                              |
| model API error (after N retries)                  | `api_error`             | see §5.6 retry policy                                                            |
| session never called `execute` before a budget cap | `never_executed`        | refinement of the budget reason; set when `executeAttempts === 0` at termination |
| query is R1-unsatisfiable                          | `unsatisfiable_ceiling` | **never started** — recorded directly without a session (§7.4)                   |

`failReason` is the _most specific_ applicable reason. Precedence: `success` > `unsatisfiable_ceiling` > `no_tool_call_loop` > `api_error` > `budget_cost` > `budget_tokens` > `budget_tool_calls` > `budget_turns`; and `never_executed` is an orthogonal flag layered onto whichever budget reason fired.

### 1.4 Turn cap rationale

`maxTurns=12` allows ~5–6 search/execute round-trips plus retries. Combined with `maxCostUsd=0.50` and prompt caching (§5.2) this bounds worst-case spend per session. See §8 for the full-run estimate.

---

## 2. File layout

All paths under `/workspaces/evaluation/`. **New** unless marked _(edit)_.

```
src/
  agent-models/                              # NEW loadable axis (R9) — chat models, NOT embedding models
    claude-sonnet-4-6/
      meta.json                              # AgentModelDef config (provider, pricing, modelName)
    claude-haiku-4-6/
      meta.json
    gpt-4-1/                                  # OpenAI seam, lands after Claude (optional initial)
      meta.json
  benchmarks/
    agent/
      runner.ts                              # export runBenchmark(opts: RunOptions): Promise<AgentRunReport>; main-thread mapWithConcurrency loop (R8)
      session.ts                             # AgentSession pure state machine (§1.2) + SessionState
      tools.ts                               # ToolRegistry: search(...) + execute(...); JSON schemas for both tools
      validator.ts                           # three-path Validator (§4): parse/validate/coverage + coord walk
      coords.ts                              # spread-reachable coord walk (§4.2) + must classification (§4.4)
      clients/
        types.ts                             # ModelClient interface + ChatMessage/ToolUse/Usage/ToolDef (§3)
        anthropic.ts                         # AnthropicClient (ModelClient impl) (§5)
        openai.ts                            # OpenAIClient (ModelClient impl) — seam, lands second (§5.7)
        cost.ts                              # costOf(usage, pricing) per provider; pricing table lookup (§5.4)
      prompt.ts                              # buildSystemPrompt() + tool descriptions (§6)
      metrics.ts                             # AgentTurn, AgentRunRecord, AgentConfigSummary, AgentRunReport, aggregateAgentCohort, wilson()
      reporter.ts                            # export writeReport(report, outDir): {jsonPath; mdPath}; STREAMED json (§7.7)
      meta.json                              # benchmark descriptor (mirrors src/benchmarks/models/meta.json)
  core/
    cli.ts                                   # (edit) add 'agent' to union+BENCHMARKS, imports, dispatch block, runAgent()
    shared/
      loader.ts                              # (edit) add loadAgentModels()
      embed-accounting.ts                    # NEW (R4) embedOneAccounted(): wraps embedOne, returns {vec, tokens}
    types.ts                                 # (edit) add `operation?: string` to QueryDef; add AgentModelDef
package.json                                 # (edit) add "eval:agent" script + "@anthropic-ai/sdk" dep
```

**No `worker.ts` / `worker-entry.mjs`** for this category — deliberate (R8). The header comment in `runner.ts` must state why.

---

## 3. Exact TypeScript types

### 3.1 Tool input schemas

Defined once in `tools.ts`, exported as both runtime JSON Schema (for the providers) and a TS type (for the handlers). Using literal JSON Schema objects (not zod-derived) keeps the schema text stable so its hash is stable (R5).

```ts
// src/benchmarks/agent/tools.ts
export const SEARCH_TOOL_NAME = 'search' as const;
export const EXECUTE_TOOL_NAME = 'execute' as const;

/** JSON Schema for `search`. The model passes a natural-language search query;
 *  we embed it and return a compact sub-schema SDL. */
export const SEARCH_INPUT_SCHEMA = {
    type: 'object',
    properties: {
        searchQuery: {
            type: 'string',
            description:
                'A natural-language description of the schema elements you need (types, fields, arguments). ' +
                'This is embedded and matched against the schema; it is NOT GraphQL.',
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
    },
    required: ['query'],
    additionalProperties: false,
} as const;

export interface SearchInput {
    searchQuery: string;
}
export interface ExecuteInput {
    query: string;
}
```

### 3.2 ModelClient port + message/usage types

```ts
// src/benchmarks/agent/clients/types.ts

/** Provider-agnostic tool definition (mapped per provider in each client). */
export interface ToolDef {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>; // JSON Schema
}

/** A normalized assistant tool-use request. */
export interface ToolUse {
    id: string; // tool_use_id (Anthropic) / tool_call.id (OpenAI)
    name: string; // 'search' | 'execute'
    input: unknown; // parsed JSON object (OpenAI arguments are JSON-stringified — client parses)
}

/** A normalized turn-level usage record. Cache fields are provider-mapped:
 *  Anthropic: cache_creation_input_tokens / cache_read_input_tokens.
 *  OpenAI:    cachedInputTokens from prompt_tokens_details.cached_tokens
 *             (NOTE: OpenAI's input_tokens INCLUDE cached; Anthropic's EXCLUDE — see cost.ts). */
export interface Usage {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number; // Anthropic only; 0 for OpenAI
    cacheReadInputTokens: number; // Anthropic cache_read; OpenAI cached_tokens
}

/** Normalized message in the running transcript. `content` blocks mirror Anthropic's
 *  shape; the OpenAI client translates to/from chat-completions messages internally. */
export type ContentBlock =
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: unknown }
    | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean };

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: ContentBlock[];
}

/** Result of one provider round-trip. */
export interface ModelTurn {
    /** Raw assistant content blocks (text + tool_use) to append to the transcript. */
    content: ContentBlock[];
    /** The tool_use blocks, normalized (possibly empty). */
    toolUses: ToolUse[];
    /** True iff the provider signalled it wants to run tools (Anthropic stop_reason==='tool_use'). */
    wantsTool: boolean;
    usage: Usage;
}

export interface CreateTurnArgs {
    system: string;
    tools: ToolDef[];
    messages: ChatMessage[];
}

/** The single seam every provider implements. Pure: takes a transcript, returns one turn. */
export interface ModelClient {
    readonly providerId: string; // 'anthropic' | 'openai'
    createTurn(args: CreateTurnArgs): Promise<ModelTurn>;
}
```

### 3.3 SessionState, AgentTurn, AgentRunRecord

```ts
// src/benchmarks/agent/session.ts (state) + metrics.ts (records)

/** Mutable per-session bookkeeping (not serialized; the record below is). */
export interface SessionState {
    turn: number;
    searchCalls: number;
    executeAttempts: number;
    consecutiveNoTool: number;
    /** Union of every strategy.run() selectedCoords seen so far (R11). */
    accumulatedCoords: Set<string>;
    messages: ChatMessage[];
    // running cost accumulators
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    chatCostUsd: number;
    embedTokens: number; // R4
    embedCostUsd: number; // R4
}
```

```ts
// src/benchmarks/agent/metrics.ts

export type ToolKind = 'search' | 'execute' | 'none';
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
    usage: {
        inputTokens: number;
        outputTokens: number;
        cacheCreationInputTokens: number;
        cacheReadInputTokens: number;
    };
    costUsd: number;
}

export interface AgentRunRecord {
    schemaId: string;
    queryId: string;
    category: string;
    chatModelId: string;
    strategyId: string;
    configHash: string; // short hash of (strategy defaultConfig + budgets + temperature)
    sampleIndex: number; // 0..nSamples-1 (R6)

    success: boolean;
    failReason?: FailReason; // absent iff success

    // loop counters
    turns: number;
    searchCalls: number;
    executeAttempts: number;

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

    latencyMs: number;
    turnsTrace: AgentTurn[]; // full per-turn trace
    error?: string; // populated on api_error
}
```

### 3.4 AgentModelDef (chat-model config)

```ts
// src/core/types.ts (append). Does NOT extend or overload ModelDef (R9).
export interface ChatPricing {
    /** USD per 1M tokens. */
    inputPerMillion: number;
    outputPerMillion: number;
    /** Anthropic cache write (~1.25× input) / read (~0.1× input). OpenAI: cacheWrite unused (0),
     *  cacheRead is the discounted cached-prompt rate. */
    cacheWritePerMillion: number;
    cacheReadPerMillion: number;
}

export interface AgentModelDef {
    id: string; // 'claude-sonnet-4-6'
    name: string;
    description: string;
    provider: 'anthropic' | 'openai';
    modelName: string; // wire model id, e.g. 'claude-sonnet-4-6-20250...'
    maxTokens: number; // per-turn max_tokens / max_completion_tokens
    pricing: ChatPricing;
    /** Whether this provider supports explicit prompt-cache control (Anthropic) vs automatic (OpenAI). */
    supportsCacheControl: boolean;
    sourceHash?: string; // SHA256 of meta.json, set by loadAgentModels (cache invalidation)
}
```

`QueryDef` gains one optional field (the YAMLs already carry it; the TS interface omitted it):

```ts
// src/core/types.ts QueryDef — add:
  /** The reference GraphQL operation. Loaded for the offline oracle/sanity assert ONLY;
   *  NEVER shown to the model. The model must author its own query. */
  operation?: string;
```

…and `loadQueries` already spreads `...parsed`, so `operation` flows through automatically once it is on the interface — verify it is not stripped (it is not; the loader spreads the parsed YAML).

### 3.5 Report + summary shapes

A **new** report shape — neither `RunReport` (perfect%) nor `RankRunReport` (recall@K). Success%-centric with cost/turn distributions and a failure taxonomy.

```ts
// src/benchmarks/agent/metrics.ts

export interface WilsonCI {
    lo: number;
    hi: number;
}

export interface AgentConfigSummary {
    chatModelId: string;
    strategyId: string;
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
    meanInputTokens: number;
    meanOutputTokens: number;
    meanCacheReadTokens: number;
    meanCacheCreationTokens: number;
    meanChatCostUsd: number;
    meanEmbedCostUsd: number;
    meanTotalCostUsd: number;
    totalCostUsd: number; // sum over all rows in cohort — the bill for this cohort

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
    /** The unsatisfiable carve-out, documented in the report (R1). */
    unsatisfiableQueryIds: string[];
    summary: AgentConfigSummary[];
    rows: AgentRunRecord[];
}
```

---

## 4. The Validator

`validator.ts` exports a `Validator` with one method, driven by the FULL schema (built once per session). It runs the three phases in order and returns the FIRST failure.

```ts
// src/benchmarks/agent/validator.ts
import { buildSchema, parse, validate, specifiedRules, type GraphQLSchema } from 'graphql';

export type ValidatorResult =
    | { ok: true }
    | { ok: false; kind: 'parse'; message: string }
    | { ok: false; kind: 'validate'; message: string; errors: string[] }
    | { ok: false; kind: 'coverage'; message: string; missing: string[] };

export interface Validator {
    /** mustInclude is the satisfiable-must list for this query (see §4.4/§4.6). */
    check(submitted: string): ValidatorResult;
}

export function makeValidator(opts: {
    schema: GraphQLSchema; // built with { assumeValid: true } once per session
    mustInclude: ReadonlyArray<string>;
}): Validator {
    /* §4.1–§4.6 */
}
```

### 4.1 Phase 1 — parse (THROWS)

```ts
let doc;
try {
    doc = parse(submitted);
} catch (e) {
    return { ok: false, kind: 'parse', message: parseErrorMessage(e) }; // §6 wording
}
```

### 4.2 Phase 2 — validate (RETURNS an array; `[]` === valid)

```ts
const errors = validate(schema, doc, specifiedRules); // 27 standard rules
if (errors.length > 0) {
    return {
        ok: false,
        kind: 'validate',
        errors: errors.map((e) => e.message),
        message: validateErrorMessage(errors),
    }; // §6
}
```

`assumeValid: true` is only a schema-construction flag (repo convention); it does NOT weaken query validation. The `NoUnusedFragments` rule here rejects defined-but-unspread fragments — but coverage (Phase 3) is built to NOT depend on that (R3), so reordering or relaxing rules can't open a gaming hole.

### 4.3 Phase 3 — coverage (superset check)

Collect the coords the submitted query **traverses**, then assert every `mustInclude` coord is present:

```ts
const used = submittedCoords(schema, submitted); // §4.2 walk, spread-reachable only
const missing = mustInclude.filter((m) => !used.has(m));
if (missing.length > 0) {
    return { ok: false, kind: 'coverage', missing, message: coverageErrorMessage(missing) }; // §6 — tells model to SEARCH for these
}
return { ok: true };
```

### 4.4 The coord walk — spread-reachable only (`coords.ts`)

This is the hardened union of the existing `operationCoords` (input-object/arg closures) and a **bare-field + arg walk** that visits ONLY selections reachable from an operation's root by resolving fragment spreads — so an unused fragment contributes nothing (R3).

```ts
// src/benchmarks/agent/coords.ts
import {
    parse,
    visit,
    visitWithTypeInfo,
    TypeInfo,
    Kind,
    type GraphQLSchema,
    type DocumentNode,
    type SelectionSetNode,
} from 'graphql';
import { operationCoords } from '../../../scripts/op-coords.ts';

/** Coords a submitted query TRAVERSES, walking ONLY selections reachable from an
 *  OperationDefinition root (fragment spreads resolved; unused fragments ignored). */
export function submittedCoords(schema: GraphQLSchema, operation: string): Set<string> {
    const out = new Set<string>();
    let ast: DocumentNode;
    try {
        ast = parse(operation);
    } catch {
        return out;
    }

    // Index named fragments so we can resolve spreads on demand.
    const fragments = new Map<string, SelectionSetNode>();
    for (const def of ast.definitions) {
        if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def.selectionSet);
    }

    const ti = new TypeInfo(schema);
    // Build a doc that contains ONLY the operations + fragments they transitively spread,
    // OR (simpler, equivalent for coord emission) visit with TypeInfo but gate Field emission
    // on reachability by walking operations manually and following FragmentSpread → fragment.
    //
    // Implementation: visit each OperationDefinition; on FragmentSpread, recurse into the
    // referenced fragment's selectionSet under the SAME TypeInfo (push/enter the fragment's
    // type condition). The whole-document `visit` over UNUSED fragment defs is avoided by
    // walking from operation roots only.
    for (const def of ast.definitions) {
        if (def.kind !== Kind.OPERATION_DEFINITION) continue;
        walkSelectionSet(def.selectionSet, ti, fragments, new Set(), out);
    }

    // Merge the input-object/arg closure (bare input type names + Input.field + required closures).
    // operationCoords walks the whole doc, but it only emits coords for ARGUMENTS actually
    // passed; an unused fragment carries no arguments to a root call, so this is safe to union.
    for (const c of operationCoords(schema, operation)) out.add(c);
    return out;
}
```

`walkSelectionSet` uses `visitWithTypeInfo(ti, …)` semantics on each selection set, emitting:

- **`${parent.name}.${fdef.name}`** — bare field traversal (the 66% of musts `operationCoords` omits). `parent = ti.getParentType()`, `fdef = ti.getFieldDef()`; **skip introspection** (`fdef.name.startsWith('__')`).
- **`${parent.name}.${fdef.name}(${argNode.name.value}:)`** — for each `node.arguments`, trailing `:`, no value.
- On a `FragmentSpread`, look up `fragments.get(name)`; if present and not already on the current recursion path (cycle guard via the `Set`), recurse into it (TypeInfo narrows to the fragment's type condition).
- On an `InlineFragment`, recurse; `ti.getParentType()` correctly narrows to the `... on X` type.

TypeInfo correctness (verified in grounding): **aliases** resolve to the real field (`getFieldDef()`), **variables** are irrelevant (coord uses `argNode.name.value`), **inline fragments** narrow `getParentType()`.

### 4.5 Coordinate formats (what must/coverage compare)

- `Type.field` — object/interface field traversal (3130/4720 musts ≈ 66%)
- `Type.field(arg:)` — argument presence, trailing `:`, no value (1584/4720 ≈ 34%)
- bare `Type` — **only 6 musts, all UNIONS** (`PinnableItem`, `ProjectV2ItemFieldValue`, `DiscountCustomerSelection`)

Input-object names / `Input.field` / `Enum.VALUE` appear in `operationCoords` closures and in slices but are NOT used as mustInclude entries in this corpus.

### 4.6 Classifying musts: satisfiable vs unsatisfiable (R1)

`coords.ts` exports a pure classifier run once per query at load time (no model needed):

```ts
export interface MustClassification {
    satisfiable: string[]; // graded by the coverage gate
    unsatisfiable: string[]; // the bare-union musts no field walk can produce
    isUnsatisfiableQuery: boolean; // unsatisfiable.length > 0
}

/** A must is unsatisfiable iff it is a BARE type name AND that type is a UNION in the schema.
 *  (A union name is never emitted by a Type.field walk and operationCoords only emits bare
 *  INPUT type names — so no model output can cover it.) */
export function classifyMusts(
    schema: GraphQLSchema,
    mustInclude: ReadonlyArray<string>,
): MustClassification;
```

Implementation: a must with no `.` and no `(` is a bare type; resolve it in the schema; if `isUnionType(named)` → unsatisfiable. Everything else → satisfiable. This yields exactly the 6 known rows (`gh-ext-045` `PinnableItem`, the `ProjectV2ItemFieldValue` row(s), `shop-073` `DiscountCustomerSelection`). The validator is constructed with `mustInclude = classification.satisfiable`, so even if we _did_ start a session for one of these queries, coverage would grade only the reachable musts. But per R1 we **don't start it at all** when `isUnsatisfiableQuery` (§7.4): we emit a record with `success:false, failReason:'unsatisfiable_ceiling', unsatisfiable:true` and exclude it from `rowCountSatisfiable`.

> Note on `gh-ext-045`: confirmed by reading the YAML — its `mustInclude` is `[Query.viewer, User.pinnedItems, PinnableItem, Repository.description, User.pinnedItems(first:)]` while its own `operation` only selects `pinnedItems(first:10){ __typename }`. So even the oracle fails its own musts (`PinnableItem` AND `Repository.description`). This is the canonical R1+R2 case: `PinnableItem` is structurally unsatisfiable (carve-out); `Repository.description` is satisfiable only by a _fuller_ query than the oracle (grade against musts, reward over-selection).

### 4.7 Multi-request `queries` (R7-adjacent)

The 4 files with `queries: string[]` (`gh-ext-055`, `gh-ext-092`, `glab-042`, `glab-073`) hold NL sub-asks, NOT multiple GraphQL docs. There is still exactly ONE answer expected. Handling:

- **User prompt** (§6): join the sub-asks into one numbered list so the model sees all asks.
- **Coverage**: unchanged — `mustInclude` is a single list; coverage is over the single submitted operation.
- **Search**: the model issues whatever `searchQuery` strings it wants; we never auto-decompose. (Unlike the strategy benchmarks which embed each sub-query, here the MODEL decides what to search.)

---

## 5. The Anthropic ModelClient (+ OpenAI seam)

### 5.1 Tool handlers (`tools.ts`)

```ts
export interface ToolContext {
    snapshot: SchemaSnapshot; // built once per (schema, embedding setup)
    strategy: StrategyDef;
    embedModel: ModelDef; // openai-3-small (fixed)
    embedTemplate: TemplateDef; // coord-return-desc (fixed; query embeds under FIELD template namespace)
    state: SessionState; // mutated: accumulatedCoords, embedTokens, embedCostUsd
    validator: Validator;
    sliceFloor?: number; // default DEFAULT_SLICE_FLOOR (0.25) via env
}

/** Run one search: embed → strategy.run → union coords → buildSlice over the union. */
export async function runSearch(searchQuery: string, ctx: ToolContext): Promise<string> {
    const { vec, tokens } = await embedOneAccounted(ctx.embedModel, ctx.embedTemplate, searchQuery); // R4
    ctx.state.embedTokens += tokens;
    ctx.state.embedCostUsd += (tokens / 1e6) * (ctx.embedModel.costPerMillionTokens ?? 0);
    const result = await ctx.strategy.run({
        snapshot: ctx.snapshot,
        query: { /* QueryDef shell */ embedding: vec, embeddings: [vec] } as any, // see §5.1 note
        config: ctx.strategy.defaultConfig ?? {},
    });
    for (const c of result.selectedCoords) ctx.state.accumulatedCoords.add(c); // R11
    // Build the slice over the UNION of all coords seen so far.
    return buildSlice(
        ctx.snapshot.schema.sdl,
        [...ctx.state.accumulatedCoords],
        relevanceOptsFromSnapshot(ctx.snapshot, vec),
    ); // mirrors strategies worker buildSlice opts
}

export function runExecute(query: string, ctx: ToolContext): ValidatorResult {
    return ctx.validator.check(query);
}
```

> **§5.1 note on the `query` shell:** `StrategyInput.query` is `QueryDef & { embedding; embeddings }`. For `search` we don't have a benchmark `QueryDef` (the model's `searchQuery` is free text), so we construct a minimal shell: `{ id:'agent-search', schemaId, category, query: searchQuery, mustInclude: [], embedding: vec, embeddings: [vec] }`. Strategies only read `embedding`/`embeddings`/`snapshot`/`config`; they do not read `mustInclude`. This is sound because the strategy's job is purely "given this query vector, pick coords."

> **buildSlice relevance:** reuse the same relevance closure the strategies worker uses — `snapshot.cosineToQueryElements(vec)` keyed by `arg:/in:/enum:` — so the rendered slice (args/inputs/enums pruned by cosine, `DEFAULT_SLICE_FLOOR=0.25`) matches what the strategy benchmark renders. Required args + pagination args always kept (buildSlice invariant).

### 5.2 Anthropic turn loop (`clients/anthropic.ts`)

Follows the established lazy-singleton + env-validate pattern from `getOpenAIClient`:

```ts
import type Anthropic from '@anthropic-ai/sdk';
let client: Anthropic | null = null;
async function getClient(): Promise<Anthropic> {
    if (client) return client;
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required to run the agent benchmark.');
    const { default: A } = await import('@anthropic-ai/sdk');
    client = new A({ apiKey });
    return client;
}

export function makeAnthropicClient(model: AgentModelDef): ModelClient {
    return {
        providerId: 'anthropic',
        async createTurn({ system, tools, messages }) {
            const c = await getClient();
            const res = await c.messages.create({
                model: model.modelName,
                max_tokens: model.maxTokens,
                system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], // §5.2 caching
                tools: tools.map((t, i) => ({
                    name: t.name,
                    description: t.description,
                    input_schema: t.inputSchema,
                    // cache the LAST tool's block → caches the whole tools array prefix:
                    ...(i === tools.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
                })),
                messages: messages.map(toAnthropicMessage), // ContentBlock → Anthropic content
            });
            return {
                content: res.content.map(fromAnthropicBlock),
                toolUses: res.content
                    .filter((b) => b.type === 'tool_use')
                    .map((b) => ({ id: b.id, name: b.name, input: b.input })),
                wantsTool: res.stop_reason === 'tool_use',
                usage: {
                    inputTokens: res.usage.input_tokens,
                    outputTokens: res.usage.output_tokens,
                    cacheCreationInputTokens: res.usage.cache_creation_input_tokens ?? 0,
                    cacheReadInputTokens: res.usage.cache_read_input_tokens ?? 0,
                },
            };
        },
    };
}
```

**Prompt caching (§5.2):** attach `cache_control: { type: 'ephemeral' }` to (a) the system block and (b) the last tool — this caches the stable `system + tools` prefix, which is identical across every turn of a session and across every query of a cohort. Caching is on by default in recent SDK; pin a recent `@anthropic-ai/sdk` 0.x so no `anthropic-beta` header is needed.

**Transcript building** (in `session.ts`, provider-agnostic): after each assistant turn, append `{ role:'assistant', content: turn.content }`; after running tools, append `{ role:'user', content: [{ type:'tool_result', toolUseId, content: <result> }] }`. The Anthropic client maps `ContentBlock` → Anthropic blocks (`tool_result` → `{ type:'tool_result', tool_use_id, content }`).

### 5.3 Reading usage

Per turn, read `res.usage` → the four fields above. Accumulate into `SessionState` and into the `AgentTurn` trace. The OpenAI client maps `prompt_tokens_details.cached_tokens` → `cacheReadInputTokens` and leaves `cacheCreationInputTokens = 0` (no cache-creation counter on OpenAI).

### 5.4 Cost (`clients/cost.ts`) — fixture-tested per provider (R5-accounting)

Pricing lives in each `AgentModelDef.pricing` (in `src/agent-models/<id>/meta.json`). `cost.ts` centralizes the per-provider arithmetic, because **the two providers count input tokens differently** and getting this wrong silently mis-bills every row:

```ts
/** Anthropic: input_tokens EXCLUDE cached/created tokens — they are billed via the
 *  cache_creation/cache_read fields. OpenAI: prompt_tokens INCLUDE cached_tokens —
 *  so we must SUBTRACT cached before charging the full input rate, then charge cached
 *  at the read rate. */
export function costOf(usage: Usage, provider: 'anthropic' | 'openai', p: ChatPricing): number {
    if (provider === 'anthropic') {
        return (
            (usage.inputTokens / 1e6) * p.inputPerMillion +
            (usage.outputTokens / 1e6) * p.outputPerMillion +
            (usage.cacheCreationInputTokens / 1e6) * p.cacheWritePerMillion +
            (usage.cacheReadInputTokens / 1e6) * p.cacheReadPerMillion
        );
    }
    // openai: inputTokens already includes cached; bill non-cached at input, cached at read.
    const nonCached = Math.max(0, usage.inputTokens - usage.cacheReadInputTokens);
    return (
        (nonCached / 1e6) * p.inputPerMillion +
        (usage.cacheReadInputTokens / 1e6) * p.cacheReadPerMillion +
        (usage.outputTokens / 1e6) * p.outputPerMillion
    );
}
```

This function MUST have a unit test with a fixture `Usage` per provider asserting the exact dollar value. Embedding cost (R4) is computed separately in `runSearch` from `embedModel.costPerMillionTokens` and added to `totalCostUsd`.

### 5.5 Exactly-one-action enforcement + tool_result pairing

The state machine takes the FIRST tool_use and ignores extras (§1.2 ROUTE). **Critical OpenAI trap:** every `tool_call` id in the assistant message MUST get a matching `{ role:'tool', tool_call_id, content }` in the next request or the API 400s. So for ignored extra tool_uses we still emit a `tool_result` with `isError:true` and a short "ignored: emit exactly one tool call per turn" message. Anthropic is more lenient but we do the same for symmetry of transcript shape. This is the #1 mid-run failure and is exactly why the loop is unit-testable via a fake `ModelClient` that returns 2 tool_use blocks.

### 5.6 Retry / error policy

`createTurn` failures (429, 5xx, network) retry with exponential backoff (e.g. 3 tries, 1s/2s/4s + jitter) inside the client. A persistent failure throws; the session catches it, sets `failReason:'api_error'`, records `error`, and terminates that session WITHOUT failing the whole run (one bad cell must not abort a sweep). 400s (malformed request — our bug) are NOT retried; they throw and abort, since they indicate a transcript-construction defect we must fix.

### 5.7 OpenAI seam (`clients/openai.ts`)

Same `ModelClient` interface. `client.chat.completions.create({ model, messages, tools:[{type:'function',function:{name,description,parameters}}], tool_choice:'auto' })`. Map `res.choices[0].message.tool_calls` (each `{id, function:{name, arguments(JSON string)}}`) → `ToolUse` (JSON.parse the arguments). Reply with `{ role:'tool', tool_call_id, content }`. `wantsTool = (message.tool_calls?.length ?? 0) > 0`. Usage from `res.usage` (CompletionUsage) → map `prompt_tokens→inputTokens`, `completion_tokens→outputTokens`, `prompt_tokens_details.cached_tokens→cacheReadInputTokens`, `cacheCreationInputTokens=0`. **Ship Claude end-to-end first; the OpenAI client is ~30 lines behind the same seam** (R8/pragmatic sequencing).

---

## 6. System prompt + tool-use protocol (`prompt.ts`)

`buildSystemPrompt(args: { schemaName: string })` returns a stable string (its hash is in the cache key — R5). Content:

```
You are a GraphQL query-authoring agent working against the "<schemaName>" GraphQL API.
You CANNOT see the schema directly. You discover it using tools.

You have exactly two tools and you MUST call exactly ONE tool per turn:

1. search(searchQuery): Describe, in natural language, the types/fields/arguments you
   need. We return a compact slice of the schema (SDL) most relevant to your description.
   Call search as many times as you need. Each search ADDS to what you have already seen —
   the schema slice you get back grows to include everything you have searched for so far.

2. execute(query): Submit a COMPLETE GraphQL operation that answers the user's question.
   We validate it against the full schema and check that it traverses every required
   schema coordinate. If it fails we tell you exactly why; fix it and call execute again.

Strategy: search first to discover the relevant types and fields, then execute. If execute
reports MISSING coordinates, use search with those names to find where they live, then
execute an updated query that selects them. Do not give up after one failure.

Rules:
- Exactly one tool call per turn. Do not emit a tool call and prose in the same turn.
- Never invent field or type names you have not seen in a search result.
- The query must be a single valid GraphQL document.
```

Tool **descriptions** (in `tools.ts`, hashed too) restate the contract tersely. The user message is the query's NL `query` (or, for multi-request, a numbered list of `queries[]`). Failure-message wording (`prompt.ts` exports these so they're hashed via validator-source — R5):

- **parse** (`kind:'parse'`): `"Your query could not be parsed (syntax error): <gql error>. Fix the syntax and call execute again."`
- **validate** (`kind:'validate'`): `"Your query is syntactically valid but failed schema validation: <first 1–3 error messages>. Use search to confirm the correct field/argument names, then call execute again."`
- **coverage** (`kind:'coverage'`): `"Your query is valid but does not yet reach all required parts of the schema. Missing coordinates: <missing list>. Use search to locate these (e.g. search for the type or field name), then call execute with a query that selects them."` — the coverage message is the recovery affordance the protocol hinges on (R10).

---

## 7. `cli.ts` wiring + runner

### 7.1 The divergence (header comment in `runner.ts`)

```ts
// AGENT BENCHMARK RUNNER — DELIBERATE DIVERGENCE FROM THE OTHER FOUR CATEGORIES.
// The agent loop is NETWORK-bound (LLM API round-trips), not CPU-bound. Worker
// threads buy nothing for an HTTP-bound loop and add structured-clone friction,
// so we DROP the worker pool / worker.ts / worker-entry.mjs entirely and run
// sessions on the MAIN thread via mapWithConcurrency at LOW concurrency (default 4)
// for rate-limit + cost safety. Snapshots are still warmed once on main (CPU,
// cache-first). The result cache still removes repeat cost across runs.
```

### 7.2 `loadAgentModels()` (`loader.ts`)

Mirror `loadModels` (lines 212–230) but read from `src/agent-models/` and parse into `AgentModelDef`; set `sourceHash` from the meta.json bytes. Wire it into the `Promise.all` at `cli.ts:167–175` and into `--list` with a line that **tolerates missing `dims`** (R9): `console.log(` ${m.id}  — ${m.name}  (${m.provider}/${m.modelName})`)`. (Do NOT print `${m.dims}d` for agent models — they have no dims.)

### 7.3 Arg parsing (`parseArgs`, `cli.ts:63–141`)

Add to the `BenchmarkType` union (`cli.ts:33`): `... | 'agent'`. Add to `BENCHMARKS` (`cli.ts:34–39`):

```ts
{ id: 'agent', name: 'Agent benchmark', description: 'Agentic LLM schema-search loop; vary (chat model × strategy). Headline: success%.' },
```

Reuse existing flags `--strategy`, `--query`, `--schema`, `--category`, `--concurrency`. Reuse `--model` to select **agent models** in the agent category (it filters `agentModelIds`; in other categories it still filters embedding models — the value is just a set of ids, resolved against `src/agent-models/` only inside `runAgent`). Add NEW flags to `Args` + the switch:

| Flag                   | `Args` field                 | Default | Meaning                                                     |
| ---------------------- | ---------------------------- | ------- | ----------------------------------------------------------- |
| `--max-turns <N>`      | `maxTurns: number\|null`     | 12      | per-session turn cap                                        |
| `--max-tool-calls <N>` | `maxToolCalls: number\|null` | 20      | per-session tool-call cap                                   |
| `--max-cost <USD>`     | `maxCostUsd: number\|null`   | 0.50    | per-session $ cap                                           |
| `--samples <N>`        | `nSamples: number\|null`     | 1       | draws per cell (R6)                                         |
| `--seed <N>`           | `seed: number\|null`         | 0       | RNG seed determinant (R6)                                   |
| `--temperature <F>`    | `temperature: number\|null`  | 0       | passed to provider                                          |
| `--limit <N>`          | `limit: number\|null`        | none    | cap total cells AFTER filtering (cost safety; R8/pragmatic) |

`--concurrency` default for agent is **4** (override the CPU-based default), because it is rate-limit/cost bound, not CPU bound.

### 7.4 `runAgent(...)` (new fn after `runModels`, `cli.ts:~443`)

Signature mirrors `runModels` (`cli.ts:371`):

```ts
async function runAgent(
    args: Args,
    schemas: SchemaDef[],
    categories: CategoryMeta[],
    queries: QueryDef[],
    templates: TemplateDef[],
    typeTemplates: TypeTemplateDef[],
    models: ModelDef[],
    strategies: StrategyDef[],
    agentModels: AgentModelDef[],
): Promise<void>;
```

(The dispatch call in `main()` passes the extra `strategies` and `agentModels` it already loaded.) Body:

1. Resolve FIXED embedding setup: `model = openai-3-small`, `template = coord-return-desc`, `typeTemplate = name-desc` (reuse `resolveDefaultSetup`).
2. Filter: `useAgentModels` (by `--model`), `useStrategies` (by `--strategy`), `useSchemas`, `useCategories`, `useQueries` — same pattern as `runModels`. Guard non-empty.
3. **R1 carve-out + `--limit`:** build the cell list `(agentModel × strategy × query × sampleIndex)`. For each query, run `classifyMusts`; mark `unsatisfiable` cells. Apply `--limit` to the cell count (deterministic order: sort by `queryId, modelId, strategyId, sampleIndex`). Print the count of unsatisfiable queries being carved out.
4. Call `runAgentBenchmark(opts)` (the runner) with all the above + budgets/temperature/seed/nSamples.
5. `outDir = join(here,'..','..','runs','current','agent')` (hardcode `'agent'`, the runX convention — R/gotcha). `await writeAgentReport(report, outDir)`.
6. Print the headline table (§7.6).

Dispatch block (add before the strategies fall-through at `cli.ts:206–209`):

```ts
if (args.benchmark === 'agent') {
    await runAgent(
        args,
        schemas,
        categories,
        queries,
        templates,
        typeTemplates,
        models,
        strategies,
        agentModels,
    );
    return;
}
```

Imports (`cli.ts:23–30`):

```ts
import { runBenchmark as runAgentBenchmark } from '../benchmarks/agent/runner.ts';
import { writeReport as writeAgentReport } from '../benchmarks/agent/reporter.ts';
```

And `loadAgentModels()` added to the `Promise.all` (`cli.ts:167`).

### 7.5 Runner internals (`runner.ts`)

`RunOptions` (agent-specific interface, exported):

```ts
export interface RunOptions {
    schemas: SchemaDef[];
    categories: CategoryMeta[];
    agentModels: AgentModelDef[];
    strategies: StrategyDef[];
    queries: QueryDef[];
    setup: EmbeddingSetup; // fixed embedding setup for search
    maxTurns: number;
    maxToolCalls: number;
    maxCostUsd: number;
    temperature: number;
    nSamples: number;
    seed: number;
    limit?: number;
    timestampIso: string;
    concurrency?: number; // default 4
    noCache?: boolean;
    onProgress?: (msg: string) => void;
}
export async function runBenchmark(opts: RunOptions): Promise<AgentRunReport>;
```

Flow (mirrors models/runner but main-thread):

1. **Warm snapshots** once on main, bounded-parallel (`mapWithConcurrency`, `WARM_CONCURRENCY=8`): `buildSnapshot({schema, template, typeTemplate, model})` per schema (single fixed embedding setup, so per-schema not per-model). Cache-first.
2. **Pre-hash** determinants: schema SDL hashes; query content hashes (same JSON shape as `models/runner.ts:122–135`, PLUS `operation` excluded — it's oracle-only and not shown, so it must NOT affect the cache key... actually INCLUDE `mustInclude` etc. as models does; `operation` is irrelevant to grading so leave it out).
3. **Static determinant hashes** (R5): `systemPromptHash = sha256(buildSystemPrompt sample)`, `toolSchemaHash = sha256(JSON.stringify([SEARCH_INPUT_SCHEMA, EXECUTE_INPUT_SCHEMA, tool descriptions]))`, `validatorSourceHash = sha256(read validator.ts + coords.ts + prompt.ts failure messages)`, `embedSetupHash` (model+template+typeTemplate sourceHashes).
4. **Build cell specs** `(agentModel × strategy × query × sampleIndex)`; skip-but-record `unsatisfiable` queries (no session). Apply `--limit`.
5. **Cache key** per cell (R5):
    ```ts
    computeJobCacheKey([
        'agent',
        m.id,
        m.sourceHash ?? m.id,
        strat.id,
        strat.sourceHash ?? strat.id,
        embedSetupHash,
        systemPromptHash,
        toolSchemaHash,
        validatorSourceHash,
        String(maxTurns),
        String(maxToolCalls),
        String(maxCostUsd),
        String(temperature),
        String(nSamples),
        String(seed),
        String(sampleIndex),
        schemaSdlHashes.get(q.schemaId)!,
        queryContentHashes.get(q.id)!,
    ]);
    ```
6. **Parallel cache read** (`Promise.all` of `readCached<AgentRunRecord>`); hits skip the API.
7. **Live cells** run on the MAIN thread via `mapWithConcurrency(liveSpecs, concurrency, runOneSession)`. `runOneSession` constructs the per-session `ModelClient` (provider from `AgentModelDef.provider`), `ToolContext` (snapshot, strategy, validator built from `classifyMusts(...).satisfiable`), runs `AgentSession`, returns the `AgentRunRecord`, then `writeCached(key, record)`.
8. **Aggregate** per `(chatModelId, strategyId)` cohort via `aggregateAgentCohort` → `AgentConfigSummary[]`. `successPct = successes / rowCountSatisfiable`; `successCI = wilson(successes, rowCountSatisfiable)`. `distinctQueries` for the effective-n note; the markdown notes that base/`-kw` pairs are correlated (R7).
9. Return `AgentRunReport`.

`wilson(successes, n)` (in `metrics.ts`): standard Wilson score interval at z=1.96; returns `{lo, hi}` clamped to [0,1].

### 7.6 Headline (printed by `runAgent`, mirrors `runModels` table style)

Sorted by `successPct` desc:

```
Headline (sorted by success%):
  model            strategy   success%   [95% CI]      turns p50   search μ   exec μ   $ μ      $ total
  ---------------------------------------------------------------------------------------------------
  claude-sonnet-4-6  slicer     71.4%    [66.1,76.2]      3         1.8       1.3      0.041    12.34
```

Per-row sub-breakdown optional (by schema, like strategies). Print the `failBreakdown` as a second table.

### 7.7 Reporter (`reporter.ts`)

Mirror `strategies/reporter.ts`: **stream `results.json`** (`writeReportJson`) because `turnsTrace` makes rows large and a full sweep (5 models × 30 strategies × 816 × samples) can hit V8's 512MB single-string cap. Markdown: headline success% table (with CI), failure-taxonomy table, cost table (mean/p50/p95/max per cohort), turn-distribution sparklines, and a documented carve-out section listing `unsatisfiableQueryIds`. Signature: `export async function writeReport(report: AgentRunReport, outDir: string): Promise<{ jsonPath: string; mdPath: string }>`.

---

## 8. Cost controls + rough estimate

**Controls**

- **Query sampling** — `--query`, `--category`, `--schema`, and `--limit` cut the cell count. **Always run a `--limit 5` (or `--query <one id>`) smoke run before any sweep** (R8). Cost is real money.
- **`maxTurns` / `maxToolCalls` / `maxCostUsd`** — per-session hard caps. The cost cap is the backstop that bounds the bill even if a model loops.
- **Slice-only, never full schema in prompt** — the model NEVER sees the full SDL; it only sees accumulated slices. This is the central token control: the system prompt + tools are cached (§5.2), and the only growing context is the slices the model itself requested.
- **Prompt caching** — system + tools cached per turn (and reused across a cohort's queries). On Anthropic, cache_read is ~0.1× input; on a 12-turn session the stable prefix is read ~11× at the discounted rate.
- **Result cache** — re-running a completed sweep with the cache on is free (records are content-addressed, R5). Only deliberate re-sampling (`--seed`/`--samples` change) re-bills.
- **Unsatisfiable carve-out (R1)** — the 6 bare-union rows are never started, eliminating ~6 guaranteed full-budget burns per `(model,strategy,sample)`.

**Rough estimate (Claude Sonnet-class, illustrative rates)**

Assume a typical successful session: ~5 turns, growing context, with caching. Per-turn input ~3–6k tokens (mostly cached after turn 1), output ~300–600 tokens. With cache read at ~0.1× input, a session lands roughly **$0.02–$0.06**; harder retry-heavy sessions approach the `$0.50` cap but are rare. Take **~$0.04 mean/session**.

- **Smoke run** (1 model × 1 strategy × 5 queries × 1 sample) ≈ **$0.20**.
- **One cohort, full corpus** (1 model × 1 strategy × ~810 satisfiable × 1 sample) ≈ 810 × $0.04 ≈ **$32**.
- **Modest matrix** (3 models × 3 strategies × 816 × 1 sample) ≈ 9 × $32 ≈ **$290**. Plus embedding spend, which is negligible and cache-warm after the first pass (R4 still threads it through `totalCostUsd`).
- **With `--samples 3`** for CI tightness, multiply by 3.

Budget the matrix deliberately; start at one cohort and expand. The `$ total` column in the headline reports the actual cohort bill so the next sweep can be sized from real numbers.

---

## 9. Incremental build order (single Claude + slicer + 1 query green first)

Each step compiles (`pnpm typecheck`) and is independently testable. The goal of steps 1–8 is ONE green run; 9–12 productionize.

1. **Types + dep.** Add `operation?: string` and `AgentModelDef`/`ChatPricing` to `core/types.ts`. `pnpm add @anthropic-ai/sdk`. Add `src/agent-models/claude-sonnet-4-6/meta.json`. Add `loadAgentModels()` to `loader.ts`. `typecheck` green.
2. **Coord walk + validator, UNIT-tested offline.** Write `coords.ts` (`submittedCoords`, `classifyMusts`) and `validator.ts`. Test against `gh-ext-045`'s `operation` (asserts `PinnableItem` unsatisfiable, oracle fails its own musts) and a few clean reference operations (assert all musts covered). NO API needed. This is the highest-risk correctness code — land it first and prove it.
3. **Tool handlers** (`tools.ts`): `runSearch` (embed → slicer → union → buildSlice) and `runExecute`. Test `runSearch` against a warmed snapshot + the `slicer` strategy with a hardcoded `searchQuery`; assert it returns parseable SDL whose `sliceMembers` include the strategy's picks. NO chat API needed.
4. **ModelClient port + cost.ts**, with a **fake `ModelClient`** that returns scripted turns. Unit-test `costOf` per provider with fixtures (R5). Unit-test the OpenAI tool_result-per-id pairing logic via the fake.
5. **AgentSession state machine** (`session.ts`) driven by the fake client: test exactly-one-action enforcement, `no_tool_call_loop` after 2 no-ops, budget termination, accumulate-coords union, and a scripted search→execute→success path. Still NO live API.
6. **AnthropicClient** (`clients/anthropic.ts`) — real `messages.create`, caching, usage mapping. Smoke: one `createTurn` with the real key returns a tool_use.
7. **Runner skeleton** (`runner.ts`): warm one snapshot, build ONE cell (`claude-sonnet-4-6 × slicer × gh-ext-007`-style satisfiable query × sample 0), run the session on main, write the record. NO cache yet, NO aggregation.
8. **cli.ts wiring**: union, `BENCHMARKS`, imports, `runAgent`, dispatch, `--list`, the new flags. Run `pnpm eval agent --model claude-sonnet-4-6 --strategy slicer --query <one-satisfiable-id> --limit 1`. **This is the first green run.**
9. **Cache + determinant hashing** (R5): add `computeJobCacheKey` with the full component list; verify a second run is a cache hit (free) and that editing the system prompt invalidates it.
10. **Metrics + aggregation + reporter** (`metrics.ts`, `reporter.ts`): `AgentConfigSummary`, `wilson`, streamed JSON, markdown headline + failure taxonomy + carve-out section. Run a `--limit 10` sample; inspect `results.md`.
11. **Carve-out + sampling + concurrency**: wire `classifyMusts` skip-list, `--samples`/`--seed`, `mapWithConcurrency` at default 4, `api_error` retry/catch. Run a small multi-query sample.
12. **OpenAI seam** (`clients/openai.ts`) behind the same `ModelClient`; add `src/agent-models/gpt-4-1/meta.json`. Verify with a 1-query run. Then size and run the first real cohort sweep from a `--limit` sample upward.
