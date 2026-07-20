import { requestUrl } from "obsidian";
import { t } from "../lang/helpers";
import { validatePublicHttpUrl } from "./NetworkPolicy";
import { withTimeout } from "./NetworkRequestUtils";

const DEFAULT_MAX_BYTES = 100 * 1024 * 1024;
const DEFAULT_TOTAL_TIMEOUT_MS = 60_000;
const DEFAULT_IDLE_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 5;

export type StreamingImageFetchTransport = "electron" | "requestUrl";

export interface StreamingImageFetchResult {
    readonly data: ArrayBuffer;
    readonly status: number;
    readonly headers: Readonly<Record<string, string>>;
    readonly finalUrl: string;
    readonly transport: StreamingImageFetchTransport;
    readonly redirectChainVerified: boolean;
    readonly hardLimitEnforced: boolean;
}

export interface StreamingImageFetcherOptions {
    readonly maxBytes?: number;
    readonly totalTimeoutMs?: number;
    readonly idleTimeoutMs?: number;
    readonly maxRedirects?: number;
    readonly electronNetProvider?: () => ElectronNetLike | null;
}

interface ElectronNetLike {
    request(options: {
        url: string;
        method: string;
        redirect: "manual";
        credentials: "omit";
        useSessionCookies: boolean;
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

interface ElectronRequestResult {
    readonly redirectUrl?: string;
    readonly data?: ArrayBuffer;
    readonly status?: number;
    readonly headers?: Record<string, string>;
}

export class StreamingImageFetcher {
    private static fallbackWarningShown = false;
    private readonly maxBytes: number;
    private readonly totalTimeoutMs: number;
    private readonly idleTimeoutMs: number;
    private readonly maxRedirects: number;
    private readonly electronNetProvider: () => ElectronNetLike | null;

    constructor(options: StreamingImageFetcherOptions = {}) {
        this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        this.totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
        this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
        this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
        this.electronNetProvider = options.electronNetProvider
            ?? resolveElectronNet;
    }

    async fetch(url: string): Promise<StreamingImageFetchResult> {
        const validationError = await validatePublicHttpUrl(url);
        if (validationError) throw new Error(validationError);

        const electronNet = this.electronNetProvider();
        if (electronNet) {
            return this.fetchWithElectron(electronNet, url);
        }
        return this.fetchWithRequestUrl(url);
    }

    private async fetchWithElectron(
        electronNet: ElectronNetLike,
        initialUrl: string
    ): Promise<StreamingImageFetchResult> {
        const deadline = Date.now() + this.totalTimeoutMs;
        let currentUrl = initialUrl;

        for (let redirectCount = 0; ; redirectCount++) {
            const validationError = await validatePublicHttpUrl(currentUrl);
            if (validationError) throw new Error(validationError);
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
                throw new Error(t("MSG_STREAM_DOWNLOAD_TIMEOUT", [
                    this.totalTimeoutMs / 1000
                ]));
            }

            const response = await this.requestElectronOnce(
                electronNet,
                currentUrl,
                remainingMs
            );
            if (response.redirectUrl) {
                if (redirectCount >= this.maxRedirects) {
                    throw new Error(t("MSG_STREAM_REDIRECT_LIMIT", [
                        this.maxRedirects
                    ]));
                }
                currentUrl = new URL(response.redirectUrl, currentUrl).toString();
                continue;
            }
            if (!response.data
                || response.status === undefined
                || !response.headers) {
                throw new Error(t("MSG_STREAM_RESPONSE_INCOMPLETE"));
            }
            return {
                data: response.data,
                status: response.status,
                headers: Object.freeze({ ...response.headers }),
                finalUrl: currentUrl,
                transport: "electron",
                redirectChainVerified: true,
                hardLimitEnforced: true
            };
        }
    }

    private requestElectronOnce(
        electronNet: ElectronNetLike,
        url: string,
        remainingMs: number
    ): Promise<ElectronRequestResult> {
        return new Promise((resolve, reject) => {
            const request = electronNet.request({
                url,
                method: "GET",
                redirect: "manual",
                credentials: "omit",
                useSessionCookies: false
            });
            let settled = false;
            let totalTimer: ReturnType<typeof setTimeout> | null = null;
            let idleTimer: ReturnType<typeof setTimeout> | null = null;

            const clearTimers = () => {
                if (totalTimer) clearTimeout(totalTimer);
                if (idleTimer) clearTimeout(idleTimer);
                totalTimer = null;
                idleTimer = null;
            };
            const finish = (
                callback: () => void,
                abort = false
            ) => {
                if (settled) return;
                settled = true;
                clearTimers();
                if (abort) {
                    try {
                        request.abort();
                    } catch {
                        // The request may already be closed.
                    }
                }
                callback();
            };
            const fail = (error: Error, abort = true) =>
                finish(() => reject(error), abort);
            const resetIdleTimer = () => {
                if (idleTimer) clearTimeout(idleTimer);
                idleTimer = setTimeout(() => {
                    fail(new Error(
                        t("MSG_STREAM_DOWNLOAD_IDLE", [
                            this.idleTimeoutMs / 1000
                        ])
                    ));
                }, Math.min(this.idleTimeoutMs, remainingMs));
            };

            totalTimer = setTimeout(() => {
                fail(new Error(
                    t("MSG_STREAM_DOWNLOAD_TIMEOUT", [
                        this.totalTimeoutMs / 1000
                    ])
                ));
            }, remainingMs);
            resetIdleTimer();

            request.on("redirect", (_status, _method, redirectUrl) => {
                finish(() => resolve({ redirectUrl }), true);
            });
            request.on("response", response => {
                const status = response.statusCode;
                if (status < 200 || status >= 300) {
                    fail(new Error(t("MSG_STREAM_HTTP_ERROR", [status])));
                    return;
                }
                const headers = flattenHeaders(response.headers);
                const declaredLength = parseContentLength(headers);
                if (declaredLength !== null && declaredLength > this.maxBytes) {
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
                    if (receivedBytes > this.maxBytes) {
                        fail(new Error(t("MSG_STREAM_SIZE_LIMIT")));
                        return;
                    }
                    chunks.push(buffer);
                });
                response.on("end", () => {
                    if (settled) return;
                    const data = toArrayBuffer(Buffer.concat(chunks));
                    finish(() => resolve({ data, status, headers }));
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
            request.end();
        });
    }

    private async fetchWithRequestUrl(
        url: string
    ): Promise<StreamingImageFetchResult> {
        if (!StreamingImageFetcher.fallbackWarningShown) {
            StreamingImageFetcher.fallbackWarningShown = true;
            console.warn(
                "[Image Assistant] Electron streaming is unavailable. "
                + "Falling back to requestUrl; in-flight hard limits and final redirect validation are unavailable."
            );
        }

        const head = await withTimeout(
            requestUrl({ url, method: "HEAD" }),
            this.totalTimeoutMs,
            "Remote image HEAD request"
        );
        if (head.status < 200 || head.status >= 300) {
            throw new Error(t("MSG_STREAM_HEAD_HTTP_ERROR", [head.status]));
        }
        const headHeaders = normalizeRequestUrlHeaders(head.headers);
        const declaredLength = parseContentLength(headHeaders);
        if (declaredLength === null) {
            throw new Error(t("MSG_STREAM_CONTENT_LENGTH_REQUIRED"));
        }
        if (declaredLength > this.maxBytes) {
            throw new Error(t("MSG_STREAM_SIZE_LIMIT"));
        }

        const response = await withTimeout(
            requestUrl({ url, method: "GET" }),
            this.totalTimeoutMs,
            "Remote image fetch"
        );
        if (response.status < 200 || response.status >= 300) {
            throw new Error(t("MSG_STREAM_HTTP_ERROR", [response.status]));
        }
        if (response.arrayBuffer.byteLength > this.maxBytes) {
            throw new Error(t("MSG_STREAM_SIZE_LIMIT"));
        }
        return {
            data: response.arrayBuffer,
            status: response.status,
            headers: Object.freeze(normalizeRequestUrlHeaders(response.headers)),
            finalUrl: url,
            transport: "requestUrl",
            redirectChainVerified: false,
            hardLimitEnforced: false
        };
    }
}

function resolveElectronNet(): ElectronNetLike | null {
    try {
        const electron = require("electron") as {
            net?: ElectronNetLike;
        };
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

function normalizeRequestUrlHeaders(
    headers: Record<string, string> | undefined
): Record<string, string> {
    if (!headers) return {};
    return Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [
            name.toLowerCase(),
            value
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
