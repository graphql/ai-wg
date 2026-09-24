/**
 * seeded-typetree-v2-e4 — self-contained eval port of
 * `lib/explore/strategies/seeded-typetree-v2-e4.ts`.
 *
 * Algorithm at 30000ft (parent docstring):
 *   1) Retrieve top-K *types* relevant to the query (RRF fuse of BM25 + trigram
 *      + per-type cosine in the parent; here we approximate — see notes below).
 *   2) For each retrieved type, pick top-`fieldsPerType` fields using a per-type
 *      cos²+lex pick formula (modulated by the active hybrid mode), and (optionally)
 *      recurse one hop into object-valued children.
 *   3) Apply the hybrid mode:
 *        - off:         identical to v2-default (control).
 *        - typed-knn:   inject global cosine kNN filtered to retrieved types.
 *        - strict-knn:  inject global cosine kNN minus excluded root types.
 *        - rrf-fusion:  per-type, RRF-fuse local order with global-kNN order.
 *        - knn-rerank:  per-type top-rerankPoolSize by formula, then rerank by cosine.
 *   4) Optional legacy cosine-safety-net top-K.
 *   5) Paths-to-root closure ensures structural reachability.
 *
 * Eval-vs-parent simplifications (forced by the eval snapshot):
 *   - The parent's BM25 / trigram / type-doc indexes are not available. Type
 *     retrieval is approximated by aggregating per-field cosine sim into a per-type
 *     score (max-field + small mean-field component) and blending with a
 *     token-overlap bonus on the type name. The resulting `searchTypes` is a
 *     coarse but workable substitute.
 *   - The per-field lex bonus is computed from token-overlap + 3-gram overlap on
 *     the field name only (no description text, no real BM25/trigram index).
 *   - Eval snapshot has no `members` / `synonymyEdges` / per-type embeddings
 *     table — none of these are referenced.
 *   - `bestPath` reporting (parent's `selectedPaths`) is dropped — eval contract
 *     returns only `selectedCoords`.
 *   - `trace` events are dropped — eval contract has no trace channel.
 *
 * Self-contained: imports only from ../../core/types.ts.
 */

import type { FieldDef, SchemaSnapshot, StrategyInput, StrategyResult } from '../../core/types.ts';

// ─── Config ───────────────────────────────────────────────────────────────

type HybridMode = 'off' | 'typed-knn' | 'strict-knn' | 'rrf-fusion' | 'knn-rerank';
type ScoreMode = 'add' | 'cos-gated';

interface HybridCfg {
    mode: HybridMode;
    knnTopK: number;
    rrfK: number;
    rerankPoolSize: number;
    excludeRootTypes: string[];
}

interface PathsToRootCfg {
    mode: 'on' | 'off';
    maxPathsPerType: number;
    maxDepth: number;
    includeMutationPaths: boolean;
    expandConnectionWrappers: boolean;
}

interface Cfg {
    nodeBudget: number;
    typesTopK: number;
    fieldsPerType: number;
    childrenPerPickedField: number;
    maxPathHops: number;
    cosWeight: number;
    lexWeight: number;
    scoreMode: ScoreMode;
    minTypeScore: number;
    cosineSafetyTopK: number;
    hybrid: HybridCfg;
    pathsToRoot: PathsToRootCfg;
}

function num(c: Record<string, unknown>, k: string, d: number): number {
    const v = c[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : d;
}
function int(c: Record<string, unknown>, k: string, d: number): number {
    return Math.trunc(num(c, k, d));
}
function bool(c: Record<string, unknown>, k: string, d: boolean): boolean {
    const v = c[k];
    return typeof v === 'boolean' ? v : d;
}
function str<T extends string>(
    c: Record<string, unknown>,
    k: string,
    allowed: ReadonlyArray<T>,
    d: T,
): T {
    const v = c[k];
    return typeof v === 'string' && (allowed as ReadonlyArray<string>).includes(v) ? (v as T) : d;
}
function strArr(c: Record<string, unknown>, k: string, d: string[]): string[] {
    const v = c[k];
    if (!Array.isArray(v)) return d;
    return v.filter((x): x is string => typeof x === 'string');
}

function readCfg(raw: Record<string, unknown>): Cfg {
    const hy = (raw['hybrid'] as Record<string, unknown> | undefined) ?? {};
    const ptr = (raw['pathsToRoot'] as Record<string, unknown> | undefined) ?? {};
    return {
        nodeBudget: int(raw, 'nodeBudget', 60),
        typesTopK: int(raw, 'typesTopK', 15),
        fieldsPerType: int(raw, 'fieldsPerType', 12),
        childrenPerPickedField: int(raw, 'childrenPerPickedField', 4),
        maxPathHops: int(raw, 'maxPathHops', 6),
        cosWeight: num(raw, 'cosWeight', 1.0),
        lexWeight: num(raw, 'lexWeight', 5.0),
        scoreMode: str(raw, 'scoreMode', ['add', 'cos-gated'] as const, 'add'),
        minTypeScore: num(raw, 'minTypeScore', 0),
        cosineSafetyTopK: int(raw, 'cosineSafetyTopK', 0),
        hybrid: {
            mode: str(
                hy,
                'mode',
                ['off', 'typed-knn', 'strict-knn', 'rrf-fusion', 'knn-rerank'] as const,
                'off',
            ),
            knnTopK: int(hy, 'knnTopK', 30),
            rrfK: int(hy, 'rrfK', 60),
            rerankPoolSize: int(hy, 'rerankPoolSize', 25),
            excludeRootTypes: strArr(hy, 'excludeRootTypes', ['Mutation', 'Subscription']),
        },
        pathsToRoot: {
            mode: str(ptr, 'mode', ['on', 'off'] as const, 'on'),
            maxPathsPerType: int(ptr, 'maxPathsPerType', 5),
            maxDepth: int(ptr, 'maxDepth', 6),
            includeMutationPaths: bool(ptr, 'includeMutationPaths', false),
            expandConnectionWrappers: bool(ptr, 'expandConnectionWrappers', true),
        },
    };
}

// ─── Tokenization helpers ─────────────────────────────────────────────────

function tokenize(s: string): string[] {
    return s
        .toLowerCase()
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_.\-]+/g, ' ')
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1);
}

function trigrams(text: string): Set<string> {
    const out = new Set<string>();
    if (text.length < 3) return out;
    for (let i = 0; i <= text.length - 3; i++) out.add(text.slice(i, i + 3));
    return out;
}

// ─── Approximate per-field lex bonus (BM25/trigram surrogate) ─────────────

interface LexRanks {
    bm25Rank: Map<string, number>;
    triRank: Map<string, number>;
}

function buildLexRanks(fields: ReadonlyArray<FieldDef>, queryText: string, topK = 200): LexRanks {
    const bm25Rank = new Map<string, number>();
    const triRank = new Map<string, number>();
    const qTokens = new Set(tokenize(queryText));
    if (qTokens.size === 0) return { bm25Rank, triRank };
    const qTris = new Set<string>();
    for (const t of qTokens) {
        if (t.length < 3) continue;
        for (let i = 0; i <= t.length - 3; i++) qTris.add(t.slice(i, i + 3));
    }

    interface Scored {
        coord: string;
        tok: number;
        tri: number;
    }
    const scored: Scored[] = [];
    for (const f of fields) {
        const fieldToks = tokenize(f.field);
        let tok = 0;
        for (const t of fieldToks) if (qTokens.has(t)) tok++;
        const fieldText = fieldToks.join('');
        let tri = 0;
        if (fieldText.length >= 3 && qTris.size > 0) {
            for (let i = 0; i <= fieldText.length - 3; i++) {
                if (qTris.has(fieldText.slice(i, i + 3))) tri++;
            }
        }
        if (tok > 0 || tri > 0) scored.push({ coord: f.coord, tok, tri });
    }

    const byTok = scored
        .filter((s) => s.tok > 0)
        .sort((a, b) => b.tok - a.tok || a.coord.localeCompare(b.coord));
    byTok.forEach((s, i) => {
        if (i < topK) bm25Rank.set(s.coord, i + 1);
    });
    const byTri = scored
        .filter((s) => s.tri > 0)
        .sort((a, b) => b.tri - a.tri || a.coord.localeCompare(b.coord));
    byTri.forEach((s, i) => {
        if (i < topK) triRank.set(s.coord, i + 1);
    });
    return { bm25Rank, triRank };
}

function lexBonusFor(coord: string, ranks: LexRanks): number {
    const br = ranks.bm25Rank.get(coord);
    const tr = ranks.triRank.get(coord);
    const fromBm25 = br != null ? 1 / Math.log2(2 + br) : 0;
    const fromTri = tr != null ? 1 / Math.log2(2 + tr) : 0;
    return Math.max(fromBm25, fromTri);
}

// ─── Derived snapshot helpers ─────────────────────────────────────────────

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
    /** Type → array of its field coords (kept in fields array order). */
    fieldsByType: ReadonlyMap<string, ReadonlyArray<string>>;
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
    const fieldsByType = new Map<string, string[]>();
    for (const [t, arr] of snap.fieldsByType) {
        fanOut.set(t, arr.length);
        fieldsByType.set(
            t,
            arr.map((f) => f.coord),
        );
    }
    const objectLikeTypes = new Set<string>(snap.fieldsByType.keys());
    const reverseAdj = new Map<string, Array<{ fieldCoord: string; parentType: string }>>();
    for (const e of edges.values()) {
        const arr = reverseAdj.get(e.returnType) ?? [];
        arr.push({ fieldCoord: e.coord, parentType: e.parent });
        reverseAdj.set(e.returnType, arr);
    }
    return { edges, fanOut, rootTypes: snap.rootTypes, objectLikeTypes, reverseAdj, fieldsByType };
}

// ─── Paths-to-root closure (ported inline from lib/explore/paths-to-root.ts) ─

const WRAPPER_SUFFIXES = ['Connection', 'Edge'] as const;

function pathsToRoot(
    d: DerivedSnap,
    rootPref: ReadonlyArray<string>,
    targetType: string,
    opts: { maxPaths: number; maxDepth: number; includeMutationPaths: boolean },
): string[][] {
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
        const i = rootPref.indexOf(root);
        return i === -1 ? rootPref.length : i;
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
    rootPref: ReadonlyArray<string>,
    targets: ReadonlyArray<string>,
    cfg: PathsToRootCfg,
): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    const expanded = cfg.expandConnectionWrappers ? expandWithWrappers(d, targets) : [...targets];
    for (const t of expanded) {
        const paths = pathsToRoot(d, rootPref, t, {
            maxPaths: cfg.maxPathsPerType,
            maxDepth: cfg.maxDepth,
            includeMutationPaths: cfg.includeMutationPaths,
        });
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

// ─── Approximate per-type retrieval (parent: BM25 + trigram + cosine RRF) ──
//
// The eval snapshot has neither the per-type BM25/trigram index nor the
// `type_embeddings` table. We synthesise a per-type score from:
//   - per-type cosine: max + mean-of-top3 of the type's field cosines
//   - per-type lex:    token overlap + trigram overlap on the type name
// We then RRF-fuse the two channels (k=60, like the parent) for ranking.
// `searchTypes(...)` returns the top-K types with a normalised RRF score in
// [0, ~0.033], matching the magnitude (and minTypeScore=0 default-safe range)
// of the parent.

interface TypeHit {
    type: string;
    score: number;
}

function searchTypesApprox(
    d: DerivedSnap,
    snap: SchemaSnapshot,
    queryText: string,
    queryEmbedding: Float32Array,
    topK: number,
): TypeHit[] {
    const cosByCoord = snap.cosineToQuery(queryEmbedding);
    const mutOrSub = new Set<string>(['Mutation', 'Subscription']);

    interface Bucket {
        type: string;
        cosScore: number;
        lexScore: number;
    }
    const buckets: Bucket[] = [];

    const qTokens = new Set(tokenize(queryText));
    const qTris = new Set<string>();
    for (const t of qTokens) {
        if (t.length < 3) continue;
        for (let i = 0; i <= t.length - 3; i++) qTris.add(t.slice(i, i + 3));
    }

    for (const [type, fieldCoords] of d.fieldsByType) {
        // Skip Mutation/Subscription/Connection/Edge to match parent's
        // typeMembers filter in getTypeIndex (Query stays in).
        if (mutOrSub.has(type)) continue;
        if (type.endsWith('Connection') || type.endsWith('Edge')) continue;
        if (fieldCoords.length === 0) continue;

        // Cosine channel: max field cosine + (mean of top-3) / 2 — a coarse
        // surrogate for the parent's per-type embedding cosine.
        const sims: number[] = [];
        for (const c of fieldCoords) {
            const s = cosByCoord.get(c);
            if (s != null) sims.push(s);
        }
        if (sims.length === 0) continue;
        sims.sort((a, b) => b - a);
        const top3 = sims.slice(0, 3);
        const top3Mean = top3.reduce((a, b) => a + b, 0) / top3.length;
        const cosScore = sims[0]! + 0.5 * top3Mean;

        // Lex channel: type-name token overlap + trigram overlap. Also include
        // a small contribution from how many of the type's field names overlap
        // the query (cheap stand-in for the parent's field-doc bag-of-words).
        const typeToks = tokenize(type);
        let tokHits = 0;
        for (const t of typeToks) if (qTokens.has(t)) tokHits++;
        const typeText = typeToks.join('');
        const typeTris = trigrams(typeText);
        let triHits = 0;
        for (const t of typeTris) if (qTris.has(t)) triHits++;
        let fieldNameHits = 0;
        for (const c of fieldCoords) {
            const fname = c.slice(c.indexOf('.') + 1);
            for (const t of tokenize(fname))
                if (qTokens.has(t)) {
                    fieldNameHits++;
                    break;
                }
        }
        const lexScore = 2 * tokHits + 0.25 * triHits + 0.5 * fieldNameHits;

        buckets.push({ type, cosScore, lexScore });
    }

    // RRF-fuse the two channels (k=60).
    const RRF_K = 60;
    const cosRanked = [...buckets].sort((a, b) => b.cosScore - a.cosScore).map((b) => b.type);
    const lexRanked = [...buckets]
        .filter((b) => b.lexScore > 0)
        .sort((a, b) => b.lexScore - a.lexScore)
        .map((b) => b.type);
    const rrf = new Map<string, number>();
    cosRanked.forEach((t, i) => rrf.set(t, (rrf.get(t) ?? 0) + 1 / (RRF_K + i + 1)));
    lexRanked.forEach((t, i) => rrf.set(t, (rrf.get(t) ?? 0) + 1 / (RRF_K + i + 1)));

    return [...rrf.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, topK)
        .map(([type, score]) => ({ type, score }));
}

// ─── Strategy entry ───────────────────────────────────────────────────────

export function run(input: StrategyInput): StrategyResult {
    const cfg = readCfg(input.config);
    const snap = input.snapshot;
    const d = deriveSnap(snap);
    const qText = input.query.query;
    const qEmb = input.query.embedding;

    const rootPref: string[] = ['Query', 'Subscription', 'Mutation'].filter((r) =>
        d.rootTypes.has(r),
    );
    const cosByCoord = snap.cosineToQuery(qEmb);
    const getCos = (c: string): number => cosByCoord.get(c) ?? 0;

    // ── Per-field lex bonus (BM25/trigram surrogate) ─────────────────────
    const lexRanks = buildLexRanks(snap.fields, qText, 200);
    const lexBonus = (coord: string): number => lexBonusFor(coord, lexRanks);

    function fieldScore(coord: string): number {
        const cos = getCos(coord);
        const lex = lexBonus(coord);
        if (cfg.scoreMode === 'cos-gated') {
            return cos * (cfg.cosWeight * cos + cfg.lexWeight * lex);
        }
        return cfg.cosWeight * cos * cos + cfg.lexWeight * lex;
    }

    // ── Step 1: type retrieval (approximated) ────────────────────────────
    const typeHits = searchTypesApprox(d, snap, qText, qEmb, cfg.typesTopK).filter(
        (h) => h.score >= cfg.minTypeScore,
    );
    const retrievedTypeSet = new Set<string>(typeHits.map((h) => h.type));
    const excludedRootSet = new Set<string>(cfg.hybrid.excludeRootTypes);

    // ── Optional global kNN pool (shared by hybrid modes that need it) ───
    const globalKnnByCoord = new Map<string, { rank: number; cosineSim: number }>();
    const hybridNeedsKnn =
        cfg.hybrid.mode === 'typed-knn' ||
        cfg.hybrid.mode === 'strict-knn' ||
        cfg.hybrid.mode === 'rrf-fusion';
    if (hybridNeedsKnn && cfg.hybrid.knnTopK > 0) {
        const all = [...cosByCoord.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, cfg.hybrid.knnTopK);
        all.forEach(([coord, sim], i) => {
            globalKnnByCoord.set(coord, { rank: i + 1, cosineSim: sim });
        });
    }

    // ── Step 2+3: per-type field selection ───────────────────────────────
    const selectedCoords = new Set<string>();

    function pickFieldsForType(typeFields: ReadonlyArray<string>, fp: number): string[] {
        if (cfg.hybrid.mode === 'rrf-fusion' && globalKnnByCoord.size > 0) {
            // Local rank by formula.
            const localOrder = typeFields
                .map((f) => ({ coord: f, score: fieldScore(f) }))
                .sort((a, b) => b.score - a.score)
                .map((s, i) => ({ coord: s.coord, rank: i + 1 }));
            const localRankByCoord = new Map(localOrder.map((s) => [s.coord, s.rank]));

            // Per-type-filtered global kNN rank (re-rank within this type).
            const typeFieldSet = new Set(typeFields);
            const globalForType = [...globalKnnByCoord.entries()]
                .filter(([coord]) => typeFieldSet.has(coord))
                .sort((a, b) => a[1].rank - b[1].rank)
                .map(([coord], i) => ({ coord, rank: i + 1 }));
            const globalRankByCoord = new Map(globalForType.map((s) => [s.coord, s.rank]));

            const fused = typeFields.map((coord) => {
                const lr = localRankByCoord.get(coord) ?? localOrder.length + 1;
                const gr = globalRankByCoord.get(coord);
                let rrf = 1 / (cfg.hybrid.rrfK + lr);
                if (gr != null) rrf += 1 / (cfg.hybrid.rrfK + gr);
                return { coord, rrf };
            });
            fused.sort((a, b) => b.rrf - a.rrf);
            return fused.slice(0, fp).map((s) => s.coord);
        }

        if (cfg.hybrid.mode === 'knn-rerank') {
            const scored = typeFields.map((f) => ({ coord: f, score: fieldScore(f) }));
            scored.sort((a, b) => b.score - a.score);
            const pool = scored.slice(0, cfg.hybrid.rerankPoolSize).map((s) => s.coord);
            pool.sort((a, b) => getCos(b) - getCos(a));
            return pool.slice(0, fp);
        }

        // Default: cos²+lex pick order.
        const scored = typeFields.map((f) => ({ coord: f, score: fieldScore(f) }));
        scored.sort((a, b) => b.score - a.score);
        return scored.slice(0, fp).map((s) => s.coord);
    }

    let nodesUsed = 0;
    for (const hit of typeHits) {
        if (nodesUsed >= cfg.nodeBudget) break;
        const typeFields = d.fieldsByType.get(hit.type) ?? [];
        if (typeFields.length === 0) continue;

        const pickedFields = pickFieldsForType(typeFields, cfg.fieldsPerType);

        // Recurse one level for object-valued picked fields.
        const recurseChildren: string[] = [];
        if (cfg.childrenPerPickedField > 0) {
            for (const f of pickedFields) {
                const edge = d.edges.get(f);
                if (!edge) continue;
                const returnType = edge.returnType;
                if (d.fanOut.get(returnType) === undefined) continue;
                const childFields = d.fieldsByType.get(returnType) ?? [];
                if (childFields.length === 0) continue;
                const childPicks = pickFieldsForType(childFields, cfg.childrenPerPickedField);
                for (const c of childPicks) recurseChildren.push(c);
            }
        }

        const additions = new Set<string>([...pickedFields, ...recurseChildren]);
        const newCount = [...additions].filter((c) => !selectedCoords.has(c)).length;
        for (const c of additions) selectedCoords.add(c);
        nodesUsed += newCount;
    }

    // ── Hybrid additions ─────────────────────────────────────────────────
    if (cfg.hybrid.mode === 'typed-knn' && globalKnnByCoord.size > 0) {
        for (const [coord] of globalKnnByCoord) {
            const edge = d.edges.get(coord);
            if (!edge) continue;
            if (!retrievedTypeSet.has(edge.parent)) continue;
            selectedCoords.add(coord);
        }
    } else if (cfg.hybrid.mode === 'strict-knn' && globalKnnByCoord.size > 0) {
        for (const [coord] of globalKnnByCoord) {
            const edge = d.edges.get(coord);
            if (!edge) continue;
            if (excludedRootSet.has(edge.parent)) continue;
            selectedCoords.add(coord);
        }
    }

    // ── Legacy cosine safety net (unchanged from v2) ─────────────────────
    if (cfg.cosineSafetyTopK > 0) {
        const hits = [...cosByCoord.entries()]
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, cfg.cosineSafetyTopK);
        for (const [coord] of hits) selectedCoords.add(coord);
    }

    // ── Paths-to-root closure ────────────────────────────────────────────
    if (cfg.pathsToRoot.mode === 'on') {
        const anchorTypes = new Set<string>();
        for (const c of selectedCoords) {
            const edge = d.edges.get(c);
            if (!edge) continue;
            anchorTypes.add(edge.parent);
            anchorTypes.add(edge.returnType);
        }
        const closure = pathsToRootClosure(d, rootPref, [...anchorTypes], cfg.pathsToRoot);
        for (const c of closure) selectedCoords.add(c);
    }

    return { selectedCoords: [...selectedCoords].sort() };
}
