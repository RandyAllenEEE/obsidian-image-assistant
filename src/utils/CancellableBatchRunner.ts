export interface CancellableBatchOptions<T, R> {
    concurrency: number;
    isCancelled: () => boolean;
    onStart?: (item: T, index: number) => void;
    onSettled?: (entry: CancellableBatchEntry<T, R>) => void;
}

export interface CancellableBatchEntry<T, R> {
    item: T;
    index: number;
    status: "fulfilled" | "rejected";
    value?: R;
    error?: unknown;
}

export async function runCancellableBatch<T, R>(
    items: T[],
    worker: (item: T, index: number) => Promise<R>,
    options: CancellableBatchOptions<T, R>
): Promise<CancellableBatchEntry<T, R>[]> {
    const concurrency = Math.min(10, Math.max(1, Math.floor(options.concurrency) || 1));
    const results: CancellableBatchEntry<T, R>[] = [];
    let nextIndex = 0;

    const runWorker = async () => {
        while (!options.isCancelled()) {
            const index = nextIndex++;
            if (index >= items.length) return;

            const item = items[index];
            invokeBatchHook("onStart", () => options.onStart?.(item, index));
            let entry: CancellableBatchEntry<T, R>;
            try {
                entry = { item, index, status: "fulfilled", value: await worker(item, index) };
            } catch (error) {
                entry = { item, index, status: "rejected", error };
            }
            results.push(entry);
            invokeBatchHook("onSettled", () => options.onSettled?.(entry));
        }
    };

    await Promise.all(Array.from(
        { length: Math.min(concurrency, items.length) },
        () => runWorker()
    ));

    return results.sort((left, right) => left.index - right.index);
}

function invokeBatchHook(name: string, callback: () => void): void {
    try {
        callback();
    } catch (error) {
        console.error(`[Image Assistant] Batch ${name} callback failed:`, error);
    }
}
