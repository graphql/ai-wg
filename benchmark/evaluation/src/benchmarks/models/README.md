# Models benchmark

## TLDR

**Fixes** the field-rendering template (`coord-return-desc`) and the slicing
approach (pure-knn-K=50 reference ranking) and **varies** the embedding
model. The metric is rank-based and lives in **two independent retrieval
spaces**:

- **Field space** — embed every `Type.field` coord; score the query's
  `targetFields` (the semantic answer leaf fields) by rank/recall in the
  field-cosine ranking.
- **Type space** — embed every object/interface type as its own vector; score
  the query's `targetTypes` (the answer types) by rank/recall in the
  type-cosine ranking.

We do **not** score against `mustInclude` — that set is full of navigation
scaffolding and bare type names that aren't field coords, so they always sink
to the sentinel rank and pollute the distribution. Higher field `recall@50`
(and lower field `rank p50/p95`) mean the model better aligns query embeddings
with the right answer fields. Both spaces vary by model.

Headline metric: field `recall@50`. Type recall is reported alongside.

Cohort granularity = one row per model.

## How it works

1. For each model, the runner builds a snapshot per schema — every field's
   `<Type>.<field> -> <ReturnType> — <description>` string is embedded under
   that model, and every type's `<Type> — <description>` string is embedded as
   its own type-space vector. The cache namespace is
   `.embed-cache/<modelId>/coord-return-desc/`, so a new model is a cold cache
   (slow first run) and re-runs are free.
2. Each query string is embedded under the same model + template.
3. Workers compute the cosine of the query embedding against every field coord
   AND against every type, sort each descending (ties broken by coord asc for
   determinism), and record per-target rank + cosine in each space
   (`targetFields` against the field ranking, `targetTypes` against the type
   ranking). The cosine ranking IS pure-knn's top-K signal — we just keep it
   full so we can report rank percentiles instead of a binary "in top-K or
   not".
4. Per-cohort aggregates, computed independently per space: `rank` percentiles
   (p50 / p95 / p99), `recall@{20, 50, 100, 200}`, mean cosine on targets,
   mean latency.

No strategy code runs here. Comparing models with a strategy in the loop
would entangle two axes; the rank-based metric isolates the model signal.

## When to pick this benchmark

- You want to know whether spending more on a larger embedding model actually
  pulls more musts toward the top of the retrieval list.
- You're comparing OpenAI 3-small vs 3-large (the two models wired up in v1)
  before deciding which one to make the default.
- You want a model-only signal that isn't entangled with strategy choice.

## Metrics produced

| Metric                                                  | Meaning                                                                                        |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `fieldRankStats` / `typeRankStats` `.p50/p95/p99`       | Where the median / tail target ranks in the field / type cosine list. Lower = better.          |
| `fieldRecallAtK` / `typeRecallAtK` `[20\|50\|100\|200]` | Fraction of targets with `rank ≤ K`. Mean over rows-with-fields / rows-with-types.             |
| `fieldMeanCosine` / `typeMeanCosine`                    | Average cosine between query embedding and target field / type embedding.                      |
| `fieldPairs` / `typePairs`                              | Total (query, target) pairs scored per space — denominators for the rank distribution stats.   |
| `meanLatencyMs`                                         | Per-row cosine-rank latency (worker-local clock). Dominated by `cosineToQuery`, not the model. |

## Output

`runs/current/models/results.{json,md}` — JSON is canonical, markdown is
generated for humans / PRs.

## v1 scope

Only OpenAI models are wired up:

- `openai-3-small` (1536d, $0.02/Mtok) — default
- `openai-3-large` (3072d, $0.13/Mtok)

Adding Voyage / Cohere / etc. is a `provider` extension in
`core/shared/embeddings.ts` plus a new `src/models/<id>/meta.json`.
