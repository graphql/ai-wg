/**
 * Cross-worker snapshot vectors backed by SharedArrayBuffer.
 *
 * The templates and type-templates benchmarks build a grid of (schema ×
 * template) snapshots and score each against many query vectors. Previously
 * every worker thread rebuilt the WHOLE grid from the disk cache, so the
 * embedding vectors — by far the largest thing in memory — were held once *per
 * worker*. This module packs each axis's vectors into SharedArrayBuffer
 * matrices ONCE on the main thread; because worker_threads share one process
 * address space, posting these to the workers shares the same underlying memory
 * across the whole pool, so the vector data exists exactly once regardless of
 * worker count. Only the small per-axis coord lists are copied per worker.
 *
 * Layout per axis: a row-major Float32 matrix (row i = the vector for
 * coords[i]) plus a parallel norms array (precomputed L2 norm per row). Cosine
 * to a query is dot(row_i, q) / (norm_i * |q|) — identical arithmetic, in the
 * same summation order, as SchemaSnapshot.cosineToQuery / cosineToQueryTypes,
 * so rankings are byte-for-byte the same as the per-worker build path.
 */

/** One embedding axis (fields or types) packed into shared memory. */
export interface SharedAxis {
    /** Coordinate per row; coords[i] labels matrix row i and keys the cosine output. */
    coords: string[];
    /** Embedding dimensionality (matrix row stride). */
    dims: number;
    /** SharedArrayBuffer-backed row-major matrix, length coords.length * dims. */
    matrix: Float32Array;
    /**
     * SharedArrayBuffer-backed per-row L2 norms, length coords.length. Float64
     * (not Float32) so it matches SchemaSnapshot's Map<string, number> norms
     * bit-for-bit — a Float32 norm rounds at ~1e-8 and silently reorders
     * near-tied cosine ranks.
     */
    norms: Float64Array;
}

/** A (schema × template) grid cell: the two axes a worker scores against. */
export interface SharedSnapshotEntry {
    /** Lookup key, e.g. `${schemaId}::${templateId}`. */
    key: string;
    schemaId: string;
    fieldAxis: SharedAxis;
    typeAxis: SharedAxis;
}

function l2(v: Float32Array): number {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i]! * v[i]!;
    return Math.sqrt(s);
}

/**
 * Pack the vectors for `coords` (in the given order) into a SharedArrayBuffer
 * matrix + precomputed norms. The vectors are copied into shared memory here;
 * the source map can be released afterwards. Throws on a missing or
 * wrong-dimensioned vector so a packing bug surfaces immediately.
 */
export function packAxis(
    coords: string[],
    vecByCoord: ReadonlyMap<string, Float32Array>,
    dims: number,
): SharedAxis {
    const n = coords.length;
    const matrix = new Float32Array(new SharedArrayBuffer(n * dims * 4));
    const norms = new Float64Array(new SharedArrayBuffer(n * 8));
    for (let i = 0; i < n; i++) {
        const v = vecByCoord.get(coords[i]!);
        if (!v) throw new Error(`packAxis: no vector for '${coords[i]}'`);
        if (v.length !== dims) {
            throw new Error(
                `packAxis: vector for '${coords[i]}' has length ${v.length}, expected ${dims}`,
            );
        }
        matrix.set(v, i * dims);
        norms[i] = l2(v);
    }
    return { coords, dims, matrix, norms };
}

/**
 * Cosine similarity from `query` to every row of `axis`, keyed by coord.
 * Mirrors SchemaSnapshot.cosineToQuery exactly (same guards, same dot/norm
 * summation order), but reads rows from the shared matrix.
 */
export function cosineOverAxis(axis: SharedAxis, query: Float32Array): Map<string, number> {
    const { coords, dims, matrix, norms } = axis;
    if (coords.length > 0 && query.length !== dims) {
        throw new Error(`cosineOverAxis: query length ${query.length} != axis dims ${dims}`);
    }
    const qn = l2(query) || 1;
    const out = new Map<string, number>();
    for (let i = 0; i < coords.length; i++) {
        const base = i * dims;
        let s = 0;
        for (let d = 0; d < dims; d++) s += matrix[base + d]! * query[d]!;
        const denom = norms[i]! * qn;
        out.set(coords[i]!, denom === 0 ? 0 : s / denom);
    }
    return out;
}
