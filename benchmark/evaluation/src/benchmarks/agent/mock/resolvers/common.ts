/**
 * Reusable, deterministic resolver factories.
 *
 * These build the handful of {@link Resolver}s the gold-op survey says actually matter — Relay
 * connections (pagination + edges/nodes/pageInfo/totalCount), id/name lookups whose result reflects
 * its lookup args, plain object lists — plus two small helpers (`dateRange`, `nullableSubset`) used
 * to shape `ConnectionOpts`. Every factory stays deterministic: no clock, no RNG. All variation
 * flows from the engine's seeded store/seed helpers via `ctx.store`.
 *
 * A schema's hand-written {@link ResolverMap} (resolvers/github.ts, …) is then small and readable:
 * it only names the answer-bearing fields and composes these factories.
 */
import {
    isObjectType,
    isInterfaceType,
    isLeafType,
    isListType,
    isNonNullType,
    getNamedType,
    type GraphQLResolveInfo,
    type GraphQLNamedType,
    type GraphQLField,
} from 'graphql';
import type { Entity, Resolver, ConnectionOpts } from '../types.ts';
import { seedDate, REFERENCE_INSTANT } from '../seed.ts';

/** A Relay connection object: what a connection field resolver returns. The default resolver then
 *  serves `edges`/`nodes`/`totalCount`/`pageInfo` by reading these props off the source. */
export interface Connection {
    __typename: string;
    nodes: Entity[];
    edges: { __typename: string; node: Entity; cursor: string }[];
    totalCount: number;
    /** Alias of totalCount — some schemas name the count field `count` (e.g. gitlab) rather than
     *  `totalCount`. Exposing both means whichever the schema declares resolves to the real count
     *  (instead of a generic seeded scalar), so "how many …" answers are grounded. */
    count: number;
    pageInfo: {
        __typename: 'PageInfo';
        hasNextPage: boolean;
        hasPreviousPage: boolean;
        startCursor: string | null;
        endCursor: string | null;
    };
}

/** Per-factory options may be static or computed from the field's resolved args. */
type OptsArg = Partial<ConnectionOpts> | ((args: Record<string, any>) => Partial<ConnectionOpts>);

/** A deterministic opaque cursor for the node at `index` of a connection. */
function cursor(parentId: string, nodeType: string, index: number): string {
    return `cursor:${parentId}/${nodeType}/${index}`;
}

/** Shape a list of node entities into the connection object the contract mandates. `totalCount`
 *  honors an explicit `opts.count`, else reports the materialized node count. `pageInfo` is derived
 *  from `first`/`last` vs the count so "has more" is internally consistent. */
function shapeConnection(
    nodeType: string,
    parentId: string,
    nodes: Entity[],
    opts: ConnectionOpts,
): Connection {
    const totalCount = opts.count ?? nodes.length;
    const edges = nodes.map((node, i) => ({
        __typename: `${nodeType}Edge`,
        node,
        cursor: cursor(parentId, nodeType, i),
    }));
    const window = opts.first ?? opts.last;
    // Paging forward (`first`): more remains iff the connection holds more than this page.
    const hasNextPage = window != null ? totalCount > nodes.length : false;
    // Paging backward (`last`): symmetric — earlier items exist beyond the window.
    const hasPreviousPage = opts.last != null ? totalCount > nodes.length : false;
    return {
        __typename: `${nodeType}Connection`,
        nodes,
        edges,
        totalCount,
        count: totalCount,
        pageInfo: {
            __typename: 'PageInfo',
            hasNextPage,
            hasPreviousPage,
            startCursor: edges.length > 0 ? edges[0]!.cursor : null,
            endCursor: edges.length > 0 ? edges[edges.length - 1]!.cursor : null,
        },
    };
}

/**
 * A Relay connection resolver.
 *
 * Reads `first`/`last` off the field's ARGS, merges them with `opts` (static or a fn of the args),
 * calls `ctx.store.connection(nodeType, source.id, mergedOpts)` to materialize deterministic node
 * entities, and RETURNS THE CONNECTION OBJECT. Explicit `first`/`last` in `opts` win over the args
 * (a map can pin a page size); otherwise the field's own arg drives pagination.
 */
export function connection(nodeType: string, opts?: OptsArg): Resolver {
    return (source, args, ctx, info): Connection => {
        // Honor a parent's `empty` flag for THIS field even though it has its own resolver: a node
        // blanked by applyEmpty carries an `_empty` marker, so e.g. "merge requests with no
        // reviewers" yields an empty connection here instead of re-materializing a full one.
        const parentId0 = (source?.id as string | undefined) ?? `${nodeType}:root`;
        if (isEmptyFlagged(source, info.fieldName)) {
            return shapeConnection(nodeType, parentId0, [], { count: 0 });
        }
        const resolved = typeof opts === 'function' ? opts(args ?? {}) : (opts ?? {});
        // The field's own pagination args, overridable by an explicit opt. Built by conditional
        // assignment (not `key: undefined`) to satisfy exactOptionalPropertyTypes.
        const merged: ConnectionOpts = {};
        const first = resolved.first ?? (args?.first as number | undefined);
        const last = resolved.last ?? (args?.last as number | undefined);
        if (first != null) merged.first = first;
        if (last != null) merged.last = last;
        if (resolved.count != null) merged.count = resolved.count;
        if (resolved.filter) merged.filter = resolved.filter;
        if (resolved.seedFields) merged.seedFields = resolved.seedFields;
        // `empty` is applied HERE (not by the store), so a flagged child field becomes the
        // type-correct "none" — an empty connection / [] / null — never a raw null that would
        // violate a non-null connection field. See applyEmpty.
        const nodes = ctx.store.connection(nodeType, parentId0, merged);
        if (resolved.empty) {
            applyEmpty(nodes, resolved.empty, nodeType, info);
        }
        return shapeConnection(nodeType, parentId0, nodes, merged);
    };
}

/** True when a parent's applyEmpty has flagged `fieldName` on this source node as "none" — so a
 *  child collection resolver returns empty instead of re-materializing. */
function isEmptyFlagged(source: any, fieldName: string): boolean {
    const marker = source?._empty;
    return marker instanceof Set && marker.has(fieldName);
}

/** For each `empty` entry, blank the named child field on every node whose index matches the
 *  predicate — using the SCHEMA-CORRECT empty value so non-null connection fields stay valid:
 *  a connection field → an empty Connection object; a list field → `[]`; otherwise `null`. */
function applyEmpty(
    nodes: Entity[],
    empty: NonNullable<ConnectionOpts['empty']>,
    nodeType: string,
    info: GraphQLResolveInfo,
): void {
    for (const [field, pred] of Object.entries(empty)) {
        const fieldDef = nodeFieldDef(nodeType, field, info);
        for (let i = 0; i < nodes.length; i++) {
            if (!pred(i)) continue;
            const e = nodes[i]!;
            // Set the empty value directly (covers fields served by the default resolver) AND stamp
            // an `_empty` marker (honored by connection()/listOf if the field has its OWN resolver).
            e[field] = emptyValueFor(fieldDef, field);
            const marker = (e._empty as Set<string> | undefined) ?? new Set<string>();
            marker.add(field);
            e._empty = marker;
        }
    }
}

/** Look up a field definition on the connection's node type (object or interface). */
function nodeFieldDef(
    nodeType: string,
    field: string,
    info: GraphQLResolveInfo,
): GraphQLField<any, any> | undefined {
    const t = info.schema.getType(nodeType);
    if (t && (isObjectType(t) || isInterfaceType(t))) {
        return t.getFields()[field];
    }
    return undefined;
}

/** The schema-correct "none" value for a node field being blanked. */
function emptyValueFor(fieldDef: GraphQLField<any, any> | undefined, field: string): unknown {
    if (!fieldDef) return null;
    const bare = isNonNullType(fieldDef.type) ? fieldDef.type.ofType : fieldDef.type;
    if (isListType(bare)) return [];
    const named = getNamedType(bare);
    // A connection field "has none" → an empty connection object (valid for `XConnection!`).
    if ((isObjectType(named) || isInterfaceType(named)) && named.name.endsWith('Connection')) {
        return emptyConnection(named.name, `${field}:empty`);
    }
    return null;
}

/** A well-formed but empty Relay connection — totalCount 0, no nodes/edges, flat pageInfo. */
function emptyConnection(connectionTypeName: string, parentId: string): Connection {
    const nodeType = connectionTypeName.replace(/Connection$/, '');
    return shapeConnection(nodeType, parentId, [], { count: 0 });
}

/** Scalar/enum (leaf) field names declared on `typeName` in the schema — the args eligible for
 *  default seeding. Returns an empty set for unknown/non-composite types. */
function leafFieldNames(typeName: string, info: GraphQLResolveInfo): Set<string> {
    const t: GraphQLNamedType | undefined = info.schema.getType(typeName) ?? undefined;
    const names = new Set<string>();
    if (t && (isObjectType(t) || isInterfaceType(t))) {
        for (const [name, def] of Object.entries(t.getFields())) {
            if (isLeafType(getNamedType(def.type))) {
                names.add(name);
            }
        }
    }
    return names;
}

/**
 * A lookup resolver: `Query.repository(owner,name)` → the Repository entity for that id, with its
 * lookup args reflected as its own scalar fields (so `repository(name:"x").name === "x"`).
 *
 * `idFrom(args)` builds the stable id. `seedFrom(args)` forces scalar fields onto the entity;
 * its DEFAULT copies every scalar arg whose name is a leaf field on `type` (so `name`/`owner`-style
 * args round-trip, while pagination/filter args that aren't fields are dropped).
 */
export function lookup(
    type: string,
    idFrom: (args: Record<string, any>) => string,
    seedFrom?: (args: Record<string, any>) => Record<string, unknown>,
): Resolver {
    return (_source, args, ctx, info): Entity => {
        const a = args ?? {};
        const seedFields = seedFrom ? seedFrom(a) : defaultSeedFromArgs(type, a, info);
        return ctx.store.entity(type, idFrom(a), seedFields);
    };
}

/** Default `seedFrom`: copy every scalar-valued arg whose name is a leaf field on `type`. */
function defaultSeedFromArgs(
    type: string,
    args: Record<string, any>,
    info: GraphQLResolveInfo,
): Record<string, unknown> {
    const fields = leafFieldNames(type, info);
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(args)) {
        // Only forward scalar-shaped args that correspond to an actual leaf field on the type.
        if (fields.has(name) && isScalarish(value)) {
            out[name] = value;
        }
    }
    return out;
}

/** True for values cheap to stamp onto an entity as a seeded scalar (string/number/boolean). */
function isScalarish(v: unknown): boolean {
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/**
 * A non-connection object-list resolver: returns `n` deterministic child entities of `nodeType`
 * (default `DEFAULT_LIST = 2`), scoped to the parent via `source.id`. For plain `[T]` fields that
 * are NOT Relay connections.
 */
export function listOf(nodeType: string, n?: number): Resolver {
    return (source, _args, ctx, info): Entity[] => {
        if (isEmptyFlagged(source, info.fieldName)) return []; // honor a parent's `empty` flag
        const count = n ?? DEFAULT_LIST;
        const parentId = (source?.id as string | undefined) ?? `${nodeType}:root`;
        // Reuse the store's deterministic per-index node generation; no pagination/filter here.
        return ctx.store.connection(nodeType, parentId, { first: count });
    };
}

/** Default element count for {@link listOf}. */
const DEFAULT_LIST = 2;

/**
 * Resolve a `[from, to]` ISO date window from `args` for the named date args (e.g.
 * `['since','until']` or `['from','to']`). A bound the args don't supply falls back to a
 * deterministic date around {@link REFERENCE_INSTANT}, so a window always has two ISO endpoints.
 * Use it inside a `connection(...)` opts fn to seed node date fields into a requested range.
 */
export function dateRange(
    args: Record<string, any>,
    names: string[],
): { from: string; to: string } {
    const a = args ?? {};
    const raw = names.map((n) => a[n]).filter((v): v is string => typeof v === 'string');
    const from = raw.length > 0 ? raw[0]! : seedDate('dateRange', names.join('-'), 0);
    const to = raw.length > 1 ? raw[1]! : REFERENCE_INSTANT;
    // Normalize ordering so `from <= to` regardless of which arg names were supplied.
    return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * Build an `empty` entry for {@link ConnectionOpts}: `nullableSubset('assignees', i => i % 3 === 0)`
 * blanks the named field (null/[]) on every node whose index matches `pred` — modeling "which have
 * none". Spread the result into a connection's `empty` opt.
 */
export function nullableSubset(
    field: string,
    pred: (index: number) => boolean,
): Record<string, (index: number) => boolean> {
    return { [field]: pred };
}
