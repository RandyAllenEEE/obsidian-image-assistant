import { TFile } from 'obsidian';
import ImageConverterPlugin from '../../main';
import { UploaderManager } from '../uploader';
import { CloudLinkFormatter } from '../CloudLinkFormatter';

/**
 * SingleImageUploader - Shared logic for uploading a single image.
 */
export class SingleImageUploader {
    constructor(
        private plugin: ImageConverterPlugin
    ) { }

    async uploadSingleImage(
        file: TFile
    ): Promise<{ success: boolean; url?: string; error?: string }> {
        try {
            const uploaderManager = new UploaderManager(
                this.plugin.settings.pasteHandling.cloud.uploader,
                this.plugin
            );

            // Read file binary
            const arrayBuffer = await file.vault.readBinary(file);
            const blob = new Blob([arrayBuffer]);
            const uploadFile = new File([blob], file.name, { type: 'image/' + file.extension });

            // FileList is not directly constructible in some environments, but DataTransfer is
            const dataTransfer = new DataTransfer();
            dataTransfer.items.add(uploadFile);
            const fileList = dataTransfer.files;

            const uploadResult = await uploaderManager.uploadByClipboard(fileList);
            if (uploadResult.success && uploadResult.result.length > 0) {
                const cloudUrl = uploadResult.result[0];
                const cloudLink = CloudLinkFormatter.formatCloudLink(
                    cloudUrl,
                    this.plugin.settings.pasteHandling.cloud,
                    file.basename
                );

                // Add to history
                this.plugin.historyManager.addRecord({
                    url: cloudUrl,
                    localPath: file.path,
                    imgUrl: cloudUrl,
                    name: file.name
                });

                return { success: true, url: cloudUrl };
            } else {
                return {
                    success: false,
                    error: uploadResult.errorMessage || "Unknown upload error"
                };
            }
        } catch (error) {
            console.error(`Failed to upload image ${file.path}:`, error);
            return { success: false, error: error.message };
        }
    }
}
