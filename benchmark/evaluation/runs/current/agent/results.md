# Agent Benchmark Results

Generated: `2026-06-13T12:50:05.806Z`

- Schemas: 5 (github, gitlab, linear, shopify, singapore)
- Categories: 1 (all-schemas)
- Chat models: 1 (gpt-4-1-mini)
- Strategies: 1 (slicer)
- Rows: 408

Fixed: embed=`openai-3-small`, maxTurns=12, maxToolCalls=20, maxCostUsd=$0.5000, temperature=0, nSamples=1, seed=0

## Headline — success% (the metric)

| model | strategy/prompt | rows | coverage | **success%** | [95% CI] | turns p50 | search μ | queries μ | invalid μ | api s μ | $ μ | $ total |
|---|---|---:|---:|---:|:--|---:|---:|---:|---:|---:|---:|---:|
| gpt-4-1-mini | slicer / default@69052b | 408/408 | 408/408 | **85.0%** | [81.3%, 88.2%] | 3 | 1.0 | 1.3 | 0.6 | 7.3 | $0.0118 | $4.83 |

> `coverage` = board cells present / expected (`queryCount × nSamples`); < 100% means some cells are missing under the current determinants. `queries μ` = mean valid queries used to reach coverage (1 ideal; >1 = split across queries). `invalid μ` = mean parse/validate-rejected queries before success.

> Denominator is SATISFIABLE rows (`rowCountSatisfiable`); the unsatisfiable carve-out (R1) is excluded — see below. Means are over satisfiable rows; `$ total` is the cohort bill over ALL rows.

## Failure taxonomy (failBreakdown — counts over all rows incl. unsatisfiable)

| model | strategy/prompt | wrong answer | no answer | budget turns | budget tool calls | budget cost | budget tokens | no tool call loop | api error | parse | validate | coverage | never executed | unsatisfiable ceiling | total |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-4-1-mini | slicer / default@69052b | 54 | 0 | 7 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 61 |

## Cost (totalCostUsd per row, per cohort)

| model | strategy/prompt | $ mean | $ p50 | $ p95 | $ max | $ total | shape |
|---|---|---:|---:|---:|---:|---:|:--|
| gpt-4-1-mini | slicer / default@69052b | $0.0118 | $0.0099 | $0.0248 | $0.0768 | $4.83 | `▄█▂▁▁▁▁▁▁▁` |

## Token usage

| model | strategy/prompt | in μ | out μ | cache-rd μ | cache-wr μ | embed μ | total in | total out | total cache-rd | total embed |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| gpt-4-1-mini | slicer / default@69052b | 36196 | 321 | 10523 | 0 | 11 | 14.8M | 131.0k | 4.3M | 4.6k |

> `μ` columns are per-session means over satisfiable rows; `total` columns sum over ALL rows in the cohort. `in` = prompt/input tokens, `out` = completion tokens, `cache-rd`/`cache-wr` = prompt-cache read/write, `embed` = search-query embedding tokens.

## Diagnostics — one-shot quality · thrash · retrieval ceiling

| model | strategy/prompt | 1-shot% | thrash% | gap: agent | gap: retrieval | gap: never-selected |
|---|---|---:|---:|---:|---:|---:|
| gpt-4-1-mini | slicer / default@69052b | 57.1% | 0% | 235 | 31 | 29 |

> `1-shot%` = succeeded with one valid query, no retries. `thrash%` = searches that added nothing. Each uncovered required coordinate is bucketed: **agent** (its field WAS retrieved but the model — which DID execute — didn't select it), **retrieval** (never surfaced by the slicer), **never-selected** (the session executed ZERO valid queries, so selection never happened — a loop/prompt issue, NOT attributable to agent skill or retrieval). Only the agent vs retrieval split is comparable across models; never-selected must be read separately.

## Turn distribution (turns per row, per cohort)

| model | strategy/prompt | mean | min | p50 | p95 | p99 | max | shape |
|---|---|---:|---:|---:|---:|---:|---:|:--|
| gpt-4-1-mini | slicer / default@69052b | 3.9 | 2 | 3 | 8 | 12 | 12 | `▁▁█▃▁▁▁▁▁▁` |

## Unsatisfiable carve-out (R1)

These queries have a structurally-unsatisfiable `mustInclude` (e.g. bare-union members the slicer can never surface; §4.4). They are carved out of the headline denominator: `successPct = successes / rowCountSatisfiable`. If a cohort's row was nonetheless started for one of these, its fail bucket is `unsatisfiable_ceiling`.

_None — no unsatisfiable queries in this run._
