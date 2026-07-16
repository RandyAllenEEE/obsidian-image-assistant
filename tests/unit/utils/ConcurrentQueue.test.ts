import { describe, expect, it, vi } from "vitest";
import { ConcurrentQueue } from "../../../src/utils/AsyncLock";

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

describe("ConcurrentQueue", () => {
    it("drains overlapping run calls through the same FIFO queue", async () => {
        const queue = new ConcurrentQueue(1);
        const first = deferred<string>();
        const second = deferred<string>();
        const started: string[] = [];

        const firstRun = queue.run([
            async () => {
                started.push("first");
                return first.promise;
            },
            async () => {
                started.push("second");
                return second.promise;
            },
        ]);
        const overlappingRun = queue.run([
            async () => {
                started.push("third");
                return "third-result";
            },
        ]);

        await flushPromises();
        expect(started).toEqual(["first"]);

        first.resolve("first-result");
        await flushPromises();
        expect(started).toEqual(["first", "second"]);

        second.resolve("second-result");
        await expect(firstRun).resolves.toEqual(["first-result", "second-result"]);
        await expect(overlappingRun).resolves.toEqual(["third-result"]);
        expect(started).toEqual(["first", "second", "third"]);
    });

    it("continues draining after a task rejects", async () => {
        const queue = new ConcurrentQueue(1);
        const secondTask = vi.fn(async () => "ok");

        const run = queue.run([
            async () => {
                throw new Error("boom");
            },
            secondTask,
        ]);

        await expect(run).rejects.toThrow("boom");
        await flushPromises();
        expect(secondTask).toHaveBeenCalledOnce();
    });

    it("applies concurrency changes to already queued work", async () => {
        const queue = new ConcurrentQueue(1);
        const blockers = [deferred<void>(), deferred<void>()];
        const started: number[] = [];

        const run = queue.run(blockers.map((blocker, index) => async () => {
            started.push(index);
            return blocker.promise;
        }));

        await flushPromises();
        expect(started).toEqual([0]);

        queue.setConcurrency(2);
        await flushPromises();
        expect(started).toEqual([0, 1]);

        blockers.forEach((blocker) => blocker.resolve());
        await expect(run).resolves.toEqual([undefined, undefined]);
    });

    it("clamps invalid concurrency so work cannot deadlock", async () => {
        const queue = new ConcurrentQueue(-10);
        await expect(queue.run([async () => 1])).resolves.toEqual([1]);
    });

    it("preserves per-task outcomes in runSettled", async () => {
        const queue = new ConcurrentQueue(2);
        const results = await queue.runSettled([
            async () => "ok",
            async () => {
                throw new Error("failed");
            },
        ]);

        expect(results[0]).toEqual({ status: "fulfilled", value: "ok" });
        expect(results[1].status).toBe("rejected");
    });
});
