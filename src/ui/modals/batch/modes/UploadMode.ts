import { App, Notice, TFile, TFolder, Setting } from "obsidian";
import ImageConverterPlugin from "../../../../main";
import { BatchTask, BatchItemResult, BatchResult, BatchScope, BatchTaskDiscoveryResult } from "../../../../types/BatchTypes";
import { IBatchMode, ReviewAction } from "./IBatchMode";
import { t } from "../../../../lang/helpers";
import { CloudImageDeleter } from "../../../../cloud/CloudImageDeleter";
import { ImageLinkPathReplacer } from "../../../../utils/ImageLinkPathReplacer";
import { getContextualReferenceLinks } from "../../../../utils/MarkdownSourceContext";
import { buildAllowedPathSet } from "../../../../utils/batch";
import { ImageFileCollector } from "../../../../utils/batch/ImageFileCollector";
import { ReferenceSafetyService } from "../../../../utils/ReferenceSafetyService";
import { ConfirmDialog } from "../../../../settings/SettingsModals";
import { OperationResultModal } from "../../OperationResultModal";
import { getErrorMessage } from "../../../../utils/ErrorUtils";
import { isHttpUrl } from "../../../../utils/NetworkPolicy";
import {
    getCanvasFileReferenceIndexDetailed,
    replaceCanvasFileReferencesWithUrl
} from "../../../../utils/CanvasReferenceUtils";

export class UploadMode implements IBatchMode {
    id = "upload" as const;
    name = t("BATCH_MODE_UPLOAD");

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private target: TFile | TFolder | null,
        private scope: BatchScope
    ) { }

    renderSettings(container: HTMLElement): void {
        new Setting(container)
            .setName(t("BATCH_UPLOAD_CONFIG"))
            .setDesc(t("BATCH_UPLOAD_DESC"))
            .addButton(b => b.setButtonText(t("MODAL_BUTTON_SETTINGS")).onClick(() => {
                this.plugin.commandOpenSettingsTab();
            }));
    }

    async loadTasks(): Promise<BatchTaskDiscoveryResult> {
        const tasks: BatchTask[] = [];
        let files: TFile[] = [];
        const failedFiles: string[] = [];
        const uncertainFiles: string[] = [];

        // Identify files based on scope
        try {
        if (this.scope === "note" && this.target instanceof TFile) {
            const resolvedFiles: Map<string, TFile> = new Map();
            const useContentScan = !!this.plugin.settings.global.codeBlockImageLinkIndexing;

            if (this.target.extension === "canvas") {
                const imagePaths = await new ImageFileCollector(this.app, this.plugin).getImagesFromCanvas(this.target);
                for (const imagePath of imagePaths) {
                    const abstract = this.app.vault.getAbstractFileByPath(imagePath);
                    if (!(abstract instanceof TFile)) continue;
                    if (!this.plugin.supportedImageFormats.isSupported(abstract.extension, abstract.name)) continue;
                    resolvedFiles.set(abstract.path, abstract);
                }
            } else {
                const cache = this.app.metadataCache.getFileCache(this.target);
                for (const cacheLink of [...(cache?.embeds ?? []), ...(cache?.links ?? [])]) {
                    const file = this.app.metadataCache.getFirstLinkpathDest(cacheLink.link, this.target.path);
                    if (file instanceof TFile
                        && this.plugin.supportedImageFormats.isSupported(file.extension, file.name)) {
                        resolvedFiles.set(file.path, file);
                    }
                }

                const content = await this.app.vault.read(this.target);
                const links = getContextualReferenceLinks(content, {
                    includeFencedCode: useContentScan
                });
                for (const link of links) {
                    const linkPath = (link.path ?? '').trim();
                    if (!linkPath) continue;
                    if (isHttpUrl(linkPath)) continue; // local upload only

                    const dest = this.app.metadataCache.getFirstLinkpathDest(linkPath, this.target.path);
                    if (!dest?.path) continue;

                    const abstract = this.app.vault.getAbstractFileByPath(dest.path);
                    if (!(abstract instanceof TFile)) continue;
                    if (!this.plugin.supportedImageFormats.isSupported(abstract.extension, abstract.name)) continue;
                    resolvedFiles.set(abstract.path, abstract);
                }
            }

            files = Array.from(resolvedFiles.values());
        } else if (this.scope === "folder" && this.target instanceof TFolder) {
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
        } catch (error) {
            const targetPath = this.target?.path ?? this.scope;
            failedFiles.push(`${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
            uncertainFiles.push(targetPath);
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

        return { tasks, complete: failedFiles.length === 0 && uncertainFiles.length === 0, failedFiles, uncertainFiles };
    }

    async processTask(task: BatchTask): Promise<BatchItemResult> {
        const file = task.source;
        if (!(file instanceof TFile)) {
            return {
                status: "failed",
                success: false,
                item: task.path,
                error: t("BATCH_UPLOAD_SOURCE_MISSING")
            };
        }
        try {
            if (typeof this.plugin.cloudImageHandler.uploadFileHeadless === "function") {
                return await this.plugin.cloudImageHandler.uploadFileHeadless(file);
            }
            const result = await this.plugin.cloudImageHandler.batchUpload([file]);
            return result.successful[0] ?? result.skipped[0] ?? result.failed[0]
                ?? { status: "failed", success: false, item: file, error: t("MSG_UNKNOWN_ERROR") };
        } catch (e) {
            return {
                status: "failed",
                success: false,
                item: file,
                error: getErrorMessage(e)
            };
        }
    }

    getReviewActions(): ReviewAction[] {
        const actions: ReviewAction[] = [
            { id: "replace_only", label: t("BATCH_REPLACE_LINKS_ONLY"), style: 'primary' },
            { id: "replace_delete", label: t("BATCH_REPLACE_DELETE_LOCAL"), style: 'danger' }
        ];

        if (this.plugin.settings.pasteHandling.cloud.uploader === 'PicList') {
            actions.push({ id: "undo", label: t("BATCH_UNDO_UPLOAD"), style: 'default' });
        }

        return actions;
    }

    async handleReviewAction(action: string, result: BatchResult): Promise<boolean | void> {
        if (!result) return false;
        const discoveryComplete = result.discovery?.complete !== false;

        if (action === "undo") {
            if (!discoveryComplete) {
                new Notice(t("BATCH_DESTRUCTIVE_BLOCKED_DISCOVERY"));
                return false;
            }
            if (this.plugin.settings.pasteHandling.cloud.uploader !== 'PicList') {
                new Notice(t("MSG_DELETE_NOT_SUPPORTED"));
                return false;
            }

            new Notice(t("MSG_UNDOING_UPLOAD"));
            const deleter = new CloudImageDeleter(this.plugin);
            const safetyService = new ReferenceSafetyService(this.app, this.plugin.vaultReferenceManager, {
                includeFencedCode: this.plugin.settings.global.codeBlockImageLinkIndexing
            });
            const blocked: string[] = [];
            for (const item of result.successful) {
                const url = typeof item.output === "string" ? item.output.trim() : "";
                if (!url) {
                    blocked.push(t("BATCH_UPLOAD_NO_URL", [String(item.item)]));
                    continue;
                }

                const safety = await safetyService.inspectUrl(url);
                if (!safety.safeToDelete) {
                    const reason = safety.complete
                        ? t("BATCH_REFERENCES_REMAIN", [safety.referenceCount.toString()])
                        : t("BATCH_REFERENCE_VERIFY_INCOMPLETE_FILES", [safety.uncertainFiles.join(", ")]);
                    blocked.push(`${url}: ${reason}`);
                    continue;
                }

                const deletion = await deleter.deleteImageDetailed({ url });
                if (!deletion.success) {
                    blocked.push(t("BATCH_CLOUD_DELETE_FAILED", [
                        url,
                        deletion.message ?? deletion.reason ?? t("MSG_UNKNOWN_ERROR")
                    ]));
                }
            }
            if (blocked.length > 0) {
                new OperationResultModal(this.app, {
                    title: t("BATCH_UPLOAD_UNDO_RESULT_TITLE"),
                    summary: t("BATCH_UPLOAD_UNDO_RESULT_SUMMARY"),
                    failed: blocked
                }).open();
                return false;
            }

            new Notice(t("MSG_UNDO_COMPLETE"));
            return true;
        }

        // Build scope boundary: collect files within the current scope
        const allowedPathSet = buildAllowedPathSet(this.scope, this.target, this.app);

        let count = 0;
        const zeroReferenceCandidates: TFile[] = [];
        const blocked: string[] = [];
        const safetyService = new ReferenceSafetyService(this.app, this.plugin.vaultReferenceManager, {
            includeFencedCode: this.plugin.settings.global.codeBlockImageLinkIndexing
        });
        let deletionCancelled = false;

        for (const item of result.successful) {
            const file = item.item as TFile;
            const cloudUrl = item.output as string;
            if (typeof cloudUrl !== "string" || !cloudUrl.trim()) {
                blocked.push(t("BATCH_UPLOAD_NO_URL", [file.path]));
                continue;
            }

            const scan = await this.plugin.vaultReferenceManager.scanReferencesDetailed(file.path);
            const canvasScan = await getCanvasFileReferenceIndexDetailed(this.app, [file], {
                includeFencedCode: this.plugin.settings.global.codeBlockImageLinkIndexing
            });
            const canvasLocations = canvasScan.references.get(file.path) ?? [];
            const scopedLocations = scan.locations.filter(location => allowedPathSet.has(location.file.path));
            const outOfScopeLocations = scan.locations.filter(location => !allowedPathSet.has(location.file.path));
            const updateResult = await this.plugin.vaultReferenceManager.updateReferenceLocationsDetailed(scopedLocations, (loc) => {
                return ImageLinkPathReplacer.replacePath(loc.original, cloudUrl);
            });
            const canvasUpdateResult = await replaceCanvasFileReferencesWithUrl(
                this.app,
                file,
                cloudUrl,
                {
                    allowedCanvasPaths: allowedPathSet,
                    includeFencedCode: this.plugin.settings.global.codeBlockImageLinkIndexing
                }
            );
            const outOfScopeCanvasLocations = canvasLocations.filter(reference =>
                !allowedPathSet.has(reference.canvasFile.path)
            );
            count += updateResult.replaced + canvasUpdateResult.replaced;

            const scanIncomplete = !scan.complete || !canvasScan.complete;
            const updateIncomplete = updateResult.complete === false
                || updateResult.replaced !== updateResult.found
                || updateResult.failedFiles.length > 0
                || updateResult.uncertainFiles.length > 0
                || canvasUpdateResult.complete === false
                || canvasUpdateResult.replaced !== canvasUpdateResult.found
                || canvasUpdateResult.failedFiles.length > 0
                || canvasUpdateResult.uncertainFiles.length > 0;
            if (scanIncomplete) {
                const uncertain = [...scan.uncertainFiles, ...canvasScan.uncertainFiles];
                blocked.push(t("BATCH_UPLOAD_SCAN_INCOMPLETE", [file.path, uncertain.join(", ")]));
            }
            if (updateIncomplete) {
                const replaced = updateResult.replaced + canvasUpdateResult.replaced;
                const found = updateResult.found + canvasUpdateResult.found;
                blocked.push(t("BATCH_UPLOAD_REPLACE_INCOMPLETE", [file.path, replaced.toString(), found.toString()]));
            }

            if (action !== "replace_delete") continue;
            if (!discoveryComplete) {
                blocked.push(t("BATCH_DELETE_BLOCKED_DISCOVERY", [file.path]));
                continue;
            }
            if (scanIncomplete || updateIncomplete) continue;
            const outOfScopeCount = outOfScopeLocations.length + outOfScopeCanvasLocations.length;
            if (outOfScopeCount > 0) {
                blocked.push(t("BATCH_UPLOAD_OUT_OF_SCOPE", [file.path, outOfScopeCount.toString()]));
                continue;
            }

            const safety = await safetyService.inspectLocalFile(file);
            if (!safety.safeToDelete) {
                const reason = safety.complete
                    ? t("BATCH_REFERENCES_REMAIN", [safety.referenceCount.toString()])
                    : t("BATCH_REFERENCE_VERIFY_INCOMPLETE_FILES", [safety.uncertainFiles.join(", ")]);
                blocked.push(`${file.path}: ${reason}`);
                continue;
            }

            if (scan.locations.length + canvasLocations.length === 0) {
                zeroReferenceCandidates.push(file);
            } else {
                try {
                    await this.app.vault.trash(file, true);
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    blocked.push(t("BATCH_UPLOAD_LOCAL_DELETE_FAILED", [file.path, message]));
                }
            }
        }

        if (action === "replace_delete" && zeroReferenceCandidates.length > 0) {
            const confirmed = await this.confirmZeroReferenceDeletion(zeroReferenceCandidates);
            if (confirmed) {
                for (const file of zeroReferenceCandidates) {
                    const safety = await safetyService.inspectLocalFile(file);
                    if (safety.safeToDelete) {
                        try {
                            await this.app.vault.trash(file, true);
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            blocked.push(t("BATCH_UPLOAD_LOCAL_DELETE_FAILED", [file.path, message]));
                        }
                    } else {
                        blocked.push(t("BATCH_UPLOAD_REFERENCES_CHANGED", [file.path]));
                    }
                }
            } else {
                deletionCancelled = true;
                zeroReferenceCandidates.forEach(file => blocked.push(t("BATCH_UPLOAD_ZERO_CANCELLED", [file.path])));
            }
        }

        new Notice(t("MSG_REPLACED_LINKS", [count.toString()]));
        if (blocked.length > 0) {
            new OperationResultModal(this.app, {
                title: t("BATCH_UPLOAD_UPDATE_RESULT_TITLE"),
                summary: t("BATCH_UPLOAD_UPDATE_RESULT_SUMMARY", [count.toString(), blocked.length.toString()]),
                failed: blocked
            }).open();
        }
        return !deletionCancelled && blocked.length === 0;
    }

    private confirmZeroReferenceDeletion(files: TFile[]): Promise<boolean> {
        const names = files.slice(0, 10).map(file => file.path).join("\n");
        const suffix = files.length > 10 ? t("BATCH_AND_MORE", [(files.length - 10).toString()]) : "";
        return new Promise(resolve => {
            new ConfirmDialog(
                this.app,
                t("BATCH_UPLOAD_ZERO_TITLE"),
                t("BATCH_UPLOAD_ZERO_DESC", [files.length.toString(), names, suffix]),
                t("BUTTON_DELETE"),
                () => resolve(true),
                () => resolve(false)
            ).open();
        });
    }
}
