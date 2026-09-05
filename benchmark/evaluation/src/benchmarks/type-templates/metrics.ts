/**
 * Type-templates benchmark metrics — rank-oriented, not slice-oriented.
 *
 * For each (typeTemplate, query) the runner computes TWO full cosine rankings:
 * one over every field coord, one over every object/interface type. The cohort
 * axis here is the TYPE template, so the headline lives in the TYPE space: we
 * score the type ranking by where each `targetTypes` answer type landed (rank
 * in the full sort + cosine strength). This tells us whether the *type
 * embedding text* (independent of any slicing strategy) puts the right types
 * near the top. The field space is computed for parity (the field template is
 * fixed across this cohort) but is context, not the headline.
 *
 * We deliberately do NOT score against `mustInclude`: that set is full of
 * navigation scaffolding and bare type names, which are not field coords and
 * always sink to the sentinel rank, polluting the distribution. `targetFields`
 * / `targetTypes` are the semantic answer members.
 *
 * Aggregations per cohort, computed per space:
 *   - rank p50 / p95 / p99 across all (query, target) pairs (lower = better)
 *   - recall@K for K in {20, 50, 100, 200} = fraction of targets in top-K
 *   - mean cosine on targets
 *
 * Duplicated in shape from benchmarks/templates/metrics.ts on purpose — the
 * self-containment principle applies to benchmark types too. Field names mirror
 * the templates report (rows pivoted on `typeTemplateId`) and the TYPE columns
 * lead so downstream tooling can be shared.
 */
import type { DistributionStats } from '../../core/types.ts';

export interface PerRank {
    coord: string;
    /** 1-based rank in the descending cosine sort over ALL members of the space. */
    rank: number;
    /** Raw cosine similarity at that rank. */
    cos: number;
}

/** Per-(query, space) retrieval metrics. A "space" is either fields or types. */
export interface SpaceMetrics {
    total: number;
    /** Hits in top-K, where K = the runner's reference cutoff (default 50). */
    hits: number;
    perRank: PerRank[];
    /** K → fraction-of-targets-in-top-K, computed for the runner's reportedK set. */
    recallAtK: Record<number, number>;
    meanCosine: number;
}

export interface RankRowMetrics {
    fields: SpaceMetrics;
    types: SpaceMetrics;
}

export interface RankRunRecord {
    schemaId: string;
    queryId: string;
    category: string;
    typeTemplateId: string;
    /** Total number of indexed field coords at the time of this query — useful for normalizing ranks. */
    indexedFieldCount: number;
    /** Total number of indexed types at the time of this query — useful for normalizing type ranks. */
    indexedTypeCount: number;
    metrics: RankRowMetrics;
    latencyMs: number;
    error?: string;
}

export interface TypeTemplateCohortSummary {
    typeTemplateId: string;
    rowCount: number;
    rowCountWithFields: number;
    rowCountWithTypes: number;
    /** Total (query, targetField) pairs we computed ranks for. */
    fieldPairs: number;
    /** Total (query, targetType) pairs we computed ranks for. */
    typePairs: number;
    fieldRankStats: DistributionStats;
    typeRankStats: DistributionStats;
    /** K → mean field recall@K across rows-with-fields. */
    fieldRecallAtK: Record<number, number>;
    /** K → mean type recall@K across rows-with-types. */
    typeRecallAtK: Record<number, number>;
    fieldMeanCosine: number;
    typeMeanCosine: number;
    meanLatencyMs: number;
}

export interface RankRunReport {
    schemaVersion: 1;
    generatedAt: string;
    benchmarkType: 'type-templates';
    fixed: { model: string; fieldTemplate: string; strategy: 'pure-knn'; K: number };
    schemas: ReadonlyArray<{ id: string; name: string; description?: string }>;
    categories: ReadonlyArray<{ id: string; name: string; description?: string }>;
    typeTemplates: ReadonlyArray<{ id: string; name: string; description: string }>;
    reportedK: number[];
    summary: TypeTemplateCohortSummary[];
    rows: RankRunRecord[];
}

function percentile(sortedAsc: ReadonlyArray<number>, p: number): number {
    if (sortedAsc.length === 0) return 0;
    const idx = Math.min(sortedAsc.length - 1, Math.floor((sortedAsc.length - 1) * p));
    return sortedAsc[idx]!;
}

export function distributionStats(xs: ReadonlyArray<number>): DistributionStats {
    if (xs.length === 0) {
        return {
            n: 0,
            mean: 0,
            min: 0,
            p10: 0,
            p25: 0,
            p50: 0,
            p75: 0,
            p95: 0,
            p99: 0,
            max: 0,
            samples: [],
        };
    }
    const sorted = [...xs].sort((a, b) => a - b);
    const sum = sorted.reduce((a, b) => a + b, 0);
    return {
        n: sorted.length,
        mean: sum / sorted.length,
        min: sorted[0]!,
        p10: percentile(sorted, 0.1),
        p25: percentile(sorted, 0.25),
        p50: percentile(sorted, 0.5),
        p75: percentile(sorted, 0.75),
        p95: percentile(sorted, 0.95),
        p99: percentile(sorted, 0.99),
        max: sorted[sorted.length - 1]!,
        samples: sorted,
    };
}

/**
 * Score one retrieval space (fields or types) for a single query. The ranking
 * is the full descending sort of every member by cosine to the query
 * embedding — it is the strategy-agnostic reference signal. An empty
 * `relevant` set means the query asks nothing of this space: recall@K is
 * vacuously 1, with zero hits and no pairs to aggregate.
 */
function computeSpaceMetrics(opts: {
    ranked: ReadonlyArray<{ coord: string; cos: number }>; // sorted desc by cos
    relevant: ReadonlyArray<string>;
    reportedK: ReadonlyArray<number>;
    headlineK: number;
}): SpaceMetrics {
    const { ranked, relevant, reportedK, headlineK } = opts;

    if (relevant.length === 0) {
        const recallAtK: Record<number, number> = {};
        for (const K of reportedK) recallAtK[K] = 1;
        return { total: 0, hits: 0, perRank: [], recallAtK, meanCosine: 0 };
    }

    const rankByCoord = new Map<string, number>();
    const cosByCoord = new Map<string, number>();
    for (let i = 0; i < ranked.length; i++) {
        const r = ranked[i]!;
        rankByCoord.set(r.coord, i + 1); // 1-based
        cosByCoord.set(r.coord, r.cos);
    }

    const perRank: PerRank[] = [];
    for (const m of relevant) {
        const rank = rankByCoord.get(m);
        if (rank === undefined) {
            // Target isn't an indexed member — record sentinel rank = N+1.
            perRank.push({ coord: m, rank: ranked.length + 1, cos: 0 });
            continue;
        }
        perRank.push({ coord: m, rank, cos: cosByCoord.get(m) ?? 0 });
    }

    const recallAtK: Record<number, number> = {};
    for (const K of reportedK) {
        let hits = 0;
        for (const pr of perRank) if (pr.rank <= K) hits++;
        recallAtK[K] = hits / relevant.length;
    }

    let hits = 0;
    for (const pr of perRank) if (pr.rank <= headlineK) hits++;

    const meanCosine =
        perRank.length === 0 ? 0 : perRank.reduce((a, b) => a + b.cos, 0) / perRank.length;

    return {
        total: relevant.length,
        hits,
        perRank,
        recallAtK,
        meanCosine,
    };
}

/**
 * Compute per-(typeTemplate, query) metrics from the precomputed field- and
 * type-cosine rankings. Each space is scored against its own answer set; the
 * TYPE space is the cohort headline here.
 */
export function computeRankRowMetrics(opts: {
    rankedFields: ReadonlyArray<{ coord: string; cos: number }>; // sorted desc by cos
    rankedTypes: ReadonlyArray<{ coord: string; cos: number }>; // sorted desc by cos
    targetFields: ReadonlyArray<string>;
    targetTypes: ReadonlyArray<string>;
    reportedK: ReadonlyArray<number>;
    /** Reference cutoff for the headline "hits" count. */
    headlineK: number;
}): RankRowMetrics {
    const { rankedFields, rankedTypes, targetFields, targetTypes, reportedK, headlineK } = opts;
    return {
        fields: computeSpaceMetrics({
            ranked: rankedFields,
            relevant: targetFields,
            reportedK,
            headlineK,
        }),
        types: computeSpaceMetrics({
            ranked: rankedTypes,
            relevant: targetTypes,
            reportedK,
            headlineK,
        }),
    };
}

export function aggregateTypeTemplateCohort(
    typeTemplateId: string,
    rows: ReadonlyArray<RankRunRecord>,
    reportedK: ReadonlyArray<number>,
): TypeTemplateCohortSummary {
    const withFields = rows.filter((r) => r.metrics.fields.total > 0);
    const withTypes = rows.filter((r) => r.metrics.types.total > 0);

    const fieldRanks: number[] = [];
    const fieldCosines: number[] = [];
    for (const r of withFields) {
        for (const pr of r.metrics.fields.perRank) {
            fieldRanks.push(pr.rank);
            fieldCosines.push(pr.cos);
        }
    }
    const typeRanks: number[] = [];
    const typeCosines: number[] = [];
    for (const r of withTypes) {
        for (const pr of r.metrics.types.perRank) {
            typeRanks.push(pr.rank);
            typeCosines.push(pr.cos);
        }
    }

    const fieldRecallAtK: Record<number, number> = {};
    const typeRecallAtK: Record<number, number> = {};
    for (const K of reportedK) {
        if (withFields.length === 0) {
            fieldRecallAtK[K] = 0;
        } else {
            let acc = 0;
            for (const r of withFields) acc += r.metrics.fields.recallAtK[K] ?? 0;
            fieldRecallAtK[K] = acc / withFields.length;
        }
        if (withTypes.length === 0) {
            typeRecallAtK[K] = 0;
        } else {
            let acc = 0;
            for (const r of withTypes) acc += r.metrics.types.recallAtK[K] ?? 0;
            typeRecallAtK[K] = acc / withTypes.length;
        }
    }

    const fieldMeanCosine =
        fieldCosines.length === 0
            ? 0
            : fieldCosines.reduce((a, b) => a + b, 0) / fieldCosines.length;
    const typeMeanCosine =
        typeCosines.length === 0 ? 0 : typeCosines.reduce((a, b) => a + b, 0) / typeCosines.length;
    const sumLatency = rows.reduce((a, r) => a + r.latencyMs, 0);

    return {
        typeTemplateId,
        rowCount: rows.length,
        rowCountWithFields: withFields.length,
        rowCountWithTypes: withTypes.length,
        fieldPairs: fieldRanks.length,
        typePairs: typeRanks.length,
        fieldRankStats: distributionStats(fieldRanks),
        typeRankStats: distributionStats(typeRanks),
        fieldRecallAtK,
        typeRecallAtK,
        fieldMeanCosine,
        typeMeanCosine,
        meanLatencyMs: rows.length === 0 ? 0 : sumLatency / rows.length,
    };
}
