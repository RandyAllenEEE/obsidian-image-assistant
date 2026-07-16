import { App, ButtonComponent, Modal, Notice, TFile, TFolder, Setting } from "obsidian";
import ImageConverterPlugin from "../../../../main";
import {
    BatchDownloadConflictPolicy,
    BatchItemResult,
    BatchResult,
    BatchScope,
    BatchTask,
    BatchTaskDiscoveryResult
} from "../../../../types/BatchTypes";
import { IBatchMode, ReviewAction } from "./IBatchMode";
import { t } from "../../../../lang/helpers";
import { CloudImageDeleter } from "../../../../cloud/CloudImageDeleter";
import { ImageReferenceReplacer } from "../../../../utils/ImageReferenceReplacer";
import { getContextualImageLinks } from "../../../../utils/MarkdownSourceContext";
import type { DownloadResult } from "../../../../cloud/NetworkImageDownloader";
import { ReferenceSafetyService } from "../../../../utils/ReferenceSafetyService";
import { OperationResultModal } from "../../OperationResultModal";
import { ConfirmDialog } from "../../../../settings/SettingsModals";
import { isDomainBlacklisted } from "../../../../utils/NetworkPolicy";
import { getErrorMessage } from "../../../../utils/ErrorUtils";
import {
    getCanvasUrlReferencesDetailed,
    replaceCanvasUrlReferencesWithFile
} from "../../../../utils/CanvasReferenceUtils";
import { buildAllowedPathSet } from "../../../../utils/batch";

export interface DownloadTaskOrigin {
    file: TFile;
    targetFolder: string;
}

export interface DownloadTaskSource {
    url: string;
    origins: DownloadTaskOrigin[];
}

interface DownloadTaskOutputEntry {
    result: DownloadResult;
    targetFolder: string;
    files: TFile[];
}

interface DownloadTaskOutput {
    url: string;
    downloads: DownloadTaskOutputEntry[];
    errors: string[];
}

export class DownloadMode implements IBatchMode {
    id = "download" as const;
    name = t("BATCH_MODE_DOWNLOAD");
    private conflictPolicy: BatchDownloadConflictPolicy | null = null;

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

    async loadTasks(): Promise<BatchTaskDiscoveryResult> {
        let files: TFile[] = [];
        const failedFiles: string[] = [];
        const uncertainFiles: string[] = [];

        if (this.scope === "note" && this.target instanceof TFile) {
            files.push(this.target);
        } else if (this.scope === "folder" && this.target instanceof TFolder) {
            const collectFiles = (folder: TFolder) => {
                for (const child of folder.children) {
                    if (child instanceof TFile && (child.extension === "md" || child.extension === "canvas")) {
                        files.push(child);
                    } else if (child instanceof TFolder) {
                        collectFiles(child);
                    }
                }
            };
            collectFiles(this.target);
        } else if (this.scope === "vault") {
            files = this.app.vault.getFiles().filter(file =>
                file.extension === "md" || file.extension === "canvas"
            );
        }

        files.sort((a, b) => a.path.localeCompare(b.path));
        const grouped = new Map<string, { url: string; origins: DownloadTaskOrigin[] }>();
        for (const file of files) {
            const links = new Set<string>();
            const useContentScan = !!this.plugin.settings.global.codeBlockImageLinkIndexing;

            try {
                if (file.extension === "canvas") {
                    const content = await this.app.vault.read(file);
                    const canvasData = JSON.parse(content) as { nodes?: unknown };
                    if (!Array.isArray(canvasData.nodes)) throw new Error("Canvas nodes are invalid");
                    for (const rawNode of canvasData.nodes) {
                        if (!rawNode || typeof rawNode !== "object") continue;
                        const node = rawNode as { url?: unknown; text?: unknown };
                        if (typeof node.url === "string"
                            && this.isAllowedNetworkImageUrl(node.url)
                            && this.isLikelyCanvasImageUrl(node.url)) {
                            links.add(node.url);
                        }
                        if (typeof node.text !== "string") continue;
                        for (const link of getContextualImageLinks(node.text, {
                            includeFencedCode: useContentScan
                        })) {
                            const rawPath = (link.path ?? "").trim();
                            if (this.isAllowedNetworkImageUrl(rawPath)) links.add(rawPath);
                        }
                    }
                } else {
                    // Metadata cache remains the fast, authoritative path for
                    // ordinary embeds, including extensionless network images.
                    const cache = this.app.metadataCache.getFileCache(file);
                    for (const embed of cache?.embeds ?? []) {
                        if (this.isAllowedNetworkImageUrl(embed.link)) {
                            links.add(embed.link);
                        }
                    }

                    // Metadata does not consistently index callouts or the
                    // legacy Admonition plugin's `ad-*` fences. Supplement it
                    // with the source-aware scanner instead of replacing it.
                    const content = await this.app.vault.read(file);
                    for (const link of getContextualImageLinks(content, {
                        includeFencedCode: useContentScan
                    })) {
                        const rawPath = (link.path ?? "").trim();
                        if (!this.isAllowedNetworkImageUrl(rawPath)) continue;
                        links.add(rawPath);
                    }
                }
            } catch (error) {
                console.warn(`[DownloadMode] Could not inspect ${file.path}:`, error);
                failedFiles.push(`${file.path}: ${getErrorMessage(error)}`);
                uncertainFiles.push(file.path);
                continue;
            }

            let targetFolder: string;
            try {
                const folderManager = this.plugin.folderAndFilenameManagement;
                targetFolder = folderManager
                    ? await Promise.resolve(folderManager.getDefaultAttachmentFolderPath(file))
                    : "";
            } catch (error) {
                failedFiles.push(`${file.path}: ${getErrorMessage(error)}`);
                uncertainFiles.push(file.path);
                continue;
            }

            for (const link of [...links].sort()) {
                const key = this.normalizeUrlIdentity(link);
                const group = grouped.get(key) ?? { url: link, origins: [] };
                if (!group.origins.some(origin => origin.file.path === file.path)) {
                    group.origins.push({ file, targetFolder });
                }
                grouped.set(key, group);
            }
        }

        const tasks = [...grouped.values()]
            .sort((a, b) => a.url.localeCompare(b.url))
            .map(group => {
                group.origins.sort((a, b) => a.file.path.localeCompare(b.file.path));
                const folders = [...new Set(group.origins.map(origin => origin.targetFolder))].sort();
                return {
                    id: group.url,
                    name: this.extractImageNameFromUrl(group.url),
                    path: group.url,
                    source: { url: group.url, origins: group.origins } satisfies DownloadTaskSource,
                    selected: true,
                    status: 'pending' as const,
                    message: t("BATCH_DOWNLOAD_SOURCE_SUMMARY", [
                        group.origins.length.toString(),
                        folders.length.toString(),
                        group.origins[0]?.file.path ?? "",
                        folders.map(folder => folder || "/").join(", ")
                    ])
                };
            });

        this.conflictPolicy = null;
        return {
            tasks,
            complete: failedFiles.length === 0 && uncertainFiles.length === 0,
            failedFiles,
            uncertainFiles
        };
    }

    async prepareExecution(tasks: BatchTask[]): Promise<boolean> {
        const conflictCount = tasks.filter(task => {
            const source = this.getTaskSource(task);
            return source && new Set(source.origins.map(origin => origin.targetFolder)).size > 1;
        }).length;
        if (conflictCount === 0) {
            this.conflictPolicy = "single-copy";
            return true;
        }

        const policy = await this.promptForConflictPolicy(conflictCount);
        if (!policy) return false;
        this.conflictPolicy = policy;
        return true;
    }

    async processTask(task: BatchTask): Promise<BatchItemResult> {
        const source = this.getTaskSource(task);
        if (!source || source.origins.length === 0) {
            return { status: "failed", success: false, item: task.path, error: t("BATCH_DOWNLOAD_SOURCE_MISSING") };
        }
        try {
            const destinations = this.buildDownloadDestinations(source);
            const downloads: DownloadTaskOutputEntry[] = [];
            const errors: string[] = [];
            const skipped: DownloadResult[] = [];
            for (const destination of destinations) {
                await this.plugin.folderAndFilenameManagement?.ensureFolderExists?.(destination.targetFolder);
                if (typeof this.plugin.cloudImageHandler.downloadImageToFolder !== "function") {
                    const legacy = await this.plugin.cloudImageHandler.batchDownload([{
                        url: source.url,
                        targetFolder: destination.targetFolder,
                        suggestedName: task.name,
                        activeFile: destination.files[0]
                    }]);
                    return legacy.successful[0] ?? legacy.skipped[0] ?? legacy.failed[0]
                        ?? { status: "failed", success: false, item: source.url, error: t("MSG_UNKNOWN_ERROR") };
                }
                const result = await this.plugin.cloudImageHandler.downloadImageToFolder(
                    source.url,
                    destination.targetFolder,
                    task.name,
                    destination.files[0]
                );
                if (result.success) {
                    downloads.push({ ...destination, result });
                } else if (result.skipped) {
                    skipped.push(result);
                    errors.push(`${destination.targetFolder || "/"}: ${result.error ?? t("MSG_UNKNOWN_ERROR")}`);
                } else {
                    errors.push(`${destination.targetFolder}: ${result.error ?? t("MSG_UNKNOWN_ERROR")}`);
                }
            }

            const output: DownloadTaskOutput = { url: source.url, downloads, errors };
            if (downloads.length > 0) {
                return { status: "success", success: true, item: source.url, output };
            }
            if (skipped.length === destinations.length) {
                return {
                    status: "skipped",
                    success: false,
                    skipped: true,
                    item: source.url,
                    error: skipped.map(item => item.error).filter(Boolean).join("; ")
                };
            }
            return {
                status: "failed",
                success: false,
                item: source.url,
                error: errors.join("; ") || t("MSG_UNKNOWN_ERROR")
            };
        } catch (e) {
            return {
                status: "failed",
                success: false,
                item: source.url,
                error: getErrorMessage(e)
            };
        }
    }

    private getTaskSource(task: BatchTask): DownloadTaskSource | null {
        const source = task.source as Partial<DownloadTaskSource> | undefined;
        if (typeof source?.url !== "string") return null;
        if (Array.isArray(source.origins)) return source as DownloadTaskSource;

        const legacyFile = (source as unknown as { file?: TFile }).file;
        if (legacyFile instanceof TFile) {
            const targetFolder = this.plugin.folderAndFilenameManagement
                ?.getDefaultAttachmentFolderPath?.(legacyFile) ?? "";
            return { url: source.url, origins: [{ file: legacyFile, targetFolder }] };
        }
        return null;
    }

    private buildDownloadDestinations(source: DownloadTaskSource): Array<{ targetFolder: string; files: TFile[] }> {
        if (this.conflictPolicy !== "per-target-folder") {
            return [{
                targetFolder: source.origins[0].targetFolder,
                files: source.origins.map(origin => origin.file)
            }];
        }

        const groups = new Map<string, TFile[]>();
        for (const origin of source.origins) {
            const files = groups.get(origin.targetFolder) ?? [];
            files.push(origin.file);
            groups.set(origin.targetFolder, files);
        }
        return [...groups.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([targetFolder, files]) => ({ targetFolder, files }));
    }

    private normalizeUrlIdentity(url: string): string {
        try {
            return new URL(url.trim()).href;
        } catch {
            return url.trim();
        }
    }

    private promptForConflictPolicy(conflictCount: number): Promise<BatchDownloadConflictPolicy | null> {
        return new Promise(resolve => {
            const modal = new Modal(this.app);
            let settled = false;
            const settle = (policy: BatchDownloadConflictPolicy | null) => {
                if (settled) return;
                settled = true;
                modal.close();
                resolve(policy);
            };
            modal.titleEl.setText(t("BATCH_DOWNLOAD_CONFLICT_TITLE"));
            modal.contentEl.createEl("p", {
                text: t("BATCH_DOWNLOAD_CONFLICT_DESC", [conflictCount.toString()])
            });
            const buttons = modal.contentEl.createDiv("modal-button-container");
            new ButtonComponent(buttons)
                .setButtonText(t("BATCH_DOWNLOAD_CONFLICT_SINGLE"))
                .onClick(() => settle("single-copy"));
            new ButtonComponent(buttons)
                .setButtonText(t("BATCH_DOWNLOAD_CONFLICT_FOLDER"))
                .setCta()
                .onClick(() => settle("per-target-folder"));
            new ButtonComponent(buttons)
                .setButtonText(t("MODAL_BUTTON_CANCEL"))
                .onClick(() => settle(null));
            modal.onClose = () => {
                modal.contentEl.empty();
                if (!settled) {
                    settled = true;
                    resolve(null);
                }
            };
            modal.open();
        });
    }

    private isAllowedNetworkImageUrl(url: string): boolean {
        try {
            const protocol = new URL(url.trim()).protocol.toLowerCase();
            if (protocol !== "http:" && protocol !== "https:") return false;
        } catch {
            return false;
        }
        return !isDomainBlacklisted(
            url,
            this.plugin.settings.pasteHandling.cloud.newWorkBlackDomains || ""
        );
    }

    private extractImageNameFromUrl(url: string): string {
        try {
            const cleanUrl = url.split("?")[0].split("#")[0];
            const fileName = decodeURIComponent(cleanUrl.split("/").pop() || "");
            return fileName || "image";
        } catch {
            const cleanUrl = url.split("?")[0].split("#")[0];
            return cleanUrl.split("/").pop() || "image";
        }
    }

    private isLikelyCanvasImageUrl(url: string): boolean {
        if (this.plugin.historyManager?.isUrlUploaded(url)) return true;
        try {
            const path = decodeURIComponent(new URL(url).pathname);
            return this.plugin.supportedImageFormats.isSupported(undefined, path);
        } catch {
            return false;
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

    async handleReviewAction(action: string, result: BatchResult): Promise<boolean | void> {
        if (!result) return false;

        if (action === "undo") {
            new Notice(t("MSG_DELETING_DOWNLOADED"));
            const failed: string[] = [];
            for (const item of result.successful) {
                const source = typeof item.item === "string" ? item.item : String(item.item);
                const output = this.normalizeDownloadOutput(item.output, new Set(), source);
                if (!output?.downloads.length) {
                    failed.push(t("BATCH_DOWNLOAD_RESULT_MISSING", [source]));
                    continue;
                }
                for (const download of output.downloads) {
                    if (!await this.plugin.cloudImageHandler.undoDownload(download.result)) {
                        failed.push(t("BATCH_DOWNLOAD_UNDO_FAILED", [source, download.targetFolder]));
                    }
                }
            }
            if (failed.length > 0) {
                new OperationResultModal(this.app, {
                    title: t("BATCH_DOWNLOAD_UNDO_RESULT_TITLE"),
                    summary: t("BATCH_DOWNLOAD_UNDO_RESULT_SUMMARY", [failed.length.toString()]),
                    failed
                }).open();
                return false;
            }
            new Notice(t("MSG_UNDO_COMPLETE"));
            return true;
        }

        const allowedPathSet = buildAllowedPathSet(this.scope, this.target, this.app);

        let count = 0;
        const updatedNotePaths = new Set<string>();
        const blocked: string[] = [];
        const uncertain = new Set<string>();
        const replacer = new ImageReferenceReplacer(
            this.app,
            this.plugin.vaultReferenceManager,
            () => this.plugin.settings.localProcessing.link
        );
        const safetyService = new ReferenceSafetyService(this.app, this.plugin.vaultReferenceManager, {
            includeFencedCode: this.plugin.settings.global.codeBlockImageLinkIndexing
        });
        const deleter = new CloudImageDeleter(this.plugin);
        let deletionCancelled = false;
        const discoveryComplete = result.discovery?.complete !== false;

        for (const item of result.successful) {
            const url = item.item as string;
            const output = this.normalizeDownloadOutput(item.output, allowedPathSet, url);
            if (!output?.downloads.length) {
                blocked.push(t("BATCH_DOWNLOAD_RESULT_MISSING", [url]));
                continue;
            }
            blocked.push(...output.errors.map(error => `${url}: ${error}`));

            const scan = await this.plugin.vaultReferenceManager.scanReferencesDetailed(url);
            const canvasScan = await getCanvasUrlReferencesDetailed(this.app, url, {
                includeFencedCode: this.plugin.settings.global.codeBlockImageLinkIndexing
            });
            scan.uncertainFiles.forEach(path => uncertain.add(path));
            canvasScan.uncertainFiles.forEach(path => uncertain.add(path));
            const outOfScopeLocations = scan.locations.filter(location => !allowedPathSet.has(location.file.path));
            const outOfScopeCanvasLocations = canvasScan.references.filter(reference =>
                !allowedPathSet.has(reference.canvasFile.path)
            );
            let updateIncomplete = false;
            for (const download of output.downloads) {
                const vaultPath = download.result.vaultPath;
                const localFile = vaultPath ? this.app.vault.getAbstractFileByPath(vaultPath) : null;
                if (!(localFile instanceof TFile)) {
                    blocked.push(t("BATCH_DOWNLOAD_LOCAL_FILE_MISSING", [url, vaultPath ?? ""]));
                    updateIncomplete = true;
                    continue;
                }

                const targetPaths = download.files.length > 0
                    ? new Set(download.files.map(file => file.path).filter(path => allowedPathSet.has(path)))
                    : new Set(allowedPathSet);
                const scopedLocations = scan.locations.filter(location => targetPaths.has(location.file.path));
                const updateResult = await this.plugin.vaultReferenceManager.updateReferenceLocationsDetailed(
                    scopedLocations,
                    location => replacer.serializeReference(location.original, localFile, location.file)
                );
                const canvasUpdateResult = await replaceCanvasUrlReferencesWithFile(
                    this.app,
                    url,
                    localFile,
                    {
                        allowedCanvasPaths: targetPaths,
                        includeFencedCode: this.plugin.settings.global.codeBlockImageLinkIndexing,
                        formatLocalTextReference: (originalLink, newFile, canvasFile) =>
                            replacer.serializeReference(originalLink, newFile, canvasFile)
                    }
                );
                updateResult.uncertainFiles.forEach(path => uncertain.add(path));
                canvasUpdateResult.uncertainFiles.forEach(path => uncertain.add(path));
                updateResult.files.filter(file => file.replaced > 0)
                    .forEach(file => updatedNotePaths.add(file.filePath));
                canvasUpdateResult.files.filter(file => file.replaced > 0)
                    .forEach(file => updatedNotePaths.add(file.filePath));

                const replaced = updateResult.replaced + canvasUpdateResult.replaced;
                const found = updateResult.found + canvasUpdateResult.found;
                count += replaced;
                const incomplete = !updateResult.complete
                    || updateResult.replaced !== updateResult.found
                    || updateResult.failedFiles.length > 0
                    || updateResult.uncertainFiles.length > 0
                    || !canvasUpdateResult.complete
                    || canvasUpdateResult.replaced !== canvasUpdateResult.found
                    || canvasUpdateResult.failedFiles.length > 0
                    || canvasUpdateResult.uncertainFiles.length > 0;
                if (incomplete) {
                    updateIncomplete = true;
                    blocked.push(t("BATCH_DOWNLOAD_REPLACE_INCOMPLETE", [url, replaced.toString(), found.toString()]));
                }
                this.plugin.cloudImageHandler.discardDownloadUndo(download.result);
            }

            if (action === "replace_delete_cloud") {
                if (!discoveryComplete) {
                    blocked.push(t("BATCH_DELETE_BLOCKED_DISCOVERY", [url]));
                    continue;
                }
                if (!this.plugin.historyManager.isUrlUploaded(url)) {
                    blocked.push(t("BATCH_DELETE_NOT_OWNED", [url]));
                    continue;
                }
                if (!scan.complete || !canvasScan.complete) {
                    blocked.push(t("BATCH_DELETE_SCAN_INCOMPLETE", [url]));
                    continue;
                }
                if (updateIncomplete) continue;
                const outOfScopeCount = outOfScopeLocations.length + outOfScopeCanvasLocations.length;
                if (outOfScopeCount > 0) {
                    blocked.push(t("BATCH_DELETE_OUT_OF_SCOPE", [url, outOfScopeCount.toString()]));
                    continue;
                }

                if (scan.locations.length + canvasScan.references.length === 0
                    && !(await this.confirmZeroReferenceDeletion(url))) {
                    deletionCancelled = true;
                    blocked.push(t("BATCH_DELETE_ZERO_CANCELLED", [url]));
                    continue;
                }

                const safety = await safetyService.inspectUrl(url);
                safety.uncertainFiles.forEach(path => uncertain.add(path));
                if (!safety.safeToDelete) {
                    const reason = safety.complete
                        ? t("BATCH_REFERENCES_REMAIN", [safety.referenceCount.toString()])
                        : t("BATCH_REFERENCE_VERIFY_INCOMPLETE");
                    blocked.push(`${url}: ${reason}`);
                    continue;
                }

                const deleteResult = await deleter.deleteImageDetailed({ url });
                if (!deleteResult.success) {
                    blocked.push(t("BATCH_CLOUD_DELETE_FAILED", [
                        url,
                        deleteResult.message ?? deleteResult.reason ?? t("MSG_UNKNOWN_ERROR")
                    ]));
                }
            }
        }

        new Notice(t("MSG_REPLACED_LINKS", [count.toString(), updatedNotePaths.size.toString()]));
        if (blocked.length > 0 || uncertain.size > 0) {
            new OperationResultModal(this.app, {
                title: t("BATCH_DOWNLOAD_UPDATE_RESULT_TITLE"),
                summary: t("BATCH_DOWNLOAD_UPDATE_RESULT_SUMMARY", [count.toString()]),
                failed: blocked,
                uncertain: [...uncertain]
            }).open();
        }
        return !deletionCancelled && blocked.length === 0 && uncertain.size === 0;
    }

    disposeItemResult(result: BatchItemResult): void {
        const output = "output" in result
            ? this.normalizeDownloadOutput(result.output, new Set(), String(result.item))
            : undefined;
        output?.downloads?.forEach(download => {
            this.plugin.cloudImageHandler.discardDownloadUndo(download.result);
        });
    }

    private normalizeDownloadOutput(
        value: unknown,
        allowedPaths: Set<string> = new Set(),
        fallbackUrl = ""
    ): DownloadTaskOutput | null {
        if (value && typeof value === "object" && Array.isArray((value as DownloadTaskOutput).downloads)) {
            return value as DownloadTaskOutput;
        }
        const legacy = value as DownloadResult | undefined;
        if (!legacy?.vaultPath) return null;
        const files = [...allowedPaths]
            .map(path => this.app.vault.getAbstractFileByPath(path))
            .filter((file): file is TFile => file instanceof TFile);
        return {
            url: legacy.url || fallbackUrl,
            downloads: [{ result: legacy, targetFolder: "", files }],
            errors: []
        };
    }

    private confirmZeroReferenceDeletion(url: string): Promise<boolean> {
        return new Promise(resolve => {
            new ConfirmDialog(
                this.app,
                t("BATCH_DELETE_ZERO_TITLE"),
                t("BATCH_DELETE_ZERO_DESC", [url]),
                t("BUTTON_DELETE"),
                () => resolve(true),
                () => resolve(false)
            ).open();
        });
    }
}
