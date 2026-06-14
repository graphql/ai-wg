# Agent benchmark — deterministic mock-server plan

Status: **IMPLEMENTED** (Phases 1-3 + wiring; supersedes & deletes the AST-walk `mock-data.ts`).
Engine + 5 resolver maps in `src/benchmarks/agent/mock/`; tests `scripts/mock-test.ts`; wired into
`session.ts`/`runner.ts` via injected `mockExecute`. Phase 4 (gold-anchored deterministic grading)
is the remaining follow-up. Owner: agent benchmark.

## 1. Why

The agent benchmark grades the **data answer** a model gives to an NL question (it queries a mock
GraphQL API, then submits an answer; a judge grades it against the gold operation). The judge audit
(86% agreement, see `runs/current/agent` + the judge-audit workflow) found the dominant structural
limit is the **mock data**, not the judge: `mock-data.ts` walks the query AST and fills leaves with
placeholders keyed only by field name, **ignoring all arguments** and returning **2 identical list
elements**. So ~65% of questions ("how many…", "which have no…", "in the last 30 days", "latest",
status filters) are unanswerable, and grading leans entirely on the LLM judge.

## 2. Goal

Replace the AST-walk with a **real in-process GraphQL execution** over a deterministic, seeded
**entity store**, so that:

- queries **honor their own arguments** (pagination, id/name lookups, filters, date ranges);
- data is **varied per entity** and **internally consistent** (counts, "which have none" are real);
- the **gold operation, run through the same mock, yields a known expected answer** → grading can
  be deterministic (fast-path) with the LLM judge only as a fallback;
- coverage is **driven by the test suite**: a generic default handles the long tail; we hand-write
  resolvers only for the answer-bearing fields, and **instrument** which fields are still generic so
  we add resolvers incrementally — never aiming for 100%, only what the suite exercises.

We keep it **in-process** (graphql-js `execute()` on the executable schema). No HTTP, no ports — a
"mock server" here is `(executable schema + per-schema resolver map + a deterministic store)`.

## 3. Where it lives

A new self-contained module under the only consumer (the agent benchmark):

```
src/benchmarks/agent/mock/
  index.ts            Public API. makeMockServer(schema, resolverMap) -> MockServer
                      MockServer.execute(query, variables?) -> { data?, errors? }
                      MockServer.coverage -> CoverageRecorder (read after a run)
  executor.ts         Per server: build a dedicated executable schema, attachResolvers(schema, map),
                      then graphql-js execute({ schema, document, fieldResolver: defaultResolver }).
                      Maps runtime errors → the GraphQL { errors } envelope.
  attach.ts           attachResolvers(schema, map): for each (Type.field) in the map, set
                      schema.getType(Type).getFields()[field].resolve = fn. NATIVE per-field
                      resolvers (~10 lines, zero dependency). graphql-js dispatches per field — OUR
                      code never looks up a resolver at query time. (Equivalent to graphql-tools
                      addResolversToSchema; hand-rolled to avoid the dep.)
  default-resolver.ts The execute() fieldResolver FALLBACK — graphql-js calls it ONLY for fields with
                      no resolver of their own. Order: (1) if source[field] is set (a parent seeded
                      it, e.g. a lookup arg) return it; (2) leaf scalar/enum → generate deterministically
                      from (parentType, field, source._seed) — so SCALARS NEED NO RESOLVER and vary per
                      entity via the seed; (3) unmapped object/list → a generic child entity (ignores
                      args). Records every (type, field, args) it sees → that recording IS the coverage gap.
  store.ts            EntityStore: id-keyed, lazy, deterministic. entity(type,id,seed) and
                      connection(type, parentId, opts) build/fetch stable entities.
  seed.ts             Deterministic value generation from a seed: scalars, dates (around a fixed
                      REFERENCE_INSTANT), ids, enums. No clock, no Math.random.
  coverage.ts         CoverageRecorder + report writer (ranked generic-resolved fields, flagging
                      fields whose args the default ignored) → runs/current/agent/mock-coverage.md.
  types.ts            Resolver, ResolverMap, EntityStore, MockContext, MockServer, CoverageRecorder.
  resolvers/
    common.ts         Reusable resolver factories: connection(first/last/after pagination +
                      edges/nodes/pageInfo/totalCount), enumFilter, dateRange, lookup, listOf,
                      nullableSubset (for "which have none").
    github.ts         Per-field resolver map for the github schema.
    gitlab.ts
    linear.ts
    shopify.ts
    singapore.ts
    registry.ts       resolverMapFor(schemaId) -> ResolverMap (the only thing the runner imports).
```

Schemas themselves stay where they are (`src/schemas/<id>/schema.graphql`); the mock module never
owns SDL — it receives the already-built `GraphQLSchema` from the runner's snapshot warm phase.

## 4. Data flow & integration

```
runner.runBenchmark
  └─ per schema (snapshot warm): server = makeMockServer(schema, resolverMapFor(schemaId))
  └─ per question (once, deterministic): goldData = server.execute(goldOperation).data   // expected answer
  └─ per session: inject mockExecute = (q) => server.execute(q)   AND goldData into runSession

session (execute branch)
  parse + validate (validator.ts)      → invalid? return { errors } (real GraphQL errors), count invalid
  valid?  data = mockExecute(query)     → return { data } to the model           // REAL execution
          submittedCoords(query)        → coverage diagnostic (unchanged)
          attempts.push({ query, data })

session (answer)                        → judge(question, goldOperation, goldData, attempts, answer)
                                          deterministic fast-path vs goldData; LLM judge fallback
```

Key swap: `session.ts` stops importing `mockExecuteData` directly and instead calls an injected
`mockExecute` (same shape as the injected `validator`/`judge`). The runner owns server construction
(one per schema, reused across that schema's sessions). `mock-data.ts` is deleted.

Store lifecycle: a **fresh store per `execute()` call**, but because every entity is generated as a
**pure function of its id**, two separate calls (e.g. the gold op and the agent's query) produce the
**same entity for the same id** — so they agree without shared mutable state. Within one `execute()`,
the store caches, so repeated references to an entity are identical (real within-query consistency).

## 5. The store

```ts
interface EntityStore {
    // get-or-create a deterministic entity; fields filled lazily by resolvers/default.
    entity(type: string, id: string, seedFields?: Record<string, unknown>): Entity;
    // a deterministic set of child entities for a parent, filtered + paginated.
    connection(type: string, parentId: string, opts: ConnectionOpts): Entity[];
}
interface Entity {
    __typename: string;
    id: string;
    _seed: number;
    [field: string]: unknown;
}
```

- `id` is a stable string (e.g. `repo:octocat/hello`, `repo:octocat/hello/issue/3`). `_seed =
stableHash(id)` drives all per-entity variation.
- Entities are plain objects flowing as graphql-js `source` values; child resolvers scope to
  `source.id`. Lazy: a field absent on the entity is produced by its specific resolver or the
  default resolver on access.

## 6. Resolvers — per field, args honored locally

Resolvers are **thin and chained**, the standard model: `Query.repository` returns ONLY a Repository
object (its id + own scalars) — never its commits/issues. Each relationship is its **own** registered
resolver that graphql-js calls lazily as the query descends, scoped to the parent via `source` and
honoring its own args: `Repository.commits(first, since)`, `Repository.issues(states, first)`, etc.
A parent resolver never returns nested relationship data.

Wiring (no central dispatcher — graphql-js routes per field):

```ts
// executor.ts
function attachResolvers(schema, map) {
    // attach.ts
    for (const [type, fields] of Object.entries(map)) {
        const t = schema.getType(type);
        if (!isObjectType(t)) continue;
        const defs = t.getFields();
        for (const [f, fn] of Object.entries(fields)) if (defs[f]) defs[f].resolve = fn; // NATIVE
    }
}
// per server, once:
attachResolvers(mockSchema, resolverMapFor(schemaId));
// per execute:
execute({ schema: mockSchema, document, contextValue: { store }, fieldResolver: defaultResolver });
//   graphql-js calls each field's own .resolve; defaultResolver fires ONLY for unmapped fields.
```

`common.ts` carries the patterns the gold-op survey says actually matter (≈1900 `first`, ~1500
id/name/fullPath/number lookups, the `search(query:)` field, dates):

```ts
// Relay connection: filter store entities, paginate by first/last/after, shape edges/nodes/pageInfo/totalCount.
connection({ entity, filter?, first?, seedFields?, empty? })
lookup(entity, idFrom)        // Query.repository(owner,name) -> entity('Repository', `${owner}/${name}`, {owner,name})
dateRange(args, ['since','until'])   // constrain generated dates into the requested window
nullableSubset(pred)          // make a deterministic subset of a field empty/null → "which have none"
```

A schema map is then small and readable — only the answer-bearing fields:

```ts
// resolvers/github.ts
export const github: ResolverMap = {
  Query: {
    repository: lookup('Repository', (a) => `${a.owner}/${a.name}`),
  },
  Repository: {
    issues: (src, { states, first }, ctx) =>
      ctx.store.connection('Issue', src.id, {
        first,
        filter: (e) => !states || states.includes(e.state),
        seedFields: { state: states?.[0] ?? 'OPEN' },
        empty: { assignees: (i) => i % 3 === 0 },   // every 3rd issue is unassigned
      }),
    pullRequests: /* states / first, similar */,
  },
};
```

Everything not in the map (e.g. `Commit.message`, `Issue.title`) falls to the default resolver.

## 7. Coverage instrumentation — the convergence loop

The default resolver records `(parentType, field, argNames, hadIgnoredArgs)` each time it handles a
field. After a run the runner writes `runs/current/agent/mock-coverage.md`:

- fields resolved generically, ranked by frequency;
- **flagged** where the field carried arguments the default ignored (the high-value gaps).

Bootstrapping (so we don't discover cold): a one-off script parses **all gold operations** and emits
the set of `(type, field, args)` the suite's correct answers depend on — that seeds the initial
resolver map (the heavy hitters: connections + lookups + `search`). Runtime instrumentation then
catches what agents query beyond the gold ops. **Target = the suite, not the schema.**

## 8. Gold-anchored deterministic grading

Because the gold op runs through the same mock, `goldData` is the **known expected answer**. The
judge step becomes:

1. Reduce `goldData` to the answer value(s) (the gold op's leaf selections).
2. **Deterministic fast-path**: if the answer is a scalar / count / short value-list, compare the
   agent's submitted answer to the expected value(s) (normalized) → PASS/FAIL with **no LLM call**.
3. **LLM judge fallback** (with `goldData` supplied as ground truth) for fuzzy / multi-part answers.

This removes judge variance on the easy majority and is the core of "more deterministic".

## 9. Determinism & lifecycle invariants

- No `Date.now()` / `Math.random()` anywhere — a fixed `REFERENCE_INSTANT` and `stableHash`-seeded
  generation only (matches the existing constraint; the runner forbids the clock/RNG too).
- A value is a pure function of `(type, field, normalizedArgs, entitySeed)` → **path-independent**
  for answer-bearing data; the same field+filter returns the same data via any query path.
- The mock source files join `validatorSourceHash` in the runner's cache key, so changing a resolver
  busts the cache and forces a clean re-run (same discipline as today).

## 10. Build phases

1. **Engine** (`executor`, `attach`, `store`, `seed`, `default-resolver`, `coverage`, `types`) +
   delete `mock-data.ts`; wire `mockExecute` injection into `session`/`runner`. Generic default only
   → already ≥ today's fidelity, plus per-entity variation and real execution.
2. **Spike github** resolver map (`Query.repository`, `Repository.issues`/`pullRequests` honoring
   `first`/`states` + an unassigned subset, `Ref.target→Commit.history` honoring `since:`); dump a
   coverage report from a handful of github questions; prove the loop.
3. **Bootstrap worklist** from gold ops → fill resolver maps for the five schemas' heavy hitters.
4. **Gold-anchored grading**: compute `goldData` per question; add the deterministic fast-path +
   judge fallback.
5. **Validate**: offline unit tests (pagination length, lookup seeding, date windows, empty subsets,
   path-independence) → fresh full run → re-run the judge-audit workflow; expect the value-dependent
   failure rate to drop and judge agreement to rise.

## 11. Risks / non-goals

- **Not building a faithful API.** We honor only the argument patterns the suite uses; unmapped args
  degrade to today's "ignored" behavior (never worse) and surface in the coverage report.
- **No full cross-path entity identity** (e.g. `search(is:pr)` returning the _same_ PR objects as
  `repository.pullRequests`). The judge is path-agnostic and grades within-query coherence, so this
  isn't required; `(type,field,args)` keying covers the answer-bearing cases. Documented limit.
- **Variables**: the prompt steers agents to inline literals; variable-valued args we can't resolve
  degrade to unconstrained.
