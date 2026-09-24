/**
 * seeded-lex — self-contained eval port of `lib/explore/strategies/seeded-lex.ts`.
 *
 * Algorithm (preserved from parent):
 *   1. Seed pool = global cosine top-K ∪ lexical channels (trigram + BM25) fused
 *      via RRF, with lex picks pinned to a linear-ramp distance so they compete
 *      in the priority queue with cosine seeds.
 *   2. Best-first expansion of the queue. For each popped leaf, accept it then
 *      enqueue its top-N children, scored via:
 *        effSim   = shape(cosSim) + alpha * lexBonus(coord)
 *        priority = (effSim * decay^depth) / (1 + fanOut(returnType))^alpha
 *      The scoreShape can be linear / cos-sq / cos-cube-exp-rank / sigmoid-cos /
 *      tight-rank — directly ported from the parent.
 *   3. Stop on nodeBudget, ratioCutoff, or coverageEpsilon marginal-gain (only
 *      when ratio is also near-cutoff).
 *   4. Paths-to-root closure on the parent + return types of every selected
 *      field. The eval runner does NOT close, so the strategy must.
 *
 * Eval-vs-parent simplifications (the parent's snapshot has more than the eval's):
 *   • No QueryVariantInput — the parent's "scoring refs" array collapses to a
 *     single ref = the raw query embedding. No per-variant pinned distances,
 *     no per-variant kNN, no per-variant coverage.
 *   • No SynonymyEdges — the parent's HippoRAG seed-time and expansion-time
 *     synonymy bridges are dropped. The `synonymy` config block is accepted but
 *     ignored. (The eval snapshot exposes no precomputed synonymy.)
 *   • No `keywords:*` direct-match force-include — the eval has no variants.
 *   • BM25 + trigram are approximated from field-name token overlap and 3-gram
 *     overlap on the joined field-name tokens (same as per-type-variant's
 *     buildLexBonus). The eval snapshot exposes neither description text nor a
 *     precomputed BM25/trigram index; using field-name signal preserves the
 *     bonus SHAPE (1/log2(2+rank)) the parent's scoreChild reads.
 *   • Parent uses snap.edges, snap.fanOut, snap.knnByCoordinate,
 *     snap.cosineForCoordinates, snap.members, snap.rootFields. All derived
 *     locally from snapshot.fields / fieldsByType / cosineToQuery / fieldByCoord.
 *   • Paths-to-root closure logic is ported inline (no import from
 *     paths-to-root.ts). Root-type preference is Query > Subscription > Mutation,
 *     filtered to the snapshot's actual rootTypes.
 *
 * Self-contained: imports only from ../../core/types.ts.
 */

import type { FieldDef, SchemaSnapshot, StrategyInput, StrategyResult } from '../../core/types.ts';

// ─── Config ───────────────────────────────────────────────────────────────

type ScoreShape =
    | 'linear'
    | 'exp-rank'
    | 'cos-sq'
    | 'cos-cube-exp-rank'
    | 'sigmoid-cos'
    | 'tight-rank';

interface ChannelCfg {
    enabled: boolean;
    weight: number;
    topK: number;
}

interface FusionCfg {
    mode: 'rrf' | 'weighted-rank-sum';
    rrfK: number;
    topN: number;
}

interface ChannelsCfg {
    cosine: ChannelCfg;
    trigram: ChannelCfg;
    bm25: ChannelCfg;
    fusion: FusionCfg;
}

interface LexExpandCfg {
    alpha: number;
    topKForBonus: number;
    scoreShape: ScoreShape;
}

interface PathsToRootCfg {
    mode: 'on' | 'off';
    maxPathsPerType: number;
    maxDepth: number;
    includeMutationPaths: boolean;
    expandConnectionWrappers: boolean;
}

interface Cfg {
    seedTopK: number;
    nodeBudget: number;
    hopBudget: number;
    ratioCutoff: number;
    decay: number;
    fanoutAlpha: number;
    maxChildrenPerExpansion: number;
    coverageEpsilon: number;
    lexExpand: LexExpandCfg;
    channels: ChannelsCfg;
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

function readChannelCfg(raw: Record<string, unknown> | undefined, d: ChannelCfg): ChannelCfg {
    if (!raw) return d;
    return {
        enabled: bool(raw, 'enabled', d.enabled),
        weight: num(raw, 'weight', d.weight),
        topK: int(raw, 'topK', d.topK),
    };
}

function readCfg(raw: Record<string, unknown>): Cfg {
    const c = raw;
    const lex = (c['lexExpand'] as Record<string, unknown> | undefined) ?? {};
    const ch = (c['channels'] as Record<string, unknown> | undefined) ?? {};
    const fu = (ch['fusion'] as Record<string, unknown> | undefined) ?? {};
    const ptr = (c['pathsToRoot'] as Record<string, unknown> | undefined) ?? {};
    return {
        seedTopK: int(c, 'seedTopK', 10),
        nodeBudget: int(c, 'nodeBudget', 25),
        hopBudget: int(c, 'hopBudget', 5),
        ratioCutoff: num(c, 'ratioCutoff', 0.25),
        decay: num(c, 'decay', 0.85),
        fanoutAlpha: num(c, 'fanoutAlpha', 0.3),
        maxChildrenPerExpansion: int(c, 'maxChildrenPerExpansion', 8),
        coverageEpsilon: num(c, 'coverageEpsilon', 0.03),
        lexExpand: {
            alpha: num(lex, 'alpha', 5.0),
            topKForBonus: int(lex, 'topKForBonus', 100),
            scoreShape: str(
                lex,
                'scoreShape',
                [
                    'linear',
                    'exp-rank',
                    'cos-sq',
                    'cos-cube-exp-rank',
                    'sigmoid-cos',
                    'tight-rank',
                ] as const,
                'cos-sq',
            ),
        },
        channels: {
            cosine: readChannelCfg(ch['cosine'] as Record<string, unknown> | undefined, {
                enabled: true,
                weight: 1.0,
                topK: 20,
            }),
            trigram: readChannelCfg(ch['trigram'] as Record<string, unknown> | undefined, {
                enabled: true,
                weight: 1.0,
                topK: 20,
            }),
            bm25: readChannelCfg(ch['bm25'] as Record<string, unknown> | undefined, {
                enabled: true,
                weight: 1.0,
                topK: 20,
            }),
            fusion: {
                mode: str(fu, 'mode', ['rrf', 'weighted-rank-sum'] as const, 'rrf'),
                rrfK: int(fu, 'rrfK', 60),
                topN: int(fu, 'topN', 30),
            },
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

// ─── Lexical signal (approximate BM25 + trigram on field names) ───────────

function tokenize(s: string): string[] {
    return s
        .toLowerCase()
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_.\-]+/g, ' ')
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1);
}

interface LexRanks {
    bm25Rank: Map<string, number>;
    triRank: Map<string, number>;
}

function buildLexRanks(
    fields: ReadonlyArray<FieldDef>,
    queryText: string,
    topKForBonus: number,
): LexRanks {
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
        tokenOverlap: number;
        triOverlap: number;
    }
    const scored: Scored[] = [];
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

    const byTok = scored
        .filter((s) => s.tokenOverlap > 0)
        .sort((a, b) => b.tokenOverlap - a.tokenOverlap || a.coord.localeCompare(b.coord));
    byTok.forEach((s, i) => {
        if (i < topKForBonus) bm25Rank.set(s.coord, i + 1);
    });
    const byTri = scored
        .filter((s) => s.triOverlap > 0)
        .sort((a, b) => b.triOverlap - a.triOverlap || a.coord.localeCompare(b.coord));
    byTri.forEach((s, i) => {
        if (i < topKForBonus) triRank.set(s.coord, i + 1);
    });
    return { bm25Rank, triRank };
}

function lexBonusFor(coord: string, ranks: LexRanks, shape: ScoreShape): number {
    const br = ranks.bm25Rank.get(coord);
    const tr = ranks.triRank.get(coord);
    function decayOf(rank: number | undefined): number {
        if (rank == null) return 0;
        if (shape === 'exp-rank' || shape === 'cos-cube-exp-rank') {
            return Math.exp(-rank / 10);
        }
        if (shape === 'tight-rank') {
            return rank <= 10 ? 1 / Math.log2(2 + rank) : 0;
        }
        return 1 / Math.log2(2 + rank);
    }
    return Math.max(decayOf(br), decayOf(tr));
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
    childrenByParent: ReadonlyMap<string, ReadonlyArray<EdgeInfo>>;
    fanOut: ReadonlyMap<string, number>;
    rootTypes: ReadonlySet<string>;
    objectLikeTypes: ReadonlySet<string>;
    reverseAdj: ReadonlyMap<string, ReadonlyArray<{ fieldCoord: string; parentType: string }>>;
    rootFields: ReadonlySet<string>;
}

function deriveSnap(snap: SchemaSnapshot): DerivedSnap {
    const edges = new Map<string, EdgeInfo>();
    const childrenByParent = new Map<string, EdgeInfo[]>();
    for (const f of snap.fields) {
        const e: EdgeInfo = {
            coord: f.coord,
            parent: f.parent,
            field: f.field,
            returnType: f.returnType,
        };
        edges.set(f.coord, e);
        const arr = childrenByParent.get(f.parent) ?? [];
        arr.push(e);
        childrenByParent.set(f.parent, arr);
    }
    const fanOut = new Map<string, number>();
    for (const [p, arr] of snap.fieldsByType) fanOut.set(p, arr.length);
    const objectLikeTypes = new Set<string>(snap.fieldsByType.keys());
    const reverseAdj = new Map<string, Array<{ fieldCoord: string; parentType: string }>>();
    for (const e of edges.values()) {
        const arr = reverseAdj.get(e.returnType) ?? [];
        arr.push({ fieldCoord: e.coord, parentType: e.parent });
        reverseAdj.set(e.returnType, arr);
    }
    const rootFields = new Set<string>();
    for (const rt of snap.rootTypes) {
        const fs = snap.fieldsByType.get(rt);
        if (!fs) continue;
        for (const f of fs) rootFields.add(f.coord);
    }
    return {
        edges,
        childrenByParent,
        fanOut,
        rootTypes: snap.rootTypes,
        objectLikeTypes,
        reverseAdj,
        rootFields,
    };
}

// ─── Paths-to-root closure (ported inline) ────────────────────────────────

const WRAPPER_SUFFIXES = ['Connection', 'Edge'] as const;

function unwrapConnection(typeName: string): string | null {
    if (typeName.endsWith('Connection')) return typeName.slice(0, -10);
    if (typeName.endsWith('Edge')) return typeName.slice(0, -4);
    return null;
}

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

// ─── Priority queue (insertion-sorted, mirrors parent) ────────────────────

interface QueueItem {
    coords: string[];
    score: number;
    depth: number;
}

function pushSorted(queue: QueueItem[], item: QueueItem): void {
    let i = 0;
    while (i < queue.length && queue[i]!.score >= item.score) i++;
    queue.splice(i, 0, item);
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

    // Cosine map.
    const cosByCoord = snap.cosineToQuery(qEmb);
    const simFor = (coord: string): number => cosByCoord.get(coord) ?? 0;

    // ── Lexical ranks for child scoring ───────────────────────────────────
    const lexRanks = buildLexRanks(snap.fields, qText, cfg.lexExpand.topKForBonus);
    const lexBonus = (coord: string): number =>
        lexBonusFor(coord, lexRanks, cfg.lexExpand.scoreShape);

    // ── Seed pool: cosine top-K seeded by every root field ────────────────
    // Parent uses snap.rootFields directly as the always-included floor; we
    // match that.
    const seedSet = new Set<string>(d.rootFields);
    const pinnedDist = new Map<string, number>(); // pinned 1-sim for lex picks

    // Cosine seeds: top-K by sim.
    {
        const ranked: Array<{ coord: string; sim: number }> = [];
        for (const [coord, sim] of cosByCoord) ranked.push({ coord, sim });
        ranked.sort((a, b) => {
            if (b.sim !== a.sim) return b.sim - a.sim;
            return a.coord.localeCompare(b.coord);
        });
        const k = Math.max(1, cfg.seedTopK);
        for (let i = 0; i < Math.min(k, ranked.length); i++) {
            seedSet.add(ranked[i]!.coord);
        }
    }

    // ── Lexical channel seed injection (RRF/weighted-rank-sum) ────────────
    // Eval has no real BM25/trigram index — we synthesize rankings from the
    // tokenized field-name signal computed for the bonus. This preserves the
    // shape of the parent's channel fusion without replicating its corpus.
    {
        const channels = cfg.channels;
        if (channels.trigram.enabled || channels.bm25.enabled) {
            const rankings: Array<{ name: string; weight: number; ranking: string[] }> = [];

            if (channels.trigram.enabled && channels.trigram.topK > 0) {
                // Order trigram-ranked coords by rank ascending, cap at topK.
                const triList = [...lexRanks.triRank.entries()]
                    .sort((a, b) => a[1] - b[1])
                    .slice(0, channels.trigram.topK)
                    .map(([c]) => c);
                rankings.push({
                    name: 'trigram',
                    weight: channels.trigram.weight,
                    ranking: triList,
                });
            }
            if (channels.bm25.enabled && channels.bm25.topK > 0) {
                const bmList = [...lexRanks.bm25Rank.entries()]
                    .sort((a, b) => a[1] - b[1])
                    .slice(0, channels.bm25.topK)
                    .map(([c]) => c);
                rankings.push({ name: 'bm25', weight: channels.bm25.weight, ranking: bmList });
            }

            if (rankings.length > 0) {
                const fused = new Map<string, number>();
                for (const r of rankings) {
                    r.ranking.forEach((coord, idx) => {
                        const rank = idx + 1;
                        let inc: number;
                        if (channels.fusion.mode === 'rrf') {
                            inc = r.weight * (1 / (channels.fusion.rrfK + rank));
                        } else {
                            const denom = Math.max(r.ranking.length, 1);
                            inc = r.weight * ((denom - rank + 1) / denom);
                        }
                        fused.set(coord, (fused.get(coord) ?? 0) + inc);
                    });
                }
                const picks = [...fused.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, channels.fusion.topN);
                picks.forEach(([coord], i) => {
                    if (!d.edges.has(coord)) return;
                    seedSet.add(coord);
                    // Pin a linear-ramp distance so the lex pick competes with
                    // mid-tier cosine seeds. Sim ≈ 1 - pickedDist.
                    const pickedDist = 0.25 + 0.3 * (i / Math.max(1, picks.length - 1));
                    const existingDist = pinnedDist.get(coord);
                    const cosDist = 1 - simFor(coord);
                    const bestExisting =
                        existingDist != null ? Math.min(existingDist, cosDist) : cosDist;
                    if (pickedDist < bestExisting) pinnedDist.set(coord, pickedDist);
                });
            }
        }
    }

    // Effective max-sim for a coord (max of cosine sim and pinned sim).
    function maxSimFor(coord: string): number {
        const cosSim = simFor(coord);
        const pinned = pinnedDist.get(coord);
        if (pinned == null) return cosSim;
        return Math.max(cosSim, 1 - pinned);
    }

    function scoreSeed(coord: string, depth: number): number {
        const sim = maxSimFor(coord);
        return sim * Math.pow(0.95, depth);
    }

    function scoreChild(coord: string, depth: number, fanOutOfParent: number): number {
        const cosSim = maxSimFor(coord);
        let cosTerm: number;
        switch (cfg.lexExpand.scoreShape) {
            case 'cos-sq':
                cosTerm = cosSim * cosSim;
                break;
            case 'cos-cube-exp-rank':
                cosTerm = cosSim * cosSim * cosSim;
                break;
            case 'sigmoid-cos':
                cosTerm = 1 / (1 + Math.exp(-8 * (cosSim - 0.5)));
                break;
            default:
                cosTerm = cosSim;
        }
        const effSim = cosTerm + cfg.lexExpand.alpha * lexBonus(coord);
        const decayed = Math.pow(cfg.decay, depth);
        const divisor = Math.pow(1 + fanOutOfParent, cfg.fanoutAlpha);
        return (effSim * decayed) / divisor;
    }

    // ── Anchor each seed to a single-segment path (shortest path to a root) ─
    // Parent uses ctx.pathsToMember to anchor a seed to its shortest root path.
    // We approximate with the inline BFS over reverseAdj (same routine used by
    // the final closure). For each seed, take the first path; depth = len - 1.
    const anchorPathCache = new Map<string, string[] | null>();
    function anchorPathFor(coord: string): string[] | null {
        const cached = anchorPathCache.get(coord);
        if (cached !== undefined) return cached;
        const edge = d.edges.get(coord);
        if (!edge) {
            anchorPathCache.set(coord, null);
            return null;
        }
        if (d.rootTypes.has(edge.parent)) {
            const path = [coord];
            anchorPathCache.set(coord, path);
            return path;
        }
        // BFS backward from coord's parent type, collecting the FIRST root-anchored
        // path. We then append the seed's own coord to that path.
        interface Frontier {
            type: string;
            pathReverse: string[];
            visitedCoords: Set<string>;
        }
        const queue: Frontier[] = [
            { type: edge.parent, pathReverse: [], visitedCoords: new Set([coord]) },
        ];
        let found: string[] | null = null;
        const MAX_DEPTH = 8;
        while (queue.length > 0 && !found) {
            const cur = queue.shift()!;
            if (cur.pathReverse.length >= MAX_DEPTH) continue;
            const incoming = d.reverseAdj.get(cur.type);
            if (!incoming) continue;
            for (const e of incoming) {
                if (cur.visitedCoords.has(e.fieldCoord)) continue;
                const nextVisited = new Set(cur.visitedCoords);
                nextVisited.add(e.fieldCoord);
                const nextPath = [...cur.pathReverse, e.fieldCoord];
                if (d.rootTypes.has(e.parentType)) {
                    found = [...nextPath].reverse();
                    break;
                }
                queue.push({
                    type: e.parentType,
                    pathReverse: nextPath,
                    visitedCoords: nextVisited,
                });
            }
        }
        const result = found ? [...found, coord] : null;
        anchorPathCache.set(coord, result);
        return result;
    }

    // ── Queue seeding ────────────────────────────────────────────────────
    const queue: QueueItem[] = [];
    for (const c of seedSet) {
        const path = anchorPathFor(c);
        if (!path || path.length === 0) continue;
        const depth = path.length - 1;
        const score = scoreSeed(c, depth);
        pushSorted(queue, { coords: path, score, depth });
    }

    // Coverage tracking: parent uses one slot per ref; we have one ref.
    let coverage = 0;
    function updateCoverage(coord: string): number {
        const sim = maxSimFor(coord);
        if (sim > coverage) {
            const delta = sim - coverage;
            coverage = sim;
            return delta;
        }
        return 0;
    }

    // ── Best-first expansion ─────────────────────────────────────────────
    const selectedCoords = new Set<string>();
    const visitedLeaves = new Set<string>();
    let bestScoreSeen = queue.length > 0 ? queue[0]!.score : Number.NEGATIVE_INFINITY;
    let acceptedCount = 0;

    while (queue.length > 0) {
        const item = queue.shift()!;
        const leaf = item.coords[item.coords.length - 1]!;

        if (acceptedCount >= cfg.nodeBudget) break;
        if (bestScoreSeen > 0 && item.score < cfg.ratioCutoff * bestScoreSeen) break;

        if (visitedLeaves.has(leaf)) continue;
        visitedLeaves.add(leaf);

        // Accept.
        for (const c of item.coords) selectedCoords.add(c);
        acceptedCount++;
        bestScoreSeen = Math.max(bestScoreSeen, item.score);

        const marginal = updateCoverage(leaf);
        if (acceptedCount >= 3 && cfg.coverageEpsilon > 0 && marginal < cfg.coverageEpsilon) {
            if (bestScoreSeen > 0 && item.score < (cfg.ratioCutoff + 0.05) * bestScoreSeen) {
                break;
            }
        }

        // Expand.
        const edge = d.edges.get(leaf);
        if (!edge) continue;
        const returnType = edge.returnType;
        const childFanout = d.fanOut.get(returnType) ?? 0;

        if (item.depth + 1 > cfg.hopBudget) continue;

        const children = d.childrenByParent.get(returnType);
        if (!children || children.length === 0) continue;

        const filtered: EdgeInfo[] = [];
        for (const ch of children) {
            if (item.coords.includes(ch.coord)) continue;
            filtered.push(ch);
        }
        if (filtered.length === 0) continue;

        const childDepth = item.depth + 1;
        const scored = filtered
            .map((ch) => ({
                coord: ch.coord,
                score: scoreChild(ch.coord, childDepth, childFanout),
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, cfg.maxChildrenPerExpansion);

        for (const { coord, score } of scored) {
            pushSorted(queue, { coords: [...item.coords, coord], score, depth: childDepth });
        }
    }

    // ── Paths-to-root closure ────────────────────────────────────────────
    if (cfg.pathsToRoot.mode === 'on') {
        const anchorTypes = new Set<string>();
        for (const c of selectedCoords) {
            const e = d.edges.get(c);
            if (!e) continue;
            anchorTypes.add(e.parent);
            if (d.objectLikeTypes.has(e.returnType)) anchorTypes.add(e.returnType);
            // Unwrap helps cover the Connection→T edge.
            const u = unwrapConnection(e.returnType);
            if (u && d.objectLikeTypes.has(u)) anchorTypes.add(u);
        }
        const closure = pathsToRootClosure(d, rootPref, [...anchorTypes], cfg.pathsToRoot);
        for (const c of closure) selectedCoords.add(c);
    }

    return { selectedCoords: [...selectedCoords].sort() };
}
