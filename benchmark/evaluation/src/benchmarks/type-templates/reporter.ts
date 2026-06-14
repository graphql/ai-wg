/**
 * Persist a type-templates RankRunReport as JSON + Markdown. The cohort axis is
 * the TYPE template, so the HEADLINE lives in the type-embedding space: TYPE
 * recall over `targetTypes`. The headline table leads with type recall@K and is
 * sorted by type recall@50 desc. The field space is reported afterwards as
 * context (the field template is fixed across cohorts, so its columns are
 * constant — they exist for parity with the templates/models reports).
 *
 * Duplicated in shape from benchmarks/templates/reporter.ts on purpose — the
 * cohort axis is `typeTemplateId` and the field/type emphasis is swapped, but
 * the columns are otherwise identical so the reports stay comparable at a glance.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { RankRunReport, TypeTemplateCohortSummary } from './metrics.ts';

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
    lines.push(`# Type-Templates Benchmark — Results`);
    lines.push('');
    lines.push(`Generated: \`${r.generatedAt}\``);
    lines.push('');
    lines.push(`- Fixed model: \`${r.fixed.model}\``);
    lines.push(`- Fixed field template: \`${r.fixed.fieldTemplate}\``);
    lines.push(`- Fixed strategy: \`${r.fixed.strategy}\` (headline K = ${r.fixed.K})`);
    lines.push(`- Schemas: ${r.schemas.length} (${r.schemas.map((s) => s.id).join(', ')})`);
    lines.push(
        `- Categories: ${r.categories.length} (${r.categories.map((c) => c.id).join(', ')})`,
    );
    lines.push(
        `- Type templates: ${r.typeTemplates.length} (${r.typeTemplates.map((t) => t.id).join(', ')})`,
    );
    lines.push(`- Rows: ${r.rows.length}`);
    lines.push('');

    const sorted = [...r.summary].sort(
        (a, b) => (b.typeRecallAtK[50] ?? 0) - (a.typeRecallAtK[50] ?? 0),
    );

    const Khdr = r.reportedK.map((K) => `recall@${K}`).join(' | ');
    const Kalign = r.reportedK.map(() => '---:').join(' | ');

    lines.push(`## Headline — TYPE recall@50 (the metric)`);
    lines.push('');
    lines.push(
        `Scored against \`targetTypes\` in type-embedding space. The varied axis is the TYPE rendering template.`,
    );
    lines.push('');
    lines.push(`| type template | rows | rank p50 | rank p95 | ${Khdr} | mean cos |`);
    lines.push(`|---|---:|---:|---:| ${Kalign} |---:|`);
    for (const s of sorted) {
        const Kcells = r.reportedK.map((K) => `**${pct(s.typeRecallAtK[K] ?? 0)}**`).join(' | ');
        lines.push(
            `| ${s.typeTemplateId} | ${s.rowCountWithTypes}/${s.rowCount} | ${s.typeRankStats.p50.toFixed(0)} | ${s.typeRankStats.p95.toFixed(0)} | ${Kcells} | ${num(s.typeMeanCosine, 3)} |`,
        );
    }
    lines.push('');

    lines.push(`## FIELD recall@50 (context)`);
    lines.push('');
    lines.push(
        `Scored against \`targetFields\` in field-embedding space. The field template is fixed across cohorts, so these columns are constant — shown for parity with the templates/models reports.`,
    );
    lines.push('');
    lines.push(`| type template | rows | rank p50 | rank p95 | ${Khdr} | mean cos |`);
    lines.push(`|---|---:|---:|---:| ${Kalign} |---:|`);
    for (const s of sorted) {
        const Kcells = r.reportedK.map((K) => `${pct(s.fieldRecallAtK[K] ?? 0)}`).join(' | ');
        lines.push(
            `| ${s.typeTemplateId} | ${s.rowCountWithFields}/${s.rowCount} | ${s.fieldRankStats.p50.toFixed(0)} | ${s.fieldRankStats.p95.toFixed(0)} | ${Kcells} | ${num(s.fieldMeanCosine, 3)} |`,
        );
    }
    lines.push('');

    lines.push(`## Type-rank distribution (across all (query, targetType) pairs)`);
    lines.push('');
    lines.push(
        '| type template | pairs | mean | min | p25 | p50 | p75 | p95 | p99 | max | shape |',
    );
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--|');
    const globalMaxTypeRank = Math.max(1, ...r.summary.flatMap((s) => s.typeRankStats.samples));
    for (const s of sorted) {
        const rs = s.typeRankStats;
        lines.push(
            `| ${s.typeTemplateId} | ${s.typePairs} | ${rs.mean.toFixed(1)} | ${rs.min} | ${rs.p25} | ${rs.p50} | ${rs.p75} | ${rs.p95} | ${rs.p99} | ${rs.max} | \`${sparkline(rs.samples, 1, globalMaxTypeRank)}\` |`,
        );
    }
    lines.push('');

    lines.push(`## Field-rank distribution (across all (query, targetField) pairs)`);
    lines.push('');
    lines.push(
        '| type template | pairs | mean | min | p25 | p50 | p75 | p95 | p99 | max | shape |',
    );
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|:--|');
    const globalMaxFieldRank = Math.max(1, ...r.summary.flatMap((s) => s.fieldRankStats.samples));
    for (const s of sorted) {
        const rs = s.fieldRankStats;
        lines.push(
            `| ${s.typeTemplateId} | ${s.fieldPairs} | ${rs.mean.toFixed(1)} | ${rs.min} | ${rs.p25} | ${rs.p50} | ${rs.p75} | ${rs.p95} | ${rs.p99} | ${rs.max} | \`${sparkline(rs.samples, 1, globalMaxFieldRank)}\` |`,
        );
    }
    lines.push('');

    lines.push(`## Latency (per row, ms)`);
    lines.push('');
    lines.push('| type template | mean ms |');
    lines.push('|---|---:|');
    for (const s of sorted) {
        lines.push(`| ${s.typeTemplateId} | ${num(s.meanLatencyMs, 1)} |`);
    }
    lines.push('');

    return lines.join('\n');
}

// 10-bucket ASCII sparkline. Same util as the templates/models reporters,
// duplicated here on purpose so each benchmark is independently mutable.
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

// Helper kept for future per-cohort embellishments — surfaces type template label.
export function cohortLabel(s: TypeTemplateCohortSummary): string {
    return s.typeTemplateId;
}
