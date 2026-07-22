import { requestUrl } from "obsidian";
import { t } from "../lang/helpers";
import {
    AbortableDesktopHttpClient,
    type ElectronNetLike
} from "./AbortableDesktopHttpClient";
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

export class StreamingImageFetcher {
    private static fallbackWarningShown = false;
    private readonly maxBytes: number;
    private readonly totalTimeoutMs: number;
    private readonly idleTimeoutMs: number;
    private readonly maxRedirects: number;
    private readonly desktopClient: AbortableDesktopHttpClient;

    constructor(options: StreamingImageFetcherOptions = {}) {
        this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        this.totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
        this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
        this.maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
        this.desktopClient = new AbortableDesktopHttpClient(
            options.electronNetProvider
        );
    }

    async fetch(
        url: string,
        signal?: AbortSignal
    ): Promise<StreamingImageFetchResult> {
        const validationError = await validatePublicHttpUrl(url);
        if (validationError) throw new Error(validationError);

        if (this.desktopClient.isAvailable()) {
            const response = await this.desktopClient.request({
                url,
                method: "GET",
                responseLimitBytes: this.maxBytes,
                totalTimeoutMs: this.totalTimeoutMs,
                idleTimeoutMs: this.idleTimeoutMs,
                maxRedirects: this.maxRedirects,
                redirectPolicy: "follow",
                validateUrl: validatePublicHttpUrl,
                signal
            });
            if (response.status < 200 || response.status >= 300) {
                throw new Error(t("MSG_STREAM_HTTP_ERROR", [response.status]));
            }
            return {
                data: response.data,
                status: response.status,
                headers: response.headers,
                finalUrl: response.finalUrl,
                transport: "electron",
                redirectChainVerified: true,
                hardLimitEnforced: true
            };
        }
        return this.fetchWithRequestUrl(url);
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
