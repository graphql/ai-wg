/**
 * Multi-model embedding client with content-addressed disk cache.
 *
 * Cache layout: .embed-cache/<modelId>/<templateId>/<sha[0:2]>/<sha>.f32
 *   - modelId keeps different models in different namespaces
 *   - templateId keeps the same text-under-a-different-template from colliding
 *     once we start varying templates in Phase 2
 *
 * Strategies do NOT call this directly — embeddings are pre-computed during
 * snapshot build and exposed as Float32Array on the snapshot.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ModelDef } from '../types.ts';

/**
 * The cache only needs an `id` to namespace texts under their renderer. Both
 * TemplateDef (field) and TypeTemplateDef (type) satisfy this — callers pass a
 * structurally-namespaced id (e.g. `type-templates/<id>`) to keep the field and
 * type axes from colliding on identical text.
 */
type CacheNamespace = { id: string };

function cacheKey(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

function cachePath(model: ModelDef, template: CacheNamespace, key: string): string {
    // Shard by first 2 hex chars so directories stay small.
    return join(
        process.cwd(),
        '.embed-cache',
        model.id,
        template.id,
        key.slice(0, 2),
        `${key}.f32`,
    );
}

async function readCache(
    model: ModelDef,
    template: CacheNamespace,
    key: string,
): Promise<Float32Array | null> {
    const p = cachePath(model, template, key);
    if (!existsSync(p)) return null;
    const buf = await readFile(p);
    // A 0-byte or non-4-aligned file is corrupt (e.g. a write interrupted by a
    // killed process). Treat it as a miss so it is recomputed rather than served
    // as a length-0 / truncated vector that silently poisons every downstream
    // cosine.
    if (buf.byteLength === 0 || buf.byteLength % 4 !== 0) return null;
    return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// Per-process counter so concurrent writes of distinct keys never collide on a
// temp path (same-key writes are content-identical, so a collision there is
// harmless anyway).
let tmpCounter = 0;

async function writeCache(
    model: ModelDef,
    template: CacheNamespace,
    key: string,
    vec: Float32Array,
): Promise<void> {
    const p = cachePath(model, template, key);
    await mkdir(dirname(p), { recursive: true });
    // Write to a temp file then rename — rename is atomic on a single
    // filesystem, so an interrupted write can never leave a partial/0-byte
    // .f32 at the real path.
    const tmp = `${p}.${process.pid}.${tmpCounter++}.tmp`;
    await writeFile(tmp, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength));
    await rename(tmp, p);
}

// ─── Provider abstraction ────────────────────────────────────────────────

interface OpenAIClient {
    embeddings: {
        create: (req: {
            model: string;
            input: string[];
        }) => Promise<{ data: { embedding: number[] }[] }>;
    };
}

let openaiClient: OpenAIClient | null = null;

async function getOpenAIClient(): Promise<OpenAIClient> {
    if (openaiClient) return openaiClient;
    const apiKey = process.env['OPENAI_API_KEY'];
    if (!apiKey) {
        throw new Error('OPENAI_API_KEY is required to compute new embeddings.');
    }
    const { default: OpenAI } = await import('openai');
    openaiClient = new OpenAI({ apiKey }) as unknown as OpenAIClient;
    return openaiClient;
}

const BATCH_SIZE = 64;

async function callProvider(model: ModelDef, texts: readonly string[]): Promise<Float32Array[]> {
    if (model.provider === 'openai') {
        const client = await getOpenAIClient();
        const res = await client.embeddings.create({
            model: model.modelName,
            input: texts as string[],
        });
        if (res.data.length !== texts.length) {
            throw new Error(
                `OpenAI returned ${res.data.length} embeddings for ${texts.length} inputs`,
            );
        }
        return res.data.map((d) => {
            const vec = new Float32Array(d.embedding);
            if (vec.length !== model.dims) {
                throw new Error(
                    `Unexpected embedding length ${vec.length} (expected ${model.dims}) for model ${model.id}`,
                );
            }
            return vec;
        });
    }
    // Stubs for future providers — explicit throw so we notice if a model
    // entry references a provider that isn't wired up yet.
    throw new Error(
        `Unknown embedding provider '${String((model as ModelDef).provider)}' for model '${model.id}'`,
    );
}

/**
 * Embed N texts under (model, template), returning vectors aligned with input
 * order. Cache hits skip the API. Misses are batched per provider call.
 */
export async function embedTexts(
    model: ModelDef,
    template: CacheNamespace,
    texts: readonly string[],
): Promise<Float32Array[]> {
    const out: (Float32Array | null)[] = new Array(texts.length).fill(null);
    const missIdxs: number[] = [];
    const missKeys: string[] = [];

    // First pass: try cache.
    for (let i = 0; i < texts.length; i++) {
        const key = cacheKey(texts[i]!);
        const cached = await readCache(model, template, key);
        if (cached) {
            out[i] = cached;
        } else {
            missIdxs.push(i);
            missKeys.push(key);
        }
    }

    // Batch the misses.
    for (let start = 0; start < missIdxs.length; start += BATCH_SIZE) {
        const sliceIdxs = missIdxs.slice(start, start + BATCH_SIZE);
        const sliceKeys = missKeys.slice(start, start + BATCH_SIZE);
        const sliceTexts = sliceIdxs.map((i) => texts[i]!);
        const vecs = await callProvider(model, sliceTexts);
        for (let j = 0; j < sliceTexts.length; j++) {
            out[sliceIdxs[j]!] = vecs[j]!;
            await writeCache(model, template, sliceKeys[j]!, vecs[j]!);
        }
    }

    return out as Float32Array[];
}

export async function embedOne(
    model: ModelDef,
    template: CacheNamespace,
    text: string,
): Promise<Float32Array> {
    const [v] = await embedTexts(model, template, [text]);
    return v!;
}
