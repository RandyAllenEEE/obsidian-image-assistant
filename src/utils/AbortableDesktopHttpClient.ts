import { t } from "../lang/helpers";

const DEFAULT_RESPONSE_LIMIT = 100 * 1024 * 1024;
const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 5;

export interface DesktopHttpTransportLike {
    request(options: {
        url: string;
        method: string;
        redirect: "manual";
        credentials: "omit";
        useSessionCookies: boolean;
        headers?: Record<string, string>;
    }): ElectronClientRequestLike;
}

/**
 * Kept as an internal compatibility alias for callers that inject a fake
 * Electron transport. The default resolver can also return the Node adapter.
 */
export type ElectronNetLike = DesktopHttpTransportLike;

interface ElectronClientRequestLike {
    on(event: "response", listener: (response: ElectronResponseLike) => void): this;
    on(event: "redirect", listener: (
        statusCode: number,
        method: string,
        redirectUrl: string,
        responseHeaders: Record<string, string[]>
    ) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: () => void): this;
    write?(data: string | Uint8Array): void;
    end(): void;
    abort?(): void;
    destroy?(error?: Error): void;
}

interface ElectronResponseLike {
    statusCode: number;
    headers: Record<string, string | string[] | undefined>;
    on(event: "data", listener: (chunk: Uint8Array) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "aborted", listener: () => void): this;
    destroy?(): void;
}

export interface AbortableDesktopHttpRequest {
    readonly url: string;
    readonly method?: "GET" | "HEAD" | "POST" | "PUT" | "DELETE";
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string | Uint8Array;
    readonly responseLimitBytes?: number;
    readonly totalTimeoutMs?: number;
    readonly idleTimeoutMs?: number;
    readonly maxRedirects?: number;
    readonly redirectPolicy?: "follow" | "reject";
    readonly signal?: AbortSignal;
    readonly validateUrl?: (url: string) => Promise<string | null>;
}

export interface AbortableDesktopHttpResponse {
    readonly data: ArrayBuffer;
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly finalUrl: string;
    readonly redirects: readonly string[];
}

export interface AbortableDesktopHttpStreamResponse {
    readonly body: ReadableStream<Uint8Array>;
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly finalUrl: string;
    readonly redirects: readonly string[];
}

interface SingleStreamRequestResult {
    readonly redirectUrl?: string;
    readonly body?: ReadableStream<Uint8Array>;
    readonly status?: number;
    readonly headers?: Record<string, string>;
}

export class AbortableDesktopHttpClient {
    private desktopTransport: DesktopHttpTransportLike | null | undefined;

    constructor(
        private readonly desktopTransportProvider: () => DesktopHttpTransportLike | null
            = resolveElectronNet
    ) { }

    isAvailable(): boolean {
        return this.getDesktopTransport() !== null;
    }

    async request(
        options: AbortableDesktopHttpRequest
    ): Promise<AbortableDesktopHttpResponse> {
        const response = await this.openStream(options);
        const chunks: Uint8Array[] = [];
        let total = 0;
        const reader = response.body.getReader();
        for (;;) {
            const result = await reader.read();
            if (result.done) break;
            chunks.push(result.value);
            total += result.value.byteLength;
        }
        const data = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return Object.freeze({
            data: data.buffer,
            status: response.status,
            headers: response.headers,
            finalUrl: response.finalUrl,
            redirects: response.redirects
        });
    }

    async openStream(
        options: AbortableDesktopHttpRequest
    ): Promise<AbortableDesktopHttpStreamResponse> {
        throwIfAborted(options.signal);
        const desktopTransport = this.getDesktopTransport();
        if (!desktopTransport) {
            throw new Error(t("MSG_CLOUD_DELETE_TRANSPORT_UNAVAILABLE"));
        }

        const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
        const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
        const responseLimitBytes = options.responseLimitBytes ?? DEFAULT_RESPONSE_LIMIT;
        const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
        const redirectPolicy = options.redirectPolicy ?? "follow";
        const deadline = Date.now() + totalTimeoutMs;
        const redirects: string[] = [];
        let currentUrl = options.url;

        for (let redirectCount = 0; ; redirectCount++) {
            throwIfAborted(options.signal);
            const validationError = await options.validateUrl?.(currentUrl);
            if (validationError) throw new Error(validationError);
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
                throw new Error(t("MSG_STREAM_DOWNLOAD_TIMEOUT", [
                    totalTimeoutMs / 1000
                ]));
            }

            const response = await this.requestStreamOnce(
                desktopTransport,
                currentUrl,
                {
                    ...options,
                    totalTimeoutMs,
                    idleTimeoutMs,
                    responseLimitBytes
                },
                remainingMs
            );
            if (response.redirectUrl) {
                if (redirectPolicy === "reject") {
                    throw new Error(t("MSG_DESKTOP_HTTP_REDIRECT_REJECTED"));
                }
                if (redirectCount >= maxRedirects) {
                    throw new Error(t("MSG_STREAM_REDIRECT_LIMIT", [maxRedirects]));
                }
                currentUrl = new URL(response.redirectUrl, currentUrl).toString();
                redirects.push(currentUrl);
                continue;
            }
            if (!response.body
                || response.status === undefined
                || !response.headers) {
                throw new Error(t("MSG_STREAM_RESPONSE_INCOMPLETE"));
            }
            return Object.freeze({
                body: response.body,
                status: response.status,
                headers: Object.freeze({ ...response.headers }),
                finalUrl: currentUrl,
                redirects: Object.freeze([...redirects])
            });
        }
    }

    private requestStreamOnce(
        desktopTransport: DesktopHttpTransportLike,
        url: string,
        options: AbortableDesktopHttpRequest & {
            totalTimeoutMs: number;
            idleTimeoutMs: number;
            responseLimitBytes: number;
        },
        remainingMs: number
    ): Promise<SingleStreamRequestResult> {
        return new Promise((resolve, reject) => {
            const request = desktopTransport.request({
                url,
                method: options.method ?? "GET",
                redirect: "manual",
                credentials: "omit",
                useSessionCookies: false,
                headers: options.headers ? { ...options.headers } : undefined
            });
            let responseStarted = false;
            let completed = false;
            let totalTimer: ReturnType<typeof setTimeout> | null = null;
            let idleTimer: ReturnType<typeof setTimeout> | null = null;
            let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

            const clearTimers = (): void => {
                if (totalTimer) clearTimeout(totalTimer);
                if (idleTimer) clearTimeout(idleTimer);
                totalTimer = null;
                idleTimer = null;
            };
            const detachAbort = (): void => options.signal?.removeEventListener("abort", abort);
            const cleanup = (): void => {
                if (completed) return;
                completed = true;
                clearTimers();
                detachAbort();
            };
            const abortRequest = (): void => {
                try {
                    if (typeof request.abort === "function") request.abort();
                    else request.destroy?.();
                } catch {
                    // The request may already be closed.
                }
            };
            const fail = (error: Error, shouldAbort = true): void => {
                if (completed) return;
                cleanup();
                if (shouldAbort) abortRequest();
                if (responseStarted) streamController?.error(error);
                else reject(error);
            };
            const abort = (): void => fail(createAbortError(options.signal), true);
            const resetIdleTimer = (): void => {
                if (idleTimer) clearTimeout(idleTimer);
                idleTimer = setTimeout(() => fail(new Error(t("MSG_STREAM_DOWNLOAD_IDLE", [
                    options.idleTimeoutMs / 1000
                ]))), Math.min(options.idleTimeoutMs, remainingMs));
            };
            totalTimer = setTimeout(() => fail(new Error(t("MSG_STREAM_DOWNLOAD_TIMEOUT", [
                options.totalTimeoutMs / 1000
            ]))), remainingMs);
            resetIdleTimer();
            options.signal?.addEventListener("abort", abort, { once: true });

            request.on("redirect", (_status, _method, redirectUrl) => {
                if (responseStarted || completed) return;
                cleanup();
                abortRequest();
                resolve({ redirectUrl });
            });
            request.on("response", response => {
                if (completed) return;
                const headers = flattenHeaders(response.headers);
                const redirectUrl = readRedirectUrl(response.statusCode, headers);
                if (redirectUrl) {
                    cleanup();
                    try {
                        response.destroy?.();
                    } catch {
                        // The response may already have closed.
                    }
                    abortRequest();
                    resolve({ redirectUrl });
                    return;
                }
                responseStarted = true;
                const declaredLength = parseContentLength(headers);
                if (declaredLength !== null && declaredLength > options.responseLimitBytes) {
                    fail(new Error(t("MSG_STREAM_SIZE_LIMIT")));
                    return;
                }
                let receivedBytes = 0;
                const body = new ReadableStream<Uint8Array>({
                    start(controller) {
                        streamController = controller;
                        response.on("data", chunk => {
                            if (completed) return;
                            resetIdleTimer();
                            const value = new Uint8Array(chunk);
                            receivedBytes += value.byteLength;
                            if (receivedBytes > options.responseLimitBytes) {
                                fail(new Error(t("MSG_STREAM_SIZE_LIMIT")));
                                return;
                            }
                            controller.enqueue(value);
                        });
                        response.on("end", () => {
                            if (completed) return;
                            cleanup();
                            controller.close();
                        });
                        response.on("error", error => fail(error));
                        response.on("aborted", () => fail(
                            new Error(t("MSG_STREAM_RESPONSE_ABORTED")),
                            false
                        ));
                    },
                    cancel() {
                        cleanup();
                        abortRequest();
                    }
                });
                resolve({
                    body,
                    status: response.statusCode,
                    headers
                });
            });
            request.on("error", error => fail(error, false));
            request.on("close", () => {
                // Node's ClientRequest may close after it has handed ownership
                // of the response stream to IncomingMessage but before that
                // response emits `end`. From that point on the response's own
                // error/aborted/end events are authoritative.
                if (!completed && !responseStarted) {
                    fail(new Error(t("MSG_STREAM_REQUEST_CLOSED")), false);
                }
            });
            try {
                if (options.body !== undefined) {
                    if (typeof request.write !== "function") {
                        throw new Error(t("MSG_DESKTOP_HTTP_BODY_UNAVAILABLE"));
                    }
                    request.write(options.body);
                }
                request.end();
            } catch (error) {
                fail(error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    private getDesktopTransport(): DesktopHttpTransportLike | null {
        if (this.desktopTransport === undefined) {
            this.desktopTransport = this.desktopTransportProvider();
        }
        return this.desktopTransport;
    }

}

export function resolveDesktopHttpTransport(): DesktopHttpTransportLike | null {
    return resolveElectronNetOnly() ?? resolveNodeHttpTransport();
}

export function resolveElectronNet(): ElectronNetLike | null {
    return resolveElectronNetOnly();
}

function resolveElectronNetOnly(): DesktopHttpTransportLike | null {
    try {
        const electron = require("electron") as { net?: DesktopHttpTransportLike };
        return electron.net?.request ? electron.net : null;
    } catch {
        return null;
    }
}

/**
 * Obsidian plugins run in an Electron renderer where `require("electron").net`
 * is commonly unavailable. Node integration is still present on desktop, so a
 * small http/https adapter provides the same manual-redirect stream contract.
 * Node does not follow redirects by itself and does not attach browser cookies.
 */
export function resolveNodeHttpTransport(): DesktopHttpTransportLike | null {
    try {
        const http = require("http") as typeof import("http");
        const https = require("https") as typeof import("https");
        return {
            request(options) {
                const target = new URL(options.url);
                if (target.username || target.password) {
                    throw new Error("Desktop HTTP endpoint URLs cannot contain credentials.");
                }
                const transport = target.protocol === "https:"
                    ? https
                    : target.protocol === "http:"
                        ? http
                        : null;
                if (!transport) {
                    throw new Error(`Unsupported desktop HTTP protocol: ${target.protocol}`);
                }
                return transport.request(target, {
                    method: options.method,
                    headers: options.headers
                }) as unknown as ElectronClientRequestLike;
            }
        };
    } catch {
        return null;
    }
}

function flattenHeaders(
    headers: Record<string, string | string[] | undefined>
): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) continue;
        result[name.toLowerCase()] = Array.isArray(value)
            ? value.join(", ")
            : value;
    }
    return result;
}

function readRedirectUrl(
    status: number,
    headers: Readonly<Record<string, string>>
): string | null {
    if (![301, 302, 303, 307, 308].includes(status)) return null;
    return headers.location?.trim() || null;
}

function parseContentLength(
    headers: Readonly<Record<string, string>>
): number | null {
    const value = headers["content-length"];
    if (!value || !/^\d+$/.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw createAbortError(signal);
}

function createAbortError(signal?: AbortSignal): Error {
    return signal?.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
}
