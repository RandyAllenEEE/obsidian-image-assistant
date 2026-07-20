import { EventEmitter } from "events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";

const networkMocks = vi.hoisted(() => ({
    validatePublicHttpUrl: vi.fn(async () => null as string | null)
}));

vi.mock("../../../src/utils/NetworkPolicy", () => ({
    validatePublicHttpUrl: networkMocks.validatePublicHttpUrl
}));

import { StreamingImageFetcher } from "../../../src/utils/StreamingImageFetcher";

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

    constructor(private readonly start: (request: FakeRequest) => void) {
        super();
    }

    end(): void {
        queueMicrotask(() => this.start(this));
    }
}

function electronProvider(
    start: (url: string, request: FakeRequest) => void
) {
    return {
        request: vi.fn((options: { url: string }) =>
            new FakeRequest(request => start(options.url, request))
        )
    };
}

describe("StreamingImageFetcher", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        networkMocks.validatePublicHttpUrl.mockResolvedValue(null);
    });

    it("aborts a chunked response as soon as it exceeds the hard limit", async () => {
        const requests: FakeRequest[] = [];
        const electron = electronProvider((_url, current) => {
            requests.push(current);
            const response = new FakeResponse();
            current.emit("response", response);
            response.emit("data", new Uint8Array([1, 2, 3]));
            response.emit("data", new Uint8Array([4, 5, 6]));
        });
        const fetcher = new StreamingImageFetcher({
            maxBytes: 4,
            electronNetProvider: () => electron as any
        });

        await expect(fetcher.fetch("https://example.com/image"))
            .rejects.toThrow("100 MiB");
        expect(requests[0].abort).toHaveBeenCalledOnce();
    });

    it("validates and manually follows every redirect", async () => {
        const electron = electronProvider((url, request) => {
            if (url === "https://example.com/start") {
                request.emit(
                    "redirect",
                    302,
                    "GET",
                    "https://cdn.example.com/image.png",
                    {}
                );
                return;
            }
            const response = new FakeResponse(200, {
                "content-length": ["3"],
                "content-type": ["image/png"]
            });
            request.emit("response", response);
            response.emit("data", new Uint8Array([1, 2, 3]));
            response.emit("end");
        });
        const fetcher = new StreamingImageFetcher({
            electronNetProvider: () => electron as any
        });

        const result = await fetcher.fetch("https://example.com/start");

        expect(result.finalUrl).toBe("https://cdn.example.com/image.png");
        expect(result.redirectChainVerified).toBe(true);
        expect(result.hardLimitEnforced).toBe(true);
        expect(electron.request).toHaveBeenCalledTimes(2);
        expect(networkMocks.validatePublicHttpUrl).toHaveBeenCalledWith(
            "https://cdn.example.com/image.png"
        );
    });

    it("fails before GET when requestUrl fallback lacks Content-Length", async () => {
        vi.mocked(requestUrl).mockResolvedValueOnce({
            status: 200,
            headers: {}
        } as any);
        const fetcher = new StreamingImageFetcher({
            electronNetProvider: () => null
        });

        await expect(fetcher.fetch("https://example.com/image.png"))
            .rejects.toThrow("Content-Length");
        expect(requestUrl).toHaveBeenCalledTimes(1);
        expect(requestUrl).toHaveBeenCalledWith({
            url: "https://example.com/image.png",
            method: "HEAD"
        });
    });

    it("marks requestUrl fallback limitations in its result", async () => {
        vi.mocked(requestUrl)
            .mockResolvedValueOnce({
                status: 200,
                headers: { "content-length": "3" }
            } as any)
            .mockResolvedValueOnce({
                status: 200,
                headers: { "content-type": "image/png" },
                arrayBuffer: new Uint8Array([1, 2, 3]).buffer
            } as any);
        const fetcher = new StreamingImageFetcher({
            electronNetProvider: () => null
        });

        const result = await fetcher.fetch("https://example.com/image.png");

        expect(result.transport).toBe("requestUrl");
        expect(result.redirectChainVerified).toBe(false);
        expect(result.hardLimitEnforced).toBe(false);
        expect(result.data.byteLength).toBe(3);
    });
});
