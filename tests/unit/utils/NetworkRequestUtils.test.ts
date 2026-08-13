import { afterEach, describe, expect, it, vi } from "vitest";
import {
    createBasicAuthorization,
    fetchWithTimeout,
    readResponseTextWithLimit,
    withTimeout
} from "../../../src/utils/NetworkRequestUtils";

describe("NetworkRequestUtils", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("times out requestUrl-style promises", async () => {
        vi.useFakeTimers();
        const request = withTimeout(new Promise<never>(() => undefined), 60_000, "Upload");
        const rejection = expect(request).rejects.toThrow("Upload timed out after 60 seconds");

        await vi.advanceTimersByTimeAsync(60_000);
        await rejection;
    });

    it("clears the requestUrl-style timeout after an operation completes", async () => {
        vi.useFakeTimers();

        await expect(withTimeout(Promise.resolve("done"), 60_000, "Upload"))
            .resolves.toBe("done");
        expect(vi.getTimerCount()).toBe(0);
    });

    it("aborts fetch when the OCR timeout expires", async () => {
        vi.useFakeTimers();
        vi.stubGlobal("fetch", vi.fn((_input, init?: RequestInit) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })));
        const request = fetchWithTimeout("https://ocr.example.test", {}, 120_000);
        const rejection = expect(request).rejects.toThrow("timed out after 120 seconds");

        await vi.advanceTimersByTimeAsync(120_000);
        await rejection;
    });

    it("preserves caller cancellation without reporting it as a timeout", async () => {
        const caller = new AbortController();
        vi.stubGlobal("fetch", vi.fn((_input, init?: RequestInit) => new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
        })));

        const request = fetchWithTimeout("https://ocr.example.test", { signal: caller.signal }, 120_000);
        caller.abort("user cancelled");

        await expect(request).rejects.toMatchObject({ name: "AbortError" });
    });

    it("forwards a caller signal that was already aborted", async () => {
        const caller = new AbortController();
        caller.abort("cancelled before request");
        const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
            expect(init?.signal?.aborted).toBe(true);
            throw new DOMException("Aborted", "AbortError");
        });
        vi.stubGlobal("fetch", fetchMock);

        await expect(fetchWithTimeout("https://ocr.example.test", { signal: caller.signal }))
            .rejects.toMatchObject({ name: "AbortError" });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("rejects redirects for endpoint-specific OCR requests", async () => {
        const response = new Response("ok");
        const fetchMock = vi.fn(async () => response);
        vi.stubGlobal("fetch", fetchMock);

        await fetchWithTimeout("https://ocr.example.test", { method: "POST" });

        expect(fetchMock).toHaveBeenCalledWith(
            "https://ocr.example.test",
            expect.objectContaining({ redirect: "error" })
        );
    });

    it("rejects credentials over remote cleartext HTTP before fetch", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await expect(fetchWithTimeout("http://ocr.example.test", {
            headers: { Authorization: "Bearer secret" }
        })).rejects.toThrow("HTTPS or a loopback HTTP endpoint");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a Request that already carries credentials over remote cleartext HTTP", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await expect(fetchWithTimeout(new Request("http://ocr.example.test", {
            headers: { Authorization: "Bearer secret" }
        }))).rejects.toThrow("HTTPS or a loopback HTTP endpoint");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("allows credential-bearing loopback development endpoints", async () => {
        const fetchMock = vi.fn(async () => new Response("ok"));
        vi.stubGlobal("fetch", fetchMock);

        await fetchWithTimeout("http://127.0.0.1:8000/predict", {
            headers: { Authorization: "Basic value" }
        });

        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it.each([
        "http://localhost:8000/predict",
        "http://ocr.localhost:8000/predict",
        "http://[::1]:8000/predict"
    ])("allows credentials for loopback hostname %s", async (url) => {
        const fetchMock = vi.fn(async () => new Response("ok"));
        vi.stubGlobal("fetch", fetchMock);

        await fetchWithTimeout(url, {
            headers: new Headers({ authorization: "Bearer secret" })
        });

        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("accepts credential-bearing URL and Request inputs over HTTPS", async () => {
        const fetchMock = vi.fn(async () => new Response("ok"));
        vi.stubGlobal("fetch", fetchMock);

        await fetchWithTimeout(new URL("https://ocr.example.test/url"), {
            headers: [["Authorization", "Bearer url-secret"]]
        });
        await fetchWithTimeout(new Request("https://ocr.example.test/request"), {
            headers: { Authorization: "Bearer request-secret" }
        });

        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("rejects a relative credential-bearing endpoint before fetch", async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);

        await expect(fetchWithTimeout("/api/ocr", {
            headers: { Authorization: "Bearer secret" }
        })).rejects.toThrow("absolute HTTPS or loopback URL");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects a declared response larger than the bounded OCR limit", async () => {
        const response = {
            headers: { get: vi.fn(() => "2048") },
            body: null,
            text: vi.fn(async () => "unreachable")
        } as unknown as Response;

        await expect(readResponseTextWithLimit(response, 1024))
            .rejects.toThrow("1024-byte limit");
        expect(response.text).not.toHaveBeenCalled();
    });

    it("reads and byte-limits responses without a readable stream", async () => {
        const accepted = {
            headers: { get: vi.fn(() => null) },
            body: null,
            text: vi.fn(async () => "用户")
        } as unknown as Response;
        const oversized = {
            headers: { get: vi.fn(() => null) },
            body: null,
            text: vi.fn(async () => "用户")
        } as unknown as Response;

        await expect(readResponseTextWithLimit(accepted, 6)).resolves.toBe("用户");
        await expect(readResponseTextWithLimit(oversized, 5))
            .rejects.toThrow("5-byte limit");
    });

    it("falls back to JSON when a bodyless response has no text method", async () => {
        const response = {
            headers: { get: vi.fn(() => null) },
            body: null,
            json: vi.fn(async () => ({ status: "ok" }))
        } as unknown as Response;

        await expect(readResponseTextWithLimit(response, 100))
            .resolves.toBe('{"status":"ok"}');
    });

    it("combines streamed UTF-8 chunks and releases the reader", async () => {
        const encoder = new TextEncoder();
        const reader = {
            read: vi.fn()
                .mockResolvedValueOnce({ done: false, value: encoder.encode("你") })
                .mockResolvedValueOnce({ done: false, value: encoder.encode("好") })
                .mockResolvedValueOnce({ done: true, value: undefined }),
            cancel: vi.fn(),
            releaseLock: vi.fn()
        };
        const response = {
            headers: { get: vi.fn(() => null) },
            body: { getReader: () => reader }
        } as unknown as Response;

        await expect(readResponseTextWithLimit(response, 6)).resolves.toBe("你好");
        expect(reader.cancel).not.toHaveBeenCalled();
        expect(reader.releaseLock).toHaveBeenCalledOnce();
    });

    it("cancels and releases a stream as soon as its byte limit is exceeded", async () => {
        const reader = {
            read: vi.fn().mockResolvedValue({
                done: false,
                value: new Uint8Array([1, 2, 3, 4])
            }),
            cancel: vi.fn(async () => undefined),
            releaseLock: vi.fn()
        };
        const response = {
            headers: { get: vi.fn(() => null) },
            body: { getReader: () => reader }
        } as unknown as Response;

        await expect(readResponseTextWithLimit(response, 3))
            .rejects.toThrow("3-byte limit");
        expect(reader.cancel).toHaveBeenCalledWith("response size limit exceeded");
        expect(reader.releaseLock).toHaveBeenCalledOnce();
    });

    it("encodes Basic authentication credentials as UTF-8", () => {
        const authorization = createBasicAuthorization("用户", "密码");
        const encoded = authorization.replace(/^Basic /, "");

        expect(Buffer.from(encoded, "base64").toString("utf8")).toBe("用户:密码");
    });
});
