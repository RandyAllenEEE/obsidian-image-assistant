import { App, Notice, TFile, TFolder } from 'obsidian';
import ImageConverterPlugin from '../../main';
import { ImageLinkPathReplacer } from "../../utils/ImageLinkPathReplacer";
import { SingleImageUploader } from "./SingleImageUploader";

// Unified Batch Tools
import {
    ImageFileCollector,
    BatchExecutor,
    BatchProgressManager,
    showBatchConfirmDialog,
    BatchTask,
    MultiRefItem,
    computeMultiRefItems
} from "../../utils/batch";

/**
 * Shared base class for cloud batch uploaders (Vault and Folder).
 * Consolidates common constructor, filtering, task building, and link replacement logic.
 */
export abstract class CloudBatchUploader {
    protected collector: ImageFileCollector;
    protected uploader: SingleImageUploader;
    protected executor: BatchExecutor<TFile>;
    protected progressManager: BatchProgressManager;

    constructor(
        protected app: App,
        protected plugin: ImageConverterPlugin
    ) {
        this.collector = new ImageFileCollector(app, plugin);
        this.uploader = new SingleImageUploader(plugin);
        this.executor = new BatchExecutor({
            concurrency: this.plugin.settings.pasteHandling.cloud.uploadConcurrency || 3,
            collectErrors: true
        });
        this.progressManager = new BatchProgressManager(plugin);
    }

    /**
     * Subclasses implement to provide the images to upload.
     */
    protected abstract getFilesToUpload(): Promise<TFile[]>;

    /**
     * Subclasses implement to provide the scope path for the dialog title.
     */
    protected abstract getScopePath(): string;

    /**
     * Subclasses implement to provide the dialog title.
     */
    protected abstract getDialogTitle(): string;

    /**
     * Filter out images that have already been uploaded.
     */
    protected filterAlreadyUploaded(images: TFile[]): TFile[] {
        return images.filter(file => !this.plugin.historyManager.isUrlUploaded(file.path));
    }

    /**
     * Build BatchTasks from a list of files.
     */
    protected buildTasks(files: TFile[]): BatchTask<TFile>[] {
        return BatchExecutor.createTasks(
            files,
            file => file.name,
            async (file) => {
                const result = await this.uploader.uploadSingleImage(file);
                if (result.success && result.url) {
                    return { success: true, result: result.url };
                }
                return { success: false, error: result.error };
            }
        );
    }

    /**
     * Handle link replacement and optional source deletion after upload.
     */
    protected async finalizeAndCleanup(result: any, action: string): Promise<number> {
        let count = 0;
        if (action === 'replace-all' || action === 'replace-all-delete') {
            for (const r of result.successful) {
                const file = r.item;
                const cloudUrl = r.result;
                if (cloudUrl) {
                    const updated = await this.plugin.vaultReferenceManager.updateReferences(file.path, (loc) => {
                        return ImageLinkPathReplacer.replacePath(loc.original, cloudUrl);
                    });
                    count += updated;
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
        return count;
    }

    /**
     * Shared execution flow for both vault and folder batch upload.
     * Subclasses call this from their public method.
     */
    protected async executeUpload(
        actions: ('replace-all' | 'replace-all-delete' | 'process-only' | 'cancel')[]
    ): Promise<void> {
        try {
            // 1. Get files to upload
            this.progressManager.start('collecting');
            const images = await this.getFilesToUpload();

            if (images.length === 0) {
                new Notice('No images found.');
                return;
            }

            // 2. Filter Already Uploaded
            const filesToUpload = this.filterAlreadyUploaded(images);

            if (filesToUpload.length === 0) {
                new Notice('No images to upload (all already uploaded).');
                return;
            }

            // 3. Pre-calculate Reference Info
            new Notice("Scanning references...");
            const multiRefItems = await computeMultiRefItems(filesToUpload, this.plugin);

            // 4. Confirm Dialog
            const action = await showBatchConfirmDialog(this.app, {
                title: this.getDialogTitle(),
                totalCount: filesToUpload.length,
                multiRefItems,
                scopePath: this.getScopePath(),
                actions,
                mode: 'cloud'
            });

            if (action === 'cancel') return;

            // 5. Execute Upload
            this.progressManager.setPhase('executing');
            const tasks = this.buildTasks(filesToUpload);
            const result = await this.executor.execute(tasks, this.progressManager);

            // 6. Handle Link Replacements
            this.progressManager.setPhase('finalizing');
            await this.finalizeAndCleanup(result, action);

            this.progressManager.complete(result.successful.length);
            if (result.failed.length > 0) {
                this.executor.showSummary(tasks.length, result.successful.length, 'Upload');
            }

            if (this.plugin.settings.captions.enabled) {
                this.plugin.imageStateManager?.refreshAllImages();
            }

        } catch (error) {
            console.error('Error in batch upload:', error);
            new Notice(`Error in batch upload: ${error.message}`);
            this.progressManager.cancel();
        }
    }
}

// Re-export SingleImageUploader for subclass use
export { SingleImageUploader } from "./SingleImageUploader";