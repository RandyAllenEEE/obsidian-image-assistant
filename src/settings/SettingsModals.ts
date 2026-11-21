import { App, Modal, ButtonComponent, Notice, SearchComponent } from "obsidian";
import {
    VariableProcessor,
    type VariableInfo
} from "../local/VariableProcessor";
import { t } from "../lang/helpers";

export class ConfirmDialog extends Modal {
    message: string | DocumentFragment;
    confirmText: string;
    callback: () => void | Promise<void>;
    private readonly cancelCallback?: () => void;
    private settled = false;

    constructor(
        app: App,
        title: string,
        message: string | DocumentFragment,
        confirmText: string,
        callback: () => void | Promise<void>,
        cancelCallback?: () => void
    ) {
        super(app);
        this.titleEl.setText(title); // Set the title text
        this.message = message;
        this.confirmText = confirmText;
        this.callback = callback;
        this.cancelCallback = cancelCallback;
    }

    onOpen() {
        const { contentEl } = this;

        // Check if the message is a string or a DocumentFragment
        if (typeof this.message === 'string') {
            contentEl.setText(this.message);
        } else {
            contentEl.empty();
            contentEl.appendChild(this.message);
        }

        // Create a container for buttons
        const buttonContainer = contentEl.createDiv(
            "image-converter-confirm-modal-buttons"
        );

        // Add a Cancel button
        new ButtonComponent(buttonContainer)
            .setButtonText(t("MODAL_BUTTON_CANCEL"))
            .onClick(() => {
                if (this.settled) return;
                this.settled = true;
                this.cancelCallback?.();
                this.close();
            });

        // Add a Confirm button with danger styling
        new ButtonComponent(buttonContainer)
            .setButtonText(this.confirmText)
            .setCta()
            .onClick(() => {
                if (this.settled) return;
                this.settled = true;
                this.close();
                void Promise.resolve()
                    .then(() => this.callback())
                    .catch(error => {
                        const message = error instanceof Error ? error.message : String(error);
                        console.error("[Image Assistant] Confirmed action failed:", error);
                        new Notice(message);
                    });
            });
    }

    onClose() {
        if (!this.settled) {
            this.settled = true;
            this.cancelCallback?.();
        }
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class AvailableVariablesModal extends Modal {
    private variableProcessor: VariableProcessor;
    private modalClass = "image-converter-available-variables-modal";
    private categorizedVariables: Record<string, VariableInfo[]>;
    private contentContainer: HTMLElement;

    constructor(app: App, variableProcessor: VariableProcessor) {
        super(app);
        this.variableProcessor = variableProcessor;
    }

    onOpen() {
        this.modalEl.addClass(this.modalClass); // Add class to modal container
        const { contentEl } = this;
        contentEl.createEl("h2", { text: t("AVAILABLE_VARIABLES_TITLE") });

        const searchLabel = t("SEARCH_VARIABLES_PLACEHOLDER");
        const search = new SearchComponent(contentEl)
            .setPlaceholder(searchLabel)
            .onChange(value => this.renderVariables(value.trim()));
        search.inputEl.setAttr("aria-label", searchLabel);

        // Create content container for the variables
        this.contentContainer = contentEl.createEl("div", { cls: "variable-content-container" });

        // Get categorized variables once
        this.categorizedVariables = this.variableProcessor.getCategorizedVariables();

        // Initial render
        this.renderVariables();

        search.inputEl.focus();
    }

    private renderVariables(searchTerm = "") {
        this.contentContainer.empty();

        for (const [category, variables] of Object.entries(this.categorizedVariables)) {
            // Filter variables based on search term
            const filteredVariables = variables.filter(variable => {
                if (!searchTerm) return true;

                const searchLower = searchTerm.toLowerCase();
                return (
                    variable.name.toLowerCase().includes(searchLower) ||
                    variable.description.toLowerCase().includes(searchLower) ||
                    variable.example.toLowerCase().includes(searchLower)
                );
            });

            // Only show category if it has matching variables
            if (filteredVariables.length > 0) {
                const categoryEl = this.contentContainer.createEl("div", { cls: "variable-category" });
                categoryEl.createEl("h4", {
                    text: getVariableCategoryLabel(category),
                    cls: "variable-category-title"
                });

                const table = categoryEl.createEl("table", { cls: "variable-table" });

                // Add table header
                const thead = table.createEl("thead");
                const headerRow = thead.createEl("tr");
                headerRow.createEl("th", { text: t("LABEL_VARIABLE") });
                headerRow.createEl("th", { text: t("LABEL_DESCRIPTION") });
                headerRow.createEl("th", { text: t("LABEL_EXAMPLE") });

                const tbody = table.createTBody();

                for (const variable of filteredVariables) {
                    const row = tbody.createEl("tr", { cls: "variable-row" });

                    // Highlight search term in the content
                    const nameCell = row.createEl("td", { cls: "variable-name" });
                    const copyButton = nameCell.createEl("button", {
                        cls: "variable-copy-button",
                        attr: { type: "button", title: t("TOOLTIP_COPY_VARIABLE") }
                    });
                    this.renderHighlightedText(copyButton, variable.name, searchTerm);

                    const descCell = row.createEl("td", { cls: "variable-description" });
                    this.renderHighlightedText(descCell, variable.description, searchTerm);
                    const exampleCell = row.createEl("td", { cls: "variable-example" });
                    this.renderHighlightedText(exampleCell, variable.example, searchTerm);
                    copyButton.addEventListener("click", async () => {
                        try {
                            await navigator.clipboard.writeText(variable.name);

                            // Visual feedback - add CSS class for copy success
                            nameCell.classList.add("variable-name-copied");

                            // Show "Copied!" text temporarily
                            copyButton.setText(t("MSG_COPIED"));

                            setTimeout(() => {
                                nameCell.classList.remove("variable-name-copied");
                                this.renderHighlightedText(copyButton, variable.name, searchTerm);
                            }, 800);
                        } catch (err) {
                            console.error("Failed to copy to clipboard:", err);
                            // Fallback visual indication for copy failure
                            nameCell.classList.add("variable-name-copy-error");
                            setTimeout(() => {
                                nameCell.classList.remove("variable-name-copy-error");
                            }, 500);
                        }
                    });
                }
            }
        }

        // Show "no results" message if no variables match
        if (searchTerm && this.contentContainer.children.length === 0) {
            this.contentContainer.createEl("div", {
                cls: "variable-no-results",
                text: t("MSG_NO_VARIABLES_FOUND", [searchTerm])
            });
        }
    }

    private renderHighlightedText(element: HTMLElement, text: string, searchTerm: string): void {
        if (!searchTerm) {
            element.setText(text);
            return;
        }

        const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        element.empty();
        text.split(regex).forEach((part, index) => {
            if (index % 2 === 0) element.appendText(part);
            else element.createEl("mark", { text: part });
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.removeClass(this.modalClass); // Remove class on close
    }
}

function getVariableCategoryLabel(category: string): string {
    switch (category) {
        case "Basic": return t("VARIABLE_CATEGORY_BASIC");
        case "Date & Time": return t("VARIABLE_CATEGORY_DATE_TIME");
        case "File & Vault": return t("VARIABLE_CATEGORY_FILE_VAULT");
        case "Image Metadata": return t("VARIABLE_CATEGORY_IMAGE_METADATA");
        case "Calculated Image Properties":
            return t("VARIABLE_CATEGORY_CALCULATED");
        case "Advanced": return t("VARIABLE_CATEGORY_ADVANCED");
        default: return category;
    }
}
