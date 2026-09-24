/**
 * Worker entry for the type-templates benchmark. Main packs every (schema ×
 * typeTemplate) snapshot's field + type vectors into SharedArrayBuffer matrices
 * ONCE and posts them in `init`; because worker_threads share one address
 * space, all workers read the SAME shared vector memory — no per-worker rebuild,
 * one copy of the vectors total. The field axis is fixed (the field template is
 * constant across cohorts), so it is packed once per schema and shared by every
 * type-template entry for that schema.
 *
 * Per job we:
 *   1. Look up the shared entry for (schemaId, typeTemplateId)
 *   2. cosineOverAxis(fieldAxis / typeAxis) → sort desc → the two reference
 *      top-K rankings (field space + type space)
 *   3. computeRankRowMetrics: per-target rank + cosine, recall@K, mean cos —
 *      computed independently for fields (targetFields) and types (targetTypes).
 *      The TYPE space is this cohort's headline; the field space is context
 *      (the field template is fixed across cohorts).
 *
 * No strategy code and no snapshot building happen here. The whole point of
 * this benchmark is to measure the TYPE embedding text in isolation from any
 * slicing algorithm.
 *
 * Wire protocol (parentPort messages):
 *   main → worker: { type: 'init', entries, reportedK, headlineK }
 *   worker → main: { type: 'ready' }
 *   main → worker: { type: 'job', jobId, schemaId, typeTemplateId, query, queryEmbedding }
 *   worker → main: { type: 'result', jobId, ..., metrics, latencyMs, error? }
 *   main → worker: { type: 'shutdown' }
 */
import { parentPort } from 'node:worker_threads';
import { cosineOverAxis, type SharedSnapshotEntry } from '../../core/shared/shared-snapshot.ts';
import { computeRankRowMetrics, type RankRowMetrics } from './metrics.ts';
import type { QueryDef } from '../../core/types.ts';

if (!parentPort) throw new Error('worker.ts must run as a Worker');

/** Key = `${schemaId}::${typeTemplateId}`. */
const entriesByKey = new Map<string, SharedSnapshotEntry>();
let reportedK: number[] = [];
let headlineK = 50;

interface JobMessage {
    type: 'job';
    jobId: number;
    schemaId: string;
    typeTemplateId: string;
    query: QueryDef;
    queryEmbedding: Float32Array;
}

interface InitMessage {
    type: 'init';
    entries: SharedSnapshotEntry[];
    reportedK: number[];
    headlineK: number;
}

type InboundMessage = InitMessage | JobMessage | { type: 'shutdown' };

function handleInit(msg: InitMessage): void {
    reportedK = msg.reportedK;
    headlineK = msg.headlineK;
    for (const e of msg.entries) entriesByKey.set(e.key, e);
    parentPort!.postMessage({ type: 'ready' });
}

/** Sort cosine entries into a descending ranking with a deterministic tie-break. */
function rankCosines(cos: Map<string, number>): Array<{ coord: string; cos: number }> {
    const ranked = Array.from(cos.entries()).map(([coord, c]) => ({ coord, cos: c }));
    // Deterministic tie-break: cosine desc, then coord asc.
    ranked.sort((a, b) => {
        if (b.cos !== a.cos) return b.cos - a.cos;
        return a.coord.localeCompare(b.coord);
    });
    return ranked;
}

/**
 * Zeroed metrics for a space, used in fallback (missing entry / error)
 * paths. Mirrors computeSpaceMetrics' empty-set convention: an empty relevant
 * set is vacuously fully recalled (recall@K = 1), otherwise 0.
 */
function zeroSpace(total: number): RankRowMetrics['fields'] {
    const recall = total === 0 ? 1 : 0;
    return {
        total,
        hits: 0,
        perRank: [],
        recallAtK: Object.fromEntries(reportedK.map((K) => [K, recall])),
        meanCosine: 0,
    };
}

function handleJob(msg: JobMessage): void {
    const targetFields = msg.query.targetFields ?? [];
    const targetTypes = msg.query.targetTypes ?? [];
    const key = `${msg.schemaId}::${msg.typeTemplateId}`;
    const entry = entriesByKey.get(key);
    if (!entry) {
        parentPort!.postMessage({
            type: 'result',
            jobId: msg.jobId,
            schemaId: msg.schemaId,
            typeTemplateId: msg.typeTemplateId,
            queryId: msg.query.id,
            category: msg.query.category,
            indexedFieldCount: 0,
            indexedTypeCount: 0,
            metrics: {
                fields: zeroSpace(targetFields.length),
                types: zeroSpace(targetTypes.length),
            },
            latencyMs: 0,
            error: `worker missing shared entry for ${key}`,
        });
        return;
    }

    const tStart = process.hrtime.bigint();
    let errMsg: string | undefined;
    let rankedFields: Array<{ coord: string; cos: number }> = [];
    let rankedTypes: Array<{ coord: string; cos: number }> = [];
    try {
        rankedFields = rankCosines(cosineOverAxis(entry.fieldAxis, msg.queryEmbedding));
        rankedTypes = rankCosines(cosineOverAxis(entry.typeAxis, msg.queryEmbedding));
    } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e);
    }

    const metrics = errMsg
        ? { fields: zeroSpace(targetFields.length), types: zeroSpace(targetTypes.length) }
        : computeRankRowMetrics({
              rankedFields,
              rankedTypes,
              targetFields,
              targetTypes,
              reportedK,
              headlineK,
          });
    const latencyMs = Number(process.hrtime.bigint() - tStart) / 1_000_000;

    parentPort!.postMessage({
        type: 'result',
        jobId: msg.jobId,
        schemaId: msg.schemaId,
        typeTemplateId: msg.typeTemplateId,
        queryId: msg.query.id,
        category: msg.query.category,
        indexedFieldCount: rankedFields.length,
        indexedTypeCount: rankedTypes.length,
        metrics,
        latencyMs,
        ...(errMsg !== undefined ? { error: errMsg } : {}),
    });
}

parentPort.on('message', (msg: InboundMessage) => {
    if (msg.type === 'init') {
        try {
            handleInit(msg);
        } catch (e) {
            parentPort!.postMessage({
                type: 'init-error',
                error: e instanceof Error ? e.message : String(e),
            });
        }
    } else if (msg.type === 'job') {
        handleJob(msg);
    } else if (msg.type === 'shutdown') {
        process.exit(0);
    }
});
