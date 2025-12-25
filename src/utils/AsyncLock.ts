// Helper class for async locking with concurrent queue support
export class AsyncLock {
    private locks: Map<string, Promise<void>> = new Map();

    async acquire(key: string, fn: () => Promise<void>) {
        const release = await this.acquireLock(key);
        try {
            return await fn();
        } finally {
            release();
        }
    }

    private async acquireLock(key: string): Promise<() => void> {
        while (this.locks.has(key)) {
            await this.locks.get(key);
        }

        let resolve!: () => void;
        const promise = new Promise<void>(resolver => resolve = resolver);
        this.locks.set(key, promise);

        return () => {
            this.locks.delete(key);
            resolve();
        };
    }
}

// Concurrent queue for rate limiting
export class ConcurrentQueue {
    private running = 0;
    private queue: Array<() => Promise<void>> = [];

    constructor(private concurrency: number = 3) { }

    async run<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
        const results: T[] = [];
        let index = 0;

        const wrappedTasks = tasks.map((task, i) => async () => {
            try {
                results[i] = await task();
            } catch (error) {
                console.error(`Task ${i} failed:`, error);
                throw error;
            }
        });

        return new Promise((resolve, reject) => {
            const next = () => {
                if (index >= wrappedTasks.length && this.running === 0) {
                    resolve(results);
                    return;
                }

                while (this.running < this.concurrency && index < wrappedTasks.length) {
                    const task = wrappedTasks[index++];
                    this.running++;

                    task()
                        .then(() => {
                            this.running--;
                            next();
                        })
                        .catch((error) => {
                            this.running--;
                            reject(error);
                        });
                }
            };

            next();
        });
    }

    async runSettled<T>(tasks: Array<() => Promise<T>>): Promise<PromiseSettledResult<T>[]> {
        const results: PromiseSettledResult<T>[] = new Array(tasks.length);
        let index = 0;

        const wrappedTasks = tasks.map((task, i) => async () => {
            try {
                const value = await task();
                results[i] = { status: 'fulfilled', value };
            } catch (reason) {
                console.error(`Task ${i} failed:`, reason);
                results[i] = { status: 'rejected', reason };
            }
        });

        return new Promise((resolve) => {
            const next = () => {
                if (index >= wrappedTasks.length && this.running === 0) {
                    resolve(results);
                    return;
                }

                while (this.running < this.concurrency && index < wrappedTasks.length) {
                    const task = wrappedTasks[index++];
                    this.running++;

                    task()
                        .then(() => {
                            this.running--;
                            next();
                        })
                        .catch(() => {
                            // This catch should generally not be hit because wrappedTasks catches internally,
                            // but good for safety.
                            this.running--;
                            next();
                        });
                }
            };

            next();
        });
    }
}