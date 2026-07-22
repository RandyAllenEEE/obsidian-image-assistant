import type ImageConverterPlugin from "../main";
import { t } from "../lang/helpers";
import {
    AbortableDesktopHttpClient
} from "../utils/AbortableDesktopHttpClient";
import { isHttpUrl } from "../utils/NetworkPolicy";

const CLOUD_REQUEST_TIMEOUT_MS = 60_000;
const CLOUD_IDLE_TIMEOUT_MS = 15_000;
const CLOUD_RESPONSE_LIMIT_BYTES = 1024 * 1024;

export interface CloudImageInfo {
    url: string;
    configMap?: Record<string, unknown>;
}

export type CloudDeleteFailureReason =
    | "unsupported-uploader"
    | "missing-delete-server"
    | "missing-history"
    | "transport-unavailable"
    | "api-failed"
    | "request-failed";

export interface CloudDeleteResult {
    success: boolean;
    reason?: CloudDeleteFailureReason;
    message?: string;
    uploader?: string;
    historyUpdated?: boolean;
}

export class CloudImageDeleter {
    constructor(
        private readonly plugin: ImageConverterPlugin,
        private readonly httpClient = new AbortableDesktopHttpClient()
    ) { }

    isDesktopTransportAvailable(): boolean {
        return this.httpClient.isAvailable();
    }

    async deleteImageDetailed(
        imageInfo: CloudImageInfo,
        signal?: AbortSignal
    ): Promise<CloudDeleteResult> {
        const cloudSettings = this.plugin.settings.pasteHandling.cloud;
        if (cloudSettings.uploader !== "PicList") {
            console.warn("[Cloud Delete] Uploader is not PicList, skipping cloud deletion");
            return {
                success: false,
                reason: "unsupported-uploader",
                uploader: cloudSettings.uploader
            };
        }
        if (!cloudSettings.deleteServer) {
            console.warn("[Cloud Delete] Delete server not configured");
            return {
                success: false,
                reason: "missing-delete-server",
                uploader: cloudSettings.uploader
            };
        }
        if (!isHttpUrl(cloudSettings.deleteServer)) {
            return {
                success: false,
                reason: "missing-delete-server",
                message: t("MSG_CLOUD_DELETE_ENDPOINT_INVALID"),
                uploader: cloudSettings.uploader
            };
        }
        if (!this.httpClient.isAvailable()) {
            return {
                success: false,
                reason: "transport-unavailable",
                message: t("MSG_CLOUD_DELETE_TRANSPORT_UNAVAILABLE"),
                uploader: cloudSettings.uploader
            };
        }

        try {
            const matchingImage = this.plugin.historyManager.getRecord(imageInfo.url);
            if (!matchingImage) {
                console.warn("[Cloud Delete] Image not found in upload history");
                return {
                    success: false,
                    reason: "missing-history",
                    uploader: cloudSettings.uploader
                };
            }

            const response = await this.httpClient.request({
                url: cloudSettings.deleteServer,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ list: [matchingImage] }),
                responseLimitBytes: CLOUD_RESPONSE_LIMIT_BYTES,
                totalTimeoutMs: CLOUD_REQUEST_TIMEOUT_MS,
                idleTimeoutMs: CLOUD_IDLE_TIMEOUT_MS,
                redirectPolicy: "reject",
                signal
            });
            if (response.status < 200 || response.status >= 300) {
                return {
                    success: false,
                    reason: "api-failed",
                    message: t("MSG_CLOUD_DELETE_HTTP_ERROR", [response.status]),
                    uploader: cloudSettings.uploader
                };
            }

            const data = parseJsonResponse(response.data);
            if (!data) {
                return {
                    success: false,
                    reason: "api-failed",
                    message: t("MSG_CLOUD_DELETE_RESPONSE_INVALID"),
                    uploader: cloudSettings.uploader
                };
            }
            if (data.success !== true) {
                return {
                    success: false,
                    reason: "api-failed",
                    message: getDeleteResponseMessage(data),
                    uploader: cloudSettings.uploader
                };
            }

            try {
                await this.plugin.historyManager.removeRecord(imageInfo.url);
                return { success: true, historyUpdated: true };
            } catch (error) {
                const message = getErrorMessage(error);
                console.error(
                    "[Cloud Delete] Remote object was deleted, but upload history could not be updated:",
                    error
                );
                return {
                    success: true,
                    historyUpdated: false,
                    message: t("REFERENCE_WORKFLOW_SOURCE_DELETED_HISTORY_STALE", [
                        message
                    ]),
                    uploader: cloudSettings.uploader
                };
            }
        } catch (error) {
            console.error("[Cloud Delete] Error deleting image:", error);
            return {
                success: false,
                reason: "request-failed",
                message: getErrorMessage(error),
                uploader: cloudSettings.uploader
            };
        }
    }

    isCloudImage(url: string): boolean {
        return isHttpUrl(url);
    }
}

function parseJsonResponse(data: ArrayBuffer): Record<string, unknown> | null {
    try {
        const text = new TextDecoder().decode(data);
        const parsed = JSON.parse(text) as unknown;
        return parsed && typeof parsed === "object"
            ? parsed as Record<string, unknown>
            : null;
    } catch {
        return null;
    }
}

function getDeleteResponseMessage(data: Record<string, unknown>): string {
    if (typeof data.msg === "string" && data.msg.trim()) return data.msg;
    if (typeof data.message === "string" && data.message.trim()) return data.message;
    return t("MSG_CLOUD_DELETE_PROVIDER_FAILED");
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
