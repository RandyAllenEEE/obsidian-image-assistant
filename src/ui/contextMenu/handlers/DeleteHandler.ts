import { App, Notice, TFile } from "obsidian";
import { CloudImageDeleter } from "../../../cloud/CloudImageDeleter";
import { t } from "../../../lang/helpers";
import type ImageConverterPlugin from "../../../main";
import {
    ImageReferenceWorkflowCoordinator,
    type ImageReferenceSource,
    type ReferenceInventory,
    type ReferenceWorkflowDecision
} from "../../../utils/ImageReferenceWorkflowCoordinator";
import { ImageReferenceDecisionModal } from "../../modals/ImageReferenceDecisionModal";
import type { ImageContextMenuContext } from "../types";
import { EditorRangeMutationTransaction } from "../../../utils/EditorRangeMutationTransaction";
import { ReferenceWorkflowProgressModal } from "../../modals/ReferenceWorkflowProgressModal";

/** Handles exact-occurrence deletion and coordinates optional vault-wide cleanup. */
export class DeleteHandler {
    private readonly coordinator: ImageReferenceWorkflowCoordinator;
    private readonly editorTransaction = new EditorRangeMutationTransaction();

    constructor(
        private readonly app: App,
        private readonly plugin: ImageConverterPlugin,
        cloudDeleter: CloudImageDeleter
    ) {
        this.coordinator = new ImageReferenceWorkflowCoordinator(
            app,
            plugin,
            cloudDeleter
        );
    }

    async deleteImageAndLink(context: ImageContextMenuContext): Promise<void> {
        let progress: ReferenceWorkflowProgressModal | null = null;
        try {
            if (context.sourceKind === "data") {
                await this.deleteDataReference(context);
                return;
            }
            const source = this.resolveSource(context);
            const clickedReference = context.viewContext;
            if (!source || !clickedReference) {
                new Notice(t("MSG_IMAGE_CONTEXT_UNRESOLVED"));
                return;
            }
            progress = new ReferenceWorkflowProgressModal(this.app);
            progress.open();

            try {
                progress.setStage("verify");
                await clickedReference.view.save();
            } catch (error) {
                progress.finish();
                console.error("[Image Assistant] Failed to save note before reference scan:", error);
                new Notice(t("MSG_LINK_REMOVED_SAVE_FAILED_SOURCE_KEPT"));
                return;
            }
            if (progress.isCancelled()) return;

            progress.setStage("index");
            const inventory = await this.coordinator.inspect(
                source,
                clickedReference
            );
            if (progress.isCancelled()) return;
            progress.finish();
            this.openDecisionModal(inventory);
        } catch (error) {
            progress?.finish();
            console.error("[Image Assistant] Failed to prepare image deletion:", error);
            new Notice(t("MSG_FAIL_DELETE"));
        }
    }

    private openDecisionModal(inventory: ReferenceInventory): void {
        const allowedActions = this.coordinator.getAllowedDecisionActions(
            inventory,
            "delete"
        );
        new ImageReferenceDecisionModal(this.app, {
            operation: "delete",
            inventory,
            allowedActions,
            sourceLabel: getSourceLabel(inventory.source),
            onDecision: decision => this.handleDecision(inventory, decision)
        }).open();
    }

    private async handleDecision(
        inventory: ReferenceInventory,
        decision: ReferenceWorkflowDecision
    ): Promise<void> {
        if (decision.action === "cancel") return;
        if (decision.scope === "none") return;

        const progress = new ReferenceWorkflowProgressModal(this.app);
        try {
            progress.open();
            progress.setStage("verify");
            progress.lock();
            progress.setStage("mutate");
            const result = await this.coordinator.remove(inventory, decision.scope);
            if (result.staleInventory) {
                progress.finish();
                new Notice(t("REFERENCE_WORKFLOW_CHANGED"));
                this.openDecisionModal(result.staleInventory);
                return;
            }
            if (!result.complete || result.changed !== result.found) {
                progress.finish();
                new Notice(t("REFERENCE_WORKFLOW_PARTIAL", [
                    result.changed.toString(),
                    result.found.toString()
                ]));
                this.refreshImageViews();
                return;
            }

            if (!decision.deleteSource) {
                progress.finish();
                new Notice(t("REFERENCE_WORKFLOW_RESULT", [
                    result.changed.toString(),
                    result.found.toString()
                ]));
                this.refreshImageViews();
                return;
            }

            progress.setStage("delete");
            const deletion = await this.coordinator.deleteSource(
                inventory.source,
                inventory.sourceRevision
            );
            progress.finish();
            new Notice(getSourceDeletionNotice(deletion));
            this.refreshImageViews();
        } catch (error) {
            progress.finish();
            console.error("[Image Assistant] Failed to execute image deletion workflow:", error);
            new Notice(t("MSG_FAIL_DELETE"));
        }
    }

    private resolveSource(
        context: ImageContextMenuContext
    ): ImageReferenceSource | null {
        if (context.sourceKind === "url" && context.url) {
            return { kind: "url", url: context.url };
        }
        if (context.sourceKind === "local" && context.localFile instanceof TFile) {
            return { kind: "local", file: context.localFile };
        }
        return null;
    }

    private async deleteDataReference(
        context: ImageContextMenuContext
    ): Promise<void> {
        const reference = context.dataReference;
        if (!reference) {
            new Notice(t("MSG_IMAGE_CONTEXT_UNRESOLVED"));
            return;
        }
        const line = reference.owner.editor.getLine(reference.match.lineNumber);
        if (line.slice(
            reference.match.index,
            reference.match.index + reference.match.fullMatch.length
        ) !== reference.match.fullMatch) {
            new Notice(t("MSG_IMAGE_CONTEXT_UNRESOLVED"));
            return;
        }
        const mutation = await this.editorTransaction.run(reference.owner, {
            line: reference.match.lineNumber,
            start: reference.match.index,
            end: reference.match.index + reference.match.fullMatch.length,
            expectedText: reference.match.fullMatch,
            replacement: "",
            removeStandaloneLine: true
        });
        if (!mutation.saved) {
            new Notice(
                mutation.stale
                    ? t("MSG_IMAGE_CONTEXT_UNRESOLVED")
                    : mutation.uncertain
                        ? t("MSG_EDITOR_SAVE_UNCERTAIN")
                        : t("MSG_FAIL_DELETE")
            );
            return;
        }
        this.refreshImageViews();
    }

    private refreshImageViews(): void {
        this.plugin.imageStateManager?.refreshAllImages();
        this.plugin.imageCaption?.refreshAllViews();
    }
}

function getSourceLabel(source: ImageReferenceSource): string {
    return source.kind === "local" ? source.file.path : source.url;
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
