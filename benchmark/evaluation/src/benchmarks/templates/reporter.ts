/**
 * Persist a templates RankRunReport as JSON + Markdown. The metric lives in
 * two independent retrieval spaces: FIELD recall over `targetFields` and TYPE
 * recall over `targetTypes`. The headline table leads with field recall@K then
 * type recall@K; cohorts are sorted by field recall@50 desc. Rank
 * distributions render one table per space.
 *
 * Note: type-embedding text is constant across template cohorts here — the
 * type template is fixed for this benchmark (the TYPE axis is varied by the
 * sibling type-templates benchmark), so the TYPE columns match across rows.
 * The headline stays field recall@50.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RankRunReport, TemplateCohortSummary } from './metrics.ts';

export async function writeReport(
    report: RankRunReport,
    outDir: string,
): Promise<{ jsonPath: string; mdPath: string }> {
    await mkdir(outDir, { recursive: true });
    const jsonPath = join(outDir, 'results.json');
    const mdPath = join(outDir, 'results.md');
    await writeFile(jsonPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    await writeFile(mdPath, renderMarkdown(report), 'utf8');
    return { jsonPath, mdPath };
}

function pct(n: number, dp = 1): string {
    return (n * 100).toFixed(dp) + '%';
}

function num(n: number, dp = 3): string {
    return n.toFixed(dp);
}

function renderMarkdown(r: RankRunReport): string {
    const lines: string[] = [];
    lines.push(`# Templates Benchmark — Results`);
    lines.push('');
    lines.push(`Generated: \`${r.generatedAt}\``);
    lines.push('');
    lines.push(`- Fixed model: \`${r.fixed.model}\``);
    lines.push(`- Fixed strategy: \`${r.fixed.strategy}\` (headline K = ${r.fixed.K})`);
    lines.push(`- Schemas: ${r.schemas.length} (${r.schemas.map((s) => s.id).join(', ')})`);
    lines.push(
        `- Categories: ${r.categories.length} (${r.categories.map((c) => c.id).join(', ')})`,
    );
    lines.push(`- Templates: ${r.templates.length} (${r.templates.map((t) => t.id).join(', ')})`);
    lines.push(`- Rows: ${r.rows.length}`);
    lines.push('');

    const sorted = [...r.summary].sort(
        (a, b) => (b.fieldRecallAtK[50] ?? 0) - (a.fieldRecallAtK[50] ?? 0),
    );

    const Khdr = r.reportedK.map((K) => `recall@${K}`).join(' | ');
    const Kalign = r.reportedK.map(() => '---:').join(' | ');

    lines.push(`## Headline — FIELD recall@50 (the metric)`);
    lines.push('');
    lines.push(`Scored against \`targetFields\` in field-embedding space.`);
    lines.push('');
    lines.push(`| template | rows | rank p50 | rank p95 | ${Khdr} | mean cos |`);
    lines.push(`|---|---:|---:|---:| ${Kalign} |---:|`);
    for (const s of sorted) {
        const Kcells = r.reportedK.map((K) => `**${pct(s.fieldRecallAtK[K] ?? 0)}**`).join(' | ');
        lines.push(
            `| ${s.templateId} | ${s.rowCountWithFields}/${s.rowCount} | ${s.fieldRankStats.p50.toFixed(0)} | ${s.fieldRankStats.p95.toFixed(0)} | ${Kcells} | ${num(s.fieldMeanCosine, 3)} |`,
        );
    }
    lines.push('');

    lines.push(`## TYPE recall@50`);
    lines.push('');
    lines.push(
        `Scored against \`targetTypes\` in type-embedding space. The type template is fixed for this benchmark, so type-embedding text is constant across these cohorts — vary it in the sibling \`type-templates\` benchmark.`,
    );
    lines.push('');
    lines.push(`| template | rows | rank p50 | rank p95 | ${Khdr} | mean cos |`);
    lines.push(`|---|---:|---:|---:| ${Kalign} |---:|`);
    for (const s of sorted) {
        const Kcells = r.reportedK.map((K) => `${pct(s.typeRecallAtK[K] ?? 0)}`).join(' | ');
        lines.push(
            `| ${s.templateId} | ${s.rowCountWithTypes}/${s.rowCount} | ${s.typeRankStats.p50.toFixed(0)} | ${s.typeRankStats.p95.toFixed(0)} | ${Kcells} | ${num(s.typeMeanCosine, 3)} |`,
        );
    }
    lines.push('');

    lines.push(`## Field-rank distribution (across all (query, targetField) pairs)`);
    lines.push('');
    lines.push('| template | pairs | mean | min | p25 | p50 | p75 | p95 | p99 | max | shape |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--|');
    const globalMaxFieldRank = Math.max(1, ...r.summary.flatMap((s) => s.fieldRankStats.samples));
    for (const s of sorted) {
        const rs = s.fieldRankStats;
        lines.push(
            `| ${s.templateId} | ${s.fieldPairs} | ${rs.mean.toFixed(1)} | ${rs.min} | ${rs.p25} | ${rs.p50} | ${rs.p75} | ${rs.p95} | ${rs.p99} | ${rs.max} | \`${sparkline(rs.samples, 1, globalMaxFieldRank)}\` |`,
        );
    }
    lines.push('');

    lines.push(`## Type-rank distribution (across all (query, targetType) pairs)`);
    lines.push('');
    lines.push('| template | pairs | mean | min | p25 | p50 | p75 | p95 | p99 | max | shape |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--|');
    const globalMaxTypeRank = Math.max(1, ...r.summary.flatMap((s) => s.typeRankStats.samples));
    for (const s of sorted) {
        const rs = s.typeRankStats;
        lines.push(
            `| ${s.templateId} | ${s.typePairs} | ${rs.mean.toFixed(1)} | ${rs.min} | ${rs.p25} | ${rs.p50} | ${rs.p75} | ${rs.p95} | ${rs.p99} | ${rs.max} | \`${sparkline(rs.samples, 1, globalMaxTypeRank)}\` |`,
        );
    }
    lines.push('');

    lines.push(`## Latency (per row, ms)`);
    lines.push('');
    lines.push('| template | mean ms |');
    lines.push('|---|---:|');
    for (const s of sorted) {
        lines.push(`| ${s.templateId} | ${num(s.meanLatencyMs, 1)} |`);
    }
    lines.push('');

    return lines.join('\n');
}

// 10-bucket ASCII sparkline. Same util as the strategies reporter, duplicated
// here on purpose so each benchmark is independently mutable.
const SPARK_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;
function sparkline(samples: ReadonlyArray<number>, lo: number, hi: number): string {
    if (samples.length === 0) return '—';
    const bins = 10;
    const counts = new Array<number>(bins).fill(0);
    const span = hi - lo || 1;
    for (const x of samples) {
        const t = Math.max(0, Math.min(1, (x - lo) / span));
        const i = Math.min(bins - 1, Math.floor(t * bins));
        counts[i] = (counts[i] ?? 0) + 1;
    }
    const peak = Math.max(1, ...counts);
    return counts
        .map(
            (c) =>
                SPARK_BLOCKS[
                    Math.min(
                        SPARK_BLOCKS.length - 1,
                        Math.floor((c / peak) * (SPARK_BLOCKS.length - 1)),
                    )
                ],
        )
        .join('');
}

// Helper kept for future per-cohort embellishments — surfaces template label
// without re-introducing the configHash suffix the strategies reporter uses.
export function cohortLabel(s: TemplateCohortSummary): string {
    return s.templateId;
}
