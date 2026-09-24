/**
 * Cache pruning for the agent benchmark (`--prune-cache`).
 *
 * The cache is the ledger: a board cell appears iff its current-determinant key has a
 * file on disk. Records computed under STALE logic get a different key, so they are
 * already invisible to the board — they just sit on disk forever. This prune removes
 * those orphans deterministically: for every agent record, recompute the cacheKey its
 * identity WOULD have under the CURRENT determinants; if it differs from the file's own
 * key (the basename), or any of the record's defs no longer loads, the file is an orphan
 * the current config would never read → delete it.
 *
 * NEVER deletes non-agent records (those without a `chatModelId`) and never deletes a
 * file whose key matches what the current config would compute. Off by default.
 */
import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { computeCellCacheKey, type CacheKeyDeterminants } from './determinants.ts';
import type { AgentModelDef, AgentPromptDef, QueryDef, StrategyDef } from '../../core/types.ts';

/** The result-cache root — matches result-cache.ts (`join(cwd, '.result-cache')`). */
const CACHE_ROOT = join(process.cwd(), '.result-cache');

export interface PruneStats {
    scanned: number; // agent records inspected
    deleted: number; // orphaned agent records removed
    bytesFreed: number; // total size of removed files
}

export interface PruneInput {
    determinants: CacheKeyDeterminants;
    models: AgentModelDef[];
    strategies: StrategyDef[];
    prompts: AgentPromptDef[];
    queries: QueryDef[];
}

/** The identity fields an agent record carries (subset; only what we re-key on). */
interface AgentRecordIdentity {
    chatModelId?: unknown;
    strategyId?: unknown;
    promptId?: unknown;
    schemaId?: unknown;
    queryId?: unknown;
    sampleIndex?: unknown;
}

/**
 * Walk `.result-cache/**\/*.json`, delete orphaned agent records, and return stats.
 * Non-agent records (no `chatModelId`) are skipped entirely.
 */
export async function pruneOrphanedAgentCache(input: PruneInput): Promise<PruneStats> {
    const modelById = new Map(input.models.map((m) => [m.id, m]));
    const strategyById = new Map(input.strategies.map((s) => [s.id, s]));
    const promptById = new Map(input.prompts.map((p) => [p.id, p]));
    const queryById = new Map(input.queries.map((q) => [q.id, q]));

    const stats: PruneStats = { scanned: 0, deleted: 0, bytesFreed: 0 };

    let shards: string[];
    try {
        shards = await readdir(CACHE_ROOT);
    } catch {
        return stats; // no cache dir → nothing to prune
    }

    for (const shard of shards) {
        const shardDir = join(CACHE_ROOT, shard);
        let files: string[];
        try {
            files = await readdir(shardDir);
        } catch {
            continue; // not a directory / vanished
        }
        for (const file of files) {
            if (!file.endsWith('.json')) continue;
            const fullPath = join(shardDir, file);
            let rec: AgentRecordIdentity;
            try {
                rec = JSON.parse(await readFile(fullPath, 'utf8')) as AgentRecordIdentity;
            } catch {
                continue; // unreadable / non-JSON → leave it alone
            }
            // Detect agent records by the presence of `chatModelId`. Anything else
            // (strategy/template/model benchmark records) is never touched.
            if (typeof rec.chatModelId !== 'string') continue;
            stats.scanned++;

            const fileKey = file.slice(0, -'.json'.length);
            const expected = expectedKey(rec, input.determinants, {
                modelById,
                strategyById,
                promptById,
                queryById,
            });
            // Orphan iff a def no longer loads (expected === null) or the recomputed
            // current key differs from the file's own key.
            if (expected !== null && expected === fileKey) continue;

            let size = 0;
            try {
                size = (await stat(fullPath)).size;
            } catch {
                /* best-effort */
            }
            try {
                await unlink(fullPath);
                stats.deleted++;
                stats.bytesFreed += size;
            } catch {
                // Could not delete (perms / race) — leave the stat counts honest.
            }
        }
    }
    return stats;
}

/** Recompute the cacheKey an agent record's identity WOULD have under the current
 *  determinants, or `null` if any of its defs no longer loads (⇒ orphan). */
function expectedKey(
    rec: AgentRecordIdentity,
    determinants: CacheKeyDeterminants,
    defs: {
        modelById: Map<string, AgentModelDef>;
        strategyById: Map<string, StrategyDef>;
        promptById: Map<string, AgentPromptDef>;
        queryById: Map<string, QueryDef>;
    },
): string | null {
    if (
        typeof rec.chatModelId !== 'string' ||
        typeof rec.strategyId !== 'string' ||
        typeof rec.promptId !== 'string' ||
        typeof rec.queryId !== 'string' ||
        typeof rec.sampleIndex !== 'number'
    ) {
        return null;
    }
    const agentModel = defs.modelById.get(rec.chatModelId);
    const strategy = defs.strategyById.get(rec.strategyId);
    const prompt = defs.promptById.get(rec.promptId);
    const query = defs.queryById.get(rec.queryId);
    if (!agentModel || !strategy || !prompt || !query) return null;
    // The query content + schema SDL hashes must be present in the determinants for a
    // current key to exist; if not (query/schema not in the loaded set), it's an orphan.
    if (!determinants.queryContentHashes.has(query.id)) return null;
    if (!determinants.schemaSdlHashes.has(query.schemaId)) return null;
    return computeCellCacheKey(
        { agentModel, strategy, prompt, query, sampleIndex: rec.sampleIndex },
        determinants,
    );
}
