/**
 * Templates benchmark runner. Cohorts = templates. The model + slicing
 * approach are held fixed: each cohort uses the configured model and runs the
 * pure-knn-K reference ranking inline. We deliberately do NOT load any
 * strategy code here — the metric is "where does the embedding text put the
 * right fields in cosine order?", which is upstream of any slicing strategy.
 *
 * For each (template × query):
 *   1. main thread embeds the query under (model, template) — cache friendly
 *   2. worker thread loads its snapshot built under (model, template), sorts
 *      every field coord by cosine to the query embedding, takes the top K
 *      (reference), and reports the rank + cosine of every mustInclude coord
 *   3. main aggregates per cohort into rank percentiles + recall@K
 */
import { createHash } from 'node:crypto';
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { buildSnapshot } from '../../core/shared/snapshot.ts';
import {
    packAxis,
    type SharedAxis,
    type SharedSnapshotEntry,
} from '../../core/shared/shared-snapshot.ts';
import { embedTexts } from '../../core/shared/embeddings.ts';
import { mapWithConcurrency } from '../../core/shared/concurrency.ts';
import { computeJobCacheKey, readCached, writeCached } from '../../core/shared/result-cache.ts';
import {
    aggregateTemplateCohort,
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
    templates: TemplateDef[];
    queries: QueryDef[];
    /** Fixed embedding model — varied axis is template. */
    model: ModelDef;
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
    templateId: string;
    query: QueryDef;
    queryEmbedding: Float32Array;
}

interface WorkerResultMessage {
    type: 'result';
    jobId: number;
    schemaId: string;
    templateId: string;
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

    // The (template × schema) snapshot grid is built + packed into shared
    // memory lazily, only when there are live (cache-miss) jobs — see
    // buildSharedGrid below. Embeddings are still warmed via the disk cache by
    // that build; on a full result-cache hit we skip it entirely.

    // Embed every query once per template (cache writes happen here, workers
    // reuse). Batched per template — embedTexts chunks the provider calls —
    // and run bounded-parallel across templates. Keyed `${templateId}::${queryId}`.
    const queryTexts = opts.queries.map((q) => q.query);
    const queryEmbeddings = new Map<string, Float32Array>();
    await mapWithConcurrency(opts.templates, WARM_CONCURRENCY, async (tmpl) => {
        const vecs = await embedTexts(opts.model, tmpl, queryTexts, 'query');
        opts.queries.forEach((q, i) => queryEmbeddings.set(`${tmpl.id}::${q.id}`, vecs[i]!));
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
    const modelSourceHash = opts.model.sourceHash ?? opts.model.id;
    const typeTemplateSourceHash = opts.typeTemplate.sourceHash ?? opts.typeTemplate.id;
    // K cutoffs are baked into each record's metrics (recall@K, hits@headlineK),
    // so they're part of the cache identity — changing them must invalidate.
    // The v2 tag invalidates every record from the single-space (mustInclude)
    // metric shape that predates the field/type two-space split.
    const metricsKey = `k:v2:${HEADLINE_K}:${REPORTED_K.join(',')}`;

    // One spec per (query × template). The cache key is keyed on the template
    // (the varied cohort) + the fixed model + schema SDL + query content; the
    // template id is included so records keep their own templateId on a hit.
    interface JobSpec {
        schemaId: string;
        templateId: string;
        query: QueryDef;
        cacheKey: string;
    }
    const allSpecs: JobSpec[] = [];
    for (const q of opts.queries) {
        for (const tmpl of opts.templates) {
            const cacheKey = computeJobCacheKey([
                'templates',
                tmpl.id,
                modelSourceHash,
                tmpl.sourceHash ?? tmpl.id,
                typeTemplateSourceHash,
                metricsKey,
                schemaSdlHashes.get(q.schemaId)!,
                queryContentHashes.get(q.id)!,
            ]);
            allSpecs.push({ schemaId: q.schemaId, templateId: tmpl.id, query: q, cacheKey });
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
            templateId: spec.templateId,
            query: spec.query,
            queryEmbedding: queryEmbeddings.get(`${spec.templateId}::${spec.query.id}`)!,
        }));

        const requested = opts.concurrency ?? Math.max(1, Math.floor(os.cpus().length / 2) - 1);
        const workerCount = Math.max(1, Math.min(requested, jobs.length));
        log(`[runner] dispatching ${jobs.length} jobs across ${workerCount} workers`);

        // Build the grid once on main and pack it into SharedArrayBuffers so all
        // workers share one copy of the vectors instead of each rebuilding it.
        const sharedEntries = await buildSharedGrid(opts, log);
        const results = await dispatchToWorkers(jobs, sharedEntries, workerCount, log);

        const specByJobId = new Map(liveSpecs.map((spec, i) => [i, spec]));
        liveRecords = await Promise.all(
            results.map(async (r) => {
                const spec = specByJobId.get(r.jobId)!;
                const record: RankRunRecord = {
                    schemaId: r.schemaId,
                    queryId: r.queryId,
                    category: r.category,
                    templateId: r.templateId,
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
        if (!buckets.has(r.templateId)) buckets.set(r.templateId, []);
        buckets.get(r.templateId)!.push(r);
    }
    const summary = Array.from(buckets.entries()).map(([tid, rows]) =>
        aggregateTemplateCohort(tid, rows, REPORTED_K),
    );

    return {
        schemaVersion: 1,
        generatedAt: opts.timestampIso,
        benchmarkType: 'templates',
        fixed: { model: opts.model.id, strategy: 'pure-knn', K: HEADLINE_K },
        schemas: opts.schemas.map((s) => ({
            id: s.id,
            name: s.name,
            ...(s.description !== undefined ? { description: s.description } : {}),
        })),
        categories: opts.categories,
        templates: opts.templates.map((t) => ({
            id: t.id,
            name: t.name,
            description: t.description,
        })),
        reportedK: [...REPORTED_K],
        summary,
        rows: records,
    };
}

/**
 * Build every (schema × template) snapshot ONCE on the main thread and pack its
 * field + type vectors into SharedArrayBuffer matrices. Posting these to workers
 * shares one copy of the (large) vector data across the whole pool instead of
 * each worker rebuilding its own. The type axis is fixed (typeTemplate is
 * constant in this benchmark), so it is packed once per schema and referenced by
 * every template entry for that schema.
 */
async function buildSharedGrid(
    opts: RunOptions,
    log: (msg: string) => void,
): Promise<SharedSnapshotEntry[]> {
    const dims = opts.model.dims;
    const typeAxisBySchema = new Map<string, SharedAxis>();
    const fieldAxisByKey = new Map<string, SharedAxis>();
    const ownerTemplate = opts.templates[0]!;

    // Pass 1: one build per schema under the owner template — packs that schema's
    // shared (fixed) type axis plus the owner template's field axis.
    await mapWithConcurrency(opts.schemas, WARM_CONCURRENCY, async (s) => {
        log(`[snapshot:main] packing ${s.id} (type axis + ${ownerTemplate.id})`);
        const snap = await buildSnapshot({
            schema: s,
            template: ownerTemplate,
            typeTemplate: opts.typeTemplate,
            model: opts.model,
        });
        typeAxisBySchema.set(s.id, packAxis([...snap.types], snap.typeEmbeddings, dims));
        fieldAxisByKey.set(
            `${s.id}::${ownerTemplate.id}`,
            packAxis(
                snap.fields.map((f) => f.coord),
                snap.fieldEmbeddings,
                dims,
            ),
        );
    });

    // Pass 2: remaining (schema × template) field axes (type axis is shared).
    const fieldPairs = opts.templates
        .slice(1)
        .flatMap((tmpl) => opts.schemas.map((s) => ({ tmpl, s })));
    await mapWithConcurrency(fieldPairs, WARM_CONCURRENCY, async ({ tmpl, s }) => {
        log(`[snapshot:main] packing ${s.id} under template=${tmpl.id}`);
        const snap = await buildSnapshot({
            schema: s,
            template: tmpl,
            typeTemplate: opts.typeTemplate,
            model: opts.model,
        });
        fieldAxisByKey.set(
            `${s.id}::${tmpl.id}`,
            packAxis(
                snap.fields.map((f) => f.coord),
                snap.fieldEmbeddings,
                dims,
            ),
        );
    });

    const entries: SharedSnapshotEntry[] = [];
    for (const s of opts.schemas) {
        for (const tmpl of opts.templates) {
            entries.push({
                key: `${s.id}::${tmpl.id}`,
                schemaId: s.id,
                fieldAxis: fieldAxisByKey.get(`${s.id}::${tmpl.id}`)!,
                typeAxis: typeAxisBySchema.get(s.id)!,
            });
        }
    }
    return entries;
}

async function dispatchToWorkers(
    jobs: Job[],
    entries: SharedSnapshotEntry[],
    workerCount: number,
    log: (msg: string) => void,
): Promise<WorkerResultMessage[]> {
    const workerUrl = new URL('./worker-entry.mjs', import.meta.url);
    const workers: Worker[] = [];
    for (let i = 0; i < workerCount; i++) {
        const w = new Worker(workerUrl);
        workers.push(w);
    }

    // The entries carry SharedArrayBuffer-backed matrices: posting them shares
    // the underlying vector memory with every worker rather than copying it.
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
                        entries,
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
                templateId: job.templateId,
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
