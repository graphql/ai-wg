/**
 * `baseline-topk` — the floor strategy.
 *
 * Take cosine top-K against the raw query embedding, then for each hit walk
 * a single shortest path-to-root and add every field coord on that path to
 * the selection. No scoring beyond cosine, no expansion, no stopping logic.
 *
 * Ported from `lib/explore/strategies/baseline-topk.ts`. The parent reaches
 * the same outcome via `ctx.pathsToMember(member)` (returns root→hit chains
 * of field coords) followed by a dedup-by-path-key pass. Here we reproduce
 * the same shape by running a BFS in reverse adjacency from the hit's
 * parent type back to a root, then appending the hit coord itself.
 *
 * SELF-CONTAINED: only imports from ../../core/types.ts. Reverse adjacency,
 * BFS, and tie-breaking are duplicated locally on purpose — see the harness
 * contract.
 */

import type { FieldDef, SchemaSnapshot, StrategyInput, StrategyResult } from '../../core/types.ts';

interface Config {
    /** Top-K global cosine neighbours over indexed field coords. */
    k: number;
    /** Hard cap on path depth (number of field hops). */
    maxDepth: number;
    /** Include Mutation paths even when Query/Sub paths exist. */
    includeMutationPaths: boolean;
    /**
     * If the hit's parent type doesn't have a path-to-root within the depth
     * budget, fall back to a Connection/Edge-wrapped sibling type. Matches
     * the parent pipeline's wrapper-friendly behaviour.
     */
    expandConnectionWrappers: boolean;
}

const DEFAULT_CONFIG: Config = {
    k: 20,
    maxDepth: 6,
    includeMutationPaths: false,
    expandConnectionWrappers: true,
};

const WRAPPER_SUFFIXES: ReadonlyArray<string> = ['Connection', 'Edge'];

function resolveConfig(raw: Record<string, unknown>): Config {
    const out: Config = { ...DEFAULT_CONFIG };
    if (typeof raw['k'] === 'number') out.k = raw['k'];
    if (typeof raw['maxDepth'] === 'number') out.maxDepth = raw['maxDepth'];
    if (typeof raw['includeMutationPaths'] === 'boolean') {
        out.includeMutationPaths = raw['includeMutationPaths'];
    }
    if (typeof raw['expandConnectionWrappers'] === 'boolean') {
        out.expandConnectionWrappers = raw['expandConnectionWrappers'];
    }
    return out;
}

// ─── Reverse adjacency (returnType → incoming edges) ──────────────────────

interface IncomingEdge {
    fieldCoord: string;
    parentType: string;
}

interface ReverseIndex {
    reverseAdj: Map<string, IncomingEdge[]>;
    objectLikeTypes: Set<string>;
}

function buildReverseIndex(snap: SchemaSnapshot): ReverseIndex {
    const reverseAdj = new Map<string, IncomingEdge[]>();
    const objectLikeTypes = new Set<string>(snap.fieldsByType.keys());
    for (const f of snap.fields) {
        const arr = reverseAdj.get(f.returnType) ?? [];
        arr.push({ fieldCoord: f.coord, parentType: f.parent });
        reverseAdj.set(f.returnType, arr);
    }
    return { reverseAdj, objectLikeTypes };
}

// ─── BFS: a single shortest path-to-root for a type ───────────────────────

/**
 * Return the single best path of field coords from a root type to `targetType`.
 * Empty array means `targetType` IS a root (no field hops needed). `null`
 * means no path within budget.
 *
 * Ranking matches parent: prefer Query > Subscription > Mutation (excluded
 * unless `includeMutations` is true), then shortest, then lex tiebreak.
 */
function firstPathToRoot(
    index: ReverseIndex,
    roots: ReadonlySet<string>,
    rootPref: ReadonlyArray<string>,
    targetType: string,
    maxDepth: number,
    includeMutations: boolean,
): string[] | null {
    if (roots.has(targetType)) return [];

    interface Frontier {
        type: string;
        pathReverse: string[]; // [closest-to-target, ..., outermost-edge]
        visitedCoords: Set<string>;
    }
    interface Found {
        path: string[]; // root → target order
        rootType: string;
    }
    const found: Found[] = [];
    const collectCap = 20; // small pool — we only return one

    const queue: Frontier[] = [
        {
            type: targetType,
            pathReverse: [],
            visitedCoords: new Set<string>(),
        },
    ];

    while (queue.length > 0 && found.length < collectCap) {
        const cur = queue.shift()!;
        if (cur.pathReverse.length >= maxDepth) continue;
        const incoming = index.reverseAdj.get(cur.type);
        if (!incoming) continue;

        for (const edge of incoming) {
            if (cur.visitedCoords.has(edge.fieldCoord)) continue;
            const nextVisited = new Set(cur.visitedCoords);
            nextVisited.add(edge.fieldCoord);
            const nextPathReverse = [...cur.pathReverse, edge.fieldCoord];
            if (roots.has(edge.parentType)) {
                found.push({
                    path: [...nextPathReverse].reverse(),
                    rootType: edge.parentType,
                });
                if (found.length >= collectCap) break;
            } else {
                queue.push({
                    type: edge.parentType,
                    pathReverse: nextPathReverse,
                    visitedCoords: nextVisited,
                });
            }
        }
    }

    const pool = includeMutations ? found : found.filter((f) => f.rootType !== 'Mutation');
    if (pool.length === 0) return null;

    const prefIdx = (rootName: string): number => {
        const i = rootPref.indexOf(rootName);
        return i === -1 ? rootPref.length : i;
    };
    pool.sort((a, b) => {
        const pa = prefIdx(a.rootType);
        const pb = prefIdx(b.rootType);
        if (pa !== pb) return pa - pb;
        if (a.path.length !== b.path.length) return a.path.length - b.path.length;
        return a.path.join('|').localeCompare(b.path.join('|'));
    });
    return pool[0]!.path;
}

// ─── Strategy entry point ─────────────────────────────────────────────────

export function run(input: StrategyInput): StrategyResult {
    const cfg = resolveConfig(input.config);
    const snap = input.snapshot;

    // ---- Step 1: global cosine kNN over indexed field coords ----
    const cos = snap.cosineToQuery(input.query.embedding);
    const ranked: Array<{ coord: string; score: number }> = [];
    for (const [coord, score] of cos) {
        ranked.push({ coord, score });
    }
    ranked.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.coord.localeCompare(b.coord);
    });
    const topK = ranked.slice(0, Math.max(1, cfg.k));

    // ---- Step 2: for each hit, attach a single shortest path-to-root ----
    // Parent uses ctx.pathsToMember(member) which returns root → hit chains
    // of field coords. We reproduce that by running BFS from the hit's
    // PARENT type back to a root and appending the hit coord.
    const roots = snap.rootTypes;
    const rootPref: string[] = ['Query', 'Subscription', 'Mutation'].filter((r) => roots.has(r));
    const index = buildReverseIndex(snap);

    const selected = new Set<string>();
    const seenPathKeys = new Set<string>();

    for (const hit of topK) {
        // Always keep the raw hit (matches parent's final
        // `for (const h of hits) selected.add(h.coordinate)`).
        selected.add(hit.coord);

        const fd: FieldDef | undefined = snap.fieldByCoord.get(hit.coord);
        if (!fd) continue;

        // Try the hit's parent type first.
        let prefixPath = firstPathToRoot(
            index,
            roots,
            rootPref,
            fd.parent,
            cfg.maxDepth,
            cfg.includeMutationPaths,
        );

        // Fallback: if no path AND wrappers are enabled, try Connection/Edge
        // wrapper types of the parent. This is rare for parent-side parents
        // but kept for parity with the parent pipeline's intent.
        if (prefixPath === null && cfg.expandConnectionWrappers) {
            for (const suffix of WRAPPER_SUFFIXES) {
                const wrapped = `${fd.parent}${suffix}`;
                if (!index.objectLikeTypes.has(wrapped)) continue;
                prefixPath = firstPathToRoot(
                    index,
                    roots,
                    rootPref,
                    wrapped,
                    cfg.maxDepth,
                    cfg.includeMutationPaths,
                );
                if (prefixPath !== null) break;
            }
        }

        if (prefixPath === null) continue; // unreachable hit — keep only the raw coord

        // Full chain = [...prefix, hitCoord], dedup by path key like parent.
        const fullPath = [...prefixPath, hit.coord];
        const key = fullPath.join('|');
        if (seenPathKeys.has(key)) continue;
        seenPathKeys.add(key);

        for (const c of fullPath) selected.add(c);
    }

    return {
        selectedCoords: [...selected].sort(),
    };
}
