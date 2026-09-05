# budgeted-best-first

> **TL;DR.** Grows a connected, Query-rooted subgraph by repeatedly committing the highest-scoring affordable field edges under a token-budget cost model (rooted PCST approximation).

## How it works

- Seeds the pool with all field edges out of `startType` (default `Query`) and marks that type as included.
- Scores every pooled candidate as `cosWeight * cos^2 + lexWeight * lex`, where `lex` is a token + 3-gram overlap bonus on field names.
- Assigns each candidate a cost: `KNOWN_TARGET` (1) if its target type is already included, `SCALAR` (1) for leaf-like targets, `OBJECT` (8) for fresh object-like targets; `Mutation`/`Subscription` targets are priced above budget so they're never picked.
- Each iteration takes the top `batchSize` candidates, commits any whose `cost + costUsed <= budget` and `score >= threshold`, and seeds the pool from each newly-included target type.
- Stops when the pool empties, the top score drops below `threshold`, or no batch candidate fits the remaining budget.
- Optionally runs a paths-to-root closure over included types (off by default — the slice is already rooted when starting at `Query`).

## When to pick this

- You want a single connected, Query-rooted slice rather than a ranked bag of coordinates.
- You need an explicit token-cost knob (`budget`) instead of `topK`/`nodeBudget`-style limits.
- You're comparing against retrieval-only strategies and need a graph-aware baseline that grows outward from a root.
- Skip it for schemas where unions/interfaces carry most of the signal — this eval port can't traverse them virtually (see caveats).

## Knobs

| Knob                         | Default | Controls                                                                                       |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------- |
| `startType`                  | `Query` | Root type the traversal grows from; must be object-like (have fields).                         |
| `budget`                     | `300`   | Total cost the traversal may spend across all committed edges.                                 |
| `threshold`                  | `0.01`  | Minimum score for a candidate to be committable; loop exits once the top batch falls below it. |
| `batchSize`                  | `16`    | How many top-scored candidates are considered for commit per iteration.                        |
| `cosWeight`                  | `1.0`   | Weight on the `cos^2` term in the field score.                                                 |
| `lexWeight`                  | `5.0`   | Weight on the lex (token + trigram) bonus in the field score.                                  |
| `includeUnionsAndInterfaces` | `true`  | Accepted for parity but inert here — eval snapshot has no union/interface member metadata.     |
| `pathsToRoot.mode`           | `off`   | When `on`, runs a safety closure that adds ancestor field edges back to a root type.           |

## Caveats

- Union/interface virtual edges (`UNION_MEMBER`, `INTERFACE_IMPL`) are dropped: the eval snapshot lacks union members and interface implementors, so unions/interfaces are only reached through direct field edges that name them.
- The per-target-kind cost table collapses to two buckets (object-like vs leaf-like) because the snapshot can't distinguish scalar/enum/input; ordering is preserved but `ENUM`/`INPUT_OBJECT`/`INTERFACE`/`UNION` costs are unreachable.
- Lex bonus uses token + 3-gram overlap on field names rather than the parent's real BM25 and trigram indices, and `includeArguments` is inert because the snapshot has no argument metadata.
