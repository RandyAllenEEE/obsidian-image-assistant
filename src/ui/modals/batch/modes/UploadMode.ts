import { App, Notice, TFile, TFolder, Setting, ButtonComponent } from "obsidian";
import ImageConverterPlugin from "../../../../main";
import { BatchTask, BatchItemResult, BatchResult, BatchScope } from "../../../../types/BatchTypes";
import { IBatchMode, ReviewAction } from "./IBatchMode";
import { t } from "../../../../lang/helpers";
import { CloudImageDeleter } from "../../../../cloud/CloudImageDeleter";
import { ImageLinkPathReplacer } from "../../../../utils/ImageLinkPathReplacer";
import { getAllImageLinks } from "../../../../utils/RegexPatterns";
import { buildAllowedPathSet } from "../../../../utils/batch";

export class UploadMode implements IBatchMode {
    id = "upload" as const;
    name = t("BATCH_MODE_UPLOAD" as any);

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private target: TFile | TFolder | null,
        private scope: BatchScope
    ) { }

    renderSettings(container: HTMLElement): void {
        new Setting(container)
            .setName(t("BATCH_UPLOAD_CONFIG" as any))
            .setDesc(t("BATCH_UPLOAD_DESC" as any))
            .addButton(b => b.setButtonText(t("MODAL_BUTTON_SETTINGS")).onClick(() => {
                this.plugin.commandOpenSettingsTab();
            }));
    }

    async loadTasks(): Promise<BatchTask[]> {
        const tasks: BatchTask[] = [];
        let files: TFile[] = [];

        // Identify files based on scope
        if (this.scope === "note" && this.target instanceof TFile) {
            const resolvedFiles: Map<string, TFile> = new Map();
            const useContentScan = !!this.plugin.settings.global.codeBlockImageLinkIndexing;

            if (useContentScan) {
                // When enabled, include references in fenced code blocks/admonitions.
                const content = await this.app.vault.read(this.target);
                const links = getAllImageLinks(content);
                for (const link of links) {
                    const linkPath = (link.path ?? '').trim();
                    if (!linkPath) continue;
                    if (linkPath.startsWith('http://') || linkPath.startsWith('https://')) continue; // local upload only

                    const dest = this.app.metadataCache.getFirstLinkpathDest(linkPath, this.target.path);
                    if (!dest?.path) continue;

                    const abstract = this.app.vault.getAbstractFileByPath(dest.path);
                    if (!(abstract instanceof TFile)) continue;
                    if (!this.plugin.supportedImageFormats.isSupported(abstract.extension, abstract.name)) continue;
                    resolvedFiles.set(abstract.path, abstract);
                }
            } else {
                // Default fast path: metadata cache embeds only.
                const cache = this.app.metadataCache.getFileCache(this.target);
                if (cache?.embeds) {
                    for (const embed of cache.embeds) {
                        const file = this.app.metadataCache.getFirstLinkpathDest(embed.link, this.target.path);
                        if (file && this.plugin.supportedImageFormats.isSupported(file.extension, file.name)) {
                            resolvedFiles.set(file.path, file);
                        }
                    }
                }
            }

            files = Array.from(resolvedFiles.values());
        } else if (this.scope === "folder" && this.target instanceof TFolder) {
            // Simple recursive scan?
            // Reusing logic from FolderBatchUploader might be better, but we need tasks here
            // Let's do a simple scan
            const collectImages = (folder: TFolder) => {
                for (const child of folder.children) {
                    if (child instanceof TFile && this.plugin.supportedImageFormats.isSupported(child.extension, child.name)) {
                        files.push(child);
                    } else if (child instanceof TFolder) {
                        collectImages(child);
                    }
                }
            };
            collectImages(this.target);
        } else if (this.scope === "vault") {
            files = this.app.vault.getFiles().filter(f => this.plugin.supportedImageFormats.isSupported(f.extension, f.name));
        }

        // Deduplicate
        files = [...new Set(files)];

        // Create tasks
        for (const file of files) {
            // Skip already uploaded?
            if (this.plugin.historyManager.isLocalPathUploaded(file.path)) {
                continue;
            }

            tasks.push({
                id: file.path,
                name: file.name,
                path: file.path,
                source: file,
                selected: true,
                status: 'pending'
            });
        }

        return tasks;
    }

    async processTask(task: BatchTask): Promise<BatchItemResult> {
        // Delegate to CloudImageHandler to upload single file
        // We can reuse SingleUploadHandler logic effectively if we exposed it,
        // or just use UploaderManager directly.
        // Task has 'source' as TFile.
        const file = task.source as TFile;
        // We use SingleUploadHandler's uploadWithRetry-like logic?
        // Or better, expose a simple upload method in CloudImageHandler.
        // CloudImageHandler.uploadSingleFile handles UI. We want headless.
        // CloudImageHandler.batchUpload is what we want!
        // But batchUpload takes specific files.

        // For simplicity and reuse, let's use the headless batch upload logic we implemented in CloudImageHandler
        // But since processTask is per task, we can just call uploader logic here.
        // Actually, let's use the new `batchUpload` we refactored in CloudImageHandler 
        // passing just this one file.

        try {
            const result = await this.plugin.cloudImageHandler.batchUpload([file]);
            if (result.successful.length > 0) {
                return result.successful[0];
            } else if (result.failed.length > 0) {
                return result.failed[0]; // Is BatchItemResult
            }
            return {
                success: false,
                item: file,
                error: "Unknown error"
            };
        } catch (e) {
            return {
                success: false,
                item: file,
                error: e.message
            };
        }
    }

    getReviewActions(): ReviewAction[] {
        return [
            { id: "replace_only", label: t("BATCH_ACTION_REPLACE_ONLY" as any), style: 'primary' },
            { id: "replace_delete", label: t("BATCH_ACTION_REPLACE_DELETE" as any), style: 'danger' },
            { id: "undo", label: t("BATCH_ACTION_UNDO" as any), style: 'default' }
        ];
    }

    async handleReviewAction(action: string, result: BatchResult): Promise<void> {
        if (!result) return;

        if (action === "undo") {
            const confirm = this.plugin.settings.pasteHandling.cloud.uploader === 'PicList';
            if (!confirm && !window.confirm(t("MSG_UNDO_CONFIRM_LOCAL"))) return;

            new Notice(t("MSG_UNDOING_UPLOAD"));
            const deleter = new CloudImageDeleter(this.plugin);
            for (const item of result.successful) {
                if (confirm && item.output) {
                    await deleter.deleteImage({ url: item.output as string });
                }
            }
            new Notice(t("MSG_UNDO_COMPLETE"));
            return;
        }

        // Build scope boundary: collect files within the current scope
        const allowedPathSet = buildAllowedPathSet(this.scope, this.target, this.app);

        let count = 0;
        for (const item of result.successful) {
            const file = item.item as TFile;
            const cloudUrl = item.output as string;

            const updated = await this.plugin.vaultReferenceManager.updateReferences(file.path, (loc) => {
                if (!allowedPathSet.has(loc.file.path)) return loc.original;
                return ImageLinkPathReplacer.replacePath(loc.original, cloudUrl);
            });
            count += updated;

            if (action === "replace_delete") {
                await this.app.vault.trash(file, true);
            }
        }

        new Notice(t("MSG_REPLACED_LINKS", [count.toString()]));
    }
}
