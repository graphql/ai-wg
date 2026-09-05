/**
 * Bounded-concurrency async map.
 *
 * Runs `mapper` over `items` with at most `limit` operations in flight at
 * once, returning results in input order. Fail-fast: the first rejection
 * rejects the whole call (same semantics as Promise.all).
 *
 * Used to parallelize the embedding warm-up (snapshot builds + per-cohort
 * query embedding) without firing an unbounded burst of provider requests —
 * this `limit` is provider-request bound, distinct from the worker-thread
 * concurrency that processes scored jobs.
 */
export async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
    const results = new Array<R>(items.length);
    const cap = Math.max(1, Math.min(limit, items.length));
    let next = 0;
    async function worker(): Promise<void> {
        for (;;) {
            const i = next++;
            if (i >= items.length) return;
            results[i] = await mapper(items[i]!, i);
        }
    }
    await Promise.all(Array.from({ length: cap }, () => worker()));
    return results;
}
