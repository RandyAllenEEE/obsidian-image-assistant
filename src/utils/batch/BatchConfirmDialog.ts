import { App, Modal, Setting } from "obsidian";
import { basename } from "path-browserify";
import { BatchAction, BatchConfirmOptions, MultiRefItem } from "./types";

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
        const modeLabel = mode === 'local' ? "Local Processing" : "Cloud Upload";
        content.createEl("p", {
            text: `${modeLabel}: ${totalCount} images`,
            cls: "batch-confirm-summary"
        });

        // Scope info
        if (scopePath) {
            content.createEl("p", {
                text: `Scope: ${basename(scopePath)}`,
                cls: "batch-confirm-scope"
            });
        }

        // Multi-reference warning
        if (multiRefItems.length > 0) {
            const warningDiv = content.createDiv({ cls: "batch-warning-box" });
            warningDiv.createEl("p", {
                text: `${multiRefItems.length} images have references in other notes`,
                cls: "batch-warning-text"
            });

            // Details list
            const detailsDiv = content.createDiv({ cls: "batch-reference-details" });
            detailsDiv.createEl("p", {
                text: "Details:",
                cls: "batch-details-title"
            });

            const listEl = detailsDiv.createEl("ul");
            multiRefItems.slice(0, 10).forEach(info => {
                const itemEl = listEl.createEl("li");
                itemEl.setText(
                    `${info.name}: ${info.currentNoteReferences} in current, ${info.otherNotesReferences} in other notes`
                );
            });

            if (multiRefItems.length > 10) {
                listEl.createEl("li", {
                    text: `... and ${multiRefItems.length - 10} more`,
                    cls: "batch-more-files"
                });
            }

            content.createEl("p", {
                text: "Select an action:",
                cls: "batch-info-text"
            });
        } else {
            content.createEl("p", {
                text: "All images are only referenced in the current note.",
                cls: "batch-info-text"
            });
        }

        // Buttons
        const buttonContainer = content.createDiv({ cls: "batch-button-container" });

        // First row of buttons
        const buttonSetting1 = new Setting(buttonContainer);

        if (actions.includes('replace-current') && multiRefItems.length > 0) {
            buttonSetting1.addButton(btn => btn
                .setButtonText("Replace in current note")
                .setTooltip("Only replace links in current note")
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-current');
                })
            );
        }

        if (actions.includes('replace-all')) {
            buttonSetting1.addButton(btn => btn
                .setButtonText("Replace in all notes")
                .setCta()
                .setTooltip("Replace links in all notes")
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-all');
                })
            );
        }

        if (actions.includes('process-only')) {
            buttonSetting1.addButton(btn => btn
                .setButtonText("Process only (no link changes)")
                .setTooltip("Process images without changing links")
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
                .setButtonText("Replace all & delete source")
                .setTooltip("Replace all links and delete source files")
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-all-delete');
                })
            );
        }

        buttonSetting2.addButton(btn => btn
            .setButtonText("Cancel")
            .setTooltip("Cancel operation")
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
