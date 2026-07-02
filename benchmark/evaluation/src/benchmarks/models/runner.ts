/**
 * Models benchmark runner. Cohorts = embedding models. The template + slicing
 * approach are held fixed: each cohort uses the configured template
 * (`coord-return-desc`) and the pure-knn-K reference ranking inline. We
 * deliberately do NOT load any strategy code here — the metric is "where does
 * THIS model put the right fields in cosine order under the default
 * template?", which is upstream of any slicing strategy.
 *
 * For each (model × query):
 *   1. main thread embeds the query under (model, fixedTemplate) — cache friendly
 *   2. worker thread loads its snapshot built under (model, fixedTemplate),
 *      sorts every field coord by cosine to the query embedding, takes the
 *      top K (reference, K=50 by default), and reports the rank + cosine of
 *      every mustInclude coord
 *   3. main aggregates per cohort into rank percentiles + recall@K + mean cos
 *
 * Duplicated structurally from benchmarks/templates/runner.ts on purpose —
 * benchmark types are self-contained and free to diverge.
 */
import { createHash } from 'node:crypto';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { buildSnapshot } from '../../core/shared/snapshot.ts';
import { embedTexts } from '../../core/shared/embeddings.ts';
import { mapWithConcurrency } from '../../core/shared/concurrency.ts';
import { computeJobCacheKey, readCached, writeCached } from '../../core/shared/result-cache.ts';
import {
    aggregateModelCohort,
    type RankRowMetrics,
    type RankRunRecord,
    type RankRunReport,
} from './metrics.ts';
import type {
    CategoryMeta,
    ModelDef,
    QueryDef,
    SchemaDef,
    TemplateDef,
    TypeTemplateDef,
} from '../../core/types.ts';

/** K values reported in recall@K. */
export const REPORTED_K: ReadonlyArray<number> = [20, 50, 100, 200];
/** Reference top-K cutoff for the headline "mustHits" count. Matches pure-knn-K50. */
export const HEADLINE_K = 50;
/**
 * Max concurrent provider-bound warm-up operations (snapshot builds /
 * per-cohort query embedding). Provider-request bound — intentionally
 * separate from the worker-thread `concurrency` that scores jobs.
 */
const WARM_CONCURRENCY = 8;

export interface RunOptions {
    schemas: SchemaDef[];
    categories: CategoryMeta[];
    models: ModelDef[];
    queries: QueryDef[];
    /** Fixed field template — varied axis is model. */
    template: TemplateDef;
    /** Fixed type template — used only for snapshot type-space builds (headline is field space). */
    typeTemplate: TypeTemplateDef;
    timestampIso: string;
    /** Worker thread count. Default floor(os.cpus().length / 2) - 1, clamped to [1, jobs]. */
    concurrency?: number;
    /** Skip the result cache and re-run every job. */
    noCache?: boolean;
    onProgress?: (msg: string) => void;
}

interface Job {
    jobId: number;
    schemaId: string;
    modelId: string;
    query: QueryDef;
    queryEmbedding: Float32Array;
}

interface WorkerResultMessage {
    type: 'result';
    jobId: number;
    schemaId: string;
    modelId: string;
    queryId: string;
    category: string;
    indexedFieldCount: number;
    indexedTypeCount: number;
    metrics: RankRowMetrics;
    latencyMs: number;
    error?: string;
}

export async function runBenchmark(opts: RunOptions): Promise<RankRunReport> {
    const log = opts.onProgress ?? (() => {});

    // Pre-warm the disk cache for every (model × schema) by building the
    // snapshot once on main, bounded-parallel. Workers then rebuild from warm
    // cache. First run on a new model is the slow path; subsequent runs are
    // free. Cache paths are namespaced by model+template, so concurrent builds
    // never write the same file.
    const warmPairs = opts.models.flatMap((m) => opts.schemas.map((s) => ({ m, s })));
    await mapWithConcurrency(warmPairs, WARM_CONCURRENCY, async ({ m, s }) => {
        log(`[snapshot:main] warming ${s.id} under model=${m.id}`);
        await buildSnapshot({
            schema: s,
            template: opts.template,
            typeTemplate: opts.typeTemplate,
            model: m,
        });
    });

    // Embed every query once per model (cache writes happen here; workers
    // reuse). Batched per model — embedTexts chunks the provider calls — and
    // run bounded-parallel across models. Keyed by `${modelId}::${queryId}`.
    const queryTexts = opts.queries.map((q) => q.query);
    const queryEmbeddings = new Map<string, Float32Array>();
    await mapWithConcurrency(opts.models, WARM_CONCURRENCY, async (m) => {
        const vecs = await embedTexts(m, opts.template, queryTexts);
        opts.queries.forEach((q, i) => queryEmbeddings.set(`${m.id}::${q.id}`, vecs[i]!));
    });

    // Pre-compute hashes used to build per-job cache keys.
    const schemaSdlHashes = new Map<string, string>();
    for (const s of opts.schemas) {
        schemaSdlHashes.set(s.id, createHash('sha256').update(s.sdl).digest('hex'));
    }
    const queryContentHashes = new Map<string, string>();
    for (const q of opts.queries) {
        const content = JSON.stringify({
            query: q.query,
            schemaId: q.schemaId,
            category: q.category,
            mustInclude: [...q.mustInclude].sort(),
            mustExclude: [...(q.mustExclude ?? [])].sort(),
            shouldInclude: [...(q.shouldInclude ?? [])].sort(),
            targetFields: [...(q.targetFields ?? [])].sort(),
            targetTypes: [...(q.targetTypes ?? [])].sort(),
        });
        queryContentHashes.set(q.id, createHash('sha256').update(content).digest('hex'));
    }
    const templateSourceHash = opts.template.sourceHash ?? opts.template.id;
    const typeTemplateSourceHash = opts.typeTemplate.sourceHash ?? opts.typeTemplate.id;
    // K cutoffs are baked into each record's metrics (recall@K, hits@headlineK),
    // so they're part of the cache identity — changing them must invalidate.
    // The v2 tag invalidates every record from the single-space (mustInclude)
    // metric shape that predates the field/type two-space split.
    const metricsKey = `k:v2:${HEADLINE_K}:${REPORTED_K.join(',')}`;

    // One spec per (query × model). The cache key is keyed on the model (the
    // varied cohort) + the fixed template + schema SDL + query content; the
    // model id is included so records keep their own modelId on a hit.
    interface JobSpec {
        schemaId: string;
        modelId: string;
        query: QueryDef;
        cacheKey: string;
    }
    const allSpecs: JobSpec[] = [];
    for (const q of opts.queries) {
        for (const m of opts.models) {
            const cacheKey = computeJobCacheKey([
                'models',
                m.id,
                m.sourceHash ?? m.id,
                templateSourceHash,
                typeTemplateSourceHash,
                metricsKey,
                schemaSdlHashes.get(q.schemaId)!,
                queryContentHashes.get(q.id)!,
            ]);
            allSpecs.push({ schemaId: q.schemaId, modelId: m.id, query: q, cacheKey });
        }
    }

    // Parallel cache check — all reads at once; misses go to workers.
    const cacheResults = opts.noCache
        ? allSpecs.map(() => null)
        : await Promise.all(allSpecs.map((s) => readCached<RankRunRecord>(s.cacheKey)));

    const cachedRecords: RankRunRecord[] = [];
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

    let liveRecords: RankRunRecord[] = [];
    if (liveSpecs.length > 0) {
        const jobs: Job[] = liveSpecs.map((spec, i) => ({
            jobId: i,
            schemaId: spec.schemaId,
            modelId: spec.modelId,
            query: spec.query,
            queryEmbedding: queryEmbeddings.get(`${spec.modelId}::${spec.query.id}`)!,
        }));

        const requested = opts.concurrency ?? Math.max(1, Math.floor(os.cpus().length / 2) - 1);
        const workerCount = Math.max(1, Math.min(requested, jobs.length));
        log(`[runner] dispatching ${jobs.length} jobs across ${workerCount} workers`);

        const results = await dispatchToWorkers(
            jobs,
            opts.schemas,
            opts.models,
            opts.template,
            opts.typeTemplate,
            workerCount,
            log,
        );

        const specByJobId = new Map(liveSpecs.map((spec, i) => [i, spec]));
        liveRecords = await Promise.all(
            results.map(async (r) => {
                const spec = specByJobId.get(r.jobId)!;
                const record: RankRunRecord = {
                    schemaId: r.schemaId,
                    queryId: r.queryId,
                    category: r.category,
                    modelId: r.modelId,
                    indexedFieldCount: r.indexedFieldCount,
                    indexedTypeCount: r.indexedTypeCount,
                    metrics: r.metrics,
                    latencyMs: r.latencyMs,
                    ...(r.error !== undefined ? { error: r.error } : {}),
                };
                await writeCached(spec.cacheKey, record);
                return record;
            }),
        );
    }

    const records: RankRunRecord[] = [...cachedRecords, ...liveRecords];

    const buckets = new Map<string, RankRunRecord[]>();
    for (const r of records) {
        if (!buckets.has(r.modelId)) buckets.set(r.modelId, []);
        buckets.get(r.modelId)!.push(r);
    }
    const summary = Array.from(buckets.entries()).map(([mid, rows]) =>
        aggregateModelCohort(mid, rows, REPORTED_K),
    );

    return {
        schemaVersion: 1,
        generatedAt: opts.timestampIso,
        benchmarkType: 'models',
        fixed: { template: opts.template.id, strategy: 'pure-knn', K: HEADLINE_K },
        schemas: opts.schemas.map((s) => ({
            id: s.id,
            name: s.name,
            ...(s.description !== undefined ? { description: s.description } : {}),
        })),
        categories: opts.categories,
        models: opts.models.map((m) => ({
            id: m.id,
            name: m.name,
            description: m.description,
            provider: m.provider,
            modelName: m.modelName,
            dims: m.dims,
        })),
        reportedK: [...REPORTED_K],
        summary,
        rows: records,
    };
}

async function dispatchToWorkers(
    jobs: Job[],
    schemas: SchemaDef[],
    models: ModelDef[],
    template: TemplateDef,
    typeTemplate: TypeTemplateDef,
    workerCount: number,
    log: (msg: string) => void,
): Promise<WorkerResultMessage[]> {
    const workerUrl = new URL('./worker-entry.mjs', import.meta.url);
    const workers: Worker[] = [];
    for (let i = 0; i < workerCount; i++) {
        const w = new Worker(workerUrl);
        workers.push(w);
    }

    // Workers receive IDs, not the function-holding template object (not
    // structured-cloneable). They re-load via the shared loader.
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
                        modelIds: models.map((m) => m.id),
                        templateId: template.id,
                        typeTemplateId: typeTemplate.id,
                        reportedK: REPORTED_K,
                        headlineK: HEADLINE_K,
                    });
                }),
        ),
    );

    log(`[runner] ${workerCount} workers ready, distributing ${jobs.length} jobs`);

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
                modelId: job.modelId,
                query: job.query,
                queryEmbedding: job.queryEmbedding,
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
            dispatchNext(i);
        }
    });
}

// Keep fileURLToPath imported to mirror the strategies runner — convenient
// hook for any future logging that wants the worker script path.
void fileURLToPath;
