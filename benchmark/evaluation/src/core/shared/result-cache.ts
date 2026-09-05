/**
 * Content-addressed result cache for benchmark run records.
 *
 * Cache key = SHA256 over an ordered list of NUL-separated components that
 * fully determine a job's record — the varied cohort dimension (strategy
 * source, template source, or model), the fixed (model, template) setup, the
 * schema SDL, and the query definition. Any change to those inputs yields a
 * different key and forces a re-run. The record type is the caller's concern;
 * this layer only serializes JSON.
 *
 * Cache lives in .result-cache/ at the project root, sharded by first 2 hex
 * chars (same pattern as .embed-cache/).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const CACHE_ROOT = join(process.cwd(), '.result-cache');

/** Hash an ordered set of determinant components into a stable cache key. */
export function computeJobCacheKey(components: readonly string[]): string {
    const h = createHash('sha256');
    for (const c of components) {
        h.update(c).update('\0');
    }
    return h.digest('hex');
}

function cachePath(key: string): string {
    return join(CACHE_ROOT, key.slice(0, 2), `${key}.json`);
}

export async function readCached<T>(key: string): Promise<T | null> {
    try {
        const raw = await readFile(cachePath(key), 'utf8');
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

export async function writeCached<T>(key: string, record: T): Promise<void> {
    const p = cachePath(key);
    await mkdir(join(CACHE_ROOT, key.slice(0, 2)), { recursive: true });
    await writeFile(p, JSON.stringify(record), 'utf8');
}
