# pure-knn

> **TL;DR.** Flat global cosine top-K over every indexed field coord, then a paths-to-root closure so each hit is reachable from a Query root.

## How it works

- Compute cosine similarity between the query embedding and every indexed field coord in the schema snapshot.
- Sort by score (ties broken by coord name) and keep the top K coords as the initial selection.
- Build a reverse adjacency index: for each `returnType`, list the `(fieldCoord, parentType)` edges that produce it.
- Collect anchor types as the union of `parent` and object-like `returnType` of every selected coord, optionally widened with `Connection` / `Edge` wrapper types.
- BFS backward from each anchor through reverse edges until a root type is reached, ranking paths by root preference (Query > Subscription > Mutation), then shortest, then lex.
- Union every coord on those paths into the selection so each leaf has a structurally complete root chain.

## When to pick this

- Use as the ablation baseline that isolates "what does pure embedding similarity buy us?" — no lexical signal, no per-type retrieval, no recursion.
- Reach for it when the query embedding is high-quality and the schema is small enough that K=60 leaves comfortably saturate coverage.
- Pick this over `seeded-typetree-v2` when you suspect the per-type filter is throwing away signal (this is exactly the hypothesis the strategy was built to test).
- Skip it if you need lexical recall on rare identifier tokens or if path connectivity through deep object trees matters more than leaf similarity.

## Knobs

| knob                       | default | controls                                                                                  |
| -------------------------- | ------- | ----------------------------------------------------------------------------------------- |
| `K`                        | 60      | Number of global cosine neighbors taken from the top of the ranked list.                  |
| `maxPathsPerType`          | 5       | Cap on paths-to-root collected per anchor type.                                           |
| `maxDepth`                 | 6       | Hard cap on path length (field hops) during reverse BFS.                                  |
| `includeMutationPaths`     | false   | If true, Mutation-rooted paths are kept; otherwise only Query/Subscription paths survive. |
| `expandConnectionWrappers` | true    | Also anchor on `*Connection` / `*Edge` wrapper types when they exist in the schema.       |

## Caveats

- No scoring re-weight and no lexical signal at all — a query whose top-K embedding neighbors miss the relevant fields cannot be rescued by BM25 or trigram overlap.
- The paths-to-root closure pulls in connector coords purely for structural completeness; it does not re-rank or filter them by similarity, so noisy intermediate fields ride along.
- Cosine math, reverse adjacency, and BFS are duplicated locally (per the harness self-contained contract) rather than calling the parent repo's `pathsToRootClosure`, so behavior can drift if the parent implementation changes.
