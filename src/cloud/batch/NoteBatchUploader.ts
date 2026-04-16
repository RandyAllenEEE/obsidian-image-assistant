import { App, Notice, TFile, normalizePath } from "obsidian";
import { join } from "path-browserify";
import ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { CloudResourceHelpers } from "../utils/CloudResourceHelpers";
import { SingleImageUploader } from "./SingleImageUploader";
import { ImageLinkPathReplacer } from "../../utils/ImageLinkPathReplacer";
import { getAllImageLinks } from "../../utils/RegexPatterns";

// Unified Batch Tools
import {
    BatchExecutor,
    BatchProgressManager,
    showBatchConfirmDialog,
    BatchTask,
    MultiRefItem,
    BatchResult,
    computeMultiRefItems
} from "../../utils/batch";

/**
 * NoteBatchUploader - Uploads all local images in a note to cloud.
 * Refactored to use unified batch tools.
 */
export interface UploadItem {
    file: TFile | null;
    isNetwork: boolean;
    path: string;
    links: string[];
}

/**
 * NoteBatchUploader - Uploads all local images in a note to cloud.
 * Refactored to use unified batch tools.
 */
export class NoteBatchUploader {
    private uploader: SingleImageUploader;
    private helpers: CloudResourceHelpers;
    private executor: BatchExecutor<UploadItem>;
    private progressManager: BatchProgressManager;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin
    ) {
        this.uploader = new SingleImageUploader(plugin);
        this.helpers = new CloudResourceHelpers(plugin);
        this.executor = new BatchExecutor({
            concurrency: this.plugin.settings.pasteHandling.cloud.uploadConcurrency || 3,
            collectErrors: true
        });
        this.progressManager = new BatchProgressManager(plugin);
    }

    /**
     * Upload all local images in the current note to cloud storage
     */
    async uploadAllImages(): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice(t("MSG_NO_ACTIVE_FILE") || 'No active file found.');
            return;
        }

        try {
            // 1. Collect image links directly from active file content
            const activeContent = await this.app.vault.read(activeFile);
            const allImageLinks = getAllImageLinks(activeContent);

            if (allImageLinks.length === 0) {
                new Notice("No images found in current note.");
                return;
            }

            // 2. Filter images (Network, Already Uploaded, Blacklisted)
            const filteredImageLinks = allImageLinks.filter(img => {
                const isNetworkImage = img.path.startsWith('http://') || img.path.startsWith('https://');

                if (this.plugin.historyManager.isUrlUploaded(img.path)) {
                    return false;
                }

                if (isNetworkImage) {
                    if (!this.plugin.settings.pasteHandling.cloud.workOnNetWork) return false;
                    if (this.helpers.isBlacklistedDomain(img.path)) return false;
                    return true;
                }
                return true;
            });

            if (filteredImageLinks.length === 0) {
                new Notice('No images to upload. All images are filtered or already uploaded.');
                return;
            }

            // 3. Resolve Files
            // Note: BatchExecutor works on Items. Here items are complex (File + Links).
            // We need to resolve unique files to upload.

            // Map path -> TFile (for local files)
            const filePathMap: Record<string, TFile> = {};
            this.app.vault.getFiles().forEach(file => filePathMap[file.path] = file);

            // Group by unique file/resource
            const uniqueResources = new Map<string, UploadItem>();

            for (const link of filteredImageLinks) {
                const uri = decodeURI(link.path);
                let uniqueKey = uri;
                let file: TFile | null = null;
                const isNetwork = uri.startsWith('http') || uri.startsWith('https');

                if (!isNetwork) {
                    // Resolve local file
                    file = this.resolveLocalFile(uri, activeFile, filePathMap);
                    if (!file) continue; // Skip if file not found
                    uniqueKey = file.path;
                }

                if (!uniqueResources.has(uniqueKey)) {
                    uniqueResources.set(uniqueKey, {
                        file,
                        isNetwork,
                        path: uniqueKey,
                        links: []
                    });
                }
                uniqueResources.get(uniqueKey)!.links.push(link.source);
            }

            const tasksToUpload = Array.from(uniqueResources.values());

            if (tasksToUpload.length === 0) {
                new Notice('No valid images found to upload.');
                return;
            }

            // 4. Validate Files (Unified)
            // Note: BatchExecutor handles execution, but validation is pre-check here for confirmation dialog
            // We can skip explicit validation loop since implicit validation happened during resolution above.

            // 5. Pre-calculate Reference Info for Dialog
            new Notice(t("MSG_SCANNING_REFS") || "Scanning references...");
            const localFiles = tasksToUpload
                .filter(t => !t.isNetwork && t.file)
                .map(t => t.file!);
            const multiRefItems = await computeMultiRefItems(localFiles, this.plugin, activeFile.path);

            // 6. Confirm Dialog
            const action = await showBatchConfirmDialog(this.app, {
                title: 'Batch Upload Images',
                totalCount: tasksToUpload.length,
                multiRefItems,
                scopePath: activeFile.path,
                actions: ['replace-current', 'replace-all', 'replace-all-delete', 'cancel'],
                mode: 'cloud'
            });

            if (action === 'cancel') return;

            // 7. Execute Batch Upload
            this.progressManager.start('executing');

            const batchTasks: BatchTask<UploadItem>[] = tasksToUpload.map(item => ({
                input: item,
                name: item.isNetwork ? item.path : item.file!.name,
                execute: async () => {
                    if (!item.isNetwork && item.file) {
                        return this.uploader.uploadSingleImage(item.file);
                    } else if (item.isNetwork) {
                        // Network upload fallback
                        const { UploaderManager } = require("../uploader");
                        const mgr = new UploaderManager(this.plugin.settings.pasteHandling.cloud.uploader, this.plugin);
                        const result = await mgr.upload([item.path]);
                        if (result.success && result.result.length > 0) {
                            const url = result.result[0];
                            this.plugin.historyManager.addRecord({
                                url: url,
                                imgUrl: url,
                                localPath: item.path,
                                name: item.path.split('/').pop() || item.path
                            });
                            return { success: true, result: url }; // Return URL as result
                        }
                        return { success: false, error: result.msg || "Upload failed" };
                    }
                    return { success: false, error: "Invalid item" };
                }
            }));


            const result = await this.executor.execute(batchTasks, this.progressManager);

            // 8. Handle Link Replacements
            // Result.successful has { item, result (url) }

            this.progressManager.setPhase('finalizing');
            let replacedCount = 0;

            const urlMap = new Map<string, string>();
            result.successful.forEach(r => {
                if (r.result) {
                    urlMap.set(r.item.path, r.result);
                }
            });

            if (action === 'replace-current') {
                // Replace links in the active note only, using VaultReferenceManager for precision.
                for (const item of tasksToUpload) {
                    const cloudUrl = urlMap.get(item.path);
                    if (!cloudUrl) continue;

                    if (!item.isNetwork && item.file) {
                        const updated = await this.plugin.vaultReferenceManager.updateReferencesInFile(
                            activeFile,
                            item.file.path,
                            (loc) => ImageLinkPathReplacer.replacePath(loc.original, cloudUrl)
                        );
                        replacedCount += updated;
                    } else {
                        // Network image: replace all occurrences in active file via regex.
                        const currentContent = await this.app.vault.read(activeFile);
                        const newContent = ImageLinkPathReplacer.replaceUrlInLinks(currentContent, item.path, cloudUrl);
                        if (newContent !== currentContent) {
                            await this.app.vault.modify(activeFile, newContent);
                            replacedCount++;
                        }
                    }
                }
            }
            else if (action === 'replace-all' || action === 'replace-all-delete') {
                // Replace in all files vault-wide
                for (const item of tasksToUpload) {
                    const cloudUrl = urlMap.get(item.path);
                    if (!cloudUrl) continue;

                    if (!item.isNetwork && item.file) {
                        const updated = await this.plugin.vaultReferenceManager.updateReferences(item.file.path, (loc) => {
                            return ImageLinkPathReplacer.replacePath(loc.original, cloudUrl);
                        });
                        replacedCount += updated;
                    } else {
                        // Network image: replace in active note only
                        const currentContent = await this.app.vault.read(activeFile);
                        const newContent = ImageLinkPathReplacer.replaceUrlInLinks(currentContent, item.path, cloudUrl);
                        if (newContent !== currentContent) {
                            await this.app.vault.modify(activeFile, newContent);
                            replacedCount++;
                        }
                    }
                }

                // Delete source
                if (action === 'replace-all-delete') {
                    for (const r of result.successful) {
                        if (!r.item.isNetwork && r.item.file) {
                            await this.app.vault.trash(r.item.file, true);
                        }
                    }
                }
            }

            this.progressManager.complete(result.successful.length);

            if (result.failed.length > 0) {
                this.executor.showSummary(tasksToUpload.length, result.successful.length, 'Upload');
            }

            if (this.plugin.settings.captions.enabled) {
                this.plugin.imageStateManager?.refreshAllImages();
            }

        } catch (error) {
            console.error('[Batch Upload] Unhandled error:', error);
            new Notice(`Batch upload failed: ${error.message}`);
            this.progressManager.cancel();
        }
    }

    private resolveLocalFile(uri: string, activeFile: TFile, filePathMap: Record<string, TFile>): TFile | null {
        // Direct match
        if (filePathMap[uri]) return filePathMap[uri];

        // Relative path
        if (uri.startsWith('./') || uri.startsWith('../')) {
            const absolute = normalizePath(join(activeFile.parent?.path || '', uri));
            if (filePathMap[absolute]) return filePathMap[absolute];
        }

        // Basename match (slow but common in Obsidian)
        // Optimization: build basename map once if needed, but for now iterate or rely on map passed in
        // We only passed filePathMap. Let's rely on standard Vault resolution if possible, 
        // or simple basename check if needed.
        // Original code built fileNameMap.
        const nameMatch = Object.values(filePathMap).find(f => f.name === uri || f.basename === uri);
        if (nameMatch) return nameMatch;

        return null;
    }
}
