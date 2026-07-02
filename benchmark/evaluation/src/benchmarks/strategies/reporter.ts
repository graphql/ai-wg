/**
 * Persist a RunReport as both JSON and Markdown into runs/current/.
 *
 * The JSON is canonical; the markdown is generated from it for humans / PRs.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import type { ConfigSummary, RunReport } from '../../core/types.ts';

export async function writeReport(
    report: RunReport,
    outDir: string,
): Promise<{ jsonPath: string; mdPath: string }> {
    await mkdir(outDir, { recursive: true });
    const jsonPath = join(outDir, 'results.json');
    const mdPath = join(outDir, 'results.md');
    await writeReportJson(jsonPath, report); // streamed — a single JSON.stringify overflows at many strategies
    await writeFile(mdPath, renderMarkdown(report), 'utf8');
    return { jsonPath, mdPath };
}

/** Stream the report as JSON, serializing `rows` one at a time, so we never build
 *  a single >512MB string (V8's max) — which `JSON.stringify(report)` does once a
 *  run has tens of thousands of rows × hundreds of coords each. */
async function writeReportJson(path: string, report: RunReport): Promise<void> {
    const ws = createWriteStream(path, { encoding: 'utf8' });
    const write = (s: string): Promise<void> =>
        new Promise((resolve, reject) => {
            const ok = ws.write(s, (err) => {
                if (err) reject(err);
            });
            if (ok) resolve();
            else ws.once('drain', resolve);
        });
    const { rows, ...rest } = report;
    await write('{\n');
    for (const [k, v] of Object.entries(rest))
        await write(`  ${JSON.stringify(k)}: ${JSON.stringify(v)},\n`);
    await write('  "rows": [\n');
    for (let i = 0; i < rows.length; i++)
        await write('    ' + JSON.stringify(rows[i]) + (i < rows.length - 1 ? ',' : '') + '\n');
    await write('  ]\n}\n');
    await new Promise<void>((resolve, reject) => {
        ws.on('error', reject);
        ws.end(() => resolve());
    });
}

function pct(n: number, dp = 1): string {
    return (n * 100).toFixed(dp) + '%';
}

function num(n: number, dp = 3): string {
    return n.toFixed(dp);
}

function tk(n: number): string {
    return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);
}

function renderMarkdown(r: RunReport): string {
    const lines: string[] = [];
    lines.push(`# Evaluation Results`);
    lines.push('');
    lines.push(`Generated: \`${r.generatedAt}\``);
    lines.push('');
    lines.push(`- Schemas: ${r.schemas.length} (${r.schemas.map((s) => s.id).join(', ')})`);
    lines.push(
        `- Categories: ${r.categories.length} (${r.categories.map((c) => c.id).join(', ')})`,
    );
    lines.push(
        `- Strategies: ${r.strategies.length} (${r.strategies.map((s) => s.id).join(', ')})`,
    );
    lines.push(`- Rows: ${r.rows.length}`);
    lines.push('');

    // Headline table: perfect% first, sorted by it. Token distribution next to
    // it. Recall distribution and miss buckets below.
    lines.push(`## Headline — perfect% (the metric)`);
    lines.push('');
    lines.push(
        '| strategy | rows | **perfect%** | tokens p50 | tokens p95 | tokens p99 | tokens mean | coords mean | types mean |',
    );
    lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    // md tables can't indent rows (renderers trim leading cell whitespace), so a
    // per-schema sub-row is faked with a `&nbsp;&nbsp;↳ ` prefix in the label cell.
    const schemaIds = [...new Set(r.rows.map((x) => x.schemaId))].sort();
    const mean = (a: number[]): number =>
        a.length ? a.reduce((acc, x) => acc + x, 0) / a.length : 0;
    const pctile = (a: number[], q: number): number => {
        const so = [...a].sort((x, y) => x - y);
        return so.length ? so[Math.min(so.length - 1, Math.floor((so.length - 1) * q))]! : 0;
    };
    for (const s of [...r.summary].sort((a, b) => b.perfectPct - a.perfectPct)) {
        lines.push(
            `| ${stratLabel(s)} | ${s.rowCountWithMusts}/${s.rowCount} | **${pct(s.perfectPct)}** | ${tk(s.tokenStats.p50)} | ${tk(s.tokenStats.p95)} | ${tk(s.tokenStats.p99)} | ${tk(s.tokenStats.mean)} | ${num(s.coordStats.mean, 0)} | ${num(s.typeStats.mean, 0)} |`,
        );
        for (const sid of schemaIds) {
            const rows = r.rows.filter((x) => x.strategyId === s.strategyId && x.schemaId === sid);
            if (rows.length === 0) continue;
            const wm = rows.filter((x) => x.metrics.mustTotal > 0);
            const perfect = wm.length
                ? wm.filter((x) => x.metrics.perfectRecall).length / wm.length
                : 0;
            const toks = rows.map((x) => x.metrics.sliceTokens);
            lines.push(
                `| &nbsp;&nbsp;↳ ${sid} | ${wm.length}/${rows.length} | ${pct(perfect)} | ${tk(pctile(toks, 0.5))} | ${tk(pctile(toks, 0.95))} | ${tk(pctile(toks, 0.99))} | ${tk(mean(toks))} | ${num(mean(rows.map((x) => x.metrics.selectedCount)), 0)} | ${num(mean(rows.map((x) => x.metrics.sliceTypeCount)), 0)} |`,
            );
        }
    }
    lines.push('');

    lines.push(`## Recall distribution`);
    lines.push('');
    lines.push('| strategy | mean | p10 | p25 | p50 | p75 | min | shape (over with-musts rows) |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|:--|');
    for (const s of [...r.summary].sort((a, b) => b.perfectPct - a.perfectPct)) {
        const rs = s.recallStats;
        lines.push(
            `| ${stratLabel(s)} | ${num(rs.mean, 3)} | ${num(rs.p10, 2)} | ${num(rs.p25, 2)} | ${num(rs.p50, 2)} | ${num(rs.p75, 2)} | ${num(rs.min, 2)} | \`${sparkline(rs.samples, 0, 1)}\` |`,
        );
    }
    lines.push('');

    lines.push(`## Token distribution`);
    lines.push('');
    lines.push('| strategy | mean | min | p50 | p95 | p99 | max | shape |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|:--|');
    const globalMaxTk = Math.max(1, ...r.summary.flatMap((s) => s.tokenStats.samples));
    for (const s of [...r.summary].sort((a, b) => b.perfectPct - a.perfectPct)) {
        const ts = s.tokenStats;
        lines.push(
            `| ${stratLabel(s)} | ${tk(ts.mean)} | ${tk(ts.min)} | ${tk(ts.p50)} | ${tk(ts.p95)} | ${tk(ts.p99)} | ${tk(ts.max)} | \`${sparkline(ts.samples, 0, globalMaxTk)}\` |`,
        );
    }
    lines.push('');

    lines.push(`## Coordinate-count distribution (selected "Type.field" coords)`);
    lines.push('');
    lines.push('| strategy | mean | min | p50 | p95 | p99 | max | shape |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|:--|');
    const globalMaxCoord = Math.max(1, ...r.summary.flatMap((s) => s.coordStats.samples));
    for (const s of [...r.summary].sort((a, b) => b.perfectPct - a.perfectPct)) {
        const cs = s.coordStats;
        lines.push(
            `| ${stratLabel(s)} | ${num(cs.mean, 0)} | ${num(cs.min, 0)} | ${num(cs.p50, 0)} | ${num(cs.p95, 0)} | ${num(cs.p99, 0)} | ${num(cs.max, 0)} | \`${sparkline(cs.samples, 0, globalMaxCoord)}\` |`,
        );
    }
    lines.push('');

    lines.push(`## Type-count distribution (types in the rendered slice)`);
    lines.push('');
    lines.push('| strategy | mean | min | p50 | p95 | p99 | max | shape |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|:--|');
    const globalMaxType = Math.max(1, ...r.summary.flatMap((s) => s.typeStats.samples));
    for (const s of [...r.summary].sort((a, b) => b.perfectPct - a.perfectPct)) {
        const tys = s.typeStats;
        lines.push(
            `| ${stratLabel(s)} | ${num(tys.mean, 0)} | ${num(tys.min, 0)} | ${num(tys.p50, 0)} | ${num(tys.p95, 0)} | ${num(tys.p99, 0)} | ${num(tys.max, 0)} | \`${sparkline(tys.samples, 0, globalMaxType)}\` |`,
        );
    }
    lines.push('');

    lines.push(`## Miss distribution (where perfect% fails)`);
    lines.push('');
    lines.push('| strategy | miss=0 | miss=1 | miss=2 | miss≥3 | excludeViol | mean lat (ms) |');
    lines.push('|---|---:|---:|---:|---:|---:|---:|');
    for (const s of [...r.summary].sort((a, b) => b.perfectPct - a.perfectPct)) {
        const md = s.missDistribution;
        lines.push(
            `| ${stratLabel(s)} | ${pct(md.miss0)} | ${pct(md.miss1)} | ${pct(md.miss2)} | ${pct(md.miss3plus)} | ${num(s.meanExcludeViol, 2)} | ${num(s.meanLatencyMs, 0)} |`,
        );
    }
    lines.push('');

    return lines.join('\n');
}

function stratLabel(s: ConfigSummary): string {
    // Short configHash so two configs of the same strategy don't collapse visually.
    return `${s.strategyId}@${s.configHash.slice(0, 6)}`;
}

const SPARK_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/**
 * 10-bucket ASCII sparkline over `samples` in the range [lo, hi]. Empty input → "—".
 * Useful for "shape at a glance" of a distribution in a markdown cell.
 */
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
