import { requestUrl } from "obsidian";
import type ImageConverterPlugin from "../main";

export interface CloudImageInfo {
    url: string;
    configMap?: Record<string, any>;
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
     * @returns Success status
     */
    async deleteImage(imageInfo: CloudImageInfo): Promise<boolean> {
        const settings = this.plugin.settings.cloudUploadSettings;

        // Only PicList supports deletion
        if (settings.uploader !== 'PicList') {
            console.warn('[Cloud Delete] Uploader is not PicList, skipping cloud deletion');
            return false;
        }

        if (!settings.deleteServer) {
            console.warn('[Cloud Delete] Delete server not configured');
            return false;
        }

        try {
            // Find the image in history
            const matchingImage = this.plugin.historyManager.getRecord(imageInfo.url);

            if (!matchingImage) {
                console.warn('[Cloud Delete] Image not found in upload history');
                return false;
            }

            console.log('[Cloud Delete] Deleting image from cloud:', matchingImage);

            const response = await requestUrl({
                url: settings.deleteServer,
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    list: [matchingImage],
                }),
            });

            const data = response.json;
            console.log('[Cloud Delete] Delete response:', data);

            if (data.success) {
                // Remove from history
                await this.plugin.historyManager.removeRecord(imageInfo.url);
                return true;
            } else {
                console.error('[Cloud Delete] Delete failed:', data.msg || data.message);
                return false;
            }
        } catch (error) {
            console.error('[Cloud Delete] Error deleting image:', error);
            return false;
        }
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
