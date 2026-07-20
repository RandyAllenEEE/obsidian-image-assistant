import { App, Modal, Setting } from "obsidian";
import { t } from "../../lang/helpers";
import type {
    ReferenceInventory,
    ReferenceWorkflowDecision,
    ReferenceWorkflowDecisionAction,
    ReferenceWorkflowOperation
} from "../../utils/ImageReferenceWorkflowCoordinator";

export interface ImageReferenceDecisionModalOptions {
    readonly operation: ReferenceWorkflowOperation;
    readonly inventory: ReferenceInventory;
    readonly allowedActions: ReadonlySet<ReferenceWorkflowDecisionAction>;
    readonly sourceLabel: string;
    readonly destinationLabel?: string;
    readonly onDecision: (decision: ReferenceWorkflowDecision) => Promise<void> | void;
}

/** A presentation-only decision surface shared by delete, upload and download. */
export class ImageReferenceDecisionModal extends Modal {
    private settled = false;
    private executing = false;

    constructor(
        app: App,
        private readonly options: ImageReferenceDecisionModalOptions
    ) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.empty();
        this.contentEl.addClass("image-assistant-reference-decision");
        this.contentEl.createEl("h2", {
            text: t(getTitleKey(this.options.operation))
        });
        this.renderSummary();
        this.renderActions();
    }

    onClose(): void {
        const shouldCancel = !this.settled;
        this.settled = true;
        this.contentEl.empty();
        if (shouldCancel) {
            void this.options.onDecision(toDecision("cancel"));
        }
    }

    private renderSummary(): void {
        const { inventory } = this.options;
        const summary = this.contentEl.createDiv({
            cls: "image-assistant-reference-decision-summary"
        });
        summary.createEl("p", {
            text: t("REFERENCE_WORKFLOW_SOURCE", [this.options.sourceLabel])
        });
        if (this.options.destinationLabel) {
            summary.createEl("p", {
                text: t("REFERENCE_WORKFLOW_DESTINATION", [this.options.destinationLabel])
            });
        }
        if (inventory.clickedContext) {
            summary.createEl("p", {
                text: t("REFERENCE_WORKFLOW_CLICKED_FILE", [
                    inventory.clickedContext.file.path
                ])
            });
        }
        summary.createEl("p", {
            text: t("REFERENCE_WORKFLOW_COUNTS", [
                inventory.totalReferences.toString(),
                inventory.markdownReferences.toString(),
                inventory.canvasReferences.toString()
            ])
        });
        summary.createEl("p", {
            text: t("REFERENCE_WORKFLOW_MUTABLE_COUNTS", [
                inventory.mutableReferences.toString(),
                inventory.protectedFencedReferences.toString(),
                inventory.outOfBoundaryReferences.toString()
            ])
        });

        if (inventory.protectedFencedReferences > 0) {
            summary.createEl("p", {
                text: t("REFERENCE_WORKFLOW_PROTECTED_WARNING", [
                    inventory.protectedFencedReferences.toString()
                ]),
                cls: "mod-warning"
            });
        }
        if (inventory.outOfBoundaryReferences > 0) {
            summary.createEl("p", {
                text: t("REFERENCE_WORKFLOW_BOUNDARY_WARNING", [
                    inventory.outOfBoundaryReferences.toString()
                ]),
                cls: "mod-warning"
            });
        }
        if (!inventory.safety.complete || !inventory.mutableComplete) {
            summary.createEl("p", {
                text: t("REFERENCE_WORKFLOW_INCOMPLETE_WARNING"),
                cls: "mod-warning"
            });
        }
        if (inventory.uncertainFiles.length > 0) {
            const details = summary.createEl("details");
            details.createEl("summary", {
                text: t("REFERENCE_WORKFLOW_UNCERTAIN_FILES", [
                    inventory.uncertainFiles.length.toString()
                ])
            });
            const list = details.createEl("ul");
            for (const file of inventory.uncertainFiles) {
                list.createEl("li", { text: file });
            }
        }
    }

    private renderActions(): void {
        const actions = orderedActions(this.options.allowedActions);
        const container = this.contentEl.createDiv({
            cls: "image-assistant-reference-decision-actions"
        });
        for (const action of actions) {
            new Setting(container).addButton(button => {
                button
                    .setButtonText(t(getActionKey(action, this.options.operation)))
                    .onClick(() => {
                        void this.choose(action);
                    });
                if (action === "all-delete-source" || action === "delete-source-only") {
                    button.setWarning();
                } else if (action === "clicked-keep-source" || action === "all-keep-source") {
                    button.setCta();
                }
            });
        }
    }

    private async choose(action: ReferenceWorkflowDecisionAction): Promise<void> {
        if (this.settled || this.executing) return;
        this.executing = true;
        this.contentEl.querySelectorAll<HTMLButtonElement>("button")
            .forEach(button => {
                button.disabled = true;
            });
        try {
            await this.options.onDecision(toDecision(action));
            this.settled = true;
            this.close();
        } catch (error) {
            console.error("[Image Assistant] Reference workflow decision failed:", error);
            this.executing = false;
            this.contentEl.querySelectorAll<HTMLButtonElement>("button")
                .forEach(button => {
                    button.disabled = false;
                });
        }
    }
}

function orderedActions(
    allowed: ReadonlySet<ReferenceWorkflowDecisionAction>
): ReferenceWorkflowDecisionAction[] {
    const order: ReferenceWorkflowDecisionAction[] = [
        "clicked-keep-source",
        "all-keep-source",
        "all-delete-source",
        "delete-source-only",
        "keep-transfer",
        "cancel"
    ];
    return order.filter(action => allowed.has(action));
}

function toDecision(action: ReferenceWorkflowDecisionAction): ReferenceWorkflowDecision {
    switch (action) {
        case "clicked-keep-source":
            return { action, scope: "clicked", deleteSource: false };
        case "all-keep-source":
            return { action, scope: "all", deleteSource: false };
        case "all-delete-source":
            return { action, scope: "all", deleteSource: true };
        case "delete-source-only":
            return { action, scope: "none", deleteSource: true };
        default:
            return { action, scope: "none", deleteSource: false };
    }
}

function getTitleKey(operation: ReferenceWorkflowOperation):
    | "REFERENCE_WORKFLOW_DELETE_TITLE"
    | "REFERENCE_WORKFLOW_UPLOAD_TITLE"
    | "REFERENCE_WORKFLOW_DOWNLOAD_TITLE" {
    switch (operation) {
        case "delete":
            return "REFERENCE_WORKFLOW_DELETE_TITLE";
        case "upload":
            return "REFERENCE_WORKFLOW_UPLOAD_TITLE";
        case "download":
            return "REFERENCE_WORKFLOW_DOWNLOAD_TITLE";
    }
}

function getActionKey(
    action: ReferenceWorkflowDecisionAction,
    operation: ReferenceWorkflowOperation
):
    | "REFERENCE_WORKFLOW_REMOVE_CLICKED"
    | "REFERENCE_WORKFLOW_REPLACE_CLICKED"
    | "REFERENCE_WORKFLOW_REMOVE_ALL_KEEP"
    | "REFERENCE_WORKFLOW_REPLACE_ALL_KEEP"
    | "REFERENCE_WORKFLOW_REMOVE_ALL_DELETE"
    | "REFERENCE_WORKFLOW_REPLACE_ALL_DELETE"
    | "REFERENCE_WORKFLOW_DELETE_SOURCE_ONLY"
    | "REFERENCE_WORKFLOW_KEEP_TRANSFER"
    | "MODAL_BUTTON_CANCEL" {
    switch (action) {
        case "clicked-keep-source":
            return operation === "delete"
                ? "REFERENCE_WORKFLOW_REMOVE_CLICKED"
                : "REFERENCE_WORKFLOW_REPLACE_CLICKED";
        case "all-keep-source":
            return operation === "delete"
                ? "REFERENCE_WORKFLOW_REMOVE_ALL_KEEP"
                : "REFERENCE_WORKFLOW_REPLACE_ALL_KEEP";
        case "all-delete-source":
            return operation === "delete"
                ? "REFERENCE_WORKFLOW_REMOVE_ALL_DELETE"
                : "REFERENCE_WORKFLOW_REPLACE_ALL_DELETE";
        case "delete-source-only":
            return "REFERENCE_WORKFLOW_DELETE_SOURCE_ONLY";
        case "keep-transfer":
            return "REFERENCE_WORKFLOW_KEEP_TRANSFER";
        case "cancel":
            return "MODAL_BUTTON_CANCEL";
    }
}
