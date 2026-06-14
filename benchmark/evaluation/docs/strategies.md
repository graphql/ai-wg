# Strategies

Every strategy solves the same problem: pick the `Type.field` coordinates that keep recall high
and tokens low (see the [README](../README.md) for how that's scored). This page is the map — a
one-line TLDR for each, grouped into the families they evolved through, with the detailed
mechanics tucked into collapsible blocks so you only read as deep as you need.

**The lineage, in one line:** naive cosine floors → graph best-first (PathRAG) → lexically-seeded
best-first → type-first retrieval → per-type-variant budgeting (`ptv-*`) → token-efficient
structural fixes (`te-*`) → the consolidated `slicer`.

| family                                                      | TLDR                                                        | where it landed                 |
| ----------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------- |
| [Baselines](#baselines--the-floor)                          | cosine top-K + connect to root, no cleverness               | the floor                       |
| [Best-first](#best-first-pathrag--graph-expansion)          | priority-queue graph walk from root + cosine seeds          | superseded                      |
| [Seeded best-first](#seeded-best-first--add-lexical-signal) | best-first + lexical (BM25/trigram) seeding & scoring       | superseded                      |
| [Type-tree](#type-tree--types-first-then-fields)            | rank _types_ first, then pick fields per type               | superseded                      |
| [PTV](#ptv--per-type-variant-budgeting)                     | budget a greedy expansion per candidate type, merge winners | `ptv-lex-weighted` = old target |
| [TE](#te--token-efficient)                                  | PTV + prune dead weight + fix structural recall holes       | **`te-rootfix` = 89.6 %**       |
| [Slicer](#slicer--the-consolidated-champion)                | the whole winning pipeline in one code path                 | **`slicer` = champion**         |
| [Unified](#unified--one-space-for-everything)               | one greedy pass over fields+args+inputs+enums together      | experimental                    |

Tags: ⭐ current champion · 🎯 historical target/baseline · 🧪 experiment / config-sweep · 📦 archived (in `.archive/strategies/`)

> **On numbers:** only `slicer` and `te-rootfix` are in the latest run
> ([`runs/current/strategies/results.md`](../runs/current/strategies/results.md)), both at
> **89.6 % @ ~11.5k tokens**. `ptv-lex-weighted`'s **77.1 % @ 17.5k** is the historical baseline
> everything was measured against. The other strategies carry qualitative status, not stale
> numbers — run `pnpm eval strategies --strategy <id>` to score one.

---

## Baselines — the floor

**TLDR:** take the cosine-nearest fields to the query, then add whatever's needed to connect them
back to a root operation. No scoring, no expansion. These set the recall/token frontier everyone
else tries to beat.

| strategy        | TLDR                                                                           |
| --------------- | ------------------------------------------------------------------------------ |
| `pure-knn`      | global top-K cosine fields + a paths-to-root closure so the slice is queryable |
| `baseline-topk` | even barer: top-20, one shortest path-to-root per hit, no closure              |

<details><summary>Detail</summary>

`pure-knn` ranks every field by cosine to the query, keeps the top K (default 60), then runs a
**paths-to-root closure**: for each kept coord it walks backward through reverse adjacency (which
fields _return_ this type) to a root operation, preferring `Query` > `Subscription` > `Mutation`
and shortest paths, expanding `*Connection`/`*Edge` wrappers along the way. `baseline-topk` skips
the closure (one shortest path per hit) and keeps coords even if unreachable. No lexical signal,
no re-scoring, no expansion into children.

</details>

## Best-first (PathRAG) — graph expansion

**TLDR:** treat the schema as a graph; grow a connected slice outward from root + cosine seeds with
a scored priority queue, under depth / fan-out / budget stops.

| strategy                   | what's different                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `best-first`               | canonical PathRAG: score = `decay^depth · sim / (1 + fanOut)^α`; node/hop/ratio stops                                |
| `budgeted-best-first`      | Query-rooted by construction; grows by the best _affordable_ field edge under a token-cost model (no closure needed) |
| `multi-variant-best-first` | runs one budgeted search per top seed type in parallel, keeps the best subgraph by committed-score / cost            |

<details><summary>Detail</summary>

`best-first` seeds the queue with all root fields plus the top-K cosine hits, each anchored back to
a root via a shortest reverse path, then repeatedly pops the highest-scored path, accepts its leaf,
and pushes its children — discounting deep, high-fan-out hub types so the walk doesn't drown in
generic connectors. `budgeted-best-first` reframes this as a rooted subgraph grown one affordable
field-edge at a time (cheap for scalars/known types, expensive for fresh object types), so it stays
queryable without a closure. `multi-variant-best-first` runs many budgeted searches at once — one
per top seed type — round-robin expands them, and picks the winner by score/cost. The
"many seeds, pick the best subgraph" idea here is what PTV later formalizes.

</details>

## Seeded best-first — add lexical signal

**TLDR:** `best-first` plus a lexical channel (BM25 + trigram over field names, RRF-fused with
cosine) so lexically-obvious fields aren't missed. The five `seeded-lex-*` siblings each bolt on
one targeted recall hack aimed at a specific miss category.

| strategy               | what's different                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `seeded`               | canonical seeded best-first (cosine + lex seeds, depth-decay expansion)                                            |
| `seeded-lex`           | the workhorse: lexical picks pinned into the same priority queue as cosine seeds                                   |
| `seeded-lex-deep`      | hop budget 5 → 7, to reach musts sitting 3+ hops from a root                                                       |
| `seeded-lex-intent`    | regex intent classifier pins `Query.viewer` / `Query.search` so generic roots survive the cap                      |
| `seeded-lex-temporal`  | force-includes a host type's canonical timestamp leaves when the query is time-flavored                            |
| `seeded-lex-qexpand`   | expands the query with morphologically-similar schema tokens (`stars` → `stargazerCount`) on the lexical side only |
| `seeded-lex-wormholes` | a static shortcut table to bridge known deep "parent-missing" chains the fan-out cap can't reach                   |

<details><summary>Detail</summary>

The lexical channels are approximated in the eval from field-name token + 3-gram overlap (the
snapshot has no description text), ranked and scored `1/log2(2+rank)`, then **RRF-fused** with the
cosine seeds and pinned to a distance so lex picks compete directly in the priority queue. Child
scoring blends a shaped cosine with an additive lex bonus, so high-lexical-rank children survive
the per-expansion cap. Each sibling is explicitly **miss-bucket-driven** — this is the generation
that learned recall failures are categorical (deep-hop misses, generic-root misses, morphological
misses, time-leaf misses), not uniform — and each was built to recover one named class.

</details>

## Type-tree — types first, then fields

**TLDR:** flip the order — rank _types_ by relevance first, then pick the best fields within each
top type and connect to root. `v2` is a clean pure-sequential rewrite; `e2`–`e5` are systematic
scoring/normalization sweeps over it (the codebase maturing into an experiment harness).

| strategy                | what's different                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| `seeded-typetree`       | a type-first retrieval pass bolted onto `seeded-lex`                                             |
| `seeded-typetree-v2`    | pure-sequential: rank types → pick top-N fields per type → recurse one level → close to root     |
| `seeded-typetree-v2-e2` | 🧪 sweep the per-field score _formula_ (add / mult / max / sigmoid / cos-gated …)                |
| `seeded-typetree-v2-e3` | 🧪 sweep the lex-bonus rank-decay _shape_ + a top-K cutoff                                       |
| `seeded-typetree-v2-e4` | 🧪 sweep a _hybrid_ global-kNN injection mode (typed-knn / strict-knn / rrf-fusion / knn-rerank) |
| `seeded-typetree-v2-e5` | 🧪 sweep pure / normalized-cosine scorers (threshold, relative, z-score, softmax …)              |

<details><summary>Detail</summary>

`seeded-typetree-v2` ranks types by a lex+cosine RRF, and for each anchor type picks its best
path-to-root plus its top-N fields scored locally (`cos² + lex bonus`), recurses one level into
object-valued picks, then closes to root. The `e2`–`e5` series share that engine unchanged and only
vary the scorer, so several formulae can be compared offline without touching a production path.

</details>

## PTV — per-type-variant budgeting

**TLDR:** the reference engine. Rank candidate types (Kneedle elbow-cut the tail), build one
budgeted greedy field-expansion _per_ anchor type, score each variant, then merge the winner with
other relevant variants and close to root. `ptv-lex-weighted` was the long-standing
**target — 77.1 % @ 17.5k**.

| strategy           | what's different                                                                          |
| ------------------ | ----------------------------------------------------------------------------------------- |
| `ptv-bulk-sum`     | variant score = sum-of-cos² (rewards large complete types); no gates or filters           |
| `ptv-lex-weighted` | 🎯 rebalanced weights (cos×4, lex×1.5) + a pool-entry type-cos floor; the baseline target |
| `ptv-topk-gated`   | adds a bridge-edge gate at splice time + a root-coord gate at emission                    |
| `ptv-topk-strict`  | `topk-gated` + emission filters (absolute-cosine floor, low-yield variant drop)           |

<details><summary>Detail — the full <code>ptv-lex-weighted</code> pipeline</summary>

1. **Signals.** `cosByCoord = cosineToQuery(qEmb)`, plus a cached `typeCos(T)` = max field-cosine
   over `T`'s fields (the type-relevance signal), plus a `lexBonus` per coord (BM25 + trigram over
   field-name tokens, RRF-fused, shaped `1/log2(2+rank)`).
2. **Type retrieval.** Rank non-root types by `typeCos`, take the top 15, then **Kneedle** elbow-cut
   the score tail.
3. **One variant per anchor type** via a _pool-expand budgeted greedy_: repeatedly admit the
   candidate with the best `score / cost`, where `score = cos·weight + lex·weight` and `cost` is the
   token cost (cheap for scalars/known types, ~8 for a fresh object, ~10 for a fresh `*Connection`).
   Admitting a field pulls its return type's fields into the pool at the next hop, gated by a
   `poolEntryTypeCosFloor` so low-relevance types never get spliced in.
4. **Score each variant** (`typeCos(anchor) · Σ top-K of cos²`) and **merge**: keep the winner's
   coords, fold in any other variant whose `typeCos` clears a relevance floor of the winner's.
5. **Paths-to-root closure** (with `*Connection`/`*Edge` unwrapping) so the merged slice is queryable.

The four PTV members are an ablation ladder on this one engine: bulk-sum (recall-greedy) →
lex-weighted (rebalanced + pool-entry floor) → topk-gated (+ gates) → topk-strict (+ emission filters).

</details>

## TE — token-efficient

**TLDR:** every `te-*` strategy forks `ptv-lex-weighted` and pursues two complementary levers —
**prune** the low-relevance tail (`te-lexprune-*`) for tokens, and **fix structural recall holes**
(`te-rootfix`: emit the real root entry-points + traverse connections) for recall. `te-rootfix` is
where the jump to **89.6 %** came from. The `rf*` cluster sweeps extra expansion-time levers on top
of rootfix.

| strategy                                          | what's different                                                                                                              |            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `te-rootfix`                                      | ⭐ ptv-lex-weighted + emit root-collection entries (incl. Shopify's `QueryRoot`) + connection traversal                       | **89.6 %** |
| `te-rootfix-lean`                                 | the same fixes, but applied _after_ a relevance prune so the savings survive                                                  |            |
| `te-lexprune-safe`                                | drop coords below cosine 0.16 (but protect roots / paths / top-15 types)                                                      |            |
| `te-lexprune-saver`                               | harder prune (floor 0.10, 3 paths/type) — trades ~0.5pp recall for ~6 % tokens                                                |            |
| `te-rf-trim-a / b / c`                            | 🧪 lexprune + rootfix at three budget operating points (`budget` 550/450/650, `dropFloor` 0.20/0.22/0.16)                     |            |
| `te-rfl-{d5, d5gl60, gl60, gl80}`                 | 🧪 rootfix + N-hop gateway **lookahead** (`lookaheadHops=2`) and/or **global-leaf** cosine seeding (`globalLeafTopK` 0/60/80) |            |
| `te-rfpb-{d4, d8, k30}`                           | 🧪 rootfix + boost the whole root-**path** of top-cosine target fields (`pathBoostDecay` 0.4/0.8, `topK` 30/50)               |            |
| `te-rftgt-{d8, k100}`                             | 🧪 rootfix + boost gateway fields that **reach** a top target downstream (`tgtDecay` 0.7/0.8, `tgtTopK` 50/100)               |            |
| `te-rfx-{conn1, conn3, cap, comp, conncomp, all}` | 🧪 rootfix + cost-model / type-completion sweeps (`connCost` 1/3, `maxFieldsPerType` 25/40, completion floors)                |            |

<details><summary>Detail — the two rootfix mechanisms (the breakthrough)</summary>

The old 77.1 % ceiling was dominated by one failure: the real root entry-point was never emitted —
especially on Shopify, whose root type is `QueryRoot`, not `Query`, so generic shortest-path-to-root
silently skipped it. `te-rootfix` adds two post-selection fixes:

- **`emitRootEntries`** — identify the _real_ query-root type(s) (`rootTypes` minus
  Mutation/Subscription, **plus** any `Query`/`QueryRoot` present), compute each root field's bounded
  return-type family (return type + the node type reached via `nodes`/`edges → node`), and emit every
  root field whose family intersects the selected types. Recovers collection endpoints like
  `QueryRoot.orders: OrderConnection`.
- **`emitConnectionTraversal`** — for every selected `*Connection`/`*Edge` type, emit its
  `nodes` / `edges` fields (and `edges → node`), fixing the budget-cut `Connection.nodes` class.

The `rfl` / `rfpb` / `rftgt` / `rfx` sweeps explored _more_ expansion-time levers (gateway
lookahead, path-boost, target-reach, cost-model tweaks) on the rootfix base. Most did **not** beat
plain rootfix — see the verdicts in [`.archive/strategies/README.md`](../.archive/strategies/README.md).

</details>

## Slicer — the consolidated champion

**TLDR:** ⭐ the winning pipeline — PTV's per-type budgeting _plus_ rootfix's root-entry emission and
connection traversal — welded into a single code path with numeric tunables only (no mode strings,
no dead branches). Metric-equivalent to `te-rootfix` (**89.6 % @ ~11.5k**) and the one to extend.

<details><summary>Detail</summary>

`slicer` does type-retrieval → Kneedle cut → per-type budgeted greedy variant build → variant score
→ relevance-gated merge → paths-to-root, **and** folds in root-collection entries and connection
traversal inline. It is the "productionized" descendant of `ptv-lex-weighted` + `te-rootfix`,
stripped to one code path. If you're extending the winning approach, start here.

</details>

## Unified — one space for everything

**TLDR:** 🧪 the architectural outlier. Instead of the type-variant engine, treat every member —
field, argument, input field, enum value — as one coordinate in a single embedding space and run
_one_ greedy best-first selector over the merged pool. Returns explicit `selectedMembers` for a
precise render.

| strategy     | note                                                                                                                                                                                                                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `te-unified` | parses the SDL for arg/input/enum structure; seeds from root fields + the top relevant types; budget = 1500 members. Admitting a field enqueues its args + return-type members; admitting an arg enqueues its input type's fields. |

---

## Archived experiments

Frozen dead-ends live in [`.archive/strategies/`](../.archive/strategies/) (not loaded by the
harness, not type-checked, so they can't rot). All are `te-rootfix` forks whose levers didn't pan
out: the lookahead variants _flooded_ (every connector leads somewhere), path-boost and target-boost
were _no-ops_ on cold connectors, and the breadth-tightening variants _lost recall_ (down to 84.7 %).
The per-fork verdicts are in [`.archive/strategies/README.md`](../.archive/strategies/README.md).

**The lesson:** breadth is the insurance. The aggressive trims that cut tokens also cut recall below
the rootfix line — which is why the consolidated `slicer` keeps the broad per-type expansion and
pays for recall with the cheap structural fixes rather than by widening or narrowing the net.
