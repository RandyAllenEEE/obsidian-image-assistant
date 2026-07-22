import { t } from "../lang/helpers";

const DEFAULT_RESPONSE_LIMIT = 100 * 1024 * 1024;
const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 5;

export interface ElectronNetLike {
    request(options: {
        url: string;
        method: string;
        redirect: "manual";
        credentials: "omit";
        useSessionCookies: boolean;
        headers?: Record<string, string>;
    }): ElectronClientRequestLike;
}

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
    abort(): void;
}

interface ElectronResponseLike {
    statusCode: number;
    headers: Record<string, string[]>;
    on(event: "data", listener: (chunk: Uint8Array) => void): this;
    on(event: "end", listener: () => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "aborted", listener: () => void): this;
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

interface SingleRequestResult {
    readonly redirectUrl?: string;
    readonly data?: ArrayBuffer;
    readonly status?: number;
    readonly headers?: Record<string, string>;
}

export class AbortableDesktopHttpClient {
    private electronNet: ElectronNetLike | null | undefined;

    constructor(
        private readonly electronNetProvider: () => ElectronNetLike | null
            = resolveElectronNet
    ) { }

    isAvailable(): boolean {
        return this.getElectronNet() !== null;
    }

    async request(
        options: AbortableDesktopHttpRequest
    ): Promise<AbortableDesktopHttpResponse> {
        throwIfAborted(options.signal);
        const electronNet = this.getElectronNet();
        if (!electronNet) {
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

            const response = await this.requestOnce(
                electronNet,
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
            if (!response.data
                || response.status === undefined
                || !response.headers) {
                throw new Error(t("MSG_STREAM_RESPONSE_INCOMPLETE"));
            }
            return Object.freeze({
                data: response.data,
                status: response.status,
                headers: Object.freeze({ ...response.headers }),
                finalUrl: currentUrl,
                redirects: Object.freeze([...redirects])
            });
        }
    }

    private getElectronNet(): ElectronNetLike | null {
        if (this.electronNet === undefined) {
            this.electronNet = this.electronNetProvider();
        }
        return this.electronNet;
    }

    private requestOnce(
        electronNet: ElectronNetLike,
        url: string,
        options: AbortableDesktopHttpRequest & {
            totalTimeoutMs: number;
            idleTimeoutMs: number;
            responseLimitBytes: number;
        },
        remainingMs: number
    ): Promise<SingleRequestResult> {
        return new Promise((resolve, reject) => {
            const request = electronNet.request({
                url,
                method: options.method ?? "GET",
                redirect: "manual",
                credentials: "omit",
                useSessionCookies: false,
                headers: options.headers ? { ...options.headers } : undefined
            });
            let settled = false;
            let totalTimer: ReturnType<typeof setTimeout> | null = null;
            let idleTimer: ReturnType<typeof setTimeout> | null = null;

            const clearTimers = (): void => {
                if (totalTimer) clearTimeout(totalTimer);
                if (idleTimer) clearTimeout(idleTimer);
                totalTimer = null;
                idleTimer = null;
            };
            const detachAbort = (): void => {
                options.signal?.removeEventListener("abort", abort);
            };
            const finish = (
                callback: () => void,
                shouldAbort = false
            ): void => {
                if (settled) return;
                settled = true;
                clearTimers();
                detachAbort();
                if (shouldAbort) {
                    try {
                        request.abort();
                    } catch {
                        // The request may already be closed.
                    }
                }
                callback();
            };
            const fail = (error: Error, shouldAbort = true): void =>
                finish(() => reject(error), shouldAbort);
            const abort = (): void => fail(createAbortError(options.signal), true);
            const resetIdleTimer = (): void => {
                if (idleTimer) clearTimeout(idleTimer);
                idleTimer = setTimeout(() => {
                    fail(new Error(t("MSG_STREAM_DOWNLOAD_IDLE", [
                        options.idleTimeoutMs / 1000
                    ])));
                }, Math.min(options.idleTimeoutMs, remainingMs));
            };

            totalTimer = setTimeout(() => {
                fail(new Error(t("MSG_STREAM_DOWNLOAD_TIMEOUT", [
                    options.totalTimeoutMs / 1000
                ])));
            }, remainingMs);
            resetIdleTimer();
            options.signal?.addEventListener("abort", abort, { once: true });

            request.on("redirect", (_status, _method, redirectUrl) => {
                finish(() => resolve({ redirectUrl }), true);
            });
            request.on("response", response => {
                const headers = flattenHeaders(response.headers);
                const declaredLength = parseContentLength(headers);
                if (declaredLength !== null
                    && declaredLength > options.responseLimitBytes) {
                    fail(new Error(t("MSG_STREAM_SIZE_LIMIT")));
                    return;
                }

                const chunks: Buffer[] = [];
                let receivedBytes = 0;
                response.on("data", chunk => {
                    if (settled) return;
                    resetIdleTimer();
                    const buffer = Buffer.from(chunk);
                    receivedBytes += buffer.byteLength;
                    if (receivedBytes > options.responseLimitBytes) {
                        fail(new Error(t("MSG_STREAM_SIZE_LIMIT")));
                        return;
                    }
                    chunks.push(buffer);
                });
                response.on("end", () => {
                    if (settled) return;
                    finish(() => resolve({
                        data: toArrayBuffer(Buffer.concat(chunks)),
                        status: response.statusCode,
                        headers
                    }));
                });
                response.on("error", error => fail(error));
                response.on("aborted", () => {
                    fail(new Error(t("MSG_STREAM_RESPONSE_ABORTED")), false);
                });
            });
            request.on("error", error => fail(error, false));
            request.on("close", () => {
                if (!settled) {
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
}

export function resolveElectronNet(): ElectronNetLike | null {
    try {
        const electron = require("electron") as { net?: ElectronNetLike };
        return electron.net?.request ? electron.net : null;
    } catch {
        return null;
    }
}

function flattenHeaders(
    headers: Record<string, string[]>
): Record<string, string> {
    return Object.fromEntries(
        Object.entries(headers).map(([name, values]) => [
            name.toLowerCase(),
            values.join(", ")
        ])
    );
}

function parseContentLength(
    headers: Readonly<Record<string, string>>
): number | null {
    const value = headers["content-length"];
    if (!value || !/^\d+$/.test(value.trim())) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
    return buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength
    ) as ArrayBuffer;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw createAbortError(signal);
}

function createAbortError(signal?: AbortSignal): Error {
    return signal?.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
}
