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
import { getContextualImageLinks } from "../../../../utils/MarkdownSourceContext";
import type { DownloadResult } from "../../../../cloud/NetworkImageDownloader";
import { OperationResultModal } from "../../OperationResultModal";
import { ConfirmDialog } from "../../../../settings/SettingsModals";
import { isDomainBlacklisted } from "../../../../utils/NetworkPolicy";
import { getErrorMessage } from "../../../../utils/ErrorUtils";
import { BatchScopeResolver } from "../../../../utils/batch/BatchScopeResolver";
import { ImageReferenceWorkflowCoordinator } from "../../../../utils/ImageReferenceWorkflowCoordinator";

export interface DownloadTaskOrigin {
    file: TFile;
    targetFolder: string;
    verification: "verified" | "unverified";
}

export interface DownloadTaskSource {
    url: string;
    origins: DownloadTaskOrigin[];
    verification: "verified" | "unverified";
}

export interface CanvasDownloadCandidate {
    readonly url: string;
    readonly file: TFile;
    readonly verification: "unverified";
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
        const resolver = new BatchScopeResolver(this.app, this.plugin);
        const discovery = resolver.collectSourceDocuments(this.scope, this.target);
        const files = discovery.items;
        const failedFiles = [...discovery.failedFiles];
        const uncertainFiles = [...discovery.uncertainFiles];
        const grouped = new Map<string, { url: string; origins: DownloadTaskOrigin[] }>();
        for (const file of files) {
            const links = new Map<string, "verified" | "unverified">();
            const addLink = (url: string, verification: "verified" | "unverified") => {
                const current = links.get(url);
                if (current !== "verified") links.set(url, verification);
            };
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
                            && this.isAllowedNetworkImageUrl(node.url)) {
                            addLink(node.url, "unverified");
                        }
                        if (typeof node.text !== "string") continue;
                        for (const link of getContextualImageLinks(node.text, {
                            includeFencedCode: useContentScan
                        })) {
                            const rawPath = (link.path ?? "").trim();
                            if (this.isAllowedNetworkImageUrl(rawPath)) addLink(rawPath, "verified");
                        }
                    }
                } else {
                    // Metadata cache remains the fast, authoritative path for
                    // ordinary embeds, including extensionless network images.
                    const cache = this.app.metadataCache.getFileCache(file);
                    for (const embed of cache?.embeds ?? []) {
                        if (this.isAllowedNetworkImageUrl(embed.link)) {
                            addLink(embed.link, "verified");
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
                        addLink(rawPath, "verified");
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

            for (const [link, verification] of [...links.entries()]
                .sort(([left], [right]) => left.localeCompare(right))) {
                const key = this.normalizeUrlIdentity(link);
                const group = grouped.get(key) ?? { url: link, origins: [] };
                const existingOrigin = group.origins.find(origin => origin.file.path === file.path);
                if (!existingOrigin) {
                    group.origins.push({ file, targetFolder, verification });
                } else if (verification === "verified") {
                    existingOrigin.verification = "verified";
                }
                grouped.set(key, group);
            }
        }

        const tasks = [...grouped.values()]
            .sort((a, b) => a.url.localeCompare(b.url))
            .map(group => {
                group.origins.sort((a, b) => a.file.path.localeCompare(b.file.path));
                const folders = [...new Set(group.origins.map(origin => origin.targetFolder))].sort();
                const verification = group.origins.some(origin => origin.verification === "verified")
                    ? "verified" as const
                    : "unverified" as const;
                const summary = t("BATCH_DOWNLOAD_SOURCE_SUMMARY", [
                    group.origins.length.toString(),
                    folders.length.toString(),
                    group.origins[0]?.file.path ?? "",
                    folders.map(folder => folder || "/").join(", ")
                ]);
                return {
                    id: group.url,
                    name: this.extractImageNameFromUrl(group.url),
                    path: group.url,
                    source: {
                        url: group.url,
                        origins: group.origins,
                        verification
                    } satisfies DownloadTaskSource,
                    selected: true,
                    status: 'pending' as const,
                    message: verification === "unverified"
                        ? `${summary}. ${t("BATCH_DOWNLOAD_UNVERIFIED_CANDIDATE")}`
                        : summary
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
                const result = await this.plugin.cloudImageHandler.downloadImageToFolder(
                    source.url,
                    destination.targetFolder,
                    task.name,
                    destination.files[0]
                );
                if (result.success) {
                    downloads.push({ ...destination, result });
                } else if (result.skipped
                    || (source.verification === "unverified"
                        && result.errorCode === "not-image")) {
                    skipped.push(result);
                    if (result.skipped) {
                        errors.push(`${destination.targetFolder || "/"}: ${result.error ?? t("MSG_UNKNOWN_ERROR")}`);
                    }
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
        if (Array.isArray(source.origins)) {
            const origins = source.origins.map(origin => ({
                ...origin,
                verification: origin.verification === "unverified"
                    ? "unverified" as const
                    : "verified" as const
            }));
            return {
                url: source.url,
                origins,
                verification: source.verification === "unverified"
                    ? "unverified"
                    : "verified"
            };
        }

        const legacyFile = (source as unknown as { file?: TFile }).file;
        if (legacyFile instanceof TFile) {
            const targetFolder = this.plugin.folderAndFilenameManagement
                ?.getDefaultAttachmentFolderPath?.(legacyFile) ?? "";
            return {
                url: source.url,
                origins: [{ file: legacyFile, targetFolder, verification: "verified" }],
                verification: "verified"
            };
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

        const scopeResolver = new BatchScopeResolver(this.app, this.plugin);
        const allowedPathSet = scopeResolver.getAllowedDocumentPaths(this.scope, this.target);
        let count = 0;
        const updatedNotePaths = new Set<string>();
        const blocked: string[] = [];
        const uncertain = new Set<string>();
        const coordinator = new ImageReferenceWorkflowCoordinator(this.app, this.plugin);
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

            let updateIncomplete = false;
            let initialReferenceCount: number | null = null;
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
                const inventory = await coordinator.inspect(
                    { kind: "url", url },
                    {
                        mutationBoundary: {
                            allowedDocumentPaths: [...targetPaths]
                        }
                    }
                );
                initialReferenceCount ??= inventory.totalReferences;
                const updateResult = await coordinator.replace(
                    inventory,
                    { kind: "local", file: localFile },
                    "all"
                );
                updateResult.uncertainFiles.forEach(path => uncertain.add(path));
                count += updateResult.changed;
                if (updateResult.changed > 0) {
                    inventory.mutableMarkdown.forEach(reference =>
                        updatedNotePaths.add(reference.file.path)
                    );
                    inventory.mutableCanvas.forEach(reference =>
                        updatedNotePaths.add(reference.canvasFile.path)
                    );
                }
                if (!updateResult.complete) {
                    updateIncomplete = true;
                    blocked.push(t("BATCH_DOWNLOAD_REPLACE_INCOMPLETE", [
                        url,
                        updateResult.changed.toString(),
                        updateResult.found.toString()
                    ]));
                    blocked.push(...updateResult.failedFiles.map(path => `${url}: ${path}`));
                } else {
                    this.plugin.cloudImageHandler.discardDownloadUndo(download.result);
                }
            }

            if (action === "replace_delete_cloud") {
                if (!discoveryComplete) {
                    blocked.push(t("BATCH_DELETE_BLOCKED_DISCOVERY", [url]));
                    continue;
                }
                if (updateIncomplete || output.errors.length > 0) continue;
                if (!this.plugin.historyManager.isUrlUploaded(url)) {
                    blocked.push(t("BATCH_DELETE_NOT_OWNED", [url]));
                    continue;
                }
                if ((initialReferenceCount ?? 0) === 0
                    && !(await this.confirmZeroReferenceDeletion(url))) {
                    deletionCancelled = true;
                    blocked.push(t("BATCH_DELETE_ZERO_CANCELLED", [url]));
                    continue;
                }

                const deleteResult = await coordinator.deleteSource({ kind: "url", url });
                deleteResult.uncertainFiles.forEach(path => uncertain.add(path));
                if (!deleteResult.sourceDeleted) {
                    blocked.push(t("BATCH_CLOUD_DELETE_FAILED", [
                        url,
                        [...deleteResult.failedFiles, ...deleteResult.uncertainFiles].join(", ")
                            || t("BATCH_REFERENCES_REMAIN", [deleteResult.found.toString()])
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
