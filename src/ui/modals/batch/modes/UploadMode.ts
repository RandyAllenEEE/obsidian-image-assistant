import { App, Notice, TFile, TFolder, Setting } from "obsidian";
import ImageConverterPlugin from "../../../../main";
import { BatchTask, BatchItemResult, BatchResult, BatchScope, BatchTaskDiscoveryResult } from "../../../../types/BatchTypes";
import { IBatchMode, ReviewAction } from "./IBatchMode";
import { t } from "../../../../lang/helpers";
import { BatchScopeResolver } from "../../../../utils/batch/BatchScopeResolver";
import { ConfirmDialog } from "../../../../settings/SettingsModals";
import { OperationResultModal } from "../../OperationResultModal";
import { getErrorMessage } from "../../../../utils/ErrorUtils";
import { ImageReferenceWorkflowCoordinator } from "../../../../utils/ImageReferenceWorkflowCoordinator";
import { CloudImageDeleter } from "../../../../cloud/CloudImageDeleter";
import { isProtectedDrawingFile } from "../../../../drawing/DrawingFileSemantics";

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
        const resolver = new BatchScopeResolver(this.app, this.plugin);
        const discovery = await resolver.collectLocalAssets(this.scope, this.target);

        // Create tasks
        for (const file of discovery.items) {
            if (isProtectedDrawingFile(this.plugin, file)) continue;
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

        return {
            tasks,
            complete: discovery.complete,
            failedFiles: [...discovery.failedFiles],
            uncertainFiles: [...discovery.uncertainFiles]
        };
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

        if (this.plugin.settings.pasteHandling.cloud.uploader === 'PicList'
            && new CloudImageDeleter(this.plugin).isDesktopTransportAvailable()) {
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
            const coordinator = new ImageReferenceWorkflowCoordinator(this.app, this.plugin);
            const blocked: string[] = [];
            for (const item of result.successful) {
                const url = typeof item.output === "string" ? item.output.trim() : "";
                if (!url) {
                    blocked.push(t("BATCH_UPLOAD_NO_URL", [String(item.item)]));
                    continue;
                }

                const deletion = await coordinator.deleteSource({ kind: "url", url });
                if (!deletion.sourceDeleted) {
                    const details = [...deletion.failedFiles, ...deletion.uncertainFiles]
                        .join(", ");
                    blocked.push(t("BATCH_CLOUD_DELETE_FAILED", [
                        url,
                        details || t("BATCH_REFERENCES_REMAIN", [
                            deletion.found.toString()
                        ])
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

        let count = 0;
        const zeroReferenceCandidates: TFile[] = [];
        const blocked: string[] = [];
        const scopeResolver = new BatchScopeResolver(this.app, this.plugin);
        const allowedDocumentPaths = [...scopeResolver.getAllowedDocumentPaths(this.scope, this.target)];
        const coordinator = new ImageReferenceWorkflowCoordinator(this.app, this.plugin);
        let deletionCancelled = false;

        for (const item of result.successful) {
            const file = item.item as TFile;
            if (isProtectedDrawingFile(this.plugin, file)) {
                blocked.push(t("NOTICE_DRAWING_PROTECTED"));
                continue;
            }
            const cloudUrl = item.output as string;
            if (typeof cloudUrl !== "string" || !cloudUrl.trim()) {
                blocked.push(t("BATCH_UPLOAD_NO_URL", [file.path]));
                continue;
            }

            const inventory = await coordinator.inspect(
                { kind: "local", file },
                {
                    mutationBoundary: { allowedDocumentPaths }
                }
            );
            const updateResult = await coordinator.replace(
                inventory,
                { kind: "url", url: cloudUrl },
                "all"
            );
            count += updateResult.changed;
            if (!updateResult.complete) {
                blocked.push(t("BATCH_UPLOAD_REPLACE_INCOMPLETE", [
                    file.path,
                    updateResult.changed.toString(),
                    updateResult.found.toString()
                ]));
                blocked.push(...updateResult.failedFiles.map(path => `${file.path}: ${path}`));
                blocked.push(...updateResult.uncertainFiles.map(path => `${file.path}: ${path}`));
            }

            if (action !== "replace_delete") continue;
            if (!discoveryComplete) {
                blocked.push(t("BATCH_DELETE_BLOCKED_DISCOVERY", [file.path]));
                continue;
            }
            if (!updateResult.complete) continue;
            if (inventory.totalReferences > 0 && inventory.mutableReferences === 0) {
                blocked.push(t("BATCH_UPLOAD_OUT_OF_SCOPE", [
                    file.path,
                    inventory.totalReferences.toString()
                ]));
                continue;
            }
            if (inventory.totalReferences === 0) {
                zeroReferenceCandidates.push(file);
                continue;
            }

            const deletion = await coordinator.deleteSource({ kind: "local", file });
            if (!deletion.sourceDeleted) {
                const details = [...deletion.failedFiles, ...deletion.uncertainFiles].join(", ");
                blocked.push(`${file.path}: ${details || t("BATCH_REFERENCES_REMAIN", [
                    deletion.found.toString()
                ])}`);
            }
        }

        if (action === "replace_delete" && zeroReferenceCandidates.length > 0) {
            const confirmed = await this.confirmZeroReferenceDeletion(zeroReferenceCandidates);
            if (confirmed) {
                for (const file of zeroReferenceCandidates) {
                    const deletion = await coordinator.deleteSource({ kind: "local", file });
                    if (!deletion.sourceDeleted) {
                        blocked.push(t("BATCH_UPLOAD_REFERENCES_CHANGED", [file.path]));
                        blocked.push(...deletion.uncertainFiles.map(path => `${file.path}: ${path}`));
                    }
                }
            } else {
                deletionCancelled = true;
                zeroReferenceCandidates.forEach(file =>
                    blocked.push(t("BATCH_UPLOAD_ZERO_CANCELLED", [file.path]))
                );
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
