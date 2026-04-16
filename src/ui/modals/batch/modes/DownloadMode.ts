import { App, Notice, TFile, TFolder, Setting } from "obsidian";
import ImageConverterPlugin from "../../../../main";
import { BatchTask, BatchItemResult, BatchResult, BatchScope } from "../../../../types/BatchTypes";
import { IBatchMode, ReviewAction } from "./IBatchMode";
import { t } from "../../../../lang/helpers";
import { CloudImageDeleter } from "../../../../cloud/CloudImageDeleter";
import { ImageLinkPathReplacer } from "../../../../utils/ImageLinkPathReplacer";
import { getAllImageLinks } from "../../../../utils/RegexPatterns";

export class DownloadMode implements IBatchMode {
    id = "download" as const;
    name = t("BATCH_MODE_DOWNLOAD" as any);

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private target: TFile | TFolder | null,
        private scope: BatchScope
    ) { }

    renderSettings(container: HTMLElement): void {
        new Setting(container)
            .setName(t("BATCH_DOWNLOAD_CONFIG"))
            .setDesc(t("BATCH_DOWNLOAD_DESC"));
    }

    async loadTasks(): Promise<BatchTask[]> {
        const tasks: BatchTask[] = [];
        let files: TFile[] = [];

        if (this.scope === "note" && this.target instanceof TFile) {
            files.push(this.target);
        } else if (this.scope === "folder" && this.target instanceof TFolder) {
            const collectFiles = (folder: TFolder) => {
                for (const child of folder.children) {
                    if (child instanceof TFile && child.extension === "md") {
                        files.push(child);
                    } else if (child instanceof TFolder) {
                        collectFiles(child);
                    }
                }
            };
            collectFiles(this.target);
        } else if (this.scope === "vault") {
            files = this.app.vault.getMarkdownFiles();
        }

        // We need to instantiate UploadHelper. 
        // Note: UploadHelper constructor expects 'app'.
        // But UploadHelper logic often works on 'current active file' if not careful.
        // Let's check UploadHelper.getAllImageLinks.
        // It uses `this.app.workspace.getActiveFile()`. 
        // This is bad for batch of other files.
        // We might need to manually parse if UploadHelper is tied to ActiveFile.
        // Looking at CloudImageHandler usage: `const helper = new UploadHelper(this.app); const links = helper.getAllImageLinks();`
        // It likely reads active file.

        // If we want to support batch for OTHER files, we must rely on MetadataCache.

        for (const file of files) {
            const links = new Set<string>();
            const useContentScan = !!this.plugin.settings.global.codeBlockImageLinkIndexing;

            if (useContentScan) {
                const content = await this.app.vault.read(file);
                for (const link of getAllImageLinks(content)) {
                    const rawPath = (link.path ?? "").trim();
                    if (!rawPath.startsWith("http://") && !rawPath.startsWith("https://")) continue;
                    if (!this.plugin.supportedImageFormats.isSupported(undefined, rawPath)) continue;
                    links.add(rawPath);
                }
            } else {
                const cache = this.app.metadataCache.getFileCache(file);
                if (!cache) continue;

                if (cache.embeds) {
                    for (const embed of cache.embeds) {
                        if (embed.link.startsWith("http://") || embed.link.startsWith("https://")) {
                            links.add(embed.link);
                        }
                    }
                }

                if (cache.links) {
                    for (const link of cache.links) {
                        if ((link.link.startsWith("http://") || link.link.startsWith("https://"))
                            && this.plugin.supportedImageFormats.isSupported(undefined, link.link)) {
                            links.add(link.link);
                        }
                    }
                }
            }

            // 3. Regex for direct image tags? (![])
            // MetadataCache should catch standard markdown images as embeds.
            // But HTML <img> tags?
            // MetadataCache doesn't catch HTML.
            // If we need full support we might need to read file content.
            // For now, relying on MetadataCache for performance is reasonable for batch.

            for (const link of links) {
                tasks.push({
                    id: `${file.path}|${link}`,
                    name: link.split('/').pop() || "image",
                    path: link, // The URL
                    source: link, // URL string
                    selected: true,
                    status: 'pending',
                    message: `Found in ${file.path}` // Optional context
                });
            }
        }

        // Deduplicate by URL?
        // If same URL is used in multiple files, we download once?
        // Or download multiple times?
        // NetworkDownloader likely handles dedupe if saving to same name/folder.
        // But if we want to replace links in multiple files, we need to track WHERE it is used.
        // The original implementation seemed to flatten list.
        // `downloadTasks` mapped `t.path` (url) to download.
        // `handleDownloadAction` updated links.

        // If we deduplicate here, we lose context of which file used it.
        // But `BatchTask` usually represents "One Action".
        // If we download "http://foo.png", we get "foo.png".
        // We can then replace "http://foo.png" in ALL files.
        // So deduplication by URL is PREFERRED.

        const uniqueTasks = new Map<string, BatchTask>();
        tasks.forEach(t => {
            if (!uniqueTasks.has(t.path)) {
                uniqueTasks.set(t.path, t);
            }
        });

        return Array.from(uniqueTasks.values());
    }

    async processTask(task: BatchTask): Promise<BatchItemResult> {
        const url = task.path;
        // Determine target setup
        // We need 'activeFile' logic from original.
        // `const activeFile = this.plugin.app.workspace.getActiveFile() || this.plugin.app.vault.getMarkdownFiles()[0];`
        // `const attachmentFolder = this.plugin.folderAndFilenameManagement.getDefaultAttachmentFolderPath(activeFile);`

        // We should try to use the file where we found the link if possible,
        // but since we deduped, we might just pick one or use current active file.
        const activeFile = this.app.workspace.getActiveFile() || this.app.vault.getMarkdownFiles()[0];
        const attachmentFolder = await this.plugin.folderAndFilenameManagement.getDefaultAttachmentFolderPath(activeFile);

        const downloadTask = {
            url: url,
            targetFolder: attachmentFolder,
            suggestedName: task.name,
            activeFile: activeFile
        };

        try {
            const result = await this.plugin.cloudImageHandler.batchDownload([downloadTask]);
            if (result.successful.length > 0) {
                return result.successful[0];
            } else if (result.failed.length > 0) {
                return result.failed[0];
            }
            return {
                success: false,
                item: url,
                error: "Unknown error"
            };
        } catch (e) {
            return {
                success: false,
                item: url,
                error: e.message
            };
        }
    }

    getReviewActions(): ReviewAction[] {
        const actions: ReviewAction[] = [
            { id: "replace_only", label: t("BATCH_REPLACE_LINKS_ONLY") || "Replace Links Only", style: 'primary' },
            { id: "undo", label: t("BATCH_UNDO_DOWNLOAD") || "Undo", style: 'default' }
        ];

        if (this.plugin.settings.pasteHandling.cloud.uploader === 'PicList') {
            actions.splice(1, 0, { id: "replace_delete_cloud", label: t("BATCH_REPLACE_DELETE_CLOUD") || "Replace & Delete Cloud", style: 'danger' });
        }

        return actions;
    }

    async handleReviewAction(action: string, result: BatchResult): Promise<void> {
        if (!result) return;

        if (action === "undo") {
            new Notice(t("MSG_DELETING_DOWNLOADED") || "Deleting downloaded files...");
            for (const item of result.successful) {
                const output = item.output as any;
                if (output && output.localPath) {
                    const file = this.app.vault.getAbstractFileByPath(output.localPath);
                    if (file instanceof TFile) {
                        await this.app.vault.trash(file, true);
                    }
                }
            }
            new Notice(t("MSG_UNDO_COMPLETE") || "Undo complete");
            return;
        }

        // For link replacement, we need to know which files reference these URLs.
        // Unlike UploadMode where we had `referencingNotes` (passed from modal), 
        // here we might need a re-scan or assume 'vault-wide' or 'scope-wide'.
        // "Replace" normally implies replacing where it was found.

        // Since we didn't pass `referencingNotes` to Mode, we must find them.
        // `VaultReferenceManager` can help find files referencing a URL?
        // `updateReferencesInFile` works if we know the file.
        // `getFilesReferencingImage` usually takes a PATH. Does it work for URLs?
        // `VaultReferenceManager` usually works for vault paths.
        // However, `updateReferences` logic in `CloudLinkFormatter` helps...

        // Original logic:
        // `const notesToUpdate = this.referencingNotes.filter(n => n.selected).map(n => n.file);`
        // It relied on Modal's reference scan.

        // Ideally, we should perform the reference scan either inside `handleReviewAction` 
        // or have `processTask` return context.

        // Strategy: Iterate all Markdown files in Scope (or Vault if scope is vault) 
        // and replace occurrences of the URL.

        let filesToScan: TFile[] = [];
        if (this.scope === "note" && this.target instanceof TFile) {
            filesToScan = [this.target];
        } else if (this.scope === "folder" && this.target instanceof TFolder) {
            // Collect
            const collectFiles = (folder: TFolder) => {
                for (const child of folder.children) {
                    if (child instanceof TFile && child.extension === "md") filesToScan.push(child);
                    else if (child instanceof TFolder) collectFiles(child);
                }
            };
            collectFiles(this.target);
        } else {
            filesToScan = this.app.vault.getMarkdownFiles();
        }
        const allowedPathSet = new Set(filesToScan.map(f => f.path));

        let count = 0;

        for (const item of result.successful) {
            const url = item.item as string; // Original URL
            const output = item.output as any;
            const localPath = output.localPath;

            if (!localPath) continue;

            const localFile = this.app.vault.getAbstractFileByPath(localPath) as TFile;
            if (!localFile) continue;

            const references = await this.plugin.vaultReferenceManager.getFilesReferencingUrl(url);
            const notesToUpdate = Array.from(new Set(
                references
                    .map(r => r.file)
                    .filter(note => allowedPathSet.has(note.path))
            ));

            for (const note of notesToUpdate) {
                const updated = await this.plugin.vaultReferenceManager.updateReferencesInFile(note, url, (loc) => {
                    const relativePath = this.app.metadataCache.fileToLinktext(
                        localFile,
                        note.path
                        // generateMarkdownLink? 
                    );
                    // Path-only replacement: preserve original wiki/markdown syntax & pipe syntax.
                    return ImageLinkPathReplacer.replacePath(loc.original, relativePath);
                });
                count += updated;
            }

            if (action === "replace_delete_cloud") {
                if (this.plugin.historyManager.isUrlUploaded(url)) {
                    const deleter = new CloudImageDeleter(this.plugin);
                    await deleter.deleteImage({ url: url });
                }
            }
        }
    }
}
