/**
 * Worker entry point for the strategies benchmark. The main thread spawns N
 * of these; each builds its own snapshots from the disk-cached embeddings,
 * loads all strategies, then processes jobs the main thread feeds it via
 * parentPort messages.
 *
 * Wire protocol (parentPort messages):
 *   main → worker: { type: 'init', schemas, modelId, templateId, typeTemplateId }
 *   worker → main: { type: 'ready' }
 *   main → worker: { type: 'job', jobId, schemaId, strategyId, query, queryEmbedding }
 *   worker → main: { type: 'result', jobId, selectedCoords, slicedSdl, metrics, latencyMs, error? }
 *   main → worker: { type: 'shutdown' }
 */
import { parentPort } from 'node:worker_threads';
import { buildSnapshot } from '../../core/shared/snapshot.ts';
import {
    loadModels,
    loadStrategies,
    loadTemplates,
    loadTypeTemplates,
} from '../../core/shared/loader.ts';
import { buildSlice, DEFAULT_SLICE_FLOOR } from '../../core/shared/slice.ts';
import { computeRowMetrics } from './metrics.ts';
import type {
    ModelDef,
    QueryDef,
    SchemaDef,
    SchemaSnapshot,
    StrategyDef,
    StrategyResult,
    TemplateDef,
    TypeTemplateDef,
} from '../../core/types.ts';

if (!parentPort) throw new Error('worker.ts must run as a Worker');

/** Canonical render: prune optional args / input fields / enum values by cosine
 *  relevance at SLICE_FLOOR. On by default; disable with COMPACT_SLICE=0. */
const COMPACT_SLICE = process.env['COMPACT_SLICE'] !== '0';
/** Sweepable compaction floor (args/inputs/enums). Defaults to DEFAULT_SLICE_FLOOR. */
const SLICE_FLOOR = Number.isFinite(Number(process.env['SLICE_FLOOR']))
    ? Number(process.env['SLICE_FLOOR'])
    : DEFAULT_SLICE_FLOOR;

const snapshotsById = new Map<string, SchemaSnapshot>();
const strategiesById = new Map<string, StrategyDef>();

interface JobMessage {
    type: 'job';
    jobId: number;
    schemaId: string;
    strategyId: string;
    query: QueryDef;
    queryEmbedding: Float32Array;
    queryEmbeddings: Float32Array[];
    config: Record<string, unknown>;
}

interface InitMessage {
    type: 'init';
    schemas: SchemaDef[];
    modelId: string;
    templateId: string;
    typeTemplateId: string;
}

type InboundMessage = InitMessage | JobMessage | { type: 'shutdown' };

async function resolveSetup(
    modelId: string,
    templateId: string,
    typeTemplateId: string,
): Promise<{ model: ModelDef; template: TemplateDef; typeTemplate: TypeTemplateDef }> {
    const [models, templates, typeTemplates] = await Promise.all([
        loadModels(),
        loadTemplates(),
        loadTypeTemplates(),
    ]);
    const model = models.find((m) => m.id === modelId);
    if (!model) throw new Error(`worker: unknown modelId '${modelId}'`);
    const template = templates.find((t) => t.id === templateId);
    if (!template) throw new Error(`worker: unknown templateId '${templateId}'`);
    const typeTemplate = typeTemplates.find((t) => t.id === typeTemplateId);
    if (!typeTemplate) throw new Error(`worker: unknown typeTemplateId '${typeTemplateId}'`);
    return { model, template, typeTemplate };
}

async function handleInit(msg: InitMessage): Promise<void> {
    const { model, template, typeTemplate } = await resolveSetup(
        msg.modelId,
        msg.templateId,
        msg.typeTemplateId,
    );
    // Build snapshots — embeddings come from disk cache, so this is fast.
    for (const s of msg.schemas) {
        snapshotsById.set(s.id, await buildSnapshot({ schema: s, template, typeTemplate, model }));
    }
    // Load all strategies — each worker holds its own copy of the strategy
    // modules (cheap, JS function objects, no per-job re-import).
    for (const strat of await loadStrategies()) {
        strategiesById.set(strat.id, strat);
    }
    parentPort!.postMessage({ type: 'ready' });
}

function handleJob(msg: JobMessage): void {
    const snap = snapshotsById.get(msg.schemaId);
    const strat = strategiesById.get(msg.strategyId);
    if (!snap || !strat) {
        parentPort!.postMessage({
            type: 'result',
            jobId: msg.jobId,
            error: `worker missing ${!snap ? 'snapshot ' + msg.schemaId : 'strategy ' + msg.strategyId}`,
        });
        return;
    }
    const tStart = process.hrtime.bigint();
    let selectedCoords: string[] = [];
    let selectedMembers: string[] | undefined;
    let errMsg: string | undefined;
    try {
        const res = strat.run({
            snapshot: snap,
            query: { ...msg.query, embedding: msg.queryEmbedding, embeddings: msg.queryEmbeddings },
            config: msg.config,
        });
        const synced = res instanceof Promise ? null : res;
        if (synced) {
            selectedCoords = Array.from(new Set(synced.selectedCoords));
            selectedMembers = synced.selectedMembers;
        } else {
            // Strategy returned a promise — execute async and post when done.
            (res as Promise<StrategyResult>)
                .then((r) => {
                    const coords = Array.from(new Set(r.selectedCoords));
                    postResult(msg, coords, undefined, tStart, r.selectedMembers);
                })
                .catch((e: unknown) => {
                    postResult(msg, [], e instanceof Error ? e.message : String(e), tStart);
                });
            return;
        }
    } catch (e) {
        errMsg = e instanceof Error ? e.message : String(e);
    }
    postResult(msg, selectedCoords, errMsg, tStart, selectedMembers);
}

function postResult(
    msg: JobMessage,
    selectedCoords: string[],
    errMsg: string | undefined,
    tStart: bigint,
    selectedMembers?: string[],
): void {
    const latencyMs = Number(process.hrtime.bigint() - tStart) / 1_000_000;
    const snap = snapshotsById.get(msg.schemaId)!;
    // Render priority: explicit selectedMembers (the strategy chose exactly which
    // args/input-fields/enum values to show) > COMPACT_SLICE (relevance-pruned) >
    // full render (byte-identical to before).
    let slicedSdl = '';
    if (!errMsg) {
        if (selectedMembers !== undefined) {
            slicedSdl = buildSlice(snap.schema.sdl, selectedCoords, {
                keptMembers: new Set(selectedMembers),
            });
        } else if (COMPACT_SLICE) {
            // Max element-relevance across all sub-queries (= single map when there's
            // one), so a filter/enum needed by ANY sub-request survives compaction.
            const relMaps = msg.queryEmbeddings.map((e) => snap.cosineToQueryElements(e));
            const rel = (key: string): number => {
                let mx = -1;
                for (const m of relMaps) {
                    const v = m.get(key);
                    if (v !== undefined && v > mx) mx = v;
                }
                return mx;
            };
            slicedSdl = buildSlice(snap.schema.sdl, selectedCoords, {
                relevance: rel,
                argFloor: SLICE_FLOOR,
                inputFloor: SLICE_FLOOR,
                enumFloor: SLICE_FLOOR,
            });
        } else {
            slicedSdl = buildSlice(snap.schema.sdl, selectedCoords);
        }
    }
    const metrics = computeRowMetrics({ selectedCoords, slicedSdl, query: msg.query });
    parentPort!.postMessage({
        type: 'result',
        jobId: msg.jobId,
        schemaId: msg.schemaId,
        strategyId: msg.strategyId,
        queryId: msg.query.id,
        category: msg.query.category,
        selectedCoords,
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
