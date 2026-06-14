# Type-Templates Benchmark

**What varies:** the type rendering template (`src/type-templates/<id>/index.ts`).
**What's fixed:** the embedding model (`openai-3-small`), the FIELD rendering
template (`coord-return-desc`), and the slicing approach (a pure-knn-K cosine
ranking, computed inline — no strategy code is loaded).

The question this benchmark answers:

> Independent of any slicing algorithm, which type rendering puts the right
> TYPE near the top of the type-cosine ranking? Where is the best
> needle-in-haystack rendering for a type?

## Cohorts

Every directory under `src/type-templates/` is a cohort. The type template's
`render(type, ctx)` function decides what string we embed per object/interface
type; the model, field template, and cosine math are identical across cohorts,
so any difference in the headline numbers is attributable to the type template.

## Metric shape

The metric lives in **two independent retrieval spaces**, but the **headline is
the TYPE space** (the varied axis):

- **Type space (headline)** — embed every object/interface type as its own
  vector using the cohort's type template; score the query's `targetTypes`
  (answer types) by rank/recall in the type-cosine ranking.
- **Field space (context)** — embed every `Type.field` coord under the fixed
  field template; score the query's `targetFields`. Because the field template
  is fixed across cohorts, these columns are constant — they exist for parity
  with the templates/models reports.

We do **not** score against `mustInclude` — that set is full of navigation
scaffolding and bare type names that pollute the distribution. `targetTypes` /
`targetFields` are the semantic answer members.

For every `(typeTemplate, query)` row, in each space, we compute the full cosine
ranking of every indexed member against the query embedding, then score it by
where each target landed (`metrics.types` and `metrics.fields`, each a
`SpaceMetrics`):

- **`perRank[i]`** — `{ coord, rank, cos }` for target `i`. Rank is 1-based in
  the full descending sort. Missing members get the sentinel rank `N+1`.
- **`recallAtK[K]`** — fraction of targets in the top-K, for `K ∈ {20, 50, 100, 200}`.
- **`meanCosine`** — average cosine across the targets.
- **`hits`** — count of targets in the top `HEADLINE_K = 50` (matches the
  reference `pure-knn-K50`).

Per-cohort aggregations, per space:

- **rank p50 / p95 / p99** across every `(query, target)` pair.
- **mean recall@K** for each reported K across rows-with-targets.
- **mean cosine on targets** across every target seen.

The headline table is sorted by **type** `recall@50` descending.

## Why no strategy code

The strategies benchmark already measures slicing quality. Mixing the type
rendering **and** a non-trivial strategy would muddy attribution. Pure-knn-K on
the raw type-cosine ranking is the simplest, most strategy-agnostic probe of
the type embedding text itself.

## Files

- `meta.json` — benchmark id/name/description and which axis varies
- `runner.ts` — main-thread orchestration; warms cache, dispatches jobs
- `worker.ts` + `worker-entry.mjs` — workers rebuild snapshots from cache and
  compute the ranking inline
- `metrics.ts` — `SpaceMetrics`, `RankRowMetrics` (`{ fields, types }`),
  `TypeTemplateCohortSummary`, aggregation
- `reporter.ts` — JSON + Markdown output under `runs/current/type-templates/`

## Caveats

- The embedding cache is keyed by `(model, type-templates/<id>, text-sha)`.
  Changing a type template's `render` output forces a fresh batch of OpenAI
  embedding calls for the type space; the field space is untouched.
- The `name-fields` and `fields-only` type templates cap rendered field names
  at the first 30 to bound the embedding token count. Wide types (hundreds of
  fields) would otherwise blow past the model context and dilute the signal.
