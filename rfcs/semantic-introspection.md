# Semantic Introspection

**Status:**   
**Author:** 
  - Pascal Senn, ChilliCream
  - Michael Staib, ChilliCream
**Champion:**   

---

## Abstract

This document proposes an extension to GraphQL introspection that enables semantic search over
schema capabilities. By introducing a standardized `__search` endpoint and related types, AI agents
and LLMs could discover relevant API capabilities using natural language queries rather than
traversing the full schema graph.

---

## Background & Motivation

### Prelude 

The Model Context Protocol has emerged as the de facto standard (for now) for exposing capabilities
to AI agents. It provides a structured way to describe tools, prompts, and resources that LLMs can
discover and invoke.

When examining MCP's tool abstraction, the parallels to GraphQL are striking. An MCP tool that reads
data is functionally equivalent to a field on GraphQL's Query type; a tool that mutates data mirrors
a field on the Mutation type. MCP defines tool inputs and outputs using JSON Schema - GraphQL achieves
the same with its type system. 

At its core, an MCP tool is essentially a callable operation with typed inputs and outputs -
precisely what GraphQL has provided since its inception. 

The key differences are largely cosmetic: MCP uses JSON Schema for type definitions, while GraphQL
uses its own type system; MCP tools are flat, while GraphQL fields compose into a graph.

This raises an interesting question: rather than treating GraphQL and MCP as separate ecosystems,
could GraphQL's existing schema and introspection capabilities be extended to serve as a first - class
tool provider for AI agents? What about prompts? 

This analogy suggests that GraphQL may already contain most of the structural foundations required
for AI-driven capability discovery - it simply lacks a semantic layer.

### The Problem

Today, when an LLM interacts with a GraphQL API, it must either:

1. **Traverse the entire schema** via introspection or schema - expensive and impractical for large schemas
2. **Rely on pre-trained knowledge** of specific APIs - brittle and not generalizable
3. **Receive hand-crafted tool descriptions** - requires manual effort per API

This creates friction for AI-driven API consumption. Each new GraphQL API requires custom tooling or
extensive context windows to make the schema comprehensible to an LLM.

### The Opportunity

GraphQL's introspection system already provides a foundation for self-describing APIs. By extending
this foundation with semantic search capabilities, we could enable a **"learn once, use anywhere"**
pattern for AI agents:

- LLMs learn the GraphQL specification and semantic introspection protocol **once**
- From that point forward, they can discover and use **any** GraphQL API that implements this specification
- API providers index their schema **once**
- No per-API training or custom tool definitions required

### Alignment with AI Working Group Goals

This proposal directly addresses the question of how GraphQL can better support AI/ML use cases by
providing a standardized discovery mechanism that works across all conforming implementations.

---

## Proposal

### 1. Semantic Search Introspection

A new introspection field that enables semantic search over schema members:

```graphql
extend type Query {
  """
  Search the schema for capabilities matching the provided query.
  
  The query SHOULD be interpreted as natural language describing
  the desired capability. 

  The results SHOULD be ordered by their score descending, with the most relevant
  results appearing first.
  """
  __search(
    """Natural language query or search term."""
    query: String!
    
    """Maximum number of results to return."""
    first: Int! = 10
  ): [__SearchResult!]!
}
```

> **Editor's Note:** 
> We may need to add pagination support for `__search`

#### Search Result Type

```graphql
"""
Represents a schema member matched by semantic search.
"""
type __SearchResult {
  """
  Schema coordinate identifying the matched member.
  For example: "Query.user" or "Mutation.createPost(input: )"
  """
  coordinate: String!
  
  """
  The matched schema member.
  """
  member: __SchemaMember!

  """
  Paths from the matched member to a root type, aiding query construction.

  Each path is a sequence of schema coordinates, starting from the matched member and ending at a
  root type.

  Implementations MAY return multiple paths if the member is reachable via different routes. This 
  list is not guaranteed to be exhaustive.
  """
  pathsToRoot: [String!]!
  
  """
  Relevance score for the match.
  Implementations SHOULD return scores in the range [0.0, 1.0],
  where 1.0 indicates highest relevance.
  """
  score: Float
}
```

> **Editor's Note:** The `pathsToRoot` field is placed on `__SearchResult`, but it 
> arguably belongs on the schema member types themselves (e.g., `__Field`, `__Type`). 
> This placement warrants further discussion.

#### Schema Member Union

```graphql
"""
Union of all introspectable schema members that can be discovered
through semantic search.
"""
union __SchemaMember = 
  | __Type 
  | __Field 
  | __InputValue 
  | __EnumValue 
  | __Directive
```

### 2. Indexing Requirements

Implementations adhering to this specification:

- **MUST** maintain an index of the active schema
- **MAY** use any vectorization or indexing strategy internally
- **SHOULD** index at minimum: type names, field names, and descriptions

The indexing strategy is intentionally left to the implementation. 

### 3. Example Usage

```graphql
# An LLM trying to find how to look up a user by email
query {
  __search(query: "Find a user by their email address") {
    coordinate
    score
    member {
      ... on __Field {
        name
        description
        args {
          name
          type { name }
        }
      }
    }
  }
}
```

Example response:

```json
{
  "data": {
    "__search": [
      {
        "coordinate": "Query.userByEmail",
        "score": 0.92,
        "member": {
          "name": "userByEmail",
          "description": "Retrieve a user by their email address",
          "args": [
            { "name": "email", "type": { "name": "String" } }
          ]
        }
      },
      {
        "coordinate": "Query.users",
        "score": 0.71,
        "member": {
          "name": "users",
          "description": "List all users, optionally filtered by email domain",
          "args": []
        }
      }
    ]
  }
}
```

---

## Potential Extensions

### A. Usage Examples

To further assist AI agents in understanding how to use discovered capabilities, schemas could
provide (optional) usage examples.

This could also be helpful for human developers exploring unfamiliar APIs.


```graphql
"""
An example demonstrating how to use a schema member.
"""
type __Example {
  """
  Example GraphQL operation demonstrating usage.
  """
  operation: String!
  
  """
  Human-readable description of what this example demonstrates.
  """
  description: String
}

extend type __Type {
  """Usage examples for this type."""
  examples: [__Example!]
}

extend type __Field {
  """Usage examples for this field."""
  examples: [__Example!]
}

extend type __InputValue {
  """Usage examples for this input."""
  examples: [__Example!]
}

extend type __EnumValue {
  """Usage examples for this enum value."""
  examples: [__Example!]
}

extend type __Directive {
  """Usage examples for this directive."""
  examples: [__Example!]
}
```

### B. MCP-Style Prompts

For richer AI integration, schemas could expose prompt templates (inspired by MCP):

```graphql
extend type Query {
  """
  Retrieve all prompt templates defined in the schema.
  Prompts provide pre-defined interaction patterns for AI agents.
  """
  __prompts: [__Prompt!]!
}

"""
A prompt template that guides AI agent interaction with the API.
"""
type __Prompt {
  """Unique identifier for this prompt."""
  name: String!
  
  """Human-readable description of what this prompt accomplishes."""
  description: String
  
  """Arguments that can be passed to customize the prompt."""
  arguments: [__InputValue!]!
}
```

---

## Open Questions

1. **Effectiveness**:
2. **Security considerations**: Should there be guidance on rate limiting or access control for semantic search?
3. `capabilities` might collide with the existing RFC in the main repo Semantic Introspection

---

## Feedback Requested

- Does this address a real need you've encountered?
- Does this fit as an extension to GraphQL introspection, or should it be a separate mechanism?
- Does this approach of discovery work with LLMs?
- What concerns do you have about implementation complexity?
