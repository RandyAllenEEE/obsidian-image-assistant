import { EventEmitter } from "events";
import { describe, expect, it, vi } from "vitest";
import {
    AbortableDesktopHttpClient
} from "../../../src/utils/AbortableDesktopHttpClient";

class FakeResponse extends EventEmitter {
    constructor(
        readonly statusCode = 200,
        readonly headers: Record<string, string[]> = {}
    ) {
        super();
    }
}

class FakeRequest extends EventEmitter {
    readonly abort = vi.fn();
    readonly write = vi.fn();

    constructor(private readonly start: (request: FakeRequest) => void) {
        super();
    }

    end(): void {
        queueMicrotask(() => this.start(this));
    }
}

function createElectron(start: (request: FakeRequest) => void) {
    const requests: FakeRequest[] = [];
    return {
        requests,
        net: {
            request: vi.fn(() => {
                const request = new FakeRequest(start);
                requests.push(request);
                return request;
            })
        }
    };
}

describe("AbortableDesktopHttpClient", () => {
    it("sends a bounded POST body and returns parsed response bytes", async () => {
        const electron = createElectron(request => {
            const response = new FakeResponse(200, {
                "content-length": ["16"],
                "content-type": ["application/json"]
            });
            request.emit("response", response);
            response.emit("data", new TextEncoder().encode('{"success":true}'));
            response.emit("end");
        });
        const client = new AbortableDesktopHttpClient(
            () => electron.net as any
        );

        const result = await client.request({
            url: "http://127.0.0.1:36677/delete",
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: '{"list":[]}',
            redirectPolicy: "reject",
            responseLimitBytes: 1024
        });

        expect(result.status).toBe(200);
        expect(new TextDecoder().decode(result.data)).toBe('{"success":true}');
        expect(electron.requests[0].write).toHaveBeenCalledWith('{"list":[]}');
    });

    it("rejects and aborts redirects when redirectPolicy is reject", async () => {
        const electron = createElectron(request => {
            request.emit("redirect", 302, "POST", "http://127.0.0.1/other", {});
        });
        const client = new AbortableDesktopHttpClient(
            () => electron.net as any
        );

        await expect(client.request({
            url: "http://127.0.0.1:36677/delete",
            method: "POST",
            body: "{}",
            redirectPolicy: "reject"
        })).rejects.toThrow("Redirects are not allowed");
        expect(electron.requests[0].abort).toHaveBeenCalledOnce();
    });

    it("aborts the Electron request when its signal is cancelled", async () => {
        const electron = createElectron(() => undefined);
        const client = new AbortableDesktopHttpClient(
            () => electron.net as any
        );
        const controller = new AbortController();
        const pending = client.request({
            url: "https://example.com/image",
            signal: controller.signal
        });
        await Promise.resolve();
        controller.abort();

        await expect(pending).rejects.toMatchObject({ name: "AbortError" });
        expect(electron.requests[0].abort).toHaveBeenCalledOnce();
    });

    it("aborts as soon as a chunked response crosses the response limit", async () => {
        const electron = createElectron(request => {
            const response = new FakeResponse();
            request.emit("response", response);
            response.emit("data", new Uint8Array([1, 2, 3]));
            response.emit("data", new Uint8Array([4, 5, 6]));
        });
        const client = new AbortableDesktopHttpClient(
            () => electron.net as any
        );

        await expect(client.request({
            url: "https://example.com/image",
            responseLimitBytes: 4
        })).rejects.toThrow("100 MiB");
        expect(electron.requests[0].abort).toHaveBeenCalledOnce();
    });
});
