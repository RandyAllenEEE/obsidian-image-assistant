import { afterEach, describe, expect, it, vi } from "vitest";
import { createBasicAuthorization, fetchWithTimeout, withTimeout } from "../../../src/utils/NetworkRequestUtils";

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

    it("encodes Basic authentication credentials as UTF-8", () => {
        const authorization = createBasicAuthorization("用户", "密码");
        const encoded = authorization.replace(/^Basic /, "");

        expect(Buffer.from(encoded, "base64").toString("utf8")).toBe("用户:密码");
    });
});
