import { requestUrl } from "obsidian";
import type ImageConverterPlugin from "../main";

export interface CloudImageInfo {
    url: string;
    configMap?: Record<string, any>;
}

export type CloudDeleteFailureReason =
    | 'unsupported-uploader'
    | 'missing-delete-server'
    | 'missing-history'
    | 'api-failed'
    | 'request-failed';

export interface CloudDeleteResult {
    success: boolean;
    reason?: CloudDeleteFailureReason;
    message?: string;
    uploader?: string;
}

export class CloudImageDeleter {
    plugin: ImageConverterPlugin;

    constructor(plugin: ImageConverterPlugin) {
        this.plugin = plugin;
    }

    /**
     * Delete an image from cloud storage (PicList only)
     * 从云存储删除图片（仅 PicList 支持）
     * @param imageInfo - Cloud image information
     * @returns Detailed delete result
     */
    async deleteImageDetailed(imageInfo: CloudImageInfo): Promise<CloudDeleteResult> {
        const cloudSettings = this.plugin.settings.pasteHandling.cloud;

        // Only PicList supports deletion
        if (cloudSettings.uploader !== 'PicList') {
            console.warn('[Cloud Delete] Uploader is not PicList, skipping cloud deletion');
            return {
                success: false,
                reason: 'unsupported-uploader',
                uploader: cloudSettings.uploader
            };
        }

        if (!cloudSettings.deleteServer) {
            console.warn('[Cloud Delete] Delete server not configured');
            return {
                success: false,
                reason: 'missing-delete-server',
                uploader: cloudSettings.uploader
            };
        }

        try {
            // Find the image in history
            const matchingImage = this.plugin.historyManager.getRecord(imageInfo.url);

            if (!matchingImage) {
                console.warn('[Cloud Delete] Image not found in upload history');
                return {
                    success: false,
                    reason: 'missing-history',
                    uploader: cloudSettings.uploader
                };
            }

            console.log('[Cloud Delete] Deleting image from cloud:', matchingImage);

            const response = await requestUrl({
                url: cloudSettings.deleteServer,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    list: [matchingImage],
                }),
            });

            const data = response.json;
            console.log('[Cloud Delete] Delete response:', data);

            if (!data || typeof data !== 'object') {
                console.error('[Cloud Delete] Invalid delete response:', data);
                return {
                    success: false,
                    reason: 'api-failed',
                    message: 'Invalid delete response',
                    uploader: cloudSettings.uploader
                };
            }

            if ((data as { success?: unknown }).success === true) {
                // Remove from history
                await this.plugin.historyManager.removeRecord(imageInfo.url);
                return { success: true };
            } else {
                const message = getDeleteResponseMessage(data);
                console.error('[Cloud Delete] Delete failed:', message);
                return {
                    success: false,
                    reason: 'api-failed',
                    message,
                    uploader: cloudSettings.uploader
                };
            }
        } catch (error) {
            console.error('[Cloud Delete] Error deleting image:', error);
            return {
                success: false,
                reason: 'request-failed',
                message: error instanceof Error ? error.message : String(error),
                uploader: cloudSettings.uploader
            };
        }
    }

    /**
     * Delete an image from cloud storage and return only success status.
     * Kept for callers that do not need failure details.
     */
    async deleteImage(imageInfo: CloudImageInfo): Promise<boolean> {
        return (await this.deleteImageDetailed(imageInfo)).success;
    }

    /**
     * Check if an image URL is from cloud storage
     * 检查图片 URL 是否来自云存储
     */
    isCloudImage(url: string): boolean {
        if (!url) return false;
        return url.startsWith('http://') || url.startsWith('https://');
    }
}

function getDeleteResponseMessage(data: Record<string, unknown>): string {
    if (typeof data.msg === 'string' && data.msg.trim()) return data.msg;
    if (typeof data.message === 'string' && data.message.trim()) return data.message;
    return 'Delete failed';
}
