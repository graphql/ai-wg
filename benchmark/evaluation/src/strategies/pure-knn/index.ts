/**
 * `pure-knn` — global cosine kNN baseline + paths-to-root closure.
 *
 * Pipeline:
 *   1. cosineToQuery → take top-K coords by similarity (no scoring re-weight,
 *      no lex, no recursion into object-valued children).
 *   2. Paths-to-root closure: for each selected coord T.f, ensure there is a
 *      chain Root → ... → T.f in the selection. Implemented as a BFS in
 *      reverse adjacency (returnType → incoming edges) from each anchor type
 *      (parent ∪ returnType of every selected coord) until a root parent is
 *      reached.
 *
 * SELF-CONTAINED: only imports from ../../core/types.ts. Cosine math, reverse
 * adjacency, BFS — all duplicated locally on purpose. See the harness contract.
 */

import type { FieldDef, SchemaSnapshot, StrategyInput, StrategyResult } from '../../core/types.ts';

interface Config {
    /** Top-K global cosine neighbors over indexed field coords. */
    K: number;
    /** Max number of shortest paths to return per target type. */
    maxPathsPerType: number;
    /** Hard cap on path depth (number of field hops). */
    maxDepth: number;
    /** Include Mutation paths even when Query/Sub paths exist. */
    includeMutationPaths: boolean;
    /** Also target Connection/Edge wrapper types when present. */
    expandConnectionWrappers: boolean;
}

const DEFAULT_CONFIG: Config = {
    K: 60,
    maxPathsPerType: 5,
    maxDepth: 6,
    includeMutationPaths: false,
    expandConnectionWrappers: true,
};

const WRAPPER_SUFFIXES: ReadonlyArray<string> = ['Connection', 'Edge'];

function resolveConfig(raw: Record<string, unknown>): Config {
    const out: Config = { ...DEFAULT_CONFIG };
    if (typeof raw['K'] === 'number') out.K = raw['K'];
    if (typeof raw['maxPathsPerType'] === 'number') out.maxPathsPerType = raw['maxPathsPerType'];
    if (typeof raw['maxDepth'] === 'number') out.maxDepth = raw['maxDepth'];
    if (typeof raw['includeMutationPaths'] === 'boolean')
        out.includeMutationPaths = raw['includeMutationPaths'];
    if (typeof raw['expandConnectionWrappers'] === 'boolean')
        out.expandConnectionWrappers = raw['expandConnectionWrappers'];
    return out;
}

interface IncomingEdge {
    fieldCoord: string;
    parentType: string;
}

interface ReverseIndex {
    /** returnType → list of (fieldCoord, parentType) that produce that returnType. */
    reverseAdj: Map<string, IncomingEdge[]>;
    /** Set of all parent types — these are exactly the object-like types in the schema. */
    objectLikeTypes: Set<string>;
}

function buildReverseIndex(snap: SchemaSnapshot): ReverseIndex {
    const reverseAdj = new Map<string, IncomingEdge[]>();
    const objectLikeTypes = new Set<string>();
    for (const f of snap.fields) {
        objectLikeTypes.add(f.parent);
        const arr = reverseAdj.get(f.returnType) ?? [];
        arr.push({ fieldCoord: f.coord, parentType: f.parent });
        reverseAdj.set(f.returnType, arr);
    }
    return { reverseAdj, objectLikeTypes };
}

/**
 * BFS backward from `targetType` collecting up to `maxPaths` paths-to-root,
 * ranked by (root-preference, length-asc, lex). Paths from the Mutation root
 * are excluded unless `includeMutations` is true.
 *
 * Returns each path as an array of field coords in root→target order.
 */
function pathsToRoot(
    index: ReverseIndex,
    roots: ReadonlySet<string>,
    rootPref: ReadonlyArray<string>,
    targetType: string,
    maxPaths: number,
    maxDepth: number,
    includeMutations: boolean,
): string[][] {
    if (roots.has(targetType)) return [[]];

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
    const collectCap = maxPaths * 4;

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

    return pool.slice(0, maxPaths).map((f) => f.path);
}

/** Expand each input type with Connection / Edge wrappers when those types exist. */
function expandWithWrappers(
    objectLikeTypes: ReadonlySet<string>,
    targets: ReadonlyArray<string>,
): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of targets) {
        if (!seen.has(t)) {
            seen.add(t);
            out.push(t);
        }
        for (const suffix of WRAPPER_SUFFIXES) {
            const wrapped = `${t}${suffix}`;
            if (objectLikeTypes.has(wrapped) && !seen.has(wrapped)) {
                seen.add(wrapped);
                out.push(wrapped);
            }
        }
    }
    return out;
}

/**
 * Union of all field coords on any path-to-root for any anchor type.
 * First-discovery order so coords on shorter paths land earlier.
 */
function pathsToRootClosure(
    index: ReverseIndex,
    roots: ReadonlySet<string>,
    rootPref: ReadonlyArray<string>,
    anchorTypes: ReadonlyArray<string>,
    cfg: Config,
): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const targets = cfg.expandConnectionWrappers
        ? expandWithWrappers(index.objectLikeTypes, anchorTypes)
        : [...anchorTypes];
    for (const t of targets) {
        const paths = pathsToRoot(
            index,
            roots,
            rootPref,
            t,
            cfg.maxPathsPerType,
            cfg.maxDepth,
            cfg.includeMutationPaths,
        );
        for (const path of paths) {
            for (const coord of path) {
                if (seen.has(coord)) continue;
                seen.add(coord);
                out.push(coord);
            }
        }
    }
    return out;
}

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
    const topK = ranked.slice(0, Math.max(1, cfg.K));

    const selected = new Set<string>();
    for (const h of topK) selected.add(h.coord);

    // ---- Step 2: paths-to-root closure ----
    // Anchor types = parent ∪ object-like returnType of every selected coord.
    const index = buildReverseIndex(snap);
    const roots = snap.rootTypes;
    // Prefer Query > Subscription > Mutation when choosing among candidate paths.
    const rootPref: string[] = ['Query', 'Subscription', 'Mutation'].filter((r) => roots.has(r));

    const anchorTypes: string[] = [];
    const seenAnchor = new Set<string>();
    for (const coord of selected) {
        const fd: FieldDef | undefined = snap.fieldByCoord.get(coord);
        if (!fd) continue;
        if (!seenAnchor.has(fd.parent)) {
            seenAnchor.add(fd.parent);
            anchorTypes.push(fd.parent);
        }
        if (index.objectLikeTypes.has(fd.returnType) && !seenAnchor.has(fd.returnType)) {
            seenAnchor.add(fd.returnType);
            anchorTypes.push(fd.returnType);
        }
    }
    const closureCoords = pathsToRootClosure(index, roots, rootPref, anchorTypes, cfg);
    for (const c of closureCoords) selected.add(c);

    return {
        selectedCoords: [...selected].sort(),
    };
}
