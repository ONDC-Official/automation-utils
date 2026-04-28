export const DEFAULT_CONCURRENCY = 8;

export function getConcurrency(): number {
    const raw = process.env["POLISH_CONCURRENCY"];
    if (!raw) return DEFAULT_CONCURRENCY;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 1) return DEFAULT_CONCURRENCY;
    return Math.min(64, Math.floor(n));
}

/**
 * Run `worker` over every item with at most `limit` in flight. Preserves input
 * order in the returned array. Calls `onProgress(completedCount)` after each
 * item resolves (rejections are propagated — the first rejection halts later
 * work but in-flight promises are awaited).
 */
export async function runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>,
    onProgress?: (done: number) => void,
): Promise<R[]> {
    const total = items.length;
    const results: R[] = new Array(total);
    let next = 0;
    let done = 0;
    const capped = Math.max(1, Math.min(limit, total));

    const runners: Promise<void>[] = [];
    for (let w = 0; w < capped; w++) {
        runners.push(
            (async () => {
                while (true) {
                    const i = next++;
                    if (i >= total) return;
                    results[i] = await worker(items[i]!, i);
                    done++;
                    onProgress?.(done);
                }
            })(),
        );
    }
    await Promise.all(runners);
    return results;
}
