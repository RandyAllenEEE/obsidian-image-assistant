import { App, Notice, TFile } from "obsidian";
import { t } from "../../../lang/helpers";
import type ImageConverterPlugin from "../../../main";
import { getErrorMessage } from "../../../utils/ErrorUtils";
import {
    ImageReferenceWorkflowCoordinator,
    type ReferenceInventory,
    type ReferenceWorkflowDecision
} from "../../../utils/ImageReferenceWorkflowCoordinator";
import { ImageReferenceDecisionModal } from "../../modals/ImageReferenceDecisionModal";
import type { ImageContextMenuContext } from "../types";

/** Handles context-menu transfers and delegates all reference work to the coordinator. */
export class UploadDownloadHandler {
    private readonly coordinator: ImageReferenceWorkflowCoordinator;

    constructor(
        private readonly app: App,
        private readonly plugin: ImageConverterPlugin
    ) {
        this.coordinator = new ImageReferenceWorkflowCoordinator(app, plugin);
    }

    async uploadImageToCloud(context: ImageContextMenuContext): Promise<void> {
        try {
            const file = context.localFile;
            const clickedReference = context.viewContext;
            if (!(file instanceof TFile) || !clickedReference) {
                new Notice(t("MSG_IMAGE_CONTEXT_UNRESOLVED"));
                return;
            }
            await this.plugin.cloudImageHandler.uploadSingleFile(
                file,
                clickedReference
            );
        } catch (error) {
            console.error("[Image Assistant] Error uploading image:", error);
            new Notice(t("MSG_UPLOAD_FAILED", [getErrorMessage(error)]));
        }
    }

    async downloadNetworkImage(context: ImageContextMenuContext): Promise<void> {
        let downloadResult: Awaited<ReturnType<
            ImageConverterPlugin["cloudImageHandler"]["downloadSingleImageFile"]
        >> | undefined;
        try {
            const clickedReference = context.viewContext;
            const owner = context.owner;
            const url = context.url;
            if (!owner || !url) {
                new Notice(t("MSG_IMAGE_CONTEXT_UNRESOLVED"));
                return;
            }

            downloadResult = await this.plugin.cloudImageHandler.downloadSingleImageFile(
                url,
                owner.file
            );
            if (!downloadResult.success || !downloadResult.vaultPath) {
                new Notice(t("MSG_DOWNLOAD_FAILED", [
                    downloadResult.error ?? t("MSG_UNKNOWN_ERROR")
                ]));
                return;
            }

            const downloadedFile = this.app.vault.getAbstractFileByPath(
                downloadResult.vaultPath
            );
            if (!(downloadedFile instanceof TFile)) {
                new Notice(t("MSG_DOWNLOAD_FAILED", [
                    t("REFERENCE_WORKFLOW_DOWNLOADED_FILE_MISSING", [
                        downloadResult.vaultPath
                    ])
                ]));
                return;
            }

            if (!clickedReference) {
                new Notice(t("REFERENCE_WORKFLOW_TRANSFER_KEPT"));
                return;
            }

            try {
                await clickedReference.view.save();
            } catch (error) {
                console.error("[Image Assistant] Failed to save clicked note before download review:", error);
                new Notice(t("REFERENCE_WORKFLOW_TRANSFER_KEPT"));
                return;
            }

            const inventory = await this.coordinator.inspect(
                { kind: "url", url },
                clickedReference
            );
            this.openDecisionModal(inventory, downloadedFile);
        } catch (error) {
            console.error("[Image Assistant] Error downloading network image:", error);
            new Notice(t("MSG_DOWNLOAD_FAILED", [getErrorMessage(error)]));
        } finally {
            if (downloadResult) {
                // All decisions keep the transfer result, including cancel.
                this.plugin.cloudImageHandler.discardDownloadUndo(downloadResult);
            }
        }
    }

    private openDecisionModal(
        inventory: ReferenceInventory,
        downloadedFile: TFile
    ): void {
        new ImageReferenceDecisionModal(this.app, {
            operation: "download",
            inventory,
            allowedActions: this.coordinator.getAllowedDecisionActions(
                inventory,
                "download"
            ),
            sourceLabel: inventory.source.kind === "url"
                ? inventory.source.url
                : inventory.source.file.path,
            destinationLabel: downloadedFile.path,
            onDecision: decision => this.handleDownloadDecision(
                inventory,
                downloadedFile,
                decision
            )
        }).open();
    }

    private async handleDownloadDecision(
        inventory: ReferenceInventory,
        downloadedFile: TFile,
        decision: ReferenceWorkflowDecision
    ): Promise<void> {
        if (decision.action === "cancel" || decision.action === "keep-transfer") {
            new Notice(t("REFERENCE_WORKFLOW_TRANSFER_KEPT"));
            return;
        }
        if (decision.scope === "none") return;

        try {
            const result = await this.coordinator.replace(
                inventory,
                { kind: "local", file: downloadedFile },
                decision.scope
            );
            if (result.staleInventory) {
                new Notice(t("REFERENCE_WORKFLOW_CHANGED"));
                this.openDecisionModal(result.staleInventory, downloadedFile);
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
            console.error("[Image Assistant] Failed to complete download reference workflow:", error);
            new Notice(t("MSG_DOWNLOAD_REPLACE_FAILED", [getErrorMessage(error)]));
        }
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
