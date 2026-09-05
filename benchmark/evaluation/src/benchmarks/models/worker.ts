/**
 * Worker entry for the models benchmark. Main spawns N of these; each builds
 * one snapshot per (model × schema) under the fixed template from the
 * disk-cached embeddings, then processes jobs.
 *
 * Per job we:
 *   1. Look up the snapshot for (modelId, schemaId)
 *   2. cosineToQuery / cosineToQueryTypes → sort desc → the two reference
 *      top-K rankings (field space + type space)
 *   3. computeRankRowMetrics: per-target rank + cosine, recall@K, mean cos —
 *      computed independently for fields (targetFields) and types (targetTypes)
 *
 * No strategy code is loaded. The whole point of this benchmark is to measure
 * the embedding model in isolation from any slicing algorithm — the cosine
 * ranking IS pure-knn's top-K signal, just kept full so we can report rank
 * percentiles instead of a binary "in K or not".
 *
 * Wire protocol (parentPort messages):
 *   main → worker: { type: 'init', schemas, modelIds, templateId, typeTemplateId, reportedK, headlineK }
 *   worker → main: { type: 'ready' }
 *   main → worker: { type: 'job', jobId, schemaId, modelId, query, queryEmbedding }
 *   worker → main: { type: 'result', jobId, ..., metrics, latencyMs, error? }
 *   main → worker: { type: 'shutdown' }
 */
import { parentPort } from 'node:worker_threads';
import { buildSnapshot } from '../../core/shared/snapshot.ts';
import { loadModels, loadTemplates, loadTypeTemplates } from '../../core/shared/loader.ts';
import { computeRankRowMetrics, type RankRowMetrics } from './metrics.ts';
import type {
    ModelDef,
    QueryDef,
    SchemaDef,
    SchemaSnapshot,
    TemplateDef,
    TypeTemplateDef,
} from '../../core/types.ts';

if (!parentPort) throw new Error('worker.ts must run as a Worker');

/** Key = `${modelId}::${schemaId}`. */
const snapshotsByKey = new Map<string, SchemaSnapshot>();
let reportedK: number[] = [];
let headlineK = 50;

interface JobMessage {
    type: 'job';
    jobId: number;
    schemaId: string;
    modelId: string;
    query: QueryDef;
    queryEmbedding: Float32Array;
}

interface InitMessage {
    type: 'init';
    schemas: SchemaDef[];
    modelIds: string[];
    templateId: string;
    typeTemplateId: string;
    reportedK: number[];
    headlineK: number;
}

type InboundMessage = InitMessage | JobMessage | { type: 'shutdown' };

async function resolveSetup(
    modelIds: string[],
    templateId: string,
    typeTemplateId: string,
): Promise<{ models: ModelDef[]; template: TemplateDef; typeTemplate: TypeTemplateDef }> {
    const [allModels, allTemplates, allTypeTemplates] = await Promise.all([
        loadModels(),
        loadTemplates(),
        loadTypeTemplates(),
    ]);
    const template = allTemplates.find((t) => t.id === templateId);
    if (!template) throw new Error(`worker: unknown templateId '${templateId}'`);
    const typeTemplate = allTypeTemplates.find((t) => t.id === typeTemplateId);
    if (!typeTemplate) throw new Error(`worker: unknown typeTemplateId '${typeTemplateId}'`);
    const models: ModelDef[] = [];
    for (const mid of modelIds) {
        const m = allModels.find((x) => x.id === mid);
        if (!m) throw new Error(`worker: unknown modelId '${mid}'`);
        models.push(m);
    }
    return { models, template, typeTemplate };
}

async function handleInit(msg: InitMessage): Promise<void> {
    const { models, template, typeTemplate } = await resolveSetup(
        msg.modelIds,
        msg.templateId,
        msg.typeTemplateId,
    );
    reportedK = msg.reportedK;
    headlineK = msg.headlineK;
    // Build (model × schema) snapshots. Embeddings come from disk cache
    // (main warmed it), so this is fast.
    for (const m of models) {
        for (const s of msg.schemas) {
            const snap = await buildSnapshot({ schema: s, template, typeTemplate, model: m });
            snapshotsByKey.set(`${m.id}::${s.id}`, snap);
        }
    }
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
 * Zeroed metrics for a space, used in fallback (missing snapshot / error)
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
    const key = `${msg.modelId}::${msg.schemaId}`;
    const snap = snapshotsByKey.get(key);
    if (!snap) {
        parentPort!.postMessage({
            type: 'result',
            jobId: msg.jobId,
            schemaId: msg.schemaId,
            modelId: msg.modelId,
            queryId: msg.query.id,
            category: msg.query.category,
            indexedFieldCount: 0,
            indexedTypeCount: 0,
            metrics: {
                fields: zeroSpace(targetFields.length),
                types: zeroSpace(targetTypes.length),
            },
            latencyMs: 0,
            error: `worker missing snapshot for ${key}`,
        });
        return;
    }

    const tStart = process.hrtime.bigint();
    let errMsg: string | undefined;
    let rankedFields: Array<{ coord: string; cos: number }> = [];
    let rankedTypes: Array<{ coord: string; cos: number }> = [];
    try {
        rankedFields = rankCosines(snap.cosineToQuery(msg.queryEmbedding));
        rankedTypes = rankCosines(snap.cosineToQueryTypes(msg.queryEmbedding));
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
        modelId: msg.modelId,
        queryId: msg.query.id,
        category: msg.query.category,
        indexedFieldCount: rankedFields.length,
        indexedTypeCount: rankedTypes.length,
        metrics,
        latencyMs,
        ...(errMsg !== undefined ? { error: errMsg } : {}),
    });
}

parentPort.on('message', async (msg: InboundMessage) => {
    if (msg.type === 'init') {
        try {
            await handleInit(msg);
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
