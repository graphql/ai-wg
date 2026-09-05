/**
 * Persist an AgentRunReport as both JSON and Markdown into an out directory.
 *
 * Mirrors `strategies/reporter.ts`: the JSON is canonical and STREAMED — a
 * full agent sweep (5 models × 30 strategies × 816 × samples) carries a
 * per-row `turnsTrace`, so a single `JSON.stringify(report)` would build one
 * string past V8's 512MB cap. The markdown is generated from the report for
 * humans / PRs: a headline success% table (with 95% CI), a failure-taxonomy
 * table, a cost table, turn-distribution sparklines, and the documented
 * unsatisfiable carve-out section (§7.6, §7.7).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { join } from 'node:path';
import type { AgentConfigSummary, AgentRunReport, FailReason } from './metrics.ts';

export async function writeReport(
    report: AgentRunReport,
    outDir: string,
): Promise<{ jsonPath: string; mdPath: string }> {
    await mkdir(outDir, { recursive: true });
    const jsonPath = join(outDir, 'results.json');
    const mdPath = join(outDir, 'results.md');
    await writeReportJson(jsonPath, report); // streamed — `turnsTrace` makes rows large
    await writeFile(mdPath, renderMarkdown(report), 'utf8');
    return { jsonPath, mdPath };
}

/** Stream the report as JSON, serializing `rows` one at a time, so we never build
 *  a single >512MB string (V8's max) — which `JSON.stringify(report)` does once a
 *  sweep has tens of thousands of rows, each carrying a full `turnsTrace`. */
async function writeReportJson(path: string, report: AgentRunReport): Promise<void> {
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

function usd(n: number): string {
    return '$' + n.toFixed(n >= 1 ? 2 : 4);
}

/** Compact token count: 1234 → 1.2k, 1234567 → 1.2M. */
function tok(n: number): string {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return String(Math.round(n));
}

function renderMarkdown(r: AgentRunReport): string {
    const lines: string[] = [];
    lines.push(`# Agent Benchmark Results`);
    lines.push('');
    lines.push(`Generated: \`${r.generatedAt}\``);
    lines.push('');
    lines.push(`- Schemas: ${r.schemas.length} (${r.schemas.map((s) => s.id).join(', ')})`);
    lines.push(
        `- Categories: ${r.categories.length} (${r.categories.map((c) => c.id).join(', ')})`,
    );
    lines.push(
        `- Chat models: ${r.chatModels.length} (${r.chatModels.map((m) => m.id).join(', ')})`,
    );
    lines.push(
        `- Strategies: ${r.strategies.length} (${r.strategies.map((s) => s.id).join(', ')})`,
    );
    lines.push(`- Rows: ${r.rows.length}`);
    lines.push('');
    lines.push(
        `Fixed: embed=\`${r.fixed.embeddingModel}\`, maxTurns=${r.fixed.maxTurns}, maxToolCalls=${r.fixed.maxToolCalls}, ` +
            `maxCostUsd=${usd(r.fixed.maxCostUsd)}, temperature=${r.fixed.temperature}, nSamples=${r.fixed.nSamples}, seed=${r.fixed.seed}`,
    );
    lines.push('');

    const bySuccess = [...r.summary].sort((a, b) => b.successPct - a.successPct);

    // Full-board coverage (cache-as-ledger). The board reads every model's accumulated
    // results from the cache; a cohort's expected cell count is `queryCount × nSamples`.
    // Cells missing under the current determinants (stale logic ⇒ different key ⇒ miss)
    // simply don't appear — surface the gap with a re-run hint so it can't masquerade
    // as fresh. The EMPTY-board case (every cell went stale after a re-key, so there are
    // no cohorts at all) is exactly the scenario this hint exists for: with no cohorts we
    // cannot compute a numeric "N of M" (the report's `board` carries no model/strategy/
    // prompt counts, so M is genuinely unknown), so we print a generic message instead.
    const expectedPerCohort = r.board.queryCount * r.fixed.nSamples;
    let totalPresent = 0;
    let totalExpected = 0;
    for (const s of r.summary) {
        totalPresent += s.rowCount;
        totalExpected += expectedPerCohort;
    }
    if (r.summary.length === 0 && r.board.queryCount > 0) {
        lines.push(
            '> **No board cells present under current determinants** — the harness logic or ' +
                'query set changed since the last run. Run `pnpm eval agent [--model …]` to refresh.',
        );
        lines.push('');
    } else if (expectedPerCohort > 0 && totalPresent < totalExpected) {
        const missing = totalExpected - totalPresent;
        lines.push(
            `> **${missing} of ${totalExpected} board cells missing under current determinants** — ` +
                'run `pnpm eval agent [--model …]` to refresh.',
        );
        lines.push('');
    }

    // §7.6 headline: success% (the metric), sorted desc, with the Wilson 95% CI,
    // turn p50, per-row search/exec means, mean $ and the cohort's total bill.
    lines.push(`## Headline — success% (the metric)`);
    lines.push('');
    lines.push(
        '| model | strategy/prompt | rows | coverage | **success%** | [95% CI] | turns p50 | search μ | queries μ | invalid μ | api s μ | $ μ | $ total |',
    );
    lines.push('|---|---|---:|---:|---:|:--|---:|---:|---:|---:|---:|---:|---:|');
    for (const s of bySuccess) {
        const ci = `[${pct(s.successCI.lo)}, ${pct(s.successCI.hi)}]`;
        // coverage = rows present in the board for this cohort / cells expected
        // (queryCount × nSamples). < 100% ⇒ some cells missing under current determinants.
        const coverage =
            expectedPerCohort > 0 ? `${s.rowCount}/${expectedPerCohort}` : `${s.rowCount}/—`;
        lines.push(
            `| ${s.chatModelId} | ${stratLabel(s)} | ${s.rowCountSatisfiable}/${s.rowCount} | ${coverage} | **${pct(s.successPct)}** | ${ci} | ` +
                `${num(s.turnStats.p50, 0)} | ${num(s.meanSearchCalls, 1)} | ${num(s.meanQueriesUsed, 1)} | ${num(s.meanInvalidQueries, 1)} | ${num(s.meanApiMs / 1000, 1)} | ${usd(s.meanTotalCostUsd)} | ${usd(s.totalCostUsd)} |`,
        );
    }
    lines.push('');
    lines.push(
        '> `coverage` = board cells present / expected (`queryCount × nSamples`); < 100% means some cells are missing under the current determinants. ' +
            '`queries μ` = mean valid queries used to reach coverage (1 ideal; >1 = split across queries). `invalid μ` = mean parse/validate-rejected queries before success.',
    );
    lines.push('');
    lines.push(
        `> Denominator is SATISFIABLE rows (\`rowCountSatisfiable\`); the unsatisfiable carve-out (R1) is excluded — see below. ` +
            `Means are over satisfiable rows; \`$ total\` is the cohort bill over ALL rows.`,
    );
    lines.push('');

    // §7.6 second table: the failure taxonomy (counts over ALL rows in cohort).
    lines.push(`## Failure taxonomy (failBreakdown — counts over all rows incl. unsatisfiable)`);
    lines.push('');
    const failCols: FailReason[] = [
        'wrong_answer',
        'no_answer',
        'budget_turns',
        'budget_tool_calls',
        'budget_cost',
        'budget_tokens',
        'no_tool_call_loop',
        'api_error',
        'parse',
        'validate',
        'coverage',
        'never_executed',
        'unsatisfiable_ceiling',
    ];
    lines.push(
        '| model | strategy/prompt | ' +
            failCols.map((c) => c.replace(/_/g, ' ')).join(' | ') +
            ' | total |',
    );
    lines.push('|---|---|' + failCols.map(() => '---:').join('|') + '|---:|');
    for (const s of bySuccess) {
        const cells = failCols.map((c) => String(s.failBreakdown[c] ?? 0));
        const total = failCols.reduce((a, c) => a + (s.failBreakdown[c] ?? 0), 0);
        lines.push(`| ${s.chatModelId} | ${stratLabel(s)} | ${cells.join(' | ')} | ${total} |`);
    }
    lines.push('');

    // Cost table: mean / p50 / p95 / max totalCostUsd per cohort, plus the bill.
    lines.push(`## Cost (totalCostUsd per row, per cohort)`);
    lines.push('');
    lines.push('| model | strategy/prompt | $ mean | $ p50 | $ p95 | $ max | $ total | shape |');
    lines.push('|---|---|---:|---:|---:|---:|---:|:--|');
    const globalMaxCost = Math.max(1e-9, ...r.summary.flatMap((s) => s.costStats.samples));
    for (const s of bySuccess) {
        const cs = s.costStats;
        lines.push(
            `| ${s.chatModelId} | ${stratLabel(s)} | ${usd(cs.mean)} | ${usd(cs.p50)} | ${usd(cs.p95)} | ${usd(cs.max)} | ${usd(s.totalCostUsd)} | \`${sparkline(cs.samples, 0, globalMaxCost)}\` |`,
        );
    }
    lines.push('');

    // Token usage: per-session means + cohort totals (the volume behind the $).
    lines.push(`## Token usage`);
    lines.push('');
    lines.push(
        '| model | strategy/prompt | in μ | out μ | cache-rd μ | cache-wr μ | embed μ | total in | total out | total cache-rd | total embed |',
    );
    lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const s of bySuccess) {
        lines.push(
            `| ${s.chatModelId} | ${stratLabel(s)} | ${num(s.meanInputTokens, 0)} | ${num(s.meanOutputTokens, 0)} | ` +
                `${num(s.meanCacheReadTokens, 0)} | ${num(s.meanCacheCreationTokens, 0)} | ${num(s.meanEmbedTokens, 0)} | ` +
                `${tok(s.totalInputTokens)} | ${tok(s.totalOutputTokens)} | ${tok(s.totalCacheReadTokens)} | ${tok(s.totalEmbedTokens)} |`,
        );
    }
    lines.push('');
    lines.push(
        '> `μ` columns are per-session means over satisfiable rows; `total` columns sum over ALL rows in the cohort. ' +
            '`in` = prompt/input tokens, `out` = completion tokens, `cache-rd`/`cache-wr` = prompt-cache read/write, `embed` = search-query embedding tokens.',
    );
    lines.push('');

    // Diagnostics: one-shot quality, search thrash, and the retrieval-ceiling split.
    lines.push(`## Diagnostics — one-shot quality · thrash · retrieval ceiling`);
    lines.push('');
    lines.push(
        '| model | strategy/prompt | 1-shot% | thrash% | gap: agent | gap: retrieval | gap: never-selected |',
    );
    lines.push('|---|---|---:|---:|---:|---:|---:|');
    for (const s of bySuccess) {
        lines.push(
            `| ${s.chatModelId} | ${stratLabel(s)} | ${pct(s.oneShotPct)} | ${(s.thrashRate * 100).toFixed(0)}% | ${s.coverageGapAgent} | ${s.coverageGapRetrieval} | ${s.coverageGapNeverSelected} |`,
        );
    }
    lines.push('');
    lines.push(
        '> `1-shot%` = succeeded with one valid query, no retries. `thrash%` = searches that added nothing. ' +
            "Each uncovered required coordinate is bucketed: **agent** (its field WAS retrieved but the model — which DID execute — didn't select it), " +
            '**retrieval** (never surfaced by the slicer), **never-selected** (the session executed ZERO valid queries, so selection never happened — a loop/prompt issue, NOT attributable to agent skill or retrieval). ' +
            'Only the agent vs retrieval split is comparable across models; never-selected must be read separately.',
    );
    lines.push('');

    // Turn distribution sparklines (§7.7).
    lines.push(`## Turn distribution (turns per row, per cohort)`);
    lines.push('');
    lines.push('| model | strategy/prompt | mean | min | p50 | p95 | p99 | max | shape |');
    lines.push('|---|---|---:|---:|---:|---:|---:|---:|:--|');
    const globalMaxTurns = Math.max(1, ...r.summary.flatMap((s) => s.turnStats.samples));
    for (const s of bySuccess) {
        const ts = s.turnStats;
        lines.push(
            `| ${s.chatModelId} | ${stratLabel(s)} | ${num(ts.mean, 1)} | ${num(ts.min, 0)} | ${num(ts.p50, 0)} | ${num(ts.p95, 0)} | ${num(ts.p99, 0)} | ${num(ts.max, 0)} | \`${sparkline(ts.samples, 0, globalMaxTurns)}\` |`,
        );
    }
    lines.push('');

    // §7.7 / R1: the documented unsatisfiable carve-out. These bare-union queries
    // have a structurally-unsatisfiable must (§4.4) and are never started, so they
    // are excluded from the headline denominator. List them explicitly for audit.
    lines.push(`## Unsatisfiable carve-out (R1)`);
    lines.push('');
    lines.push(
        `These queries have a structurally-unsatisfiable \`mustInclude\` (e.g. bare-union members the slicer ` +
            `can never surface; §4.4). They are carved out of the headline denominator: \`successPct = successes / rowCountSatisfiable\`. ` +
            `If a cohort's row was nonetheless started for one of these, its fail bucket is \`unsatisfiable_ceiling\`.`,
    );
    lines.push('');
    if (r.unsatisfiableQueryIds.length === 0) {
        lines.push('_None — no unsatisfiable queries in this run._');
    } else {
        lines.push(`Carved out (${r.unsatisfiableQueryIds.length}):`);
        lines.push('');
        for (const id of r.unsatisfiableQueryIds) lines.push(`- \`${id}\``);
    }
    lines.push('');

    return lines.join('\n');
}

function stratLabel(s: AgentConfigSummary): string {
    // strategy / prompt, with a short configHash so two configs don't collapse visually.
    return `${s.strategyId} / ${s.promptId}@${s.configHash.slice(0, 6)}`;
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
