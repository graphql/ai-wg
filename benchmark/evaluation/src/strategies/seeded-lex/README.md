# seeded-lex

> **TL;DR.** Best-first schema walk where children are scored by cosine plus a BM25/trigram rank bonus, so lexically strong fields survive the per-expansion cap that `seeded` would drop them at.

## How it works

- Builds a seed pool from cosine top-K plus a synthetic BM25 + trigram channel, fused via RRF and pinned onto a linear-ramp distance so lex picks compete with mid-tier cosine seeds.
- Anchors each seed to its shortest path back to a root type via reverse-adjacency BFS, then pushes the anchored path into a sim-decay priority queue.
- Pops best-first, accepts the leaf, and enqueues its top-N children scored as `shape(cosSim) + alpha * lexBonus(coord)`, all decayed by `decay^depth` and divided by `(1 + fanOut)^fanoutAlpha`.
- Stops on `nodeBudget`, `ratioCutoff` against the best score seen, or `coverageEpsilon` marginal-gain (only when the ratio is also near cutoff).
- Closes the slice with a paths-to-root pass over the parent and return types of every selected field, preferring Query > Subscription > Mutation roots.

## When to pick this

- Choose over plain `seeded` when miss analysis shows SEED_DROPPED cases — the lex channels rank the wanted child correctly but raw cosine ranks 8 siblings above it.
- Good default for queries with strong identifier overlap ("stars" → `stargazerCount`, "rate limit" → `Query.rateLimit`) where dense embeddings fail to bridge the morphology.
- Skip if you specifically want to ablate the lexical channel — use `seeded` as the control.

## Knobs

| knob                   | default  | controls                                                                                            |
| ---------------------- | -------- | --------------------------------------------------------------------------------------------------- |
| `seedTopK`             | 10       | how many cosine-ranked coords seed the queue before lex picks                                       |
| `nodeBudget`           | 25       | maximum number of accepted paths before stopping                                                    |
| `hopBudget`            | 5        | maximum expansion depth from a seed                                                                 |
| `ratioCutoff`          | 0.25     | stop when the queue head falls below this fraction of the best score                                |
| `decay`                | 0.85     | per-depth multiplicative discount on child scores                                                   |
| `fanoutAlpha`          | 0.3      | exponent of the `(1 + fanOut)` divisor that penalises high-fanout parents                           |
| `lexExpand.alpha`      | 5.0      | weight of the lex-rank bonus relative to the cosine term in `scoreChild`                            |
| `lexExpand.scoreShape` | `cos-sq` | shaping applied to the cosine term (linear / cos-sq / cos-cube-exp-rank / sigmoid-cos / tight-rank) |

## Caveats

- BM25 and trigram are approximated from field-name token and 3-gram overlap — the eval snapshot has no description text or precomputed channel indexes, so this preserves the rank-bonus shape but not the parent's full lexical signal.
- No `QueryVariantInput`, no per-variant kNN, and no HippoRAG synonymy bridges — the `synonymy` block from the parent config is silently dropped, so cosine-near token-disjoint pairs never get bridged.
- The `keywords:*` direct-match force-include is gone, so explicit coordinate hints in variants do not pin distance to zero the way they do in the parent.
