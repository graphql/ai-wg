/**
 * Strategies benchmark runner. Main thread builds snapshots + embeds queries
 * (warms the disk cache) under the configured EmbeddingSetup, then dispatches
 * (query × strategy) jobs to a pool of N worker threads. Workers do all the
 * CPU-bound algorithm work in parallel; main collects RunRecords + aggregates.
 *
 * Cohorts here are strategies — the (model × template) setup is held fixed.
 * The templates/models benchmarks live in sibling folders and use the same
 * shared infra under core/shared/.
 *
 * Result caching: each job's RunRecord is stored in .result-cache/ keyed by
 * SHA256(strategySource + configJson + schemaSdl + queryContent). Cache hits
 * skip the worker entirely; any change to those inputs invalidates the entry.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { buildSnapshot } from '../../core/shared/snapshot.ts';
import { aggregateCohort } from './metrics.ts';
import { embedOne } from '../../core/shared/embeddings.ts';
import { computeJobCacheKey, readCached, writeCached } from '../../core/shared/result-cache.ts';
import { DEFAULT_SLICE_FLOOR } from '../../core/shared/slice.ts';
import type {
    CategoryMeta,
    EmbeddingSetup,
    QueryDef,
    RowMetrics,
    RunRecord,
    RunReport,
    SchemaDef,
    StrategyDef,
} from '../../core/types.ts';

export interface RunOptions {
    schemas: SchemaDef[];
    categories: CategoryMeta[];
    strategies: StrategyDef[];
    queries: QueryDef[];
    /** (model × template) used for snapshot build + query embedding. */
    setup: EmbeddingSetup;
    timestampIso: string;
    /** Worker thread count. Default floor(os.cpus().length / 2) - 1, clamped to [1, jobs]. */
    concurrency?: number;
    /** Skip the result cache and re-run every job. */
    noCache?: boolean;
    onProgress?: (msg: string) => void;
}

interface Cohort {
    id: string;
    strategyId: string;
    config: Record<string, unknown>;
}

interface Job {
    jobId: number;
    schemaId: string;
    strategyId: string;
    query: QueryDef;
    queryEmbedding: Float32Array;
    queryEmbeddings: Float32Array[];
    config: Record<string, unknown>;
}

interface WorkerResultMessage {
    type: 'result';
    jobId: number;
    schemaId: string;
    strategyId: string;
    queryId: string;
    category: string;
    selectedCoords: string[];
    metrics: RowMetrics;
    latencyMs: number;
    error?: string;
}

function configHash(cfg: Record<string, unknown>): string {
    const ordered = JSON.stringify(cfg, Object.keys(cfg).sort());
    return createHash('sha256').update(ordered).digest('hex').slice(0, 12);
}

function sortedConfigJson(cfg: Record<string, unknown>): string {
    return JSON.stringify(cfg, Object.keys(cfg).sort());
}

export async function runBenchmark(opts: RunOptions): Promise<RunReport> {
    const log = opts.onProgress ?? (() => {});

    // Pre-warm: build snapshots once on main so all disk cache writes happen
    // here, then workers re-build from the warm cache in parallel.
    for (const s of opts.schemas) {
        log(`[snapshot:main] warming ${s.id}`);
        await buildSnapshot({
            schema: s,
            template: opts.setup.template,
            typeTemplate: opts.setup.typeTemplate,
            model: opts.setup.model,
        });
    }

    // Embed every query once on main (cache → workers benefit on rebuild).
    // `queryEmbeddings` = primary combined-NL vector (back-compat). `queryEmbLists`
    // = the per-sub-query set for multi-request asks (= [primary] when no `queries`).
    const queryEmbeddings = new Map<string, Float32Array>();
    const queryEmbLists = new Map<string, Float32Array[]>();
    for (const q of opts.queries) {
        const primary = await embedOne(opts.setup.model, opts.setup.template, q.query, 'query');
        queryEmbeddings.set(q.id, primary);
        const subs =
            q.queries && q.queries.length > 0
                ? await Promise.all(
                      q.queries.map((t) =>
                          embedOne(opts.setup.model, opts.setup.template, t, 'query'),
                      ),
                  )
                : [primary];
        queryEmbLists.set(q.id, subs);
    }

    const cohorts: Cohort[] = opts.strategies.map((strat) => ({
        id: strat.id,
        strategyId: strat.id,
        config: strat.defaultConfig ?? {},
    }));

    // Pre-compute hashes used to build per-job cache keys.
    const schemaSdlHashes = new Map<string, string>();
    for (const s of opts.schemas) {
        schemaSdlHashes.set(s.id, createHash('sha256').update(s.sdl).digest('hex'));
    }

    const queryContentHashes = new Map<string, string>();
    for (const q of opts.queries) {
        const content = JSON.stringify({
            query: q.query,
            // only add the key when present, so single-query cache entries are untouched
            ...(q.queries?.length ? { queries: q.queries } : {}),
            schemaId: q.schemaId,
            category: q.category,
            mustInclude: [...q.mustInclude].sort(),
            mustExclude: [...(q.mustExclude ?? [])].sort(),
            shouldInclude: [...(q.shouldInclude ?? [])].sort(),
        });
        queryContentHashes.set(q.id, createHash('sha256').update(content).digest('hex'));
    }

    const strategySourceHashes = new Map<string, string>();
    for (const s of opts.strategies) {
        strategySourceHashes.set(s.id, s.sourceHash ?? s.id);
    }

    // Shared infra that shapes a job's result OUTSIDE the strategy source:
    // snapshot.ts (coords + rootTypes + embeddings), slice.ts (rendered slice →
    // tokens), metrics.ts (scoring). Hash it into every cache key so editing any
    // of these invalidates stale cached rows. Without this, harness fixes (e.g.
    // the rootTypes derivation) would be silently masked by the cache.
    const infraHash = createHash('sha256')
        .update(readFileSync(new URL('../../core/shared/snapshot.ts', import.meta.url), 'utf8'))
        .update(readFileSync(new URL('../../core/shared/slice.ts', import.meta.url), 'utf8'))
        .update(readFileSync(new URL('./metrics.ts', import.meta.url), 'utf8'))
        .digest('hex');

    // Build one spec per (query × cohort); compute each job's cache key.
    const cohortHashById = new Map(cohorts.map((c) => [c.id, configHash(c.config)]));

    interface JobSpec {
        schemaId: string;
        strategyId: string;
        query: QueryDef;
        config: Record<string, unknown>;
        configHashStr: string;
        cacheKey: string;
    }

    const allSpecs: JobSpec[] = [];
    for (const q of opts.queries) {
        for (const c of cohorts) {
            const cfgJson = sortedConfigJson(c.config);
            const cacheKey = computeJobCacheKey([
                'strategies',
                c.strategyId,
                opts.setup.model.sourceHash ?? opts.setup.model.id,
                opts.setup.template.sourceHash ?? opts.setup.template.id,
                strategySourceHashes.get(c.strategyId)!,
                cfgJson,
                schemaSdlHashes.get(q.schemaId)!,
                queryContentHashes.get(q.id)!,
                infraHash,
                // Render mode AND active floor must be part of the key — compact
                // vs full (and a floor sweep) must not return stale records.
                process.env['COMPACT_SLICE'] !== '0'
                    ? `compact@${Number.isFinite(Number(process.env['SLICE_FLOOR'])) ? Number(process.env['SLICE_FLOOR']) : DEFAULT_SLICE_FLOOR}`
                    : 'full',
            ]);
            allSpecs.push({
                schemaId: q.schemaId,
                strategyId: c.strategyId,
                query: q,
                config: c.config,
                configHashStr: cohortHashById.get(c.id) ?? 'unknown',
                cacheKey,
            });
        }
    }

    // Parallel cache check — all reads at once; misses go to workers.
    const cacheResults = opts.noCache
        ? allSpecs.map(() => null)
        : await Promise.all(allSpecs.map((s) => readCached<RunRecord>(s.cacheKey)));

    const cachedRecords: RunRecord[] = [];
    const liveSpecs: JobSpec[] = [];
    for (let i = 0; i < allSpecs.length; i++) {
        const hit = cacheResults[i];
        if (hit) {
            cachedRecords.push(hit);
        } else {
            liveSpecs.push(allSpecs[i]!);
        }
    }

    if (cachedRecords.length > 0 || liveSpecs.length > 0) {
        log(`[cache] ${cachedRecords.length} hits, ${liveSpecs.length} misses`);
    }

    // Dispatch live jobs to workers.
    let liveRecords: RunRecord[] = [];
    if (liveSpecs.length > 0) {
        const jobs: Job[] = liveSpecs.map((spec, i) => ({
            jobId: i,
            schemaId: spec.schemaId,
            strategyId: spec.strategyId,
            query: spec.query,
            queryEmbedding: queryEmbeddings.get(spec.query.id)!,
            queryEmbeddings: queryEmbLists.get(spec.query.id)!,
            config: spec.config,
        }));

        const requested = opts.concurrency ?? Math.max(1, Math.floor(os.cpus().length / 2) - 1);
        const workerCount = Math.max(1, Math.min(requested, jobs.length));
        log(`[runner] dispatching ${jobs.length} jobs across ${workerCount} workers`);

        const workerResults = await dispatchToWorkers(
            jobs,
            opts.schemas,
            opts.setup,
            workerCount,
            log,
        );

        // Convert to RunRecords, write each to cache concurrently.
        const specByJobId = new Map(liveSpecs.map((spec, i) => [i, spec]));
        liveRecords = await Promise.all(
            workerResults.map(async (r) => {
                const spec = specByJobId.get(r.jobId)!;
                const record: RunRecord = {
                    schemaId: r.schemaId,
                    queryId: r.queryId,
                    category: r.category,
                    strategyId: r.strategyId,
                    configHash: spec.configHashStr,
                    metrics: r.metrics,
                    selectedCoords: r.selectedCoords,
                    latencyMs: r.latencyMs,
                    ...(r.error !== undefined ? { error: r.error } : {}),
                };
                await writeCached(spec.cacheKey, record);
                return record;
            }),
        );
    }

    const records = [...cachedRecords, ...liveRecords];

    // Aggregate per (strategy, configHash).
    const buckets = new Map<string, RunRecord[]>();
    for (const r of records) {
        const k = `${r.strategyId}::${r.configHash}`;
        if (!buckets.has(k)) buckets.set(k, []);
        buckets.get(k)!.push(r);
    }
    const summary = Array.from(buckets.entries()).map(([key, rows]) => {
        const [sid, ch] = key.split('::');
        return aggregateCohort(sid!, ch!, rows);
    });

    return {
        schemaVersion: 1,
        generatedAt: opts.timestampIso,
        schemas: opts.schemas.map((s) => ({
            id: s.id,
            name: s.name,
            ...(s.description !== undefined ? { description: s.description } : {}),
        })),
        categories: opts.categories,
        strategies: opts.strategies.map((s) => ({
            id: s.id,
            name: s.name,
            description: s.description,
            ...(s.defaultConfig !== undefined ? { defaultConfig: s.defaultConfig } : {}),
        })),
        summary,
        rows: records,
    };
}

/** Backwards-compat alias. The old API name was `runEval`. */
export const runEval = runBenchmark;

async function dispatchToWorkers(
    jobs: Job[],
    schemas: SchemaDef[],
    setup: EmbeddingSetup,
    workerCount: number,
    log: (msg: string) => void,
): Promise<WorkerResultMessage[]> {
    // Workers can't resolve .ts by default; load via a tiny .mjs bootstrap
    // that uses tsx/esm/api's tsImport. See ./worker-entry.mjs.
    const workerUrl = new URL('./worker-entry.mjs', import.meta.url);
    const workers: Worker[] = [];
    for (let i = 0; i < workerCount; i++) {
        const w = new Worker(workerUrl);
        workers.push(w);
    }

    // Initialize all workers in parallel. Workers need the EmbeddingSetup
    // to rebuild snapshots the same way main did.
    await Promise.all(
        workers.map(
            (w, i) =>
                new Promise<void>((resolve, reject) => {
                    const onReady = (msg: { type: string; error?: string }): void => {
                        if (msg.type === 'ready') {
                            w.off('message', onReady);
                            resolve();
                            return;
                        }
                        if (msg.type === 'init-error') {
                            reject(new Error(`worker ${i}: ${msg.error}`));
                            return;
                        }
                    };
                    w.on('message', onReady);
                    w.on('error', reject);
                    w.postMessage({
                        type: 'init',
                        schemas,
                        // Templates contain a function — not structured-cloneable. Pass
                        // the IDs and let the worker re-load both via the shared loader.
                        modelId: setup.model.id,
                        templateId: setup.template.id,
                        typeTemplateId: setup.typeTemplate.id,
                    });
                }),
        ),
    );

    log(`[runner] ${workerCount} workers ready, distributing ${jobs.length} jobs`);

    // Pull-queue dispatch: each worker is fed a new job as soon as its
    // previous one returns. Keeps all workers busy until the queue drains.
    const results: WorkerResultMessage[] = [];
    let nextJob = 0;
    let completed = 0;
    const PROGRESS_EVERY = Math.max(1, Math.floor(jobs.length / 20));
    const tStart = Date.now();

    return new Promise<WorkerResultMessage[]>((resolve, reject) => {
        function dispatchNext(workerIdx: number): void {
            if (nextJob >= jobs.length) return;
            const job = jobs[nextJob++]!;
            workers[workerIdx]!.postMessage({
                type: 'job',
                jobId: job.jobId,
                schemaId: job.schemaId,
                strategyId: job.strategyId,
                query: job.query,
                queryEmbedding: job.queryEmbedding,
                queryEmbeddings: job.queryEmbeddings,
                config: job.config,
            });
        }

        for (let i = 0; i < workers.length; i++) {
            const w = workers[i]!;
            w.on('message', (msg: WorkerResultMessage) => {
                if (msg.type !== 'result') return;
                results.push(msg);
                completed++;
                if (completed % PROGRESS_EVERY === 0 || completed === jobs.length) {
                    const elapsed = (Date.now() - tStart) / 1000;
                    const rate = completed / elapsed;
                    const eta = (jobs.length - completed) / rate;
                    log(
                        `[runner] ${completed}/${jobs.length}  (${rate.toFixed(1)} jobs/s, ETA ${eta.toFixed(0)}s)`,
                    );
                }
                if (completed >= jobs.length) {
                    for (const w2 of workers) w2.postMessage({ type: 'shutdown' });
                    resolve(results);
                } else {
                    dispatchNext(i);
                }
            });
            w.on('error', reject);
            // Prime each worker with its first job.
            dispatchNext(i);
        }
    });
}

// Keep the workerUrl computation co-located with the entrypoint resolution.
// fileURLToPath import kept for future use (e.g. logging worker script path).
void fileURLToPath;
