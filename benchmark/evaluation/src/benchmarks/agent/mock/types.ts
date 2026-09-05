/**
 * Public types for the deterministic in-process GraphQL mock server.
 *
 * The mock executes graphql-js `execute()` over an executable schema with NATIVE
 * per-field resolvers (a per-schema {@link ResolverMap} set on `field.resolve`) plus a
 * custom `fieldResolver` FALLBACK (default-resolver.ts) for every unmapped field. All
 * variation is seeded — see seed.ts — so the same query always yields the same result.
 */
import type { GraphQLSchema, GraphQLResolveInfo, ExecutionResult } from 'graphql';

/** A plain object flowing as a graphql-js `source` value. `_seed` drives all of the
 *  entity's per-field variation; arbitrary scalar/object fields may be seeded onto it
 *  (e.g. a lookup arg, a connection prop) and are honored by the default resolver. */
export interface Entity {
    __typename: string;
    id: string;
    _seed: number;
    [k: string]: unknown;
}

/** Context threaded through every resolver via graphql-js `contextValue`. */
export interface MockContext {
    store: EntityStore;
    coverage: CoverageRecorder;
}

/** A native per-field resolver. graphql-js dispatches it for the field it is attached to. */
export type Resolver = (
    source: any,
    args: Record<string, any>,
    ctx: MockContext,
    info: GraphQLResolveInfo,
) => unknown;

/** Per-schema resolver map: `{ Type: { field: Resolver } }`. */
export type ResolverMap = Record<string, Record<string, Resolver>>;

/** Options controlling a deterministic connection of child entities. */
export interface ConnectionOpts {
    /** Pagination → list length = clamp(first ?? last ?? DEFAULT, 0, CAP). */
    first?: number;
    last?: number;
    /** Explicit totalCount; else derived deterministically. */
    count?: number;
    /** Post-generation predicate; nodes failing it are dropped. */
    filter?: (e: Entity) => boolean;
    /** Force node scalar fields (e.g. `{ state: 'OPEN' }`). A value may be a per-node function of
     *  the node's index — `{ paused: (i) => i < 2 }` — to seed a deterministic mix across the pool
     *  (then `filter` can keep only matching nodes, modeling a real filterable endpoint). */
    seedFields?: Record<string, unknown | ((index: number) => unknown)>;
    /** Per-node: make a field null/[] when `pred(index)` → models "which have none". */
    empty?: Record<string, (index: number) => boolean>;
}

/** Deterministic, lazy, id-keyed entity store. */
export interface EntityStore {
    /** Get-or-create a deterministic entity, stable by `id`. */
    entity(type: string, id: string, seedFields?: Record<string, unknown>): Entity;
    /** Deterministic child node entities for a parent connection. */
    connection(nodeType: string, parentId: string, opts: ConnectionOpts): Entity[];
}

/** Records every `(type, field, argNames)` the default resolver handled → coverage gaps. */
export interface CoverageRecorder {
    record(type: string, field: string, argNames: string[]): void;
    report(): string;
}

/** The public mock server. `execute()` runs a query; `coverage` aggregates across calls. */
export interface MockServer {
    execute(query: string, variables?: Record<string, unknown>): ExecutionResult;
    coverage: CoverageRecorder;
}
