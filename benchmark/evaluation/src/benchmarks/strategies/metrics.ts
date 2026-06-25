/**
 * Per-row and cohort metrics. Runner calls computeRowMetrics for each
 * (strategy, query) pair, then aggregateCohort to summarize per (strategy, config).
 */
import { encode } from 'gpt-tokenizer';
import { parse, Kind } from 'graphql';
import type { ConfigSummary, QueryDef, RowMetrics, RunRecord } from '../../core/types.ts';

export function tokenCount(text: string): number {
    try {
        return encode(text).length;
    } catch {
        return Math.ceil(text.length / 4);
    }
}

/**
 * Every coordinate the rendered slice actually contains, so recall can be graded
 * end-to-end against the slice rather than against the strategy's field picks:
 *   - bare type name        `Type`
 *   - object/interface field `Type.field`  and each rendered arg `Type.field(arg:)`
 *   - input-object field    `Input.field`
 *   - enum value            `Enum.VALUE`
 * Uses `parse` (syntax only) so a not-fully-valid slice still yields its members.
 */
export function sliceMembers(sdl: string): Set<string> {
    const out = new Set<string>();
    let doc;
    try {
        doc = parse(sdl);
    } catch {
        return out;
    }
    for (const def of doc.definitions) {
        const name = (def as { name?: { value: string } }).name?.value;
        if (!name) continue;
        out.add(name);
        if (
            def.kind === Kind.OBJECT_TYPE_DEFINITION ||
            def.kind === Kind.INTERFACE_TYPE_DEFINITION
        ) {
            for (const f of def.fields ?? []) {
                out.add(`${name}.${f.name.value}`);
                for (const a of f.arguments ?? [])
                    out.add(`${name}.${f.name.value}(${a.name.value}:)`);
            }
        } else if (def.kind === Kind.INPUT_OBJECT_TYPE_DEFINITION) {
            for (const f of def.fields ?? []) out.add(`${name}.${f.name.value}`);
        } else if (def.kind === Kind.ENUM_TYPE_DEFINITION) {
            for (const v of def.values ?? []) out.add(`${name}.${v.name.value}`);
        }
    }
    return out;
}

function intersectionSize(a: ReadonlySet<string>, b: ReadonlyArray<string>): number {
    let n = 0;
    for (const x of b) if (a.has(x)) n++;
    return n;
}

function countExcludeMatches(
    selected: ReadonlySet<string>,
    patterns: ReadonlyArray<string>,
): number {
    let n = 0;
    for (const c of selected) {
        for (const p of patterns) {
            if (c === p || c.startsWith(`${p}.`)) {
                n++;
                break;
            }
        }
    }
    return n;
}

export function computeRowMetrics(opts: {
    selectedCoords: ReadonlyArray<string>;
    slicedSdl: string;
    query: QueryDef;
}): RowMetrics {
    const selected = new Set(opts.selectedCoords);
    const must = opts.query.mustInclude;
    const should = opts.query.shouldInclude ?? null;
    const mustExclude = opts.query.mustExclude ?? [];

    // Recall is graded against what the rendered SLICE actually contains
    // (fields + args + input types/fields), not just the strategy's field picks
    // — so required/used arguments and input coords in the must-list are checked
    // end-to-end. `selectedCount` below still reflects the raw field selection.
    const members = sliceMembers(opts.slicedSdl);

    const hits = intersectionSize(members, must);
    const mustRecall = must.length === 0 ? 1 : hits / must.length;
    const shouldRecall =
        should == null
            ? null
            : should.length === 0
              ? 1
              : intersectionSize(members, should) / should.length;
    const excludeViolations = countExcludeMatches(members, mustExclude);
    const sliceTokens = tokenCount(opts.slicedSdl);
    const sliceBytes = opts.slicedSdl.length;
    const sliceTypeCount = countTypeDefs(opts.slicedSdl);
    const mustMissing = Math.max(0, must.length - hits);

    return {
        mustTotal: must.length,
        mustHits: hits,
        mustMissing,
        mustRecall,
        perfectRecall: mustMissing === 0 && must.length > 0,
        shouldRecall,
        excludeViolations,
        sliceTokens,
        sliceBytes,
        selectedCount: selected.size,
        sliceTypeCount,
    };
}

/** Count type definitions in a rendered slice (type/interface/input/enum/union/scalar at line start). */
function countTypeDefs(sdl: string): number {
    const m = sdl.match(/^(?:type|interface|input|enum|union|scalar)\s/gm);
    return m ? m.length : 0;
}

function percentile(sortedAsc: ReadonlyArray<number>, p: number): number {
    if (sortedAsc.length === 0) return 0;
    const idx = Math.min(sortedAsc.length - 1, Math.floor((sortedAsc.length - 1) * p));
    return sortedAsc[idx]!;
}

/**
 * Compute mean + nearest-rank percentiles for a numeric series. Returns the
 * sorted samples too so downstream tools can re-percentile / plot histograms.
 */
export function distributionStats(
    xs: ReadonlyArray<number>,
): import('../../core/types.ts').DistributionStats {
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

export function aggregateCohort(
    strategyId: string,
    configHash: string,
    rows: ReadonlyArray<RunRecord>,
): ConfigSummary {
    const n = rows.length;
    const withMusts = rows.filter((r) => r.metrics.mustTotal > 0);
    const perfectN = withMusts.filter((r) => r.metrics.perfectRecall).length;
    const tokenVals = rows.map((r) => r.metrics.sliceTokens);
    const coordVals = rows.map((r) => r.metrics.selectedCount);
    const typeVals = rows.map((r) => r.metrics.sliceTypeCount ?? 0);
    const recallValsWithMusts = withMusts.map((r) => r.metrics.mustRecall);
    const sumExclude = rows.reduce((a, r) => a + r.metrics.excludeViolations, 0);
    const sumLatency = rows.reduce((a, r) => a + r.latencyMs, 0);

    let m0 = 0,
        m1 = 0,
        m2 = 0,
        m3 = 0;
    for (const r of withMusts) {
        const miss = r.metrics.mustMissing;
        if (miss === 0) m0++;
        else if (miss === 1) m1++;
        else if (miss === 2) m2++;
        else m3++;
    }
    const denom = withMusts.length || 1;

    return {
        strategyId,
        configHash,
        rowCount: n,
        rowCountWithMusts: withMusts.length,
        perfectPct: withMusts.length === 0 ? 0 : perfectN / withMusts.length,
        missDistribution: {
            miss0: m0 / denom,
            miss1: m1 / denom,
            miss2: m2 / denom,
            miss3plus: m3 / denom,
        },
        recallStats: distributionStats(recallValsWithMusts),
        tokenStats: distributionStats(tokenVals),
        coordStats: distributionStats(coordVals),
        typeStats: distributionStats(typeVals),
        meanExcludeViol: n === 0 ? 0 : sumExclude / n,
        meanLatencyMs: n === 0 ? 0 : sumLatency / n,
    };
}
