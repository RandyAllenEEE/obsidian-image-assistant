import { App, MarkdownView, Notice, TFile } from 'obsidian';
import { t } from '../../../lang/helpers';
import ImageConverterPlugin from '../../../main';
import { FolderAndFilenameManagement } from '../../../local/FolderAndFilenameManagement';

/**
 * Handles upload and download operations for images
 */
export class UploadDownloadHandler {
    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private folderManagement: FolderAndFilenameManagement
    ) { }

    /**
     * Upload a local image to cloud storage
     * 上传本地图片到图床
     * @param img - The HTMLImageElement
     */
    async uploadImageToCloud(img: HTMLImageElement) {
        try {
            // Get image path
            const imagePath = this.folderManagement.getImagePath(img);
            if (!imagePath) {
                new Notice(t("MSG_RESOLVE_PATH_FAIL"));
                console.warn('[Upload] Cannot resolve image path for:', img.getAttribute('src'));
                return;
            }

            // Get TFile object
            const file = this.app.vault.getAbstractFileByPath(imagePath);
            if (!(file instanceof TFile)) {
                new Notice(t("MSG_FILE_NOT_FOUND"));
                console.warn('[Upload] File not found:', imagePath);
                return;
            }

            // Call the plugin's uploadSingleFile method
            await this.plugin.uploadSingleFile(file);
        } catch (error) {
            console.error('[Upload] Error uploading image:', error);
            new Notice(t("MSG_UPLOAD_FAILED").replace("{0}", error.message));
        }
    }

    /**
     * Download a network image to local storage
     * 下载网络图片到本地
     * @param img - The HTMLImageElement
     */
    async downloadNetworkImage(img: HTMLImageElement) {
        try {
            const src = img.getAttribute('src');
            if (!src) {
                new Notice(t("MSG_RESOLVE_PATH_FAIL"));
                return;
            }

            // Get active view and editor
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView || !activeView.file) {
                new Notice(t("MSG_NO_ACTIVE_VIEW"));
                return;
            }

            const activeFile = activeView.file;
            const editor = activeView.editor;

            // Call NetworkImageDownloader to download the single image
            const downloader = this.plugin.networkDownloader;
            if (!downloader) {
                new Notice(t("MSG_DOWNLOADER_UNAVAILABLE"));
                return;
            }

            // Download and replace the link (pass editor for automatic link replacement)
            const success = await downloader.downloadSingleImage(src, activeFile, editor);

            if (success) {
                new Notice(t("MSG_DOWNLOAD_SUCCESS"));
            } else {
                new Notice(t("MSG_DOWNLOAD_FAILED").replace("{0}", "Unknown error"));
            }
        } catch (error) {
            console.error('[Download] Error downloading network image:', error);
            new Notice(t("MSG_DOWNLOAD_FAILED").replace("{0}", error.message));
        }
    }
}
