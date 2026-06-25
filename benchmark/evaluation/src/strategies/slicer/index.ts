/**
 * slicer — schema-slicing strategy (consolidated, single-path).
 *
 * Approach: find the types that best match the query, build one budgeted greedy
 * field-expansion anchored at each, merge the relevant ones, then add the
 * structure that makes the result a usable, rooted schema:
 *   - paths-to-root            (every kept type is reachable from a root)
 *   - connection traversal     (nodes/edges/totalCount on selected connections)
 *   - root-collection entries  (Query/QueryRoot fields whose family is selected)
 *
 * One code path. Config is purely numeric tunables (cosine thresholds + budgets)
 * — no modes, no alternatives. Self-contained: imports only ../../core/types.ts.
 */
import type { FieldDef, SchemaSnapshot, StrategyInput, StrategyResult } from '../../core/types.ts';

// ─── Tunables ───────────────────────────────────────────────────────────────

interface Cfg {
    typesTopK: number; // types to retrieve before the kneedle cut
    kneedleSensitivity: number; // elbow strength needed to trim the type tail
    perVariantBudget: number; // greedy expansion budget per anchor type
    efficiencyThreshold: number; // min score/cost to admit a field
    maxExpandedTypes: number; // cap on types expanded per variant
    poolEntryTypeCosFloor: number; // don't expand into types below this typeCos
    cosWeight: number; // weight on (blended cosine)^2 in field score
    lexWeight: number; // weight on the BM25/trigram lexical bonus
    parentCosBlend: number; // how much a field inherits its parent type's cosine
    variantTopK: number; // top-K effCos^2 summed in variant scoring
    relevanceFloor: number; // merge a variant iff typeCos >= floor * winnerTypeCos
    mergeMaxVariants: number; // cap on merged variants
    rootFamilyDepth: number; // hops a root field's return-type family unwraps
    pathsMaxPerType: number; // paths-to-root breadth
    pathsMaxDepth: number; // paths-to-root depth
    coldPruneTau: number; // 0=off; drop cold object subtrees (no field ≥ τ), keeping all leaves
}

function readCfg(raw: Record<string, unknown>): Cfg {
    const c = raw ?? {};
    const n = (k: string, d: number): number => {
        const v = c[k];
        return typeof v === 'number' && Number.isFinite(v) ? v : d;
    };
    const i = (k: string, d: number): number => Math.trunc(n(k, d));
    return {
        typesTopK: i('typesTopK', 15),
        kneedleSensitivity: n('kneedleSensitivity', 0.05),
        perVariantBudget: i('perVariantBudget', 800),
        efficiencyThreshold: n('efficiencyThreshold', 0.04),
        maxExpandedTypes: i('maxExpandedTypes', 40),
        poolEntryTypeCosFloor: n('poolEntryTypeCosFloor', 0.25),
        cosWeight: n('cosWeight', 4.0),
        lexWeight: n('lexWeight', 1.5),
        parentCosBlend: n('parentCosBlend', 0.3),
        variantTopK: i('variantTopK', 20),
        relevanceFloor: n('relevanceFloor', 0.75),
        mergeMaxVariants: i('mergeMaxVariants', 10),
        rootFamilyDepth: i('rootFamilyDepth', 1),
        pathsMaxPerType: i('pathsMaxPerType', 5),
        pathsMaxDepth: i('pathsMaxDepth', 6),
        coldPruneTau: n('coldPruneTau', 0.0),
    };
}

// ─── Lexical signal: BM25-ish token overlap + character-trigram, fused by RRF ─

function tokenize(s: string): string[] {
    return s
        .toLowerCase()
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
        for (let k = 0; k <= t.length - 3; k++) qTris.add(t.slice(k, k + 3));
    }
    const scored: Array<{ coord: string; tok: number; tri: number }> = [];
    for (const f of fields) {
        const ft = tokenize(f.field);
        let tok = 0;
        for (const t of ft) if (qTokens.has(t)) tok++;
        const text = ft.join('');
        let tri = 0;
        if (text.length >= 3) {
            for (let k = 0; k <= text.length - 3; k++) if (qTris.has(text.slice(k, k + 3))) tri++;
        }
        if (tok > 0 || tri > 0) scored.push({ coord: f.coord, tok, tri });
    }
    const bmRank = new Map<string, number>();
    const triRank = new Map<string, number>();
    scored
        .filter((s) => s.tok > 0)
        .sort((a, b) => b.tok - a.tok || a.coord.localeCompare(b.coord))
        .forEach((s, k) => {
            if (k < 200) bmRank.set(s.coord, k + 1);
        });
    scored
        .filter((s) => s.tri > 0)
        .sort((a, b) => b.tri - a.tri || a.coord.localeCompare(b.coord))
        .forEach((s, k) => {
            if (k < 200) triRank.set(s.coord, k + 1);
        });
    return (coord: string): number => {
        const b = bmRank.get(coord);
        const t = triRank.get(coord);
        return Math.max(b != null ? 1 / Math.log2(2 + b) : 0, t != null ? 1 / Math.log2(2 + t) : 0);
    };
}

// ─── Kneedle: cut a descending series at its elbow (n = no significant knee) ──

function findKneeIndex(scores: number[], sensitivity: number): number {
    const n = scores.length;
    if (n < 3) return n;
    const maxS = scores[0]!,
        minS = scores[n - 1]!,
        range = maxS - minS;
    if (range <= 0) return n;
    let knee = -1,
        best = 0;
    for (let k = 1; k < n - 1; k++) {
        const excess = (scores[k]! - minS) / range - (1 - k / (n - 1));
        if (excess > best) {
            best = excess;
            knee = k;
        }
    }
    return knee < 0 || best < sensitivity ? n : knee + 1;
}

// ─── Derived view of the snapshot ────────────────────────────────────────────

interface Edge {
    coord: string;
    parent: string;
    field: string;
    returnType: string;
}
interface Derived {
    edges: ReadonlyMap<string, Edge>;
    fanOut: ReadonlyMap<string, number>;
    rootTypes: ReadonlySet<string>;
    objectLike: ReadonlySet<string>;
    reverseAdj: ReadonlyMap<string, ReadonlyArray<{ coord: string; parent: string }>>;
}

function derive(snap: SchemaSnapshot): Derived {
    const edges = new Map<string, Edge>();
    const reverseAdj = new Map<string, Array<{ coord: string; parent: string }>>();
    for (const f of snap.fields) {
        edges.set(f.coord, {
            coord: f.coord,
            parent: f.parent,
            field: f.field,
            returnType: f.returnType,
        });
        const arr = reverseAdj.get(f.returnType) ?? [];
        arr.push({ coord: f.coord, parent: f.parent });
        reverseAdj.set(f.returnType, arr);
    }
    const fanOut = new Map<string, number>();
    for (const [t, arr] of snap.fieldsByType) fanOut.set(t, arr.length);
    return {
        edges,
        fanOut,
        rootTypes: snap.rootTypes,
        objectLike: new Set(snap.fieldsByType.keys()),
        reverseAdj,
    };
}

function isConnectionLike(t: string): boolean {
    return t.endsWith('Connection') || t.endsWith('Edge');
}
function unwrapConnection(t: string): string | null {
    if (t.endsWith('Connection')) return t.slice(0, -10);
    if (t.endsWith('Edge')) return t.slice(0, -4);
    return null;
}

/** Query-side root types (the schema's real query root, never the literal 'Query'). */
function queryRootTypes(snap: SchemaSnapshot): Set<string> {
    const out = new Set<string>();
    for (const t of snap.rootTypes) if (t !== 'Mutation' && t !== 'Subscription') out.add(t);
    for (const cand of ['Query', 'QueryRoot']) if (snap.fieldsByType.has(cand)) out.add(cand);
    return out;
}

/** A connection's node type, via the real nodes/edges→node fields (not string-stripping). */
function connectionNodeType(snap: SchemaSnapshot, type: string): string | null {
    const fields = snap.fieldsByType.get(type);
    if (!fields) return null;
    const node = fields.find((f) => f.field === 'node');
    if (node) return node.returnType;
    const nodes = fields.find((f) => f.field === 'nodes');
    if (nodes) return nodes.returnType;
    const edges = fields.find((f) => f.field === 'edges');
    if (edges) {
        const inner = snap.fieldsByType.get(edges.returnType)?.find((f) => f.field === 'node');
        return inner ? inner.returnType : edges.returnType;
    }
    return null;
}

// ─── Paths-to-root closure ───────────────────────────────────────────────────

function pathsToRoot(d: Derived, target: string, maxPaths: number, maxDepth: number): string[][] {
    if (d.rootTypes.has(target)) return [[]];
    interface Frontier {
        type: string;
        path: string[];
        seen: Set<string>;
    }
    const found: Array<{ path: string[]; root: string }> = [];
    const cap = maxPaths * 4;
    const queue: Frontier[] = [{ type: target, path: [], seen: new Set() }];
    while (queue.length > 0 && found.length < cap) {
        const cur = queue.shift()!;
        if (cur.path.length >= maxDepth) continue;
        for (const inc of d.reverseAdj.get(cur.type) ?? []) {
            if (cur.seen.has(inc.coord)) continue;
            const seen = new Set(cur.seen);
            seen.add(inc.coord);
            const path = [...cur.path, inc.coord];
            if (d.rootTypes.has(inc.parent))
                found.push({ path: [...path].reverse(), root: inc.parent });
            else queue.push({ type: inc.parent, path, seen });
        }
    }
    const pref = (r: string): number => (r === 'Mutation' ? 2 : r === 'Subscription' ? 1 : 0);
    found.sort(
        (a, b) =>
            pref(a.root) - pref(b.root) ||
            a.path.length - b.path.length ||
            a.path.join('|').localeCompare(b.path.join('|')),
    );
    return found
        .filter((f) => f.root !== 'Mutation')
        .slice(0, maxPaths)
        .map((f) => f.path);
}

function pathsToRootClosure(
    d: Derived,
    targets: Iterable<string>,
    maxPaths: number,
    maxDepth: number,
): string[] {
    const out: string[] = [],
        seen = new Set<string>();
    const expanded = new Set<string>();
    for (const t of targets) {
        expanded.add(t);
        for (const suf of ['Connection', 'Edge']) {
            const w = `${t}${suf}`;
            if (d.objectLike.has(w)) expanded.add(w);
        }
    }
    for (const t of expanded) {
        for (const path of pathsToRoot(d, t, maxPaths, maxDepth)) {
            for (const c of path)
                if (!seen.has(c)) {
                    seen.add(c);
                    out.push(c);
                }
        }
    }
    return out;
}

// ─── Structural emitters ─────────────────────────────────────────────────────

/** Guarantee the payload traversal (nodes/edges→node) on every selected
 *  connection-like type, so descent into the data is never severed. Other
 *  wrapper fields (totalCount, pageInfo) are left to the normal scoring — they
 *  are reachable as candidates via expand-through, picked only when relevant. */
function emitConnectionTraversal(snap: SchemaSnapshot, d: Derived, coords: Set<string>): void {
    const conns = new Set<string>();
    for (const c of coords) {
        const e = d.edges.get(c);
        if (!e) continue;
        if (isConnectionLike(e.parent)) conns.add(e.parent);
        if (isConnectionLike(e.returnType)) conns.add(e.returnType);
    }
    for (const t of conns) {
        for (const f of snap.fieldsByType.get(t) ?? []) {
            if (f.field === 'nodes' || f.field === 'edges' || f.field === 'node') {
                coords.add(f.coord);
                if (f.field === 'edges') {
                    const inner = snap.fieldsByType
                        .get(f.returnType)
                        ?.find((g) => g.field === 'node');
                    if (inner) coords.add(inner.coord);
                }
            }
        }
    }
}

/** Bounded return-type family of a root field (unwrapping connections to the node type). */
function rootFieldFamily(snap: SchemaSnapshot, returnType: string, depth: number): Set<string> {
    const fam = new Set<string>();
    let cur: string | null = returnType,
        hops = 0;
    while (cur && !fam.has(cur)) {
        fam.add(cur);
        if (!isConnectionLike(cur)) break;
        const node = connectionNodeType(snap, cur);
        if (!node) break;
        if (hops >= Math.max(1, depth)) {
            fam.add(node);
            break;
        }
        cur = node;
        hops++;
    }
    return fam;
}

/** Emit every query-root field whose return-type family overlaps a selected type. */
function emitRootEntries(
    snap: SchemaSnapshot,
    d: Derived,
    coords: Set<string>,
    depth: number,
): void {
    const roots = queryRootTypes(snap);
    if (roots.size === 0) return;
    const selectedTypes = new Set<string>();
    for (const c of coords) {
        const e = d.edges.get(c);
        if (e) {
            selectedTypes.add(e.parent);
            selectedTypes.add(e.returnType);
        }
    }
    if (selectedTypes.size === 0) return;
    for (const root of roots) {
        for (const rf of snap.fieldsByType.get(root) ?? []) {
            if (coords.has(rf.coord)) continue;
            for (const fam of rootFieldFamily(snap, rf.returnType, depth)) {
                if (selectedTypes.has(fam)) {
                    coords.add(rf.coord);
                    break;
                }
            }
        }
    }
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export function run(input: StrategyInput): StrategyResult {
    const cfg = readCfg(input.config);
    const snap = input.snapshot;
    const d = derive(snap);
    // Max-signal slicing: a coord's cosine is the MAX over all sub-queries, so one
    // pass covers a multi-request ask and pays the shared structural insurance once.
    // (Single query ⇒ embeddings = [embedding] ⇒ identical to a plain cosine map.)
    const embs = input.query.embeddings?.length ? input.query.embeddings : [input.query.embedding];
    const cos =
        embs.length === 1
            ? snap.cosineToQuery(embs[0]!)
            : ((): Map<string, number> => {
                  const maps = embs.map((e) => snap.cosineToQuery(e));
                  const merged = new Map<string, number>();
                  for (const f of snap.fields) {
                      let mx = 0;
                      for (const m of maps) {
                          const v = m.get(f.coord) ?? 0;
                          if (v > mx) mx = v;
                      }
                      merged.set(f.coord, mx);
                  }
                  return merged;
              })();
    const lexText = input.query.queries?.length ? input.query.queries.join(' ') : input.query.query;
    const lexBonus = buildLexBonus(snap.fields, lexText);

    // typeCos(T) = max cosine over T's fields. Cached.
    const typeCosCache = new Map<string, number>();
    const typeCos = (t: string): number => {
        const hit = typeCosCache.get(t);
        if (hit != null) return hit;
        let mx = 0;
        for (const f of snap.fieldsByType.get(t) ?? []) mx = Math.max(mx, cos.get(f.coord) ?? 0);
        typeCosCache.set(t, mx);
        return mx;
    };

    // 1. Retrieve the top types by cosine, then trim the tail at the elbow.
    const ranked: Array<{ type: string; score: number }> = [];
    for (const t of snap.fieldsByType.keys()) {
        if (snap.rootTypes.has(t)) continue;
        ranked.push({ type: t, score: typeCos(t) });
    }
    ranked.sort((a, b) => b.score - a.score);
    let typeHits = ranked.slice(0, cfg.typesTopK);
    if (typeHits.length >= 3) {
        const knee = findKneeIndex(
            typeHits.map((h) => h.score),
            cfg.kneedleSensitivity,
        );
        if (knee < typeHits.length) typeHits = typeHits.slice(0, knee);
    }
    if (typeHits.length === 0) return { selectedCoords: [] };

    // 2. One budgeted greedy variant per anchor type.
    const variants = typeHits.map((h) => buildVariant(h.type)).filter((v) => v.coords.size > 0);
    if (variants.length === 0) return { selectedCoords: [] };

    // 3. Score variants: anchor relevance × concentration of its best fields.
    const variantScore = (v: Variant): number => {
        if (v.effCosSq.length === 0) return 0;
        const k = Math.min(cfg.variantTopK, v.effCosSq.length);
        const top = [...v.effCosSq]
            .sort((a, b) => b - a)
            .slice(0, k)
            .reduce((s, x) => s + x, 0);
        return typeCos(v.anchor) * top;
    };
    variants.sort((a, b) => variantScore(b) - variantScore(a));

    // 4. Merge the winner with other variants whose anchor is relevant enough.
    const winner = variants[0]!;
    const coords = new Set<string>(winner.coords);
    const floor = cfg.relevanceFloor * typeCos(winner.anchor);
    let merged = 1;
    for (let k = 1; k < variants.length && merged < cfg.mergeMaxVariants; k++) {
        if (typeCos(variants[k]!.anchor) < floor) continue;
        for (const c of variants[k]!.coords) coords.add(c);
        merged++;
    }

    // 5. Make the slice a usable rooted schema.
    addPathsToRoot(coords);
    emitConnectionTraversal(snap, d, coords);
    emitRootEntries(snap, d, coords, cfg.rootFamilyDepth);
    emitConnectionTraversal(snap, d, coords); // new root collections may themselves be connections

    // 6. Cold-branch prune: drop object subtrees the expansion opened that hold no
    //    field ≥ τ (dead branches). Every LEAF is kept, so a cold must-leaf
    //    survives; only cold object connectors into cold subtrees are removed.
    pruneColdBranches(coords, cfg.coldPruneTau);

    return { selectedCoords: [...coords].sort() };

    // ── locals ────────────────────────────────────────────────────────────

    function pruneColdBranches(set: Set<string>, tau: number): void {
        if (tau <= 0) return;
        const adj = new Map<string, Array<{ coord: string; ret: string }>>();
        for (const c of set) {
            const e = d.edges.get(c);
            if (!e) continue;
            (adj.get(e.parent) ?? adj.set(e.parent, []).get(e.parent)!).push({
                coord: c,
                ret: e.returnType,
            });
        }
        const memo = new Map<string, boolean>();
        const inProg = new Set<string>();
        const hasWarm = (t: string): boolean => {
            const m = memo.get(t);
            if (m !== undefined) return m;
            if (inProg.has(t)) return false;
            inProg.add(t);
            let w = false;
            for (const e of adj.get(t) ?? []) {
                if ((cos.get(e.coord) ?? 0) >= tau) {
                    w = true;
                    break;
                }
                if (hasWarm(e.ret)) {
                    w = true;
                    break;
                }
            }
            inProg.delete(t);
            memo.set(t, w);
            return w;
        };
        for (const c of [...set]) {
            const e = d.edges.get(c);
            if (!e) continue; // keep anything not a field edge
            const parentLive = snap.rootTypes.has(e.parent) || hasWarm(e.parent);
            const isLeaf = !d.objectLike.has(e.returnType);
            if (!(parentLive && (isLeaf || (cos.get(c) ?? 0) >= tau || hasWarm(e.returnType))))
                set.delete(c);
        }
    }

    function addPathsToRoot(set: Set<string>): void {
        const anchorTypes = new Set<string>();
        for (const c of set) {
            const e = d.edges.get(c);
            if (e) {
                anchorTypes.add(e.parent);
                anchorTypes.add(e.returnType);
            }
        }
        for (const c of pathsToRootClosure(d, anchorTypes, cfg.pathsMaxPerType, cfg.pathsMaxDepth))
            set.add(c);
    }

    interface Variant {
        anchor: string;
        coords: Set<string>;
        effCosSq: number[];
    }

    function buildVariant(anchor: string): Variant {
        const coords = new Set<string>();
        const effCosSq: number[] = [];
        const included = new Set<string>([anchor]);
        const markIncluded = (t: string): void => {
            included.add(t);
            const u = unwrapConnection(t);
            if (u) included.add(u);
        };

        const effCos = (coord: string): number => {
            const e = d.edges.get(coord);
            const own = cos.get(coord) ?? 0;
            if (!e) return own;
            return cfg.parentCosBlend * typeCos(e.parent) + (1 - cfg.parentCosBlend) * own;
        };
        const fieldScore = (coord: string): number => {
            const ec = effCos(coord);
            return cfg.cosWeight * ec * ec + cfg.lexWeight * lexBonus(coord);
        };
        // Cost = how much NEW schema a field drags in (keeps the expansion clustered).
        const fieldCost = (coord: string): number => {
            const e = d.edges.get(coord);
            if (!e) return 1;
            if (e.returnType === 'Mutation' || e.returnType === 'Subscription') return 999;
            if (included.has(e.returnType)) return 1;
            const u = unwrapConnection(e.returnType);
            if (u && included.has(u)) return 2;
            if (!d.objectLike.has(e.returnType)) return 1; // scalar / enum
            return unwrapConnection(e.returnType) ? 10 : 8; // fresh connection : fresh object
        };

        const anchorFields = snap.fieldsByType.get(anchor) ?? [];
        if (anchorFields.length === 0) return { anchor, coords, effCosSq };

        interface Cand {
            coord: string;
            score: number;
            hop: number;
        }
        const pool: Cand[] = [];
        const inPool = new Set<string>();
        const expanded = new Set<string>([anchor]);
        const addType = (t: string, hop: number): void => {
            if (expanded.has(t) || expanded.size >= cfg.maxExpandedTypes) return;
            if (hop > 0 && typeCos(t) < cfg.poolEntryTypeCosFloor) return;
            expanded.add(t);
            for (const f of snap.fieldsByType.get(t) ?? []) {
                if (inPool.has(f.coord) || coords.has(f.coord)) continue;
                inPool.add(f.coord);
                pool.push({ coord: f.coord, score: fieldScore(f.coord), hop });
            }
        };
        for (const f of anchorFields) {
            inPool.add(f.coord);
            pool.push({ coord: f.coord, score: fieldScore(f.coord), hop: 0 });
        }

        let used = 0;
        while (used < cfg.perVariantBudget && pool.length > 0) {
            let bestIdx = -1,
                bestEff = -Infinity,
                bestCost = 0;
            for (let k = 0; k < pool.length; k++) {
                const p = pool[k]!;
                if (coords.has(p.coord)) continue;
                const cost = fieldCost(p.coord);
                const eff = p.score / cost;
                if (eff < cfg.efficiencyThreshold || used + cost > cfg.perVariantBudget) continue;
                if (eff > bestEff) {
                    bestEff = eff;
                    bestIdx = k;
                    bestCost = cost;
                }
            }
            if (bestIdx < 0) break;
            const w = pool[bestIdx]!;
            pool[bestIdx] = pool[pool.length - 1]!;
            pool.pop();
            coords.add(w.coord);
            used += bestCost;
            effCosSq.push(effCos(w.coord) ** 2);
            const e = d.edges.get(w.coord);
            if (e) {
                markIncluded(e.returnType);
                // Expand THROUGH the connection wrapper (so its meta-fields are
                // scorable candidates) and into the node type.
                if (isConnectionLike(e.returnType) && d.fanOut.has(e.returnType))
                    addType(e.returnType, w.hop + 1);
                const into = unwrapConnection(e.returnType) ?? e.returnType;
                if (d.fanOut.has(into)) addType(into, w.hop + 1);
            }
        }

        // Connect this variant's types back to a root.
        const anchorTypes = new Set<string>([anchor]);
        for (const c of coords) {
            const e = d.edges.get(c);
            if (e) {
                anchorTypes.add(e.parent);
                anchorTypes.add(e.returnType);
            }
        }
        for (const c of pathsToRootClosure(d, anchorTypes, cfg.pathsMaxPerType, cfg.pathsMaxDepth))
            coords.add(c);

        return { anchor, coords, effCosSq };
    }
}
