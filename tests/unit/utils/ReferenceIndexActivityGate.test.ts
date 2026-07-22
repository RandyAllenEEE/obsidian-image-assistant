import { afterEach, describe, expect, it, vi } from "vitest";
import { ReferenceIndexActivityGate } from "../../../src/utils/reference-index/ReferenceIndexActivityGate";
import { fakeApp } from "../../factories/obsidian";

describe("ReferenceIndexActivityGate", () => {
    afterEach(() => vi.useRealTimers());

    it("waits for a complete quiet period after the latest user activity", async () => {
        vi.useFakeTimers();
        const app = fakeApp() as any;
        const gate = new ReferenceIndexActivityGate(app, 3_000);
        gate.onload();
        let resolved = false;
        const idle = gate.waitForIdle().then(() => {
            resolved = true;
        });

        await vi.advanceTimersByTimeAsync(2_500);
        document.dispatchEvent(new Event("pointerdown"));
        await vi.advanceTimersByTimeAsync(2_999);
        expect(resolved).toBe(false);

        await vi.advanceTimersByTimeAsync(1);
        await idle;
        expect(gate.isIdle()).toBe(true);
        gate.onunload();
    });

    it("rejects pending waits when the gate is unloaded", async () => {
        vi.useFakeTimers();
        const gate = new ReferenceIndexActivityGate(fakeApp() as any, 3_000);
        gate.onload();
        const idle = gate.waitForIdle();

        gate.onunload();

        await expect(idle).rejects.toMatchObject({ name: "AbortError" });
    });
});
