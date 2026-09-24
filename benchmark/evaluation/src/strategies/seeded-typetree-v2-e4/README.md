# seeded-typetree-v2-e4

> **TL;DR.** Seeded type-tree v2 with a `hybrid.mode` knob that mixes per-type field picks with global cosine kNN (typed, strict, RRF-fused, or rerank) to rescue v2's type-not-retrieved misses.

## How it works

- Retrieve the top-`typesTopK` types by RRF-fusing a per-type cosine aggregate (max + half-mean-of-top-3 of the type's field cosines) with a token + trigram overlap score on the type name.
- Score each candidate field as `cosWeight*cos² + lexWeight*lex` (or `cos-gated`), where `lex` is the better of BM25-rank and trigram-rank surrogates built from field-name token/3-gram overlap.
- Apply the active `hybrid.mode` when picking fields per type: `off` uses the formula directly, `rrf-fusion` RRF-fuses the local formula order with a per-type-filtered global-kNN order, and `knn-rerank` takes a formula-ranked pool then re-orders it by raw cosine.
- Recurse one hop into object-valued picked fields, drawing up to `childrenPerPickedField` from each child type using the same pick policy.
- After the per-type loop, optionally inject global kNN coords: `typed-knn` keeps only coords whose parent type was retrieved, `strict-knn` keeps everything except `excludeRootTypes` parents.
- Close the selection with a paths-to-root expansion so every selected field is structurally reachable from `Query` (Mutation paths excluded by default).

## When to pick this

- Pick when you want to A/B the v2 type-tree against several hybrid global-kNN injection strategies behind a single `hybrid.mode` knob without forking the strategy.
- Use `mode='off'` as a clean v2 control row, or `'typed-knn'` / `'strict-knn'` to recover fields that v2 missed because their parent type fell outside `typesTopK`.
- Pick `'rrf-fusion'` or `'knn-rerank'` when v2 retrieves the right TYPES but ranks the wrong FIELDS inside them — these modes only reshuffle within retrieved types.
- Skip if you don't need the hybrid axis at all — plain `seeded-typetree-v2` has the same default behaviour with less surface area.

## Knobs

| Knob                          | Default   | Controls                                                                     |
| ----------------------------- | --------- | ---------------------------------------------------------------------------- |
| `nodeBudget`                  | 60        | Hard cap on newly-added fields across the per-type loop.                     |
| `typesTopK`                   | 15        | How many retrieved types feed the per-type field loop.                       |
| `fieldsPerType`               | 12        | Fields kept per retrieved type after scoring.                                |
| `childrenPerPickedField`      | 4         | One-hop child fields drawn from each picked object-valued field.             |
| `cosWeight` / `lexWeight`     | 1.0 / 5.0 | Weighting of cos² vs lex bonus in the per-field score.                       |
| `hybrid.mode`                 | `off`     | Hybrid policy: `off`, `typed-knn`, `strict-knn`, `rrf-fusion`, `knn-rerank`. |
| `hybrid.knnTopK`              | 30        | Size of the global cosine kNN pool fed to hybrid modes.                      |
| `pathsToRoot.maxPathsPerType` | 5         | Paths-to-root expansions per anchor type during closure.                     |

## Caveats

- Type retrieval is approximated: the eval snapshot has no per-type BM25/trigram index and no `type_embeddings` table, so `searchTypes` is replaced with a per-field cosine aggregate plus type-name token/trigram overlap RRF — coarser than the parent's typed BM25 + trigram + cosine fusion.
- The per-field lex bonus uses field-name tokens and 3-grams only; there is no description text and no real BM25/trigram index, so `lexWeight` behaves differently here than in the parent.
- `bestPath` reporting and trace events are dropped — only `selectedCoords` is returned, so any per-type "selectedPaths" diagnostics from the parent are not visible from this port.
