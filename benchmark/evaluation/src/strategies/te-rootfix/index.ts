/**
 * te-rootfix — fork of ptv-lex-weighted with two structural recall fixes.
 *
 * The entire ptv-lex-weighted pipeline (cosine type retrieval → kneedle cut →
 * per-anchor variant build via pool-expand with parentCos blend → cos-weighted-
 * topk variant scoring → relevance-gated merge → paths-to-root closure) is
 * reproduced below UNCHANGED. Two complementary mechanisms are added AFTER the
 * normal selection produces the coord set, to recover the #1 structural failure
 * mode ("root entry-points never emitted"):
 *
 *   (1) ROOT-COLLECTION ENTRY EMISSION. The BFS pathsToRoot finds a singular
 *       path (e.g. `QueryRoot.order(id): Order`) and stops before the COLLECTION
 *       endpoint (`QueryRoot.orders: OrderConnection`). It also never terminates
 *       at `QueryRoot` for shopify, because the snapshot's `rootTypes` only
 *       contains literally-named `Query`/`Mutation`/`Subscription` types and the
 *       shopify query root is named `QueryRoot`. To fix this we identify the
 *       real query-root type(s) (rootTypes minus Mutation/Subscription, plus any
 *       `Query`/`QueryRoot` type present in the schema), precompute each root
 *       field's bounded "return-type family" (its returnType, plus — if that is
 *       a `*Connection`/`*Edge` — the node type reached via nodes/edges→node),
 *       and emit every root field whose family intersects the SELECTED types.
 *
 *   (2) CONNECTION TRAVERSAL GUARANTEE. For every SELECTED `*Connection`/`*Edge`
 *       type, emit its `nodes`/`edges` fields (and `edges`→`node`). Cheap (those
 *       types are already in the slice) — fixes the `*Connection.nodes` budget-cut
 *       class.
 *
 * Self-contained: imports only type(s) from '../../core/types.ts'.
 */

import type { FieldDef, SchemaSnapshot, StrategyInput, StrategyResult } from '../../core/types.ts';

// ─── Config typing ────────────────────────────────────────────────────────

interface PathsToRootCfg {
    mode: 'on' | 'off';
    maxPathsPerType: number;
    maxDepth: number;
    includeMutationPaths: boolean;
    expandConnectionWrappers: boolean;
}

interface Cfg {
    typesTopK: number;
    perVariantBudget: number;
    efficiencyThreshold: number;
    maxExpandedTypes: number;
    cosWeight: number;
    lexWeight: number;
    parentCosBlend: number;
    unwrapConnections: boolean;
    minTypeScore: number;
    variantTopK: number;
    relevanceFloor: number;
    mergeMaxVariants: number;
    typeHitsCutoff: 'none' | 'kneedle';
    kneedleSensitivity: number;
    poolEntryTypeCosFloor: number;
    pathsToRoot: PathsToRootCfg;
    // ── root-entry emission knobs (new) ──
    rootEntryEmit: boolean;
    rootFamilyDepth: number;
    connectionTraversalEmit: boolean;
}

function readCfg(raw: Record<string, unknown>): Cfg {
    const c = raw ?? {};
    const num = (k: string, d: number): number => {
        const v = c[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : d;
    };
    const int = (k: string, d: number): number => Math.trunc(num(k, d));
    const bool = (k: string, d: boolean): boolean => {
        const v = c[k];
        return typeof v === 'boolean' ? v : d;
    };
    const str = <T extends string>(k: string, allowed: ReadonlyArray<T>, d: T): T => {
        const v = c[k];
        return typeof v === 'string' && (allowed as ReadonlyArray<string>).includes(v)
            ? (v as T)
            : d;
    };
    const ptr = c['pathsToRoot'] as Record<string, unknown> | undefined;
    const ptrCfg: PathsToRootCfg = {
        mode: ptr && ptr['mode'] === 'off' ? 'off' : 'on',
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
        typesTopK: int('typesTopK', 15),
        perVariantBudget: int('perVariantBudget', 800),
        efficiencyThreshold: num('efficiencyThreshold', 0.04),
        maxExpandedTypes: int('maxExpandedTypes', 40),
        cosWeight: num('cosWeight', 4.0),
        lexWeight: num('lexWeight', 1.5),
        parentCosBlend: num('parentCosBlend', 0.3),
        unwrapConnections: bool('unwrapConnections', true),
        minTypeScore: num('minTypeScore', 0),
        variantTopK: int('variantTopK', 20),
        relevanceFloor: num('relevanceFloor', 0.75),
        mergeMaxVariants: int('mergeMaxVariants', 10),
        typeHitsCutoff: str('typeHitsCutoff', ['none', 'kneedle'] as const, 'kneedle'),
        kneedleSensitivity: num('kneedleSensitivity', 0.05),
        poolEntryTypeCosFloor: num('poolEntryTypeCosFloor', 0.25),
        pathsToRoot: ptrCfg,
        rootEntryEmit: bool('rootEntryEmit', true),
        rootFamilyDepth: int('rootFamilyDepth', 1),
        connectionTraversalEmit: bool('connectionTraversalEmit', true),
    };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const WRAPPER_SUFFIXES = ['Connection', 'Edge'] as const;

function unwrapConnection(typeName: string): string | null {
    if (typeName.endsWith('Connection')) return typeName.slice(0, -10);
    if (typeName.endsWith('Edge')) return typeName.slice(0, -4);
    return null;
}

function isConnectionLike(typeName: string): boolean {
    return typeName.endsWith('Connection') || typeName.endsWith('Edge');
}

/** Tokenize an arbitrary string into normalized word tokens for lex matching. */
function tokenize(s: string): string[] {
    return (
        s
            .toLowerCase()
            // split camelCase / snake_case / kebab-case / dot
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/[_.\-]+/g, ' ')
            .split(/[^a-z0-9]+/)
            .filter((t) => t.length > 1)
    );
}

/**
 * Compute a lex-bonus per coord from the query text. Approximates the parent's
 * BM25 + trigram RRF lex bonus using only field-name signal.
 */
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

/**
 * Kneedle-style elbow detection on a monotonically decreasing series.
 * Returns the cut-off index k so that indices [0, k) are admitted; n when
 * no significant knee exists.
 */
function findKneeIndex(scores: number[], sensitivity: number): number {
    const n = scores.length;
    if (n < 3) return n;
    const maxS = scores[0]!;
    const minS = scores[n - 1]!;
    const range = maxS - minS;
    if (range <= 0) return n;
    let bestKnee = -1;
    let bestExcess = 0;
    for (let i = 1; i < n - 1; i++) {
        const x = i / (n - 1);
        const y = (scores[i]! - minS) / range;
        const excess = y - (1 - x);
        if (excess > bestExcess) {
            bestExcess = excess;
            bestKnee = i;
        }
    }
    if (bestKnee < 0 || bestExcess < sensitivity) return n;
    return bestKnee + 1;
}

// ─── Snapshot adaptors ────────────────────────────────────────────────────

interface EdgeInfo {
    coord: string;
    parent: string;
    field: string;
    returnType: string;
}

interface DerivedSnap {
    edges: ReadonlyMap<string, EdgeInfo>;
    fanOut: ReadonlyMap<string, number>;
    rootTypes: ReadonlySet<string>;
    objectLikeTypes: ReadonlySet<string>;
    reverseAdj: ReadonlyMap<string, ReadonlyArray<{ fieldCoord: string; parentType: string }>>;
}

function deriveSnap(snap: SchemaSnapshot): DerivedSnap {
    const edges = new Map<string, EdgeInfo>();
    for (const f of snap.fields) {
        edges.set(f.coord, {
            coord: f.coord,
            parent: f.parent,
            field: f.field,
            returnType: f.returnType,
        });
    }
    const fanOut = new Map<string, number>();
    for (const [parent, arr] of snap.fieldsByType) fanOut.set(parent, arr.length);
    const objectLikeTypes = new Set<string>(snap.fieldsByType.keys());
    const reverseAdj = new Map<string, Array<{ fieldCoord: string; parentType: string }>>();
    for (const e of edges.values()) {
        const arr = reverseAdj.get(e.returnType) ?? [];
        arr.push({ fieldCoord: e.coord, parentType: e.parent });
        reverseAdj.set(e.returnType, arr);
    }
    return { edges, fanOut, rootTypes: snap.rootTypes, objectLikeTypes, reverseAdj };
}

/**
 * Identify the QUERY-root type(s) for root-entry emission. The snapshot's
 * `rootTypes` is built from literal type names {Query, Mutation, Subscription},
 * so for shopify (query root named `QueryRoot`) it contains only `Mutation`.
 * Query-root = rootTypes minus Mutation/Subscription, plus any `Query`/`QueryRoot`
 * type actually present in the schema.
 */
function queryRootTypes(snap: SchemaSnapshot): Set<string> {
    const out = new Set<string>();
    for (const t of snap.rootTypes) {
        if (t === 'Mutation' || t === 'Subscription') continue;
        out.add(t);
    }
    for (const candidate of ['Query', 'QueryRoot']) {
        if (snap.fieldsByType.has(candidate)) out.add(candidate);
    }
    return out;
}

// ─── Connection node-type resolution (robust, field-driven) ───────────────

/**
 * For a `*Connection`/`*Edge` type, return its node type by following the
 * actual `nodes`/`edges`→`node` fields (not by string-unwrapping the name, so
 * non-standard wrappers still resolve). Returns null if not a connection-like
 * type or no node field exists.
 */
function connectionNodeType(snap: SchemaSnapshot, typeName: string): string | null {
    const fields = snap.fieldsByType.get(typeName);
    if (!fields) return null;
    // *Edge: node field directly.
    const nodeField = fields.find((f) => f.field === 'node');
    if (nodeField) return nodeField.returnType;
    // *Connection: nodes (→ node type) or edges (→ *Edge → node type).
    const nodesField = fields.find((f) => f.field === 'nodes');
    if (nodesField) return nodesField.returnType;
    const edgesField = fields.find((f) => f.field === 'edges');
    if (edgesField) {
        const edgeFields = snap.fieldsByType.get(edgesField.returnType);
        const innerNode = edgeFields?.find((f) => f.field === 'node');
        if (innerNode) return innerNode.returnType;
        return edgesField.returnType;
    }
    return null;
}

// ─── Paths-to-root closure (ported, simplified) ───────────────────────────

interface PathsToRootOpts {
    maxPaths: number;
    maxDepth: number;
    includeMutationPaths: boolean;
    expandConnectionWrappers: boolean;
}

function pathsToRoot(d: DerivedSnap, targetType: string, opts: PathsToRootOpts): string[][] {
    if (d.rootTypes.has(targetType)) return [[]];

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
    const collectCap = opts.maxPaths * 4;
    const queue: Frontier[] = [{ type: targetType, pathReverse: [], visitedCoords: new Set() }];

    while (queue.length > 0 && found.length < collectCap) {
        const cur = queue.shift()!;
        if (cur.pathReverse.length >= opts.maxDepth) continue;
        const incoming = d.reverseAdj.get(cur.type);
        if (!incoming) continue;
        for (const edge of incoming) {
            if (cur.visitedCoords.has(edge.fieldCoord)) continue;
            const nextVisited = new Set(cur.visitedCoords);
            nextVisited.add(edge.fieldCoord);
            const nextPath = [...cur.pathReverse, edge.fieldCoord];
            if (d.rootTypes.has(edge.parentType)) {
                found.push({ path: [...nextPath].reverse(), rootType: edge.parentType });
                if (found.length >= collectCap) break;
            } else {
                queue.push({
                    type: edge.parentType,
                    pathReverse: nextPath,
                    visitedCoords: nextVisited,
                });
            }
        }
    }

    const pool = opts.includeMutationPaths ? found : found.filter((f) => f.rootType !== 'Mutation');

    const prefIdx = (root: string): number => {
        if (root === 'Query') return 0;
        if (root === 'Subscription') return 1;
        if (root === 'Mutation') return 2;
        return 3;
    };
    pool.sort((a, b) => {
        const pa = prefIdx(a.rootType);
        const pb = prefIdx(b.rootType);
        if (pa !== pb) return pa - pb;
        if (a.path.length !== b.path.length) return a.path.length - b.path.length;
        return a.path.join('|').localeCompare(b.path.join('|'));
    });

    return pool.slice(0, opts.maxPaths).map((f) => f.path);
}

function expandWithWrappers(d: DerivedSnap, targets: ReadonlyArray<string>): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const t of targets) {
        if (!seen.has(t)) {
            seen.add(t);
            out.push(t);
        }
        for (const suffix of WRAPPER_SUFFIXES) {
            const wrapped = `${t}${suffix}`;
            if (d.objectLikeTypes.has(wrapped) && !seen.has(wrapped)) {
                seen.add(wrapped);
                out.push(wrapped);
            }
        }
    }
    return out;
}

function pathsToRootClosure(
    d: DerivedSnap,
    targets: ReadonlyArray<string>,
    opts: PathsToRootOpts,
): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const expanded = opts.expandConnectionWrappers ? expandWithWrappers(d, targets) : [...targets];
    for (const t of expanded) {
        const paths = pathsToRoot(d, t, opts);
        for (const p of paths) {
            for (const c of p) {
                if (seen.has(c)) continue;
                seen.add(c);
                out.push(c);
            }
        }
    }
    return out;
}

// ─── Variant build ────────────────────────────────────────────────────────

interface VariantResult {
    anchor: string;
    coords: Set<string>;
    numPicked: number;
    effCosSqList: number[];
}

// ─── Strategy entry point ─────────────────────────────────────────────────

export function run(input: StrategyInput): StrategyResult {
    const cfg = readCfg(input.config);
    const snap = input.snapshot;
    const d = deriveSnap(snap);
    const qText = input.query.query;
    const qEmb = input.query.embedding;

    const cosByCoord = snap.cosineToQuery(qEmb);

    // typeCos(T) = max over T's fields of cosToQuery(field). Cached.
    const typeCosCache = new Map<string, number>();
    function typeCos(typeName: string): number {
        const cached = typeCosCache.get(typeName);
        if (cached != null) return cached;
        const fields = snap.fieldsByType.get(typeName);
        let mx = 0;
        if (fields) {
            for (const f of fields) {
                const c = cosByCoord.get(f.coord) ?? 0;
                if (c > mx) mx = c;
            }
        }
        typeCosCache.set(typeName, mx);
        return mx;
    }

    const lexBonus = buildLexBonus(snap.fields, qText);

    // Step 1: type retrieval (cosine-only).
    const allTypes: Array<{ type: string; score: number }> = [];
    for (const t of snap.fieldsByType.keys()) {
        if (snap.rootTypes.has(t)) continue;
        const sc = typeCos(t);
        if (sc < cfg.minTypeScore) continue;
        allTypes.push({ type: t, score: sc });
    }
    allTypes.sort((a, b) => b.score - a.score);
    const rawTypeHits = allTypes.slice(0, cfg.typesTopK);

    // Step 1b: adaptive Kneedle cutoff on the typeCos curve.
    let typeHits = rawTypeHits;
    if (cfg.typeHitsCutoff === 'kneedle' && rawTypeHits.length >= 3) {
        const kneeIdx = findKneeIndex(
            rawTypeHits.map((h) => h.score),
            cfg.kneedleSensitivity,
        );
        if (kneeIdx < rawTypeHits.length) typeHits = rawTypeHits.slice(0, kneeIdx);
    }

    if (typeHits.length === 0) {
        return { selectedCoords: [] };
    }

    // ── Build one variant per anchor type ─────────────────────────────────
    const variants: VariantResult[] = [];
    for (const hit of typeHits) {
        const v = buildVariant(hit);
        if (v.coords.size > 0) variants.push(v);
    }
    if (variants.length === 0) return { selectedCoords: [] };

    // ── Variant scoring: cos-weighted-topk only ───────────────────────────
    function variantScore(v: VariantResult): number {
        if (v.numPicked === 0) return 0;
        const k = Math.min(cfg.variantTopK, v.effCosSqList.length);
        if (k === 0) return 0;
        const sorted = [...v.effCosSqList].sort((a, b) => b - a);
        let topSum = 0;
        for (let i = 0; i < k; i++) topSum += sorted[i]!;
        return typeCos(v.anchor) * topSum;
    }

    variants.sort((a, b) => variantScore(b) - variantScore(a));
    const winner = variants[0]!;

    // ── Merge: relevance-gated ────────────────────────────────────────────
    const finalCoords = new Set<string>(winner.coords);
    let mergedCount = 1;
    const winnerTypeCos = typeCos(winner.anchor);
    const cosFloor = cfg.relevanceFloor * winnerTypeCos;
    for (let i = 1; i < variants.length; i++) {
        if (mergedCount >= cfg.mergeMaxVariants) break;
        const v = variants[i]!;
        const vTypeCos = typeCos(v.anchor);
        if (vTypeCos < cosFloor) continue;
        for (const c of v.coords) finalCoords.add(c);
        mergedCount++;
    }

    // ── Final paths-to-root closure ───────────────────────────────────────
    if (cfg.pathsToRoot.mode === 'on') {
        const anchorTypes = new Set<string>();
        for (const c of finalCoords) {
            const e = d.edges.get(c);
            if (e) {
                anchorTypes.add(e.parent);
                anchorTypes.add(e.returnType);
            }
        }
        const closure = pathsToRootClosure(d, [...anchorTypes], {
            maxPaths: cfg.pathsToRoot.maxPathsPerType,
            maxDepth: cfg.pathsToRoot.maxDepth,
            includeMutationPaths: cfg.pathsToRoot.includeMutationPaths,
            expandConnectionWrappers: cfg.pathsToRoot.expandConnectionWrappers,
        });
        for (const c of closure) finalCoords.add(c);
    }

    // ── (2) CONNECTION TRAVERSAL GUARANTEE ────────────────────────────────
    // For every selected *Connection/*Edge type, emit nodes/edges (+ edges→node).
    if (cfg.connectionTraversalEmit) {
        emitConnectionTraversal(snap, d, finalCoords);
    }

    // ── (1) ROOT-COLLECTION ENTRY EMISSION ────────────────────────────────
    // Emit every query-root field whose bounded return-type family intersects
    // the SELECTED types (parents AND return types of selected coords).
    if (cfg.rootEntryEmit) {
        emitRootEntries(snap, d, finalCoords, cfg.rootFamilyDepth);
        // The newly-emitted root collection fields may themselves return
        // *Connection types — guarantee their nodes/edges descent too.
        if (cfg.connectionTraversalEmit) {
            emitConnectionTraversal(snap, d, finalCoords);
        }
    }

    const out = [...finalCoords].sort();
    return { selectedCoords: out };

    // -------------------------------------------------------------------
    // Per-variant local pipeline: pool-expand only, parentCos blend only.
    // -------------------------------------------------------------------
    function buildVariant(hit: { type: string; score: number }): VariantResult {
        const coords = new Set<string>();
        const includedTypeNames = new Set<string>();
        let numPicked = 0;
        const effCosSqList: number[] = [];

        function markTypeIncluded(typeName: string): void {
            includedTypeNames.add(typeName);
            if (cfg.unwrapConnections) {
                const u = unwrapConnection(typeName);
                if (u) includedTypeNames.add(u);
            }
        }

        function fieldCost(coord: string): number {
            const edge = d.edges.get(coord);
            if (!edge) return 1;
            if (edge.returnType === 'Mutation' || edge.returnType === 'Subscription') return 999;
            if (includedTypeNames.has(edge.returnType)) return 1;
            if (cfg.unwrapConnections) {
                const u = unwrapConnection(edge.returnType);
                if (u && includedTypeNames.has(u)) return 2;
            }
            const isObjectLike = d.objectLikeTypes.has(edge.returnType);
            if (!isObjectLike) return 1;
            if (cfg.unwrapConnections && unwrapConnection(edge.returnType)) return 10;
            return 8;
        }

        // parentCosMode = 'blend' only.
        function effCosOf(coord: string): number {
            const cos = cosByCoord.get(coord) ?? 0;
            const edge = d.edges.get(coord);
            if (!edge) return cos;
            const parent = typeCos(edge.parent);
            return cfg.parentCosBlend * parent + (1 - cfg.parentCosBlend) * cos;
        }

        function fieldScore(coord: string): number {
            const effCos = effCosOf(coord);
            return cfg.cosWeight * effCos * effCos + cfg.lexWeight * lexBonus(coord);
        }

        markTypeIncluded(hit.type);

        const anchorFields = (snap.fieldsByType.get(hit.type) ?? []).map((f) => f.coord);
        if (anchorFields.length === 0) {
            return { anchor: hit.type, coords, numPicked, effCosSqList };
        }

        let used = 0;

        // pool-expand only.
        interface PoolCandidate {
            coord: string;
            score: number;
            sourceType: string;
            hop: number;
        }
        const expandedTypes = new Set<string>([hit.type]);
        const inPool = new Set<string>();
        const pool: PoolCandidate[] = [];

        const addFieldsForType = (typeName: string, hop: number): void => {
            if (expandedTypes.has(typeName)) return;
            if (expandedTypes.size >= cfg.maxExpandedTypes) return;
            // poolEntryTypeCosFloor gate (the distinguishing knob of this preset).
            if (cfg.poolEntryTypeCosFloor > 0 && hop > 0) {
                if (typeCos(typeName) < cfg.poolEntryTypeCosFloor) return;
            }
            expandedTypes.add(typeName);
            const fields = snap.fieldsByType.get(typeName);
            if (!fields || fields.length === 0) return;
            for (const f of fields) {
                if (inPool.has(f.coord) || coords.has(f.coord)) continue;
                inPool.add(f.coord);
                pool.push({
                    coord: f.coord,
                    score: fieldScore(f.coord),
                    sourceType: typeName,
                    hop,
                });
            }
        };

        // Seed pool with anchor fields (hop=0).
        for (const fc of anchorFields) {
            inPool.add(fc);
            pool.push({ coord: fc, score: fieldScore(fc), sourceType: hit.type, hop: 0 });
        }

        while (used < cfg.perVariantBudget && pool.length > 0) {
            let bestIdx = -1;
            let bestEff = -Infinity;
            let bestCost = 0;
            for (let i = 0; i < pool.length; i++) {
                const p = pool[i]!;
                if (coords.has(p.coord)) continue;
                const cost = fieldCost(p.coord);
                const eff = p.score / cost;
                if (eff < cfg.efficiencyThreshold) continue;
                if (used + cost > cfg.perVariantBudget) continue;
                if (eff > bestEff) {
                    bestEff = eff;
                    bestIdx = i;
                    bestCost = cost;
                }
            }
            if (bestIdx < 0) break;

            const w = pool[bestIdx]!;
            pool[bestIdx] = pool[pool.length - 1]!;
            pool.pop();
            coords.add(w.coord);
            used += bestCost;
            const e = d.edges.get(w.coord);
            if (e) {
                markTypeIncluded(e.returnType);
                // Expand THROUGH the connection wrapper: add the *Connection/*Edge
                // type's OWN fields (totalCount, pageInfo, edges, nodes, cursor,
                // custom edge fields) to the candidate pool so they are scored 1:1
                // like any field — not jumped over. The efficiency-greedy then
                // picks the relevant ones (e.g. totalCount when the query asks for
                // a count). Without this the unwrap below skips them entirely.
                if (isConnectionLike(e.returnType) && d.fanOut.get(e.returnType) !== undefined) {
                    addFieldsForType(e.returnType, w.hop + 1);
                }
                const expandInto = cfg.unwrapConnections
                    ? (unwrapConnection(e.returnType) ?? e.returnType)
                    : e.returnType;
                if (d.fanOut.get(expandInto) !== undefined) {
                    addFieldsForType(expandInto, w.hop + 1);
                }
            }
            const effCos = effCosOf(w.coord);
            effCosSqList.push(effCos * effCos);
            numPicked += 1;
        }

        // ---- Per-variant paths-to-root closure ----
        if (cfg.pathsToRoot.mode === 'on') {
            const anchorTypes = new Set<string>();
            anchorTypes.add(hit.type);
            for (const c of coords) {
                const edge = d.edges.get(c);
                if (edge) {
                    anchorTypes.add(edge.parent);
                    anchorTypes.add(edge.returnType);
                }
            }
            const closure = pathsToRootClosure(d, [...anchorTypes], {
                maxPaths: cfg.pathsToRoot.maxPathsPerType,
                maxDepth: cfg.pathsToRoot.maxDepth,
                includeMutationPaths: cfg.pathsToRoot.includeMutationPaths,
                expandConnectionWrappers: cfg.pathsToRoot.expandConnectionWrappers,
            });
            for (const c of closure) coords.add(c);
        }

        return { anchor: hit.type, coords, numPicked, effCosSqList };
    }
}

// ─── Mechanism (2): connection traversal guarantee ────────────────────────

/**
 * For every SELECTED `*Connection`/`*Edge` type present in `coords`, add its
 * `nodes`/`edges` fields (and `edges`→`node`). Mutates `coords` in place.
 */
function emitConnectionTraversal(snap: SchemaSnapshot, d: DerivedSnap, coords: Set<string>): void {
    // Collect selected connection-like types (parent of any selected coord, or
    // return type of any selected coord).
    const connTypes = new Set<string>();
    for (const c of coords) {
        const e = d.edges.get(c);
        if (!e) continue;
        if (isConnectionLike(e.parent)) connTypes.add(e.parent);
        if (isConnectionLike(e.returnType)) connTypes.add(e.returnType);
    }
    for (const t of connTypes) {
        const fields = snap.fieldsByType.get(t);
        if (!fields) continue;
        for (const f of fields) {
            if (f.field === 'nodes' || f.field === 'edges' || f.field === 'node') {
                coords.add(f.coord);
                // edges → *Edge → node
                if (f.field === 'edges') {
                    const edgeFields = snap.fieldsByType.get(f.returnType);
                    const nodeField = edgeFields?.find((ef) => ef.field === 'node');
                    if (nodeField) coords.add(nodeField.coord);
                }
            }
        }
    }
}

// ─── Mechanism (1): root-collection entry emission ────────────────────────

/**
 * Emit every query-root field whose bounded "return-type family" intersects the
 * set of SELECTED types (parents AND return types of currently selected coords).
 *
 * Family of a root field with returnType RT (bounded by `familyDepth` hops
 * through connection wrappers): {RT} plus, if RT is connection-like, the node
 * type reached via nodes/edges→node (and if THAT is connection-like, one more
 * hop when familyDepth >= 2). Kept bounded so only root fields whose node type
 * is actually among the selected types get emitted — not every root field.
 *
 * Mutates `coords` in place.
 */
function emitRootEntries(
    snap: SchemaSnapshot,
    d: DerivedSnap,
    coords: Set<string>,
    familyDepth: number,
): void {
    const roots = queryRootTypes(snap);
    if (roots.size === 0) return;

    // Selected types = parents and return types of selected coords.
    const selectedTypes = new Set<string>();
    for (const c of coords) {
        const e = d.edges.get(c);
        if (!e) continue;
        selectedTypes.add(e.parent);
        selectedTypes.add(e.returnType);
    }
    if (selectedTypes.size === 0) return;

    for (const rootType of roots) {
        const rootFields = snap.fieldsByType.get(rootType);
        if (!rootFields) continue;
        for (const rf of rootFields) {
            // Already selected — nothing to do.
            if (coords.has(rf.coord)) continue;
            // Build bounded family for this root field's return type.
            const family = rootFieldFamily(snap, rf.returnType, familyDepth);
            // Emit iff the family overlaps a selected type.
            let overlaps = false;
            for (const fam of family) {
                if (selectedTypes.has(fam)) {
                    overlaps = true;
                    break;
                }
            }
            if (overlaps) coords.add(rf.coord);
        }
    }
}

/**
 * Bounded return-type family for a root field's returnType. Unwraps connection
 * wrappers via actual nodes/edges→node fields up to `familyDepth` hops.
 */
function rootFieldFamily(
    snap: SchemaSnapshot,
    returnType: string,
    familyDepth: number,
): Set<string> {
    const fam = new Set<string>();
    let current: string | null = returnType;
    let hops = 0;
    while (current && !fam.has(current)) {
        fam.add(current);
        if (!isConnectionLike(current)) break;
        if (hops >= Math.max(1, familyDepth)) {
            // Still unwrap one node hop so the node type is in the family even
            // at depth 1 (a connection's node is the meaningful target).
            const node = connectionNodeType(snap, current);
            if (node) fam.add(node);
            break;
        }
        const node = connectionNodeType(snap, current);
        if (!node) break;
        current = node;
        hops++;
    }
    return fam;
}
