import { App, Modal, Setting } from "obsidian";
import { basename } from "path-browserify";
import { BatchAction, BatchConfirmOptions, MultiRefItem } from "./types";
import { t } from "../../lang/helpers";

/**
 * BatchConfirmDialog - Unified confirmation dialog for batch operations.
 * Can be used by both Local and Cloud batch processors.
 */
export class BatchConfirmDialog extends Modal {
    private options: BatchConfirmOptions;
    private onChoice: (action: BatchAction) => void;

    constructor(
        app: App,
        options: BatchConfirmOptions,
        onChoice: (action: BatchAction) => void
    ) {
        super(app);
        this.options = options;
        this.onChoice = onChoice;
    }

    onOpen() {
        const { contentEl } = this;
        const { title, totalCount, multiRefItems, scopePath, actions, mode } = this.options;

        // Title
        contentEl.createEl("h2", { text: title });

        const content = contentEl.createDiv();

        // Summary
        const modeLabel = mode === 'local' ? t("BATCH_DIALOG_LOCAL_PROCESSING") : t("MODAL_MODE_UPLOAD");
        content.createEl("p", {
            text: `${modeLabel}: ${totalCount} ${t("BATCH_DIALOG_IMAGES")}`,
            cls: "batch-confirm-summary"
        });

        // Scope info
        if (scopePath) {
            content.createEl("p", {
                text: `${t("BATCH_SCOPE_LABEL", [basename(scopePath)])}`,
                cls: "batch-confirm-scope"
            });
        }

        // Multi-reference warning
        if (multiRefItems.length > 0) {
            const warningDiv = content.createDiv({ cls: "batch-warning-box" });
            warningDiv.createEl("p", {
                text: `${multiRefItems.length} ${t("BATCH_DIALOG_REFS_WARNING")}`,
                cls: "batch-warning-text"
            });

            // Details list
            const detailsDiv = content.createDiv({ cls: "batch-reference-details" });
            detailsDiv.createEl("p", {
                text: t("BATCH_DIALOG_DETAILS"),
                cls: "batch-details-title"
            });

            const listEl = detailsDiv.createEl("ul");
            multiRefItems.slice(0, 10).forEach(info => {
                const itemEl = listEl.createEl("li");
                itemEl.setText(
                    `${info.name}: ${info.currentNoteReferences} ${t("BATCH_DIALOG_IN_CURRENT")}, ${info.otherNotesReferences} ${t("BATCH_DIALOG_IN_OTHER")}`
                );
            });

            if (multiRefItems.length > 10) {
                listEl.createEl("li", {
                    text: t("BATCH_DIALOG_MORE_ITEMS", [(multiRefItems.length - 10).toString()]),
                    cls: "batch-more-files"
                });
            }

            content.createEl("p", {
                text: t("BATCH_DIALOG_SELECT_ACTION"),
                cls: "batch-info-text"
            });
        } else {
            content.createEl("p", {
                text: t("BATCH_DIALOG_ALL_IN_CURRENT"),
                cls: "batch-info-text"
            });
        }

        // Buttons
        const buttonContainer = content.createDiv({ cls: "batch-button-container" });

        // First row of buttons
        const buttonSetting1 = new Setting(buttonContainer);

        if (actions.includes('replace-current') && multiRefItems.length > 0) {
            buttonSetting1.addButton(btn => btn
                .setButtonText(t("BATCH_DIALOG_REPLACE_CURRENT"))
                .setTooltip(t("BATCH_DIALOG_REPLACE_CURRENT_DESC"))
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-current');
                })
            );
        }

        if (actions.includes('replace-all')) {
            buttonSetting1.addButton(btn => btn
                .setButtonText(t("BATCH_DIALOG_REPLACE_ALL"))
                .setCta()
                .setTooltip(t("BATCH_DIALOG_REPLACE_ALL_DESC"))
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-all');
                })
            );
        }

        if (actions.includes('process-only')) {
            buttonSetting1.addButton(btn => btn
                .setButtonText(t("BATCH_DIALOG_PROCESS_ONLY"))
                .setTooltip(t("BATCH_DIALOG_PROCESS_ONLY_DESC"))
                .onClick(() => {
                    this.close();
                    this.onChoice('process-only');
                })
            );
        }

        // Second row of buttons
        const buttonSetting2 = new Setting(buttonContainer);

        if (actions.includes('replace-all-delete')) {
            buttonSetting2.addButton(btn => btn
                .setButtonText(t("BATCH_DIALOG_REPLACE_DELETE"))
                .setTooltip(t("BATCH_DIALOG_REPLACE_DELETE_DESC"))
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-all-delete');
                })
            );
        }

        buttonSetting2.addButton(btn => btn
            .setButtonText(t("BATCH_DIALOG_CANCEL"))
            .setTooltip(t("BATCH_DIALOG_CANCEL_DESC"))
            .onClick(() => {
                this.close();
                this.onChoice('cancel');
            })
        );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

/**
 * Show batch confirm dialog and return promise with user choice.
 */
export function showBatchConfirmDialog(
    app: App,
    options: BatchConfirmOptions
): Promise<BatchAction> {
    return new Promise((resolve) => {
        new BatchConfirmDialog(app, options, (action) => {
            resolve(action);
        }).open();
    });
}
