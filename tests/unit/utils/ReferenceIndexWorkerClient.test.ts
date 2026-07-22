import { afterEach, describe, expect, it, vi } from "vitest";
import {
    isReferenceIndexWorkerUnavailable,
    ReferenceIndexWorkerClient
} from "../../../src/utils/reference-index/ReferenceIndexWorkerClient";
import type {
    ReferenceIndexWorkerRequest,
    ReferenceIndexWorkerResponse
} from "../../../src/utils/reference-index/ReferenceIndexWorkerProtocol";

class FakeBrowserWorker {
    static instances: FakeBrowserWorker[] = [];
    readonly messages: ReferenceIndexWorkerRequest[] = [];
    terminated = false;
    private readonly listeners = new Map<string, Array<(event: any) => void>>();

    constructor(readonly url: string, readonly options?: WorkerOptions) {
        FakeBrowserWorker.instances.push(this);
    }

    postMessage(message: ReferenceIndexWorkerRequest): void {
        this.messages.push(message);
        const response: ReferenceIndexWorkerResponse = {
            id: message.id,
            ok: true,
            result: message.type === "get-generation" ? 7 : null
        };
        queueMicrotask(() => this.emit("message", { data: response }));
    }

    addEventListener(type: string, callback: (event: any) => void): void {
        const listeners = this.listeners.get(type) ?? [];
        listeners.push(callback);
        this.listeners.set(type, listeners);
    }

    terminate(): void {
        this.terminated = true;
    }

    private emit(type: string, event: unknown): void {
        this.listeners.get(type)?.forEach(listener => listener(event));
    }
}

describe("ReferenceIndexWorkerClient", () => {
    afterEach(() => {
        FakeBrowserWorker.instances = [];
        vi.unstubAllGlobals();
    });

    it("uses a browser Worker and releases its Blob URL", async () => {
        vi.stubGlobal("Worker", FakeBrowserWorker);
        const createObjectUrl = vi.spyOn(URL, "createObjectURL")
            .mockReturnValue("blob:reference-index-worker");
        const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL");
        const client = new ReferenceIndexWorkerClient(false);

        await expect(client.getGeneration()).resolves.toBe(7);
        expect(FakeBrowserWorker.instances).toHaveLength(1);
        expect(FakeBrowserWorker.instances[0].options?.name)
            .toBe("image-assistant-reference-index");
        expect(createObjectUrl).toHaveBeenCalledTimes(1);

        await client.terminate();
        expect(FakeBrowserWorker.instances[0].terminated).toBe(true);
        expect(revokeObjectUrl).toHaveBeenCalledWith("blob:reference-index-worker");
    });

    it("classifies unavailable Worker transports as non-retryable", () => {
        vi.stubGlobal("Worker", class {
            constructor() {
                throw new Error("Web Workers disabled");
            }
        });
        const client = new ReferenceIndexWorkerClient(false);

        expect(() => client.start()).toThrowError(/Worker is unavailable/);
        try {
            client.start();
        } catch (error) {
            expect(isReferenceIndexWorkerUnavailable(error)).toBe(true);
        }
    });
});
