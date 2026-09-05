/**
 * budgeted-best-first — self-contained eval port of the parent strategy at
 * `lib/explore/strategies/budgeted-best-first.ts`.
 *
 * Spec: a budget-constrained best-first traversal that grows a connected
 * subgraph from a starting type (default Query). Cost varies per candidate
 * kind (scalars and known-targets cheap, fresh object types expensive). Each
 * iteration ranks the whole pool and commits up to `batchSize` candidates whose
 * `cost + costUsed <= budget` and `score >= threshold`. Slice is naturally
 * rooted because we start at Query — no closure needed by default.
 *
 * Differences from the parent (intentional approximations, eval has less info):
 *   1. Union/interface expansion is dropped. The parent uses snap.members to
 *      emit UNION_MEMBER and INTERFACE_IMPL pseudo-candidates so unions and
 *      interfaces can step from container → concrete type. The eval snapshot
 *      has no union members / interface implementors metadata, so those
 *      candidates are never created. `includeUnionsAndInterfaces` is accepted
 *      but inert. Practical impact: unions/interfaces with no fields of their
 *      own get expanded only via direct field edges that name them.
 *   2. Argument-input expansion is dropped. The parent can emit ARGUMENT_INPUT
 *      candidates so input-object types reachable through args become part of
 *      the slice. Eval snapshot has no arg metadata. Default is off in the
 *      parent too, so this only matters if a caller flips it on.
 *   3. Target-kind cost: the parent distinguishes scalar/enum/input/interface/
 *      union/object via member.kind. Eval can only tell "object-like" (has
 *      fields) from "leaf-like" (no fields). We map: object-like → COST.OBJECT,
 *      leaf-like → COST.SCALAR. The INTERFACE/UNION cost branch is unreachable
 *      and the ENUM/INPUT_OBJECT branches collapse into SCALAR. For most
 *      schemas the cost ordering is preserved (objects expensive, leaves cheap).
 *   4. Lex bonus is approximate: BM25 / trigram are replaced by token + 3-gram
 *      overlap on coord field names. Matches the per-type-variant port.
 *
 * Self-contained: imports only from ../../core/types.ts.
 */

import type { FieldDef, SchemaSnapshot, StrategyInput, StrategyResult } from '../../core/types.ts';

// ─── Cost model (mirrors the parent's COST constants) ─────────────────────

const COST = {
    KNOWN_TARGET: 1,
    SCALAR: 1,
    ENUM: 2,
    INPUT_OBJECT: 5,
    INTERFACE: 6,
    UNION: 6,
    UNION_MEMBER: 6,
    INTERFACE_IMPL: 6,
    OBJECT: 8,
} as const;

// ─── Config ───────────────────────────────────────────────────────────────

interface PathsToRootCfg {
    mode: 'on' | 'off';
    maxPathsPerType: number;
    maxDepth: number;
    includeMutationPaths: boolean;
    expandConnectionWrappers: boolean;
}

interface Cfg {
    startType: string;
    budget: number;
    threshold: number;
    batchSize: number;
    cosWeight: number;
    lexWeight: number;
    structuralScore: number;
    includeArguments: boolean; // inert (eval has no arg metadata)
    includeUnionsAndInterfaces: boolean; // inert (eval has no union/iface metadata)
    pathsToRoot: PathsToRootCfg;
}

function readCfg(raw: Record<string, unknown>): Cfg {
    const num = (k: string, d: number): number => {
        const v = raw[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : d;
    };
    const int = (k: string, d: number): number => Math.trunc(num(k, d));
    const bool = (k: string, d: boolean): boolean => {
        const v = raw[k];
        return typeof v === 'boolean' ? v : d;
    };
    const str = (k: string, d: string): string => {
        const v = raw[k];
        return typeof v === 'string' && v.length > 0 ? v : d;
    };
    const ptr = raw['pathsToRoot'] as Record<string, unknown> | undefined;
    const ptrCfg: PathsToRootCfg = {
        mode: ptr && ptr['mode'] === 'on' ? 'on' : 'off',
        maxPathsPerType:
            typeof ptr?.['maxPathsPerType'] === 'number' ? (ptr['maxPathsPerType'] as number) : 5,
        maxDepth: typeof ptr?.['maxDepth'] === 'number' ? (ptr['maxDepth'] as number) : 6,
        includeMutationPaths:
            typeof ptr?.['includeMutationPaths'] === 'boolean'
                ? (ptr['includeMutationPaths'] as boolean)
                : false,
        expandConnectionWrappers:
            typeof ptr?.['expandConnectionWrappers'] === 'boolean'
                ? (ptr['expandConnectionWrappers'] as boolean)
                : true,
    };
    return {
        startType: str('startType', 'Query'),
        budget: int('budget', 300),
        threshold: num('threshold', 0.01),
        batchSize: int('batchSize', 16),
        cosWeight: num('cosWeight', 1.0),
        lexWeight: num('lexWeight', 5.0),
        structuralScore: num('structuralScore', 0.05),
        includeArguments: bool('includeArguments', false),
        includeUnionsAndInterfaces: bool('includeUnionsAndInterfaces', true),
        pathsToRoot: ptrCfg,
    };
}

// ─── Lex bonus (token + trigram overlap on field names) ───────────────────

function tokenize(s: string): string[] {
    return s
        .toLowerCase()
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_.\-]+/g, ' ')
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1);
}

function buildLexBonus(
    fields: ReadonlyArray<FieldDef>,
    queryText: string,
): (coord: string) => number {
    const qTokens = new Set(tokenize(queryText));
    if (qTokens.size === 0) return () => 0;

    const qTris = new Set<string>();
    for (const t of qTokens) {
        if (t.length < 3) continue;
        for (let i = 0; i <= t.length - 3; i++) qTris.add(t.slice(i, i + 3));
    }

    interface ScoredCoord {
        coord: string;
        tokenOverlap: number;
        triOverlap: number;
    }
    const scored: ScoredCoord[] = [];
    for (const f of fields) {
        const fieldToks = tokenize(f.field);
        let tokenOverlap = 0;
        for (const t of fieldToks) if (qTokens.has(t)) tokenOverlap++;
        const fieldText = fieldToks.join('');
        let triOverlap = 0;
        if (fieldText.length >= 3 && qTris.size > 0) {
            for (let i = 0; i <= fieldText.length - 3; i++) {
                if (qTris.has(fieldText.slice(i, i + 3))) triOverlap++;
            }
        }
        if (tokenOverlap > 0 || triOverlap > 0) {
            scored.push({ coord: f.coord, tokenOverlap, triOverlap });
        }
    }

    const bmRank = new Map<string, number>();
    const triRank = new Map<string, number>();
    const byTok = scored
        .filter((s) => s.tokenOverlap > 0)
        .sort((a, b) => b.tokenOverlap - a.tokenOverlap || a.coord.localeCompare(b.coord));
    byTok.forEach((s, i) => {
        if (i < 200) bmRank.set(s.coord, i + 1);
    });
    const byTri = scored
        .filter((s) => s.triOverlap > 0)
        .sort((a, b) => b.triOverlap - a.triOverlap || a.coord.localeCompare(b.coord));
    byTri.forEach((s, i) => {
        if (i < 200) triRank.set(s.coord, i + 1);
    });

    return (coord: string): number => {
        const br = bmRank.get(coord);
        const tr = triRank.get(coord);
        const fromBm = br != null ? 1 / Math.log2(2 + br) : 0;
        const fromTri = tr != null ? 1 / Math.log2(2 + tr) : 0;
        return Math.max(fromBm, fromTri);
    };
}

// ─── Reverse adjacency for paths-to-root closure ─────────────────────────

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
    const objectLikeTypes = new Set<string>();
    for (const f of snap.fields) {
        objectLikeTypes.add(f.parent);
        const arr = reverseAdj.get(f.returnType) ?? [];
        arr.push({ fieldCoord: f.coord, parentType: f.parent });
        reverseAdj.set(f.returnType, arr);
    }
    return { reverseAdj, objectLikeTypes };
}

const WRAPPER_SUFFIXES: ReadonlyArray<string> = ['Connection', 'Edge'];

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
        pathReverse: string[];
        visitedCoords: Set<string>;
    }
    interface Found {
        path: string[];
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

function pathsToRootClosure(
    index: ReverseIndex,
    roots: ReadonlySet<string>,
    rootPref: ReadonlyArray<string>,
    anchorTypes: ReadonlyArray<string>,
    cfg: PathsToRootCfg,
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

// ─── Strategy entry point ─────────────────────────────────────────────────

type CandidateKind = 'FIELD';

interface Candidate {
    sourceName: string;
    edgeLabel: string; // unique label per source (here: field name)
    targetName: string;
    /** true when target type has fields in the snapshot (object-like). */
    targetIsObjectLike: boolean;
    kind: CandidateKind;
    fieldCoord: string;
}

export function run(input: StrategyInput): StrategyResult {
    const cfg = readCfg(input.config);
    const snap = input.snapshot;

    // Object-like = has fields. Anything else is treated as a scalar leaf.
    const objectLikeTypes = new Set<string>(snap.fieldsByType.keys());

    // Mutation/Subscription root names — used to make their target types sky-cost.
    // Mirrors the parent's "if c.targetName === 'Mutation' || 'Subscription'" guard.
    // We can't read these from the snapshot literally; use the convention names.
    const MUTATION_LIKE = new Set<string>(['Mutation', 'Subscription']);

    // Cosine cache: parent uses lazy batched fetch. Eval already has a full map
    // in one call; just compute once.
    const cosineByCoord = snap.cosineToQuery(input.query.embedding);

    const lexBonus = buildLexBonus(snap.fields, input.query.query);

    // ===== Core state =====
    const includedTypes = new Set<string>();
    const includedFields = new Map<string, Set<string>>();
    const pool = new Map<string, Candidate>(); // key = `${source}|${edgeLabel}`
    let costUsed = 0;

    const poolKey = (sourceName: string, edgeLabel: string): string => `${sourceName}|${edgeLabel}`;

    function addCandidate(c: Candidate): void {
        const key = poolKey(c.sourceName, c.edgeLabel);
        if (!pool.has(key)) pool.set(key, c);
    }

    function seedPool(typeName: string): void {
        const fields = snap.fieldsByType.get(typeName);
        if (!fields) return; // not object-like — no fields to seed
        for (const f of fields) {
            const targetIsObjectLike = objectLikeTypes.has(f.returnType);
            addCandidate({
                sourceName: typeName,
                edgeLabel: f.field,
                targetName: f.returnType,
                targetIsObjectLike,
                kind: 'FIELD',
                fieldCoord: f.coord,
            });
        }
        // NOTE: union/interface and argument-input pseudo-candidates are
        // intentionally not emitted — see header comment for rationale.
    }

    function cost(c: Candidate): number {
        // Mutation/Subscription targets get sky-high cost so they're never affordable.
        if (MUTATION_LIKE.has(c.targetName)) return cfg.budget + 1;
        if (includedTypes.has(c.targetName)) return COST.KNOWN_TARGET;
        return c.targetIsObjectLike ? COST.OBJECT : COST.SCALAR;
    }

    function score(c: Candidate): number {
        // Eval port only has FIELD candidates; the structural and arg branches
        // from the parent are unreachable here.
        const cos = cosineByCoord.get(c.fieldCoord) ?? 0;
        const lex = lexBonus(c.fieldCoord);
        return cfg.cosWeight * cos * cos + cfg.lexWeight * lex;
    }

    function topK(k: number): Array<{ c: Candidate; s: number }> {
        const scored = [...pool.values()].map((c) => ({ c, s: score(c) }));
        scored.sort((a, b) => b.s - a.s);
        return scored.slice(0, k);
    }

    // ===== Initialize =====
    // Parent throws when startType is missing or isn't object/interface/union.
    // Eval can only verify it's an object-like type (has fields).
    if (!objectLikeTypes.has(cfg.startType)) {
        // No fields at all — return empty selection rather than throwing,
        // so a misconfigured eval row doesn't crash the whole sweep.
        return { selectedCoords: [] };
    }
    includedTypes.add(cfg.startType);
    includedFields.set(cfg.startType, new Set());
    seedPool(cfg.startType);

    // ===== Main loop =====
    while (pool.size > 0) {
        const batch = topK(cfg.batchSize);
        if (batch.length === 0) break;
        if (batch[0]!.s < cfg.threshold) break;

        let committed = false;
        for (const { c, s } of batch) {
            if (s < cfg.threshold) break;
            const cc = cost(c);
            if (costUsed + cc > cfg.budget) continue; // unaffordable, try next

            // Commit
            pool.delete(poolKey(c.sourceName, c.edgeLabel));
            costUsed += cc;
            committed = true;

            if (!includedFields.has(c.sourceName)) includedFields.set(c.sourceName, new Set());
            includedFields.get(c.sourceName)!.add(c.edgeLabel);

            if (!includedTypes.has(c.targetName)) {
                includedTypes.add(c.targetName);
                seedPool(c.targetName);
            }
        }

        if (!committed) break; // budget saturated; no candidate in batch fit
    }

    // ===== Build selectedCoords =====
    const selectedCoords = new Set<string>();
    for (const [typeName, fields] of includedFields) {
        for (const fname of fields) {
            selectedCoords.add(`${typeName}.${fname}`);
        }
    }

    // ===== Optional paths-to-root closure (off by default) =====
    // Slice is already Query-rooted by construction when startType === Query,
    // so closure is only useful when starting from a non-root type OR as a
    // safety net the caller opts into.
    if (cfg.pathsToRoot.mode === 'on') {
        const index = buildReverseIndex(snap);
        const roots = snap.rootTypes;
        const rootPref: string[] = ['Query', 'Subscription', 'Mutation'].filter((r) =>
            roots.has(r),
        );
        const closure = pathsToRootClosure(
            index,
            roots,
            rootPref,
            [...includedTypes],
            cfg.pathsToRoot,
        );
        for (const c of closure) selectedCoords.add(c);
    }

    return { selectedCoords: [...selectedCoords].sort() };
}
