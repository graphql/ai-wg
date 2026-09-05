# ptv-lex-weighted

> **TL;DR.** Per-type-variant pool-expand with rebalanced cos/lex weights (4.0/1.5) and a type-cos floor that blocks splicing into weakly-relevant types during expansion.

## How it works

- Score every non-root type by `typeCos` (max cosine of its fields to the query) and keep the top-K, then trim further with a Kneedle elbow cut on the score curve.
- Build one variant per surviving anchor type: seed the candidate pool with the anchor's fields and greedily pick by `score / cost` until the per-variant budget is spent.
- Score each candidate as `cosWeight · effCos² + lexWeight · lexBonus`, where `effCos` blends 30% parent typeCos with 70% the field's own cosine, and `lexBonus` is an RRF of field-name BM25 and trigram overlap with the query.
- Pool-expand only: when a picked field's return type is fresh, gate it through `poolEntryTypeCosFloor` (0.25) before adding its fields to the pool — low-relevance types never get spliced in.
- Rank variants by `typeCos(anchor) × sum of top-20 effCos² picks`, then relevance-gate merge: union the winner with any other variant whose `typeCos` is at least `relevanceFloor × winner.typeCos`.
- Close the final coord set under paths-to-root (BFS to Query/Subscription, mutation paths excluded by default).

## When to pick this

- You want per-type-variant behavior but find the default `lexWeight=5` too lexical — this preset trusts cosine far more (cos×4, lex×1.5).
- The schema has noisy or off-topic types whose fields would otherwise leak into the answer via multi-hop pool expansion — the type-cos floor cuts those off.
- You want the high-recall "merge multiple variants" behavior rather than picking just the top-1 anchor.

## Knobs

| Knob                    | Default | Controls                                                                             |
| ----------------------- | ------- | ------------------------------------------------------------------------------------ |
| `cosWeight`             | 4.0     | Weight on `effCos²` in per-field score (raised from PTV default 1.0).                |
| `lexWeight`             | 1.5     | Weight on the BM25/trigram RRF lex bonus (lowered from PTV default 5.0).             |
| `parentCosBlend`        | 0.30    | Fraction of `effCos` taken from the parent type's typeCos vs the field's own cosine. |
| `poolEntryTypeCosFloor` | 0.25    | Minimum `typeCos` a non-anchor type must clear before its fields enter the pool.     |
| `efficiencyThreshold`   | 0.04    | Minimum `score/cost` for a candidate to be eligible during greedy picking.           |
| `variantTopK`           | 20      | Number of top per-pick effCos² values summed when scoring a variant.                 |
| `relevanceFloor`        | 0.75    | Variant must reach this fraction of the winner's typeCos to be merged in.            |
| `perVariantBudget`      | 800     | Cost budget consumed during each variant's greedy pool-expand.                       |

## Caveats

- The lex bonus is field-name-only token + trigram RRF; it approximates but does not match the parent repo's full BM25 + trigram-over-descriptions signal.
- Several PTV branches are dropped in this preset (no `floor`/`rescue` parentCos modes, no `recurse-topn` expansion, no `pickRatio`/`jaccard` merge gates, no edge-label or raw-cos post-filters) — re-enabling them via config has no effect.
- The type-cos floor is a hard gate, so if your query genuinely needs a hop through a type whose top field scores below 0.25, that branch is silently pruned.
