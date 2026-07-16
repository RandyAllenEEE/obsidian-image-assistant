import { describe, expect, it, vi } from "vitest";
import { runCancellableBatch } from "../../../src/utils/CancellableBatchRunner";

describe("runCancellableBatch", () => {
    it("enforces the concurrency limit and keeps input result order", async () => {
        let active = 0;
        let maxActive = 0;
        const releases: Array<() => void> = [];
        const worker = vi.fn(async (value: number) => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise<void>(resolve => releases.push(resolve));
            active--;
            return value * 2;
        });

        const run = runCancellableBatch([1, 2, 3, 4], worker, {
            concurrency: 2,
            isCancelled: () => false
        });
        await vi.waitFor(() => expect(worker).toHaveBeenCalledTimes(2));
        releases.splice(0).forEach(release => release());
        await vi.waitFor(() => expect(worker).toHaveBeenCalledTimes(4));
        releases.splice(0).forEach(release => release());

        const result = await run;
        expect(maxActive).toBe(2);
        expect(result.map(entry => entry.value)).toEqual([2, 4, 6, 8]);
    });

    it("stops scheduling after cancellation while allowing in-flight work to settle", async () => {
        let cancelled = false;
        let release!: () => void;
        const worker = vi.fn(async (value: number) => {
            if (value === 1) await new Promise<void>(resolve => { release = resolve; });
            return value;
        });

        const run = runCancellableBatch([1, 2, 3], worker, {
            concurrency: 1,
            isCancelled: () => cancelled
        });
        await vi.waitFor(() => expect(worker).toHaveBeenCalledOnce());
        cancelled = true;
        release();

        const result = await run;
        expect(worker).toHaveBeenCalledOnce();
        expect(result).toHaveLength(1);
    });

    it("captures failures and continues remaining tasks", async () => {
        const result = await runCancellableBatch([1, 2, 3], async value => {
            if (value === 2) throw new Error("failed two");
            return value;
        }, {
            concurrency: 2,
            isCancelled: () => false
        });

        expect(result.map(entry => entry.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
        expect(result[1].error).toBeInstanceOf(Error);
    });

    it("does not abort work when progress callbacks throw", async () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const worker = vi.fn(async (value: number) => value * 2);

        const result = await runCancellableBatch([1, 2, 3], worker, {
            concurrency: 2,
            isCancelled: () => false,
            onStart: () => { throw new Error("start UI detached"); },
            onSettled: () => { throw new Error("progress UI detached"); }
        });

        expect(worker).toHaveBeenCalledTimes(3);
        expect(result.map(entry => entry.value)).toEqual([2, 4, 6]);
        expect(consoleSpy).toHaveBeenCalledTimes(6);
    });
});
