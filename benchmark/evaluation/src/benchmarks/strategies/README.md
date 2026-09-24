# Strategies benchmark

## TLDR

The original benchmark in this harness. **Fixes** the embedding model
(`openai-3-small`) and the field-rendering template (`coord-return-desc`) and
**varies** the slicing strategy. Headline metric is `perfect%` — the fraction
of with-musts queries where every `mustInclude` coord ended up in the slice.

Cohort granularity = one row per strategy (using its `defaultConfig`).

## How it works

1. The runner builds a snapshot per schema by parsing SDL, rendering
   `<Type>.<field> -> <ReturnType> — <description>` for every field, and
   embedding those strings with OpenAI `text-embedding-3-small`. The disk
   cache under `.embed-cache/openai-3-small/coord-return-desc/` makes re-runs
   effectively free.
2. Each query string is embedded with the same (model, template).
3. For every `(query × strategy)` pair, a worker thread asks the strategy to
   return a list of `Type.field` coords. The harness then turns those coords
   into a sliced SDL, tokenizes it, and computes `mustHits`, `mustMissing`,
   `excludeViolations`, `sliceTokens`, etc.
4. Rows are aggregated per `(strategyId × configHash)` into a `ConfigSummary`
   carrying `perfectPct`, `missDistribution`, `recallStats`, `tokenStats`,
   `meanExcludeViol`, `meanLatencyMs`.

## When to pick this benchmark

- You changed a strategy's algorithm or constants and want to know whether the
  new version actually finds more musts (or finds the same musts in fewer
  tokens).
- You added a new strategy and want it ranked against the existing 22.
- You're hunting regressions before merging a strategy PR.

## Metrics produced

| Metric                               | Meaning                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| `perfectPct`                         | Headline. `% of with-musts rows where mustMissing === 0`.                                               |
| `missDistribution.miss{0,1,2,3plus}` | Coarse complement of perfectPct — how badly the strategy fails when it fails.                           |
| `recallStats`                        | mean / p10 / p25 / p50 / p75 / min of `mustHits / mustTotal`, over with-musts rows.                     |
| `tokenStats`                         | mean / min / p50 / p95 / p99 / max of slice token counts, over ALL rows. The cost side of the tradeoff. |
| `meanExcludeViol`                    | Average `mustExclude` matches per row.                                                                  |
| `meanLatencyMs`                      | Per-row strategy latency (worker-local clock).                                                          |

## Output

`runs/current/strategies/results.{json,md}` — JSON is canonical, markdown is
generated for humans / PRs.
