import { App, TFolder, Notice, TFile } from 'obsidian';
import ImageConverterPlugin from '../../main';
import { CloudResourceHelpers } from "../utils/CloudResourceHelpers";
import { SingleImageUploader } from "./SingleImageUploader";
import { CloudLinkFormatter } from "../CloudLinkFormatter";

// Unified Batch Tools
import {
    ImageFileCollector,
    BatchExecutor,
    BatchProgressManager,
    showBatchConfirmDialog,
    BatchTask,
    MultiRefItem
} from "../../utils/batch";

/**
 * FolderBatchUploader - Uploads all images in a folder to cloud.
 * Refactored to use unified batch tools.
 */
export class FolderBatchUploader {
    private collector: ImageFileCollector;
    private uploader: SingleImageUploader;
    private executor: BatchExecutor<TFile>;
    private progressManager: BatchProgressManager;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin
    ) {
        this.collector = new ImageFileCollector(app, plugin);
        this.uploader = new SingleImageUploader(plugin);
        this.executor = new BatchExecutor({
            concurrency: this.plugin.settings.pasteHandling.cloud.uploadConcurrency || 3,
            collectErrors: true
        });
        this.progressManager = new BatchProgressManager(plugin);
    }

    async uploadImagesInFolder(folderPath: string, recursive: boolean): Promise<void> {
        try {
            // 1. Validate Folder
            const folder = this.app.vault.getAbstractFileByPath(folderPath);
            if (!(folder instanceof TFolder)) {
                new Notice('Error: Invalid folder path.');
                return;
            }

            // 2. Collect Images
            this.progressManager.start('collecting');
            const images = this.collector.getImageFilesInFolder(folder, recursive);

            if (images.length === 0) {
                new Notice('No images found in the folder.');
                return;
            }

            // 3. Filter Already Uploaded
            const filesToUpload: TFile[] = [];
            for (const file of images) {
                if (this.plugin.historyManager.isUrlUploaded(file.path)) {
                    continue;
                }
                filesToUpload.push(file);
            }

            if (filesToUpload.length === 0) {
                new Notice('No images to upload (all already uploaded).');
                return;
            }

            // 4. Pre-calculate Reference Info
            new Notice("Scanning references...");
            const multiRefItems: MultiRefItem[] = [];

            for (const file of filesToUpload) {
                const refs = await this.plugin.vaultReferenceManager.getFilesReferencingImage(file.path);
                if (refs.length > 0) {
                    // For folder upload, there is no "current note". All refs are "other".
                    multiRefItems.push({
                        name: file.name,
                        vaultReferences: refs.length,
                        currentNoteReferences: 0,
                        otherNotesReferences: refs.length
                    });
                }
            }

            // 5. Confirm Dialog
            const action = await showBatchConfirmDialog(this.app, {
                title: 'Batch Upload Folder',
                totalCount: filesToUpload.length,
                multiRefItems,
                scopePath: folderPath,
                actions: ['replace-all', 'replace-all-delete', 'process-only', 'cancel'],
                mode: 'cloud'
            });

            if (action === 'cancel') return;

            // 6. Execute Upload
            this.progressManager.setPhase('executing');

            const tasks: BatchTask<TFile>[] = BatchExecutor.createTasks(
                filesToUpload,
                file => file.name,
                async (file) => {
                    const result = await this.uploader.uploadSingleImage(file);
                    // SingleImageUploader returns {success, url, error}
                    // BatchExecutor result handles .result prop
                    if (result.success && result.url) {
                        return { success: true, result: result.url };
                    }
                    return { success: false, error: result.error };
                }
            );

            const result = await this.executor.execute(tasks, this.progressManager);

            // 7. Handle Link Replacements
            this.progressManager.setPhase('finalizing');

            if (action === 'replace-all' || action === 'replace-all-delete') {
                for (const r of result.successful) {
                    const file = r.item;
                    const cloudUrl = r.result; // URL
                    if (cloudUrl) {
                        await this.plugin.vaultReferenceManager.updateReferences(file.path, (loc) => {
                            return CloudLinkFormatter.formatCloudLink(
                                cloudUrl,
                                this.plugin.settings.pasteHandling.cloud,
                                file.basename
                            );
                        });
                    }
                }

                if (action === 'replace-all-delete') {
                    for (const r of result.successful) {
                        try {
                            await this.app.vault.trash(r.item, true);
                        } catch (e) {
                            console.error('Failed to trash file:', r.item.path);
                        }
                    }
                }
            }

            this.progressManager.complete(result.successful.length);
            if (result.failed.length > 0) {
                this.executor.showSummary(tasks.length, result.successful.length, 'Upload');
            }

            if (this.plugin.settings.captions.enabled) {
                this.plugin.imageStateManager?.refreshAllImages();
            }

        } catch (error) {
            console.error('Error uploading images in folder:', error);
            new Notice(`Error uploading images: ${error.message}`);
            this.progressManager.cancel();
        }
    }
}
