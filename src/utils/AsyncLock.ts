// Helper class for async locking with concurrent queue support
export class AsyncLock {
    private locks: Map<string, Promise<void>> = new Map();

    async acquire<T>(key: string, fn: () => Promise<T>): Promise<T> {
        const previous = this.locks.get(key) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => {
            release = resolve;
        });
        const tail = previous.then(() => current);
        this.locks.set(key, tail);

        await previous;
        try {
            return await fn();
        } finally {
            release();
            if (this.locks.get(key) === tail) {
                this.locks.delete(key);
            }
        }
    }
}

// Concurrent queue for rate limiting
export class ConcurrentQueue {
    private running = 0;
    private readonly queue: Array<() => void> = [];
    private concurrency: number;

    constructor(concurrency: number = 3) {
        this.concurrency = this.normalizeConcurrency(concurrency);
    }

    setConcurrency(concurrency: number): void {
        this.concurrency = this.normalizeConcurrency(concurrency);
        this.drain();
    }

    async run<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
        return Promise.all(tasks.map((task) => this.enqueue(task)));
    }

    async runSettled<T>(tasks: Array<() => Promise<T>>): Promise<PromiseSettledResult<T>[]> {
        return Promise.allSettled(tasks.map((task) => this.enqueue(task)));
    }

    private enqueue<T>(task: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.queue.push(() => {
                this.running++;
                void (async () => {
                    try {
                        resolve(await task());
                    } catch (error) {
                        reject(error);
                    } finally {
                        this.running--;
                        this.drain();
                    }
                })();
            });
            this.drain();
        });
    }

    private drain(): void {
        while (this.running < this.concurrency && this.queue.length > 0) {
            this.queue.shift()?.();
        }
    }

    private normalizeConcurrency(concurrency: number): number {
        if (!Number.isFinite(concurrency)) return 3;
        return Math.min(10, Math.max(1, Math.floor(concurrency)));
    }
}
