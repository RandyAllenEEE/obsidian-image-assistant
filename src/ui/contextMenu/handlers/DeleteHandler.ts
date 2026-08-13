import { App, Notice, TFile } from "obsidian";
import { CloudImageDeleter } from "../../../cloud/CloudImageDeleter";
import { t } from "../../../lang/helpers";
import type ImageConverterPlugin from "../../../main";
import {
    ImageReferenceWorkflowCoordinator,
    type ClickedImageReferenceContext,
    type ImageReferenceSource,
    type ReferenceInventory,
    type ReferenceWorkflowDecision
} from "../../../utils/ImageReferenceWorkflowCoordinator";
import { ImageReferenceDecisionModal } from "../../modals/ImageReferenceDecisionModal";
import type { ImageContextMenuContext } from "../types";
import { EditorRangeMutationTransaction } from "../../../utils/EditorRangeMutationTransaction";
import { ReferenceWorkflowProgressModal } from "../../modals/ReferenceWorkflowProgressModal";
import { describeLocalFileDeletion } from "../../../utils/LocalFileDeletionService";
import {
    getExcalidrawAssetFamily,
    inspectDrawingFile
} from "../../../drawing/DrawingFileSemantics";

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
            this.openLoadingDecisionModal(source, clickedReference);
        } catch (error) {
            console.error("[Image Assistant] Failed to prepare image deletion:", error);
            new Notice(t("MSG_FAIL_DELETE"));
        }
    }

    private openLoadingDecisionModal(
        source: ImageReferenceSource,
        clickedReference: ClickedImageReferenceContext
    ): void {
        const abortController = new AbortController();
        const modal = new ImageReferenceDecisionModal(this.app, {
            operation: "delete",
            allowedActions: new Set(["clicked-keep-source", "cancel"]),
            sourceLabel: getSourceLabel(source),
            sourceDeletionLabel: source.kind === "local"
                ? describeLocalFileDeletion(this.plugin.settings.cleanerSettings)
                : undefined,
            onCancelLoading: () => abortController.abort(),
            onDecision: (decision, inventory) => this.handleDecision(
                source,
                clickedReference,
                inventory,
                decision
            )
        });
        modal.open();
        void this.coordinator.beginSession(source, {
            clickedContext: clickedReference,
            signal: abortController.signal
        }).then(session => {
            modal.updateInventory(
                session.inventory,
                this.coordinator.getAllowedDecisionActions(
                    session.inventory,
                    "delete"
                )
            );
        }).catch(error => {
            if (isAbortError(error)) return;
            modal.markInventoryUnavailable();
            console.error("[Image Assistant] Failed to prepare reference inventory:", error);
            new Notice(t("REFERENCE_WORKFLOW_INDEX_DEGRADED"));
        });
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
            sourceDeletionLabel: inventory.source.kind === "local"
                ? describeLocalFileDeletion(this.plugin.settings.cleanerSettings)
                : undefined,
            onDecision: decision => this.handleDecision(
                inventory.source,
                inventory.clickedContext,
                inventory,
                decision
            )
        }).open();
    }

    private async handleDecision(
        source: ImageReferenceSource,
        clickedReference: ClickedImageReferenceContext | undefined,
        inventory: ReferenceInventory | undefined,
        decision: ReferenceWorkflowDecision
    ): Promise<void> {
        if (decision.action === "cancel") return;
        if (decision.scope === "none" && !decision.deleteSource) return;
        if (!clickedReference && decision.scope === "clicked") return;
        if (!inventory && decision.scope !== "clicked") return;

        const localSource = source.kind === "local" ? source.file : null;
        const drawing = localSource
            ? inspectDrawingFile(this.plugin, localSource)
            : null;
        const derivativeCandidates = drawing?.providerId === "excalidraw"
            && drawing.role === "source"
            ? getExcalidrawAssetFamily(this.app, drawing)
                .filter(file => file.path !== localSource?.path)
            : [];

        const progress = new ReferenceWorkflowProgressModal(this.app);
        try {
            progress.open();
            const onProgress = (state: {
                stage: "index" | "verify" | "mutate" | "delete";
                processed: number;
                total: number;
            }): void => {
                progress.setStage(state.stage);
                progress.setProgress(state.processed, state.total);
            };
            const result = inventory
                ? await this.coordinator.executeDecision(
                    { inventory, createdAt: Date.now() },
                    decision,
                    {
                        signal: progress.signal,
                        onProgress,
                        onCommitStart: () => progress.lock()
                    }
                )
                : await this.coordinator.executeClickedOnly(
                    source,
                    clickedReference!,
                    {
                        signal: progress.signal,
                        onCommitStart: () => progress.lock()
                    }
                );
            if (result.staleInventory) {
                progress.finish();
                new Notice(t("REFERENCE_WORKFLOW_CHANGED"));
                this.openDecisionModal(result.staleInventory);
                return;
            }
            if (!result.complete || result.changed !== result.found) {
                progress.finish();
                new Notice(decision.deleteSource && result.sourceDeleteResult
                    ? getSourceDeletionNotice(result)
                    : t("REFERENCE_WORKFLOW_PARTIAL", [
                        result.changed.toString(),
                        result.found.toString()
                    ]));
                this.refreshImageViews(result.changedFiles);
                return;
            }

            progress.finish();
            new Notice(decision.deleteSource
                ? getSourceDeletionNotice(result)
                : t("REFERENCE_WORKFLOW_RESULT", [
                    result.changed.toString(),
                    result.found.toString()
                ]));
            if (decision.deleteSource && result.sourceDeleted
                && derivativeCandidates.length > 0) {
                const retained = await this.cleanupExcalidrawDerivatives(
                    derivativeCandidates,
                    progress.signal
                );
                if (retained > 0) {
                    new Notice(t("NOTICE_EXCALIDRAW_DERIVATIVES_RETAINED", [
                        retained.toString()
                    ]));
                }
            }
            this.refreshImageViews(result.changedFiles);
        } catch (error) {
            progress.finish();
            if (isAbortError(error)) return;
            console.error("[Image Assistant] Failed to execute image deletion workflow:", error);
            new Notice(t("MSG_FAIL_DELETE"));
        }
    }

    /**
     * Derivatives are deleted only after their source was safely removed and
     * only when the normal reference/revision checks independently pass.
     * A referenced or concurrently modified preview is deliberately retained.
     */
    private async cleanupExcalidrawDerivatives(
        files: readonly TFile[],
        signal?: AbortSignal
    ): Promise<number> {
        let retained = 0;
        for (const original of files) {
            const current = this.app.vault.getAbstractFileByPath(original.path);
            if (!(current instanceof TFile)) continue;
            try {
                const result = await this.coordinator.deleteSource(
                    { kind: "local", file: current },
                    undefined,
                    signal
                );
                if (!result.sourceDeleted) retained += 1;
            } catch {
                retained += 1;
            }
        }
        return retained;
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
        this.refreshImageViews([reference.owner.file.path]);
    }

    private refreshImageViews(paths: readonly string[] = []): void {
        const changedPaths = new Set(paths);
        if (changedPaths.size === 0) return;
        const imageStateManager = this.plugin.imageStateManager;
        if (typeof imageStateManager?.refreshFiles === "function") {
            imageStateManager.refreshFiles(changedPaths);
        } else {
            imageStateManager?.refreshAllImages();
        }
        const imageCaption = this.plugin.imageCaption;
        if (typeof imageCaption?.refreshFiles === "function") {
            imageCaption.refreshFiles(changedPaths);
        } else {
            imageCaption?.refreshAllViews();
        }
    }
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
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
