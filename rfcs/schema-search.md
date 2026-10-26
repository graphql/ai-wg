# Schema Search

**Status:** Draft

**Author:**

- Dale Seo, Apollo

**Champion:**

- Dale Seo, Apollo
- Michael Staib, ChilliCream

---

## Abstract

This document proposes a standard HTTP endpoint for schema search. A client
sends a natural language query, and the GraphQL service returns a valid subset
of its schema. For example, an AI agent, an IDE or a code generator asks for
"the latest commit in a repository". In one round trip, it receives the small
piece of SDL (the text form of a GraphQL schema) that it needs to write that
query. The piece holds the matching fields, the types that they depend on, and a
path from a root operation type to each of them.

Schema search complements the
[Semantic Introspection](./semantic-introspection.md) proposal. It does not
depend on introspection, and it does not return scores or ranked lists. It also
does not prescribe how a service decides what is relevant. The specification
covers only the entry point and the shape of the response.

---

## Background & Motivation

### The problem

A GraphQL schema is the complete description of what a service can do. A large
language model (LLM) needs exactly this description to use the service. But real
schemas do not fit in a context window. The GitLab schema is about 160,000 lines
of SDL, and the GitHub schema is about 72,000 lines. Enterprise schemas can be
far larger. Even a mid-sized schema fills most of the context with types that
have nothing to do with the question. The more tokens the model holds, the worse
it reasons about the tokens that matter.

Today every tool that puts an LLM in front of a GraphQL API solves this problem
in its own way:

- Apollo MCP Server has a `search` tool that returns a portion of the schema.
- Hot Chocolate ships semantic introspection, and ChilliCream demonstrated a
  schema search endpoint.
- Meta loads partial schemas on demand.

Each of these tools uses a different contract. An agent harness (the program
that runs the model and its tools) that works with one tool does not work with
the next.

MCP clients have the same problem with large tool catalogs. Some clients now use
_tool search_: the model searches for the relevant tools and does not load them
all ([Claude API tool search tool][tool-search]). The MCP specification itself
has no search. A proposal to add a `query` parameter to `tools/list`
([SEP-1821][sep-1821]) never found a sponsor, and it was closed when SEPs moved
to pull requests. GraphQL exposes a schema, not a list of tools, so the
equivalent primitive is _schema search_. GraphQL can standardize this primitive
in the protocol.

[tool-search]:
  https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool
[sep-1821]:
  https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1821

With a standard, a harness implements one request contract. It can then use any
GraphQL API that supports the contract, and the MCP layer in between becomes
optional. The contract fixes the shape of the result, not its quality.
[Section 4](#4-what-the-specification-does-not-define) explains why the
specification leaves quality to implementations.

### Why not semantic introspection alone

Semantic introspection adds the `__search` and `__definitions` fields to
introspection. It works well, and Hot Chocolate ships it. The working group
found three problems when it used semantic introspection:

1. It ties search to introspection. Many production services disable
   introspection, and the community told them to do so for a decade. A service
   can allow `__search` and block the rest of introspection. But then its search
   policy depends on per-field rules inside introspection. A separate endpoint
   makes the two policies independent.
2. It usually takes two turns. `__search` returns the definition of each match
   and its paths to the root in the same call. But it returns them only for the
   match itself. A query that spans several types usually needs a second call to
   `__definitions` for the types along the path. In practice, this second call
   is the common case. Each turn is a full LLM round trip.
3. It puts a thinking step between the two calls. In that step, the model
   decides which types to look up. This decision spends reasoning tokens on a
   task that the server can do.

The shape of the result causes two more limits. A ranked top-K list (the K
best-scoring results) misses the answer in two cases. The first case is a
question that a type answers better than a field. The second case is a common
word, such as "point" or "commit", that matches dozens of unrelated schema
coordinates (names such as `Commit.message`). Also, the specification does not
say how to trim a whole type. So a type with 200 fields fills the context again.

Schema search avoids these problems because it returns a schema, not a list. The
service knows the whole schema and has no context limit. It chooses which fields
of a type to include and how to reach them from the root. The model receives
SDL, which it already reads well, and it can write a query directly.

### Prior art

Schema search standardizes approaches that are in production or that members
presented to this working group:

| Date     | Work                                                                                                    | What this proposal takes from it                                                                                                                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sep 2024 | Hot Chocolate `/graphql/schema` SDL endpoint                                                            | The endpoint location ([section 1](#1-endpoint))                                                                                                                                                                                                                                                                                                                       |
| Apr 2025 | Apollo MCP Server `introspect` tool                                                                     | Exploring from a named type ([extension A](#a-anchor-type))                                                                                                                                                                                                                                                                                                            |
| Jul 2025 | Apollo MCP Server `search` tool, presented to this group                                                | The response contract: a reduced schema in SDL that keeps the paths from the root to each match ([section 3](#3-response)); several search terms in one request, although this proposal searches them separately ([section 2](#2-request-parameters)); evidence that a lexical algorithm is enough to conform ([section 4](#4-what-the-specification-does-not-define)) |
| Dec 2025 | Loading partial schemas on demand at Meta                                                               | Loading only the part of a schema a task needs                                                                                                                                                                                                                                                                                                                         |
| Jan 2026 | [Semantic introspection](./semantic-introspection.md) (ChilliCream)                                     | Search over schema coordinates; paths to root                                                                                                                                                                                                                                                                                                                          |
| May 2026 | ChilliCream's prototype search endpoint, demonstrated to this group                                     | Search served over HTTP ([section 1](#1-endpoint))                                                                                                                                                                                                                                                                                                                     |
| Jun 2026 | Evaluation bench by Pascal Senn (ChilliCream), now in [`benchmark/evaluation`](../benchmark/evaluation) | The evidence below                                                                                                                                                                                                                                                                                                                                                     |
| Sep 2026 | Hot Chocolate `spec-version` parameter                                                                  | The edition parameter, named `v` in this proposal ([section 2](#2-request-parameters))                                                                                                                                                                                                                                                                                 |

### Evidence

The results of the evaluation bench motivate this proposal. In the table, the
golden query is the reference query that answers the test question.

| Measure                                                   | Result               |
| --------------------------------------------------------- | -------------------- |
| Slice contains every coordinate the golden query needs    | 90%                  |
| Slice size                                                | about 11K tokens     |
| Embedding search alone produces a perfect slice           | 40%                  |
| Required field appears in the top 20 / top 50 coordinates | 42% / 54%            |
| GPT-4.1 Mini answers the question end to end              | 85%                  |
| Searches per question                                     | about 1              |
| Turns per question (search, execute, answer)              | 3 for a typical case |

[strategy-results]: ../benchmark/evaluation/runs/current/strategies/results.md
[model-results]: ../benchmark/evaluation/runs/current/models/results.md
[agent-results]: ../benchmark/evaluation/runs/current/agent/results.md

The numbers come from the bench's [strategy][strategy-results],
[model][model-results] and [agent][agent-results] results. The bench asks about
800 questions over the GitHub, GitLab, Linear, Shopify and Singapore open-data
schemas. The agent runs against mock servers, not the live APIs. These numbers
show the direction, not a verified ceiling, for three reasons:

- A model generated the test questions, and nobody reviewed them by hand.
- The bench does not yet check its slices against [requirement 1](#3-response)
  below.
- The bench did not run semantic introspection end to end on the same cases. So
  the bench gives no direct comparison between the two proposals.

Two observations from the bench shape the proposal. First, a short ranked list
is not enough. With the bench's default embedding model, the required field is
in the top 20 coordinates less than half the time. But a slice holds far more
than 20 coordinates. A fair comparison ranks coordinates up to the same token
budget, and the bench did not run that comparison yet. Second, a small model was
enough to use the slice. This result suggests that the server can do the
expensive part, which is choosing the slice. The client model still has to write
good `q` intents.

### Relationship to semantic introspection

The two proposals are complementary. A service can offer both.

|                | Semantic introspection                 | Schema search                             |
| -------------- | -------------------------------------- | ----------------------------------------- |
| Where it lives | `__search` and `__definitions` fields  | An HTTP endpoint                          |
| Returns        | Ranked coordinates, scores, paths      | A valid subset of the schema as SDL       |
| Turns          | Search, then usually `__definitions`   | Search, then execute                      |
| Strength       | Selecting types; expanding selectively | Selecting fields within a type; one shot  |
| Weakness       | Top-K misses; large types              | Expanding a slice after the first request |

Semantic introspection lets the model expand from a known point more easily.
Schema search aims to provide enough context in the first response to write an
operation. The bench did not test whether it does so more often than semantic
introspection. [Section 5](#5-building-up-a-slice-across-requests) discusses how
schema search can support expansion.

### Alternatives considered

This proposal makes two choices, and each choice is independent of the other.
The first choice is where search lives. The second choice is what search
returns.

|                     | Returns a ranked list               | Returns an SDL slice                                    |
| ------------------- | ----------------------------------- | ------------------------------------------------------- |
| Introspection field | `__search` (semantic introspection) | A field such as `__schemaSlice(q: [String!]!): String!` |
| HTTP endpoint       | A search tool returning coordinates | This proposal                                           |

Most of the advantages above come from the shape of the result: SDL that is
already trimmed and connected to the root. An introspection field can return the
same shape. That field reuses the existing transport, authentication and
persisted documents. It also needs no new media type.

This document proposes an HTTP endpoint for three reasons:

- A service can set its search policy independently of its introspection policy.
- A harness can construct a URL without a GraphQL client.
- The response is SDL text, not SDL inside a JSON string.

These reasons are conveniences, not hard limits. If the working group prefers an
introspection field, sections [1](#1-endpoint), [2](#2-request-parameters) and
[6](#6-relationship-to-graphql-over-http) change. [Section 3](#3-response) stays
the same.

---

## Terminology

Schema search is the feature that this document specifies. A request carries one
or more natural language intents, and the response carries a subset of the
schema. An intent is one `q` value, for example "the author email of an issue".

A schema slice is that subset. It is a schema document that is valid on its own.
It contains the parts of the schema of the service that are relevant to the
query.

A patch is a response that holds only what the client does not have yet. It uses
`extend` for types that the client already holds
([section 5](#5-building-up-a-slice-across-requests)). A patch is not valid on
its own. It becomes valid when the client merges it into its slice. A whole
slice is a slice that is not a patch.

The working group called this feature "semantic search". This document does not
use that term, because the specification does not require semantic (vector)
search. A service that uses lexical matching conforms. The term also suggests
ranked results with scores, and this feature does not return scores. Finally,
readers easily confuse the term with semantic introspection.

---

## Proposal

### 1. Endpoint

A service that supports schema search exposes it at a URL that comes from its
GraphQL endpoint. [GraphQL over HTTP][gql-http] defines that endpoint. The
service appends `/schema` to the path. For the endpoint
`https://api.example.com/graphql`:

[gql-http]: https://github.com/graphql/graphql-over-http

```
GET https://api.example.com/graphql/schema
```

For a request without `q`, the service MUST return the full schema as SDL. This
response gives tools a standard place to get the SDL without an introspection
query. A service that keeps its schema private protects this endpoint as it
protects its GraphQL endpoint, for example with authentication. Search does not
keep a schema secret anyway, because repeated searches reconstruct much of it.

A request with a `q` parameter returns a schema slice:

```
GET https://api.example.com/graphql/schema?q=latest+commit+in+a+repository
```

The service MUST accept `GET`. A URL is the simplest request for an agent
harness to construct.

The service MUST also accept the parameters in a request body, with `POST`. A
body has no length limit, and it keeps intents out of URLs, which proxies and
servers log. The service SHOULD also accept `QUERY` ([RFC 10008][rfc-10008]).
`QUERY` is safe like `GET`, so a cache can store its responses. GraphQL over
HTTP is adding `QUERY` for operations in [graphql-over-http#411][gqlhttp-411]. A
client SHOULD use `QUERY` when the service and the intermediaries support it,
and `POST` otherwise. A search seldom repeats, because intents are free text, so
a client loses little cache benefit when it sends a `POST`.

The body MUST be JSON (`Content-Type: application/json`), as for a
GraphQL-over-HTTP `POST` request. Its members are the parameters: `q` as an
array of strings and `v` as a string. The service MUST reject form-encoded
bodies. As GraphQL over HTTP explains, browsers send form-encoded bodies without
a CORS preflight, which exposes servers to cross-site request forgery. Browsers
always send a preflight before a `QUERY` request. The JSON rule still applies to
`QUERY`, so both methods share one body format.

[rfc-10008]: https://www.rfc-editor.org/rfc/rfc10008.html
[gqlhttp-411]: https://github.com/graphql/graphql-over-http/pull/411

This document does not define how a client discovers schema search. A client
that knows the GraphQL endpoint tries the search URL. The service capabilities
proposal ([graphql-spec#1208][spec-1208]) lets a service advertise support and
point to a different URL, even on another host. Agent harnesses can also support
the contract natively. Both are out of scope here.

[spec-1208]: https://github.com/graphql/graphql-spec/pull/1208

### 2. Request parameters

| Parameter | Required | Meaning                                                                                                  |
| --------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `q`       | No       | A natural language description of the capability the client needs. MAY be repeated; see below.           |
| `v`       | No       | The GraphQL specification edition whose SDL syntax the client understands, for example `september-2025`. |

In a `GET` request, the client encodes the parameters in the query component of
the URL, as for a GraphQL-over-HTTP `GET` request. The encoding is
`application/x-www-form-urlencoded`, as the WHATWG `URLSearchParams` class reads
it. The service reads the repeated `q` parameter with `getAll`. As in GraphQL
over HTTP, an empty parameter is the same as an absent parameter. So `?q=` is a
request without `q`. In a `QUERY` or `POST` request, the body carries the same
parameters as JSON members ([section 1](#1-endpoint)). An empty array
(`"q": []`) is the same as an absent `q`.

The `q` parameter is natural language, not GraphQL. If a client needs several
things, it SHOULD pass each thing as a separate `q`. It SHOULD NOT join them
into one sentence:

```
GET /graphql/schema?q=the+author+email+of+an+issue&q=labels+on+an+issue
```

The service searches each intent separately and merges the results into one
slice. Because the server merges, the response stays a single valid schema. The
`search` tool of Apollo MCP Server already accepts a list of terms in one call.
But it combines the terms into a single query. The search tool of the evaluation
bench searches each intent on its own.

The `v` parameter tells the service which SDL syntax the client can parse. The
GraphQL specification changes over time. A schema can use syntax that is newer
than the client, for example a new directive location or type kind. In that
case, the service SHOULD render the slice with only the syntax that the client
understands. It MAY leave out elements that the edition cannot express, together
with the elements that depend on them. It MUST NOT change the meaning of the
elements that it keeps. For example, it must not render a `@oneOf` input type as
an ordinary input type. If no matching element can be expressed, the service
responds with `400 Bad Request`. If `v` is absent, the service uses the newest
edition that it supports.

Errors use the response format of GraphQL over HTTP. The response has a `4xx` or
`5xx` status code and a GraphQL response body with `errors`. Its media type is
`application/graphql-response+json`. For example, an unknown `v` returns `400`
with an error that names the supported editions. Hot Chocolate already responds
this way to an unknown `spec-version`. GraphQL over HTTP lets a server refuse
any request with the relevant status code, for example to require
authentication. A schema search service MAY do the same.

A successful response and an error response have different media types. A client
that sends an `Accept` header SHOULD list both `text/plain` and
`application/graphql-response+json`, as in the examples in
[section 3](#3-response). Otherwise the service cannot return an error body that
the client accepts. A service MUST treat a request without `Accept` as a request
that accepts both.

The status codes in one place:

| Status                       | When                                                                                                                                 | Source                                         |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| `200 OK`                     | The response is a slice, or the full schema for a request without `q`                                                                | [Sections 1](#1-endpoint) and [3](#3-response) |
| `204 No Content`             | No intent matches                                                                                                                    | [Section 3](#3-response)                       |
| `400 Bad Request`            | An unknown `v`, or nothing that matches can be expressed in `v`                                                                      | [Section 2](#2-request-parameters)             |
| `405 Method Not Allowed`     | The method is not `GET`, `POST` or `QUERY`, or the service does not support `QUERY`. The `Allow` header lists the supported methods. | GraphQL over HTTP                              |
| `406 Not Acceptable`         | The `Accept` header excludes the media type of the response                                                                          | GraphQL over HTTP                              |
| `413 Content Too Large`      | The body of a `QUERY` or `POST` request is too large                                                                                 | GraphQL over HTTP                              |
| `414 URI Too Long`           | The URL of a `GET` request is too long                                                                                               | GraphQL over HTTP                              |
| `415 Unsupported Media Type` | The body is not JSON, for example a form-encoded body                                                                                | GraphQL over HTTP                              |
| Other `4xx` or `5xx`         | The service refuses the request, for example for authentication or rate limits                                                       | GraphQL over HTTP                              |

#### Why these names

`v` names the GraphQL specification edition. It is short like `q`, so the two
parameters read as a pair. Its values are edition names, for example
`october-2021` (or `2021-10`) and `september-2025` (or `2025-09`). These names
match how the GraphQL specification is published. Hot Chocolate accepts the same
values today under the name `spec-version` ([Hot Chocolate endpoint
docs][hc-endpoints]). A service that already accepts `spec-version` can accept
both names. In other URLs, `v` often means an API version or a cache key. On
this endpoint, it means only the specification edition.

`q` is the conventional name for a search query in a URL. It also avoids
`query`, which already has a different meaning here. GraphQL over HTTP uses the
`query` parameter for the GraphQL document in a `GET` request. So
`/graphql/schema?query=…` looks like a GraphQL operation that a client sends to
the schema endpoint. `search` also avoids this conflict, and it is a reasonable
alternative.

[hc-endpoints]:
  https://github.com/ChilliCream/graphql-platform/blob/main/website/content/docs/hotchocolate/server/endpoints.md

### 3. Response

The goal is that one response is enough. The client reads the slice, writes an
operation and executes it, with no second search. Each extra search costs an LLM
round trip and puts another slice into the context. In the experiments of the
working group, sessions with several searches filled the context, and smaller
models lost track of the task. So a service aims to answer all intents in one
response, and requirement 5 gives it room to add nearby context.

A successful search returns `200 OK` with a schema slice in SDL. The media type
of the response is `text/plain; charset=utf-8` for now. SDL has no registered
media type, and the response is not a GraphQL response, so
`application/graphql-response+json` does not apply. A later edition can define a
dedicated media type without a change to the body. If none of the requested
intents matches, the service MUST return `204 No Content` with no body. A client
MUST NOT try to parse that response as SDL. If only some intents match, the
service returns a slice for those matches. The response does not tell the client
which intents matched. Errors follow [section 2](#2-request-parameters),
including requests whose matches cannot be expressed in the requested
specification edition.

The requirements below apply to every returned slice. The base contract does not
include patches or the `known` parameter.
[Section 5](#5-building-up-a-slice-across-requests) explores them as future
work.

1. The slice MUST be a valid GraphQL schema document on its own. Every type that
   it references MUST be defined in it. A client MUST be able to parse the
   response and build a schema from it without any other input.
2. For every field that the slice includes, the slice MUST contain a path from a
   root operation type (`Query`, `Mutation` or `Subscription`) to that field. So
   a client can write an executable operation for anything in the slice.
3. Every definition in the slice MUST be a subset of the same definition in the
   full schema. The slice MUST NOT rename, retype or add anything. An operation
   that validates against the slice MUST validate against the full schema.
4. The slice SHOULD omit unrelated elements, except those needed to satisfy
   requirements 1 to 3. Structural validity takes priority over relevance. For
   example, a mutation-only or subscription-only match still needs the service's
   query root type with at least one existing field and its dependencies. The
   service MUST NOT invent a placeholder field. Requirement 5 allows nearby
   context within a size budget.
5. The slice MAY include fields and types that the intents did not match, if
   they are small and likely to be useful. Examples are scalar fields on a
   matched type, sibling fields, and several paths to the root. The working
   group calls this the size budget. The service chooses this budget and how to
   measure it. The budget is an implementation heuristic, not a limit that the
   client sees. The base contract defines neither a token-counting method nor a
   maximum response size. If required dependencies exceed the budget, the
   service MUST preserve requirements 1 to 3 even if that makes the slice larger
   than the budget. A client cannot assume that a response fits its context
   window.
6. A service MAY omit descriptions. In early experiments, dropping descriptions
   cut the token count by about half. A service SHOULD keep a description when
   it is the only explanation of what a field does.
7. The slice MUST NOT contain scores, ranks or other search metadata. The
   response is a schema and nothing else.

Requirement 3 makes the slice safe to use. A client can use the slice as the
schema, validate operations against it locally, and execute them against the
real endpoint. GraphQL over HTTP already allows the schema at one URL to differ
between clients, for example for authenticated users. Requirement 3 applies to
the schema that the requesting client can see. A field that the introspection of
a client hides is also hidden from the slice of that client.

The `search` tool of Apollo MCP Server is the closest existing implementation of
this contract. It tree-shakes the full schema (removes everything that the
matches do not need) down to the root paths of the matching types. It returns
the result as SDL. Today it does not guarantee requirement 1. This proposal
makes validity a requirement, with the rules below. It also adds trimming at the
field level (requirement 4) and the size budget (requirement 5).

#### Keeping a slice valid

A trimmed schema breaks easily. To meet requirements 1 and 3, a slice follows
these rules:

- An object or interface type stays only if it keeps at least one field. If a
  type becomes empty, the service drops it and the fields that return it.
- A type keeps an `implements` clause only if the interface is also in the
  slice. Every interface that this interface implements must also be in the
  slice. The type keeps every field of that interface that the slice includes.
- A union keeps only the members that are in the slice. If no member remains,
  the service drops the union.
- A field keeps all its required arguments, and an input type keeps all its
  required fields. Default values and `@oneOf` stay as they are. Without these
  rules, an operation can validate against the slice and fail against the full
  schema.
- If the slice applies a directive, the slice also defines that directive.
- Each type, field, argument, input field and enum value in the slice exists in
  the full schema with the same name and type.

A conformance test can check the last rule directly. Together, the rules are
meant to give the guarantee of requirement 3 about operations. A service can
trim output enum values or union members. Then a response can contain values
that the slice does not declare. A client that generates exhaustive code from a
slice must allow for unknown values.

The first rule follows the September 2025 edition, which requires an object or
interface type to define at least one field. The GraphQL working group is
relaxing this rule in [graphql-spec#1227][spec-1227], [#1228][spec-1228] and
[#1229][spec-1229], partly for schema subsets for AI. Under an edition that
adopts these changes, a slice can keep an empty referenced type, such as
`type Book {}`, instead of dropping it. Such a slice is valid only under that
edition, so a client that parses an older edition says so with `v`
([section 2](#2-request-parameters)). This document requires neither behavior.

[spec-1227]: https://github.com/graphql/graphql-spec/pull/1227
[spec-1228]: https://github.com/graphql/graphql-spec/pull/1228
[spec-1229]: https://github.com/graphql/graphql-spec/pull/1229

#### Example

Request:

```http
GET /graphql/schema?q=latest+commit+on+the+default+branch+of+a+repository HTTP/1.1
Host: api.example.com
Accept: text/plain, application/graphql-response+json
```

The same search as a `POST` request:

```http
POST /graphql/schema HTTP/1.1
Host: api.example.com
Content-Type: application/json
Accept: text/plain, application/graphql-response+json

{ "q": ["latest commit on the default branch of a repository"] }
```

Response (abbreviated), for a GitHub-like schema:

```http
HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
```

```graphql
type Query {
  repository(owner: String!, name: String!): Repository
}

type Repository {
  name: String!
  defaultBranchRef: Ref
}

type Ref {
  name: String!
  target: GitObject
}

interface GitObject {
  oid: String!
}

type Commit implements GitObject {
  oid: String!
  message: String!
  committedDate: DateTime!
  author: GitActor
  history(first: Int): CommitHistoryConnection!
}

type GitActor {
  name: String
  email: String
  date: DateTime
}

type CommitHistoryConnection {
  nodes: [Commit]
}

scalar DateTime
```

The full `Repository` type has over a hundred fields, and the slice keeps two.
The intents did not match the `history` field. The service included it under the
size budget, because a client needs it to ask for more than one commit.

A search that matches nothing, for example `?q=weather+forecast` on the same
schema:

```http
HTTP/1.1 204 No Content
```

A request with an unknown edition, for example `?q=...&v=march-2019`, gets an
error in the GraphQL over HTTP format:

```http
HTTP/1.1 400 Bad Request
Content-Type: application/graphql-response+json

{
  "errors": [
    {
      "message": "The edition 'march-2019' is not supported. Supported editions: october-2021, september-2025."
    }
  ]
}
```

### 4. What the specification does not define

The specification does not say how a service decides what is relevant. The
experiments of the working group used several methods:

- Vector embeddings (numeric representations of text).
- Lexical matching, for example BM25 (a keyword ranking method) and trigrams.
- Boosts for exact matches.
- Expansion from types first, with a budget for each type.
- Combinations of all of these methods.

Existing implementations differ as much. Apollo MCP Server ranks types with BM25
over type names, type descriptions and field names. The slicer of ChilliCream
combines embeddings with lexical boosts. The results varied widely between
algorithms and between schemas, and the best method still changes. If the
specification fixes an algorithm, it freezes the wrong thing.

For the same reason, the response carries no score, and the request accepts no
score threshold. Scores are not comparable across embedding models or across
schemas. In the author's own tests, a threshold of `0.8` matched nothing with
one embedding model and many results with another. Only the service can
interpret its own scores, so the service keeps them.

The specification fixes the contract: natural language in, a valid subset of the
schema out. Any search algorithm that follows [section 3](#3-response) conforms.
You can use the [evaluation bench](../benchmark/evaluation) to compare
implementations.

### 5. Building up a slice across requests

This section is non-normative. [Section 3](#3-response) sets the goal that one
response is enough, and the working group prefers to improve the first response
before it adds a second request. This section records the design space for that
second request and a candidate design for a future extension. It does not set a
requirement.

Sometimes the first slice is not enough. While the model writes a query, it can
find that it needs a field that the slice does not include. With semantic
introspection, the model searches again from its current point. With schema
search, a second request returns another whole slice. That slice can repeat most
of the first one.

To support expansion, the design must answer two questions. How does the client
tell the service what it already has? And what does the service send back? Every
design so far keeps the server stateless, and the client carries the state.

The examples below use one scenario. After a first search, the client holds this
slice:

```graphql
type Query {
  repository(owner: String!, name: String!): Repository
}

type Repository {
  defaultBranchRef: Ref
}

type Ref {
  target: GitObject
}

interface GitObject {
  oid: String!
}

type Commit implements GitObject {
  oid: String!
  message: String!
}
```

The client then searches for "commit author email". The new parts are
`Commit.author` and the `GitActor` type.

#### What the client sends

1. Known coordinates. The client lists the coordinates that it already has. The
   request stays a `GET`, but the URL grows during the session. So long lists
   need a request with a body, `QUERY` or `POST`, as [section 1](#1-endpoint)
   describes.

   ```
   GET /graphql/schema?q=commit+author+email&known=Query.repository&known=Repository.defaultBranchRef&known=Ref.target&known=GitObject.oid&known=Commit.oid&known=Commit.message
   ```

2. Local schema. The client sends the schema that it has built so far in the
   body of a `QUERY` or `POST` request. This option adds a `schema` member to
   the JSON body from [section 1](#1-endpoint). The body also grows during the
   session.

   ```
   QUERY /graphql/schema
   Content-Type: application/json

   {
     "q": ["commit author email"],
     "schema": "type Query { repository(owner: String!, name: String!): Repository } type Repository { defaultBranchRef: Ref } type Ref { target: GitObject } interface GitObject { oid: String! } type Commit implements GitObject { oid: String! message: String! }"
   }
   ```

3. Cursor. The previous response carries an opaque token that encodes what the
   service sent. The client passes the token back. It is the simplest option for
   the client. But the token grows during the session, and it ties the client to
   the encoding of one service.

#### What the service returns

The first option is a whole slice. The response is a complete, valid schema on
its own (requirement 1). So it must repeat a path from the root to every new
field:

```graphql
type Query {
  repository(owner: String!, name: String!): Repository
}

type Repository {
  defaultBranchRef: Ref
}

type Ref {
  target: GitObject
}

interface GitObject {
  oid: String!
}

type Commit implements GitObject {
  oid: String!
  author: GitActor
}

type GitActor {
  name: String
  email: String
}
```

The client still has to merge this slice into what it holds, field by field.
Also, nothing in the response says that it is partial. This `Commit` has no
`message`, and a model can take it as the complete type. In practice, models
often cannot tell whether a slice is complete.

The second option is a patch. The response holds only what is new. It extends
the types that the client already has, and it defines new types in full:

```graphql
extend type Commit {
  author: GitActor
}

type GitActor {
  name: String
  email: String
}
```

The `extend` keyword tells the model that the response is partial and that the
client must merge it. Standard tools already merge extensions into a schema, for
example `extendSchema` in graphql-js and schema extensions in Apollo Compiler.
Patches also suit tools on the client side. A code generator or a Relay-style
component can build up exactly the schema that it depends on. A patch is not a
valid schema on its own. So requirement 1 applies to the merged result, not to
each response. Pascal Senn and Michael Staib both proposed this format.

#### Candidate design

The candidate uses known coordinates on the request and a patch in the response.
It adds a `known` parameter and a response form with `extend`. The limitations
of state and merge below apply to it. The response can also say that it is
partial. A request without known coordinates gets a slice, as in
[section 3](#3-response). So a client that never expands needs nothing extra.

The base contract returns whole slices. The following problems must be resolved
before a patch extension can be specified:

- Schema changes. A deployment between two requests can change the schema. Then
  the client merges a patch into a state that is no longer true. A response can
  carry an `ETag`. A request with an old `ETag` then gets
  `412 Precondition Failed` or a whole slice, not a patch.
- Incomplete state. A field coordinate does not identify which optional
  arguments the client holds. Type and enum-value coordinates can describe more
  state, but schema coordinates do not describe an `implements` clause. A list
  of known fields therefore cannot determine the patch the client needs.
- Existing field changes. A slice can omit an optional argument. Adding it later
  requires changing an existing field definition, which SDL `extend type` cannot
  do. Standard extension tools support the additive example above, but not this
  case. An extension must either restrict trimming so retained fields have
  complete signatures, or define replacement and merge semantics beyond SDL
  extensions.
- URL length. A slice holds about 800 coordinates on average. The `known` list
  for it is tens of kilobytes. This size is far over the URL limits of common
  servers and proxies. So a client that sends `known` uses `QUERY` or `POST`.
- Caching. `known` lists rarely repeat, so a cache gains little.

The bench did not measure how often a first slice needs expansion. It also did
not measure the cost of a repeated whole slice. These numbers decide whether
this design is worth its complexity.

### 6. Relationship to GraphQL over HTTP

Schema search has its own specification, but it builds on [GraphQL over
HTTP][gql-http]. GraphQL over HTTP is still a draft, and it prepares its first
release. It defines these parts, and this proposal uses them:

- The endpoint URL.
- The encoding of parameters in a `GET` request.
- The JSON request body.
- The response format for errors.
- The security considerations.

This document refers to those definitions and does not repeat them. It cites
them by name, not by section number, so the references stay correct when the
draft changes.

A service that supports schema search MUST serve its GraphQL endpoint as GraphQL
over HTTP specifies.

Two separate documents let schema search develop at its own pace. They also add
no scope to GraphQL over HTTP before its first release. A later edition of
GraphQL over HTTP can add a short pointer to this document. The pointer can say
that a service that supports schema search SHOULD expose it at `/schema`
relative to its GraphQL endpoint.

---

## Potential Extensions

### A. Anchor type

A parameter can start the search from a type, not from the root operation types:

```
GET /graphql/schema?q=commit+author&from=Repository
```

The slice then contains the path down from `Repository`, not the path from
`Query`. This option helps a client that builds a fragment for a component and
knows which type the component renders. The `introspect` tool of Apollo MCP
Server offers this kind of exploration today. It takes a type name and a depth,
and it returns that part of the schema.

### B. Descriptions

A parameter can include or exclude descriptions explicitly. A client that wants
the smallest slice can exclude them. A client that wants documentation can
include them. Requirement 6 in [section 3](#3-response) already lets a service
omit them.

### C. Non-schema results

The same query can return things other than schema. A service that keeps a set
of trusted documents can return an existing operation that answers the question.
Then the client does not have to write the operation. A service can even
generate the operation itself. Both options are out of scope for the base
specification, but they fit the same entry point.

### D. Streaming

A service MAY stream the response and send the most relevant definitions first.
The slice is valid only when it is complete. So a streaming client must wait for
the end before it builds a schema. The benefit is limited to the latency that
the user perceives.

---

## Open Questions

1. The `/graphql/schema` endpoint of Hot Chocolate accepts `types`, which
   returns named types. Must the specification standardize it too?
2. Are the edge-case behaviors in [section 3](#3-response) right? When only some
   intents match, the service returns a slice and does not say which intents
   matched. When a match is only in `Mutation` or `Subscription`, it keeps a
   minimal query root.

---

## Feedback Requested

- Do you prefer to get the same slice from an introspection field, not from an
  HTTP endpoint (see [Alternatives considered](#alternatives-considered))?
