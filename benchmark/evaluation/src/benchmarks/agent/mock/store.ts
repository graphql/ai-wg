/**
 * Deterministic, lazy, id-keyed entity store.
 *
 * A fresh store is created per `execute()` call, but every entity is a pure function of its
 * `id`, so two independent calls produce the SAME entity for the same id (the gold op and the
 * agent's query agree without shared mutable state). Within one call the Map caches, giving
 * real within-query consistency.
 */
import type { Entity, EntityStore, ConnectionOpts } from './types.ts';
import { stableHash, seedId } from './seed.ts';

/** Default node count for a connection when neither `first` nor `last` is given. */
const DEFAULT_LENGTH = 3;
/** Hard cap on the number of nodes any connection can materialize. */
const CAP = 5;

/** Build the in-memory entity store backing one execution. */
export function createStore(): EntityStore {
    // Cache keyed by 'type#id' so repeated references within a query are identical.
    const cache = new Map<string, Entity>();

    const entity = (type: string, id: string, seedFields?: Record<string, unknown>): Entity => {
        const key = `${type}#${id}`;
        let e = cache.get(key);
        if (!e) {
            e = { __typename: type, id, _seed: stableHash(key) };
            cache.set(key, e);
        }
        // Seed/override forced scalar fields (lookup args, connection node fields, etc.).
        if (seedFields) {
            for (const [k, v] of Object.entries(seedFields)) {
                e[k] = v;
            }
        }
        return e;
    };

    const connection = (nodeType: string, parentId: string, opts: ConnectionOpts): Entity[] => {
        const requested = opts.first ?? opts.last ?? DEFAULT_LENGTH;
        const length = Math.min(Math.max(requested, 0), CAP);

        const nodes: Entity[] = [];
        for (let i = 0; i < length; i++) {
            const id = seedId(parentId, nodeType, i);
            // Per-node forced fields = seedFields plus any per-node `empty` blanking. A seedField
            // value may be a function of the node index, letting a connection seed a deterministic
            // mix (e.g. some paused, some not) so a `filter` produces a non-trivial result set.
            const fields: Record<string, unknown> = {};
            if (opts.seedFields) {
                for (const [k, v] of Object.entries(opts.seedFields)) {
                    fields[k] = typeof v === 'function' ? (v as (index: number) => unknown)(i) : v;
                }
            }
            if (opts.empty) {
                for (const [field, pred] of Object.entries(opts.empty)) {
                    if (pred(i)) {
                        fields[field] = null;
                    }
                }
            }
            nodes.push(entity(nodeType, id, fields));
        }

        // Post-generation predicate drops non-matching nodes.
        return opts.filter ? nodes.filter(opts.filter) : nodes;
    };

    return { entity, connection };
}
