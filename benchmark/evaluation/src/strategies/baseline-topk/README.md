# baseline-topk

> **TL;DR.** Cosine top-K against the raw query, then for each hit attach a single shortest path-to-root — no scoring, no expansion, no stopping logic.

## How it works

- Rank every indexed field coord by cosine similarity to the raw query embedding, with lexicographic tiebreak.
- Keep the top-K hits and always include each hit's own coord in the selection.
- Build a reverse adjacency (returnType -> incoming edges) over the schema's fields.
- BFS backwards from each hit's parent type to a root, capped at `maxDepth` field hops, preferring Query > Subscription > Mutation, then shortest path, then lex.
- If the parent type has no path within budget and `expandConnectionWrappers` is on, retry against `{Parent}Connection` and `{Parent}Edge` wrapper types.
- Dedupe full chains by joined path key and union all coords on surviving paths into the final selection.

## When to pick this

- Use as the floor / control when comparing any other strategy — it shows what plain cosine plus naive path attachment already gives you.
- Pick it when you want a fast, fully deterministic baseline with no graph walk beyond a single shortest path.
- Skip it for real retrieval quality: it does no neighbour expansion, no rank fusion, no type-level reasoning, and tends to under-cover related fields.

## Knobs

| knob                       | default | controls                                                                                 |
| -------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `k`                        | 20      | Number of cosine top-K hits seeded from the query.                                       |
| `maxDepth`                 | 6       | Maximum number of field hops in the BFS path-to-root.                                    |
| `includeMutationPaths`     | false   | Allow Mutation roots when Query/Subscription paths exist.                                |
| `expandConnectionWrappers` | true    | Fall back to `{Parent}Connection`/`{Parent}Edge` if the parent type has no path-to-root. |

## Caveats

- Reverse adjacency, BFS, and tie-breaking are duplicated locally instead of reusing the parent's `ctx.pathsToMember` — kept intentionally self-contained per the harness contract, but any future fix to the parent's path logic must be ported by hand.
- Only one shortest path per hit is kept, so fields reachable via a second-best route never enter the selection even if the schema has many viable parents.
- Unreachable hits (no path-to-root within depth, no wrapper fallback) survive as bare coords with no enclosing context, which downstream consumers may struggle to render.
