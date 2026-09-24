# Templates Benchmark

**What varies:** the field rendering template (`src/templates/<id>/index.ts`).
**What's fixed:** the embedding model (`openai-3-small`) and the slicing
approach (a pure-knn-K cosine ranking, computed inline — no strategy code is
loaded).

The question this benchmark answers:

> Independent of any slicing algorithm, does the embedding text put the
> right field coords near the top of the cosine ranking?

## Cohorts

Every directory under `src/templates/` is a cohort. The template's `render`
function decides what string we embed per field; the model + cosine math are
identical across cohorts, so any difference in the headline numbers is
attributable to the template.

## Metric shape

The metric lives in **two independent retrieval spaces**:

- **Field space** — embed every `Type.field` coord; score the query's
  `targetFields` (semantic answer leaf fields) by rank/recall in the
  field-cosine ranking.
- **Type space** — embed every object/interface type as its own vector; score
  the query's `targetTypes` (answer types) by rank/recall in the type-cosine
  ranking.

We do **not** score against `mustInclude` — that set is full of navigation
scaffolding and bare type names that aren't field coords, so they always sink
to the sentinel rank and pollute the distribution. `targetFields` /
`targetTypes` are the semantic answer members.

For every `(template, query)` row, in each space, we compute the full cosine
ranking of every indexed member against the query embedding, then score it by
where each target landed (`metrics.fields` and `metrics.types`, each a
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

> Type-space caveat: the type template is **fixed** for this benchmark (the
> default `name-desc`), so the TYPE columns are identical across cohorts here.
> The TYPE rendering is varied by the sibling **`type-templates`** benchmark.
> The headline therefore stays **field** recall@50.

## Headline table

```
| template | rows | rank p50 | rank p95 | recall@20 | recall@50 | recall@100 | recall@200 | mean cos |
```

Two such tables are rendered — field-space (the headline) then type-space.
Both sorted by **field** `recall@50` descending.

## Why no strategy code

The strategies benchmark already measures slicing quality. Mixing templates
**and** a non-trivial strategy would muddy attribution — a great template
under a buggy strategy would look bad. Pure-knn-K on the raw cosine ranking
is the simplest, most strategy-agnostic probe of the embedding text itself.

## Files

- `meta.json` — benchmark id/name/description and which axis varies
- `runner.ts` — main-thread orchestration; warms cache, dispatches jobs
- `worker.ts` + `worker-entry.mjs` — workers rebuild snapshots from cache and
  compute the ranking inline
- `metrics.ts` — `SpaceMetrics`, `RankRowMetrics` (`{ fields, types }`),
  `TemplateCohortSummary`, aggregation
- `reporter.ts` — JSON + Markdown output under `runs/current/templates/`

## Caveats (Phase 2A)

- The `sig` and `sig-desc` templates render `Parent.field: ReturnType[]!`
  without argument lists. `FieldDef` in the eval harness does not carry
  argument metadata; adding it would mean re-parsing the SDL inside the
  template. Args are typically short; the impact on cosine ranking is
  expected to be small but is unmeasured. A future iteration can extend
  `FieldDef` with `args: Array<{name, type}>` and re-run.
- The embedding cache is keyed by `(model, template, text-sha)`. Changing a
  template's `render` output forces a fresh batch of OpenAI embedding calls.
