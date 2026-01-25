import { App, Notice, TFile } from 'obsidian';
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
 * VaultBatchUploader - Uploads all images in the entire vault to cloud.
 * NEW FEATURE using unified batch tools.
 */
export class VaultBatchUploader {
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

    async uploadAllVaultImages(): Promise<void> {
        try {
            // 1. Collect All Images
            this.progressManager.start('collecting');
            const images = await this.collector.getAllImageFiles();

            if (images.length === 0) {
                new Notice('No images found in the vault.');
                return;
            }

            // 2. Filter Already Uploaded
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

            // 3. Pre-calculate Reference Info
            new Notice("Scanning references (this may take a while)...");
            const multiRefItems: MultiRefItem[] = [];

            // Limit scanning for huge vaults? Or just warn?
            // Unified tools handle batch logic well, but scanning thousands of files for refs is slow.
            // Let's do it but warn user if many files.

            for (const file of filesToUpload) {
                const refs = await this.plugin.vaultReferenceManager.getFilesReferencingImage(file.path);
                if (refs.length > 0) {
                    multiRefItems.push({
                        name: file.name,
                        vaultReferences: refs.length,
                        currentNoteReferences: 0,
                        otherNotesReferences: refs.length
                    });
                }
            }

            // 4. Confirm Dialog
            const action = await showBatchConfirmDialog(this.app, {
                title: 'Process All Vault Images (Cloud Upload)',
                totalCount: filesToUpload.length,
                multiRefItems,
                scopePath: '/',
                actions: ['replace-all', 'replace-all-delete', 'process-only', 'cancel'],
                mode: 'cloud'
            });

            if (action === 'cancel') return;

            // 5. Execute Upload
            this.progressManager.setPhase('executing');

            const tasks: BatchTask<TFile>[] = BatchExecutor.createTasks(
                filesToUpload,
                file => file.name,
                async (file) => {
                    const result = await this.uploader.uploadSingleImage(file);
                    if (result.success && result.url) {
                        return { success: true, result: result.url };
                    }
                    return { success: false, error: result.error };
                }
            );

            const result = await this.executor.execute(tasks, this.progressManager);

            // 6. Handle Link Replacements
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
            console.error('Error uploading vault images:', error);
            new Notice(`Error uploading vault images: ${error.message}`);
            this.progressManager.cancel();
        }
    }
}
