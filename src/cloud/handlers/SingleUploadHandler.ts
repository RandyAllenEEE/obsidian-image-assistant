import { App, Notice, TFile } from "obsidian";
import { t } from "../../lang/helpers";
import type ImageConverterPlugin from "../../main";
import { getErrorMessage } from "../../utils/ErrorUtils";
import {
    ImageReferenceWorkflowCoordinator,
    type ClickedImageReferenceContext,
    type ImageReferenceSource,
    type ReferenceInventory,
    type ReferenceWorkflowDecision
} from "../../utils/ImageReferenceWorkflowCoordinator";
import { isHttpUrl } from "../../utils/NetworkPolicy";
import { ImageReferenceDecisionModal } from "../../ui/modals/ImageReferenceDecisionModal";
import { UploadErrorDialog } from "../../ui/modals/UploadModals";
import { UploaderManager } from "../uploader/index";
import { describeLocalFileDeletion } from "../../utils/LocalFileDeletionService";

export interface SingleUploadResult {
    readonly success: boolean;
    readonly file: TFile;
    readonly cloudUrl?: string;
    readonly error?: string;
}

export class SingleUploadHandler {
    private readonly coordinator: ImageReferenceWorkflowCoordinator;

    constructor(
        private readonly app: App,
        private readonly plugin: ImageConverterPlugin
    ) {
        this.coordinator = new ImageReferenceWorkflowCoordinator(app, plugin);
    }

    async uploadSingleFile(
        file: TFile,
        clickedContext?: ClickedImageReferenceContext
    ): Promise<void> {
        if (isHttpUrl(file.path)) {
            new Notice(t("ERROR_CANNOT_UPLOAD_NETWORK"));
            return;
        }

        const uploadResult = await this.uploadWithRetry(file);
        if (!uploadResult?.success || !uploadResult.cloudUrl) return;
        new Notice(t("REFERENCE_WORKFLOW_UPLOAD_COMPLETE", [uploadResult.cloudUrl]));

        if (clickedContext) {
            try {
                await clickedContext.view.save();
            } catch (error) {
                console.error("[Image Assistant] Failed to save clicked note before upload review:", error);
                new Notice(t("REFERENCE_WORKFLOW_TRANSFER_KEPT"));
                return;
            }
        }

        const source: ImageReferenceSource = { kind: "local", file };
        const inventory = await this.coordinator.inspect(source, clickedContext);
        this.openDecisionModal(inventory, uploadResult.cloudUrl);
    }

    private openDecisionModal(inventory: ReferenceInventory, cloudUrl: string): void {
        new ImageReferenceDecisionModal(this.app, {
            operation: "upload",
            inventory,
            allowedActions: this.coordinator.getAllowedDecisionActions(inventory, "upload"),
            sourceLabel: inventory.source.kind === "local"
                ? inventory.source.file.path
                : inventory.source.url,
            destinationLabel: cloudUrl,
            sourceDeletionLabel: inventory.source.kind === "local"
                ? describeLocalFileDeletion(this.plugin.settings.cleanerSettings)
                : undefined,
            onDecision: decision => this.handleDecision(inventory, cloudUrl, decision)
        }).open();
    }

    private async handleDecision(
        inventory: ReferenceInventory,
        cloudUrl: string,
        decision: ReferenceWorkflowDecision
    ): Promise<void> {
        if (decision.action === "cancel" || decision.action === "keep-transfer") {
            new Notice(t("REFERENCE_WORKFLOW_TRANSFER_KEPT"));
            return;
        }

        try {
            if (decision.scope === "none") {
                if (decision.deleteSource) {
                    const deletion = await this.coordinator.deleteSource(
                        inventory.source,
                        inventory.sourceRevision
                    );
                    new Notice(getSourceDeletionNotice(deletion));
                }
                return;
            }

            const result = await this.coordinator.replace(
                inventory,
                { kind: "url", url: cloudUrl },
                decision.scope
            );
            if (result.staleInventory) {
                new Notice(t("REFERENCE_WORKFLOW_CHANGED"));
                this.openDecisionModal(result.staleInventory, cloudUrl);
                return;
            }
            if (!result.complete || result.changed !== result.found) {
                new Notice(t("REFERENCE_WORKFLOW_PARTIAL", [
                    result.changed.toString(),
                    result.found.toString()
                ]));
                this.refreshImageViews();
                return;
            }

            if (decision.deleteSource) {
                const deletion = await this.coordinator.deleteSource(
                    inventory.source,
                    inventory.sourceRevision
                );
                new Notice(getSourceDeletionNotice(deletion));
            } else {
                new Notice(t("REFERENCE_WORKFLOW_RESULT", [
                    result.changed.toString(),
                    result.found.toString()
                ]));
            }
            this.refreshImageViews();
        } catch (error) {
            console.error("[Image Assistant] Failed to complete upload reference workflow:", error);
            new Notice(t("MSG_UPLOAD_FAILED", [getErrorMessage(error)]));
        }
    }

    private async uploadWithRetry(file: TFile): Promise<SingleUploadResult | null> {
        let retryCount = 0;
        const maxRetries = 3;
        while (retryCount < maxRetries) {
            try {
                new Notice(t("REFERENCE_WORKFLOW_UPLOADING", [file.name]));
                if (!await this.validateFileExists(file)) {
                    throw new Error(t("MSG_FILE_NOT_FOUND"));
                }

                const uploaderManager = new UploaderManager(
                    this.plugin.settings.pasteHandling.cloud.uploader,
                    this.plugin
                );
                const result = await uploaderManager.upload([{
                    path: file.path,
                    name: file.name,
                    source: file.path,
                    file
                }]);
                const cloudUrl = result.success && typeof result.result?.[0] === "string"
                    ? result.result[0].trim()
                    : "";
                if (!cloudUrl || !isHttpUrl(cloudUrl)) {
                    throw new Error(result.msg || t("REFERENCE_WORKFLOW_UPLOAD_NO_URL"));
                }
                return { success: true, file, cloudUrl };
            } catch (error) {
                retryCount++;
                if (retryCount >= maxRetries) {
                    const retry = await new Promise<boolean>(resolve => {
                        new UploadErrorDialog(
                            this.app,
                            file.name,
                            getErrorMessage(error),
                            choice => resolve(choice === "retry")
                        ).open();
                    });
                    if (retry) {
                        retryCount = 0;
                    } else {
                        return {
                            success: false,
                            file,
                            error: getErrorMessage(error)
                        };
                    }
                } else {
                    new Notice(t("REFERENCE_WORKFLOW_UPLOAD_RETRY", [
                        retryCount.toString(),
                        maxRetries.toString()
                    ]));
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }
        }
        return null;
    }

    private async validateFileExists(file: TFile): Promise<boolean> {
        return this.app.vault.adapter.exists(file.path);
    }

    private refreshImageViews(): void {
        this.plugin.imageStateManager?.refreshAllImages();
        this.plugin.imageCaption?.refreshAllViews();
    }
}

function getSourceDeletionNotice(
    result: Awaited<ReturnType<ImageReferenceWorkflowCoordinator["deleteSource"]>>
): string {
    if (result.sourceDeleted) {
        return result.sourceDeleteResult?.historyUpdated === false
            ? result.sourceDeleteResult.message
                ?? t("REFERENCE_WORKFLOW_SOURCE_DELETED_HISTORY_STALE", [
                    t("MSG_UNKNOWN_ERROR")
                ])
            : t("REFERENCE_WORKFLOW_SOURCE_DELETED");
    }
    if (result.sourceDeleteResult) {
        return t("REFERENCE_WORKFLOW_SOURCE_DELETE_FAILED", [
            result.sourceDeleteResult.message
                ?? result.sourceDeleteResult.reason
                ?? t("MSG_UNKNOWN_ERROR")
        ]);
    }
    return t("REFERENCE_WORKFLOW_SOURCE_KEPT");
}
