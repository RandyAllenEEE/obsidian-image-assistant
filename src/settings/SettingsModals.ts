import { App, Modal, ButtonComponent } from "obsidian";
import { VariableProcessor } from "../local/VariableProcessor";
import { t } from "../lang/helpers";

export class ConfirmDialog extends Modal {
    message: string | DocumentFragment;
    confirmText: string;
    callback: () => void;

    constructor(
        app: App,
        title: string,
        message: string | DocumentFragment,
        confirmText: string,
        callback: () => void
    ) {
        super(app);
        this.titleEl.setText(title); // Set the title text
        this.message = message;
        this.confirmText = confirmText;
        this.callback = callback;
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
            .onClick(() => this.close());

        // Add a Confirm button with danger styling
        new ButtonComponent(buttonContainer)
            .setButtonText(this.confirmText)
            .setCta()
            .onClick(() => {
                this.close();
                this.callback();
            });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

export class AvailableVariablesModal extends Modal {
    private variableProcessor: VariableProcessor;
    private modalClass = "image-converter-available-variables-modal";
    private searchInput: HTMLInputElement;
    private categorizedVariables: Record<string, any[]>;
    private contentContainer: HTMLElement;

    constructor(app: App, variableProcessor: VariableProcessor) {
        super(app);
        this.variableProcessor = variableProcessor;
    }

    onOpen() {
        this.modalEl.addClass(this.modalClass); // Add class to modal container
        const { contentEl } = this;
        contentEl.createEl("h2", { text: t("AVAILABLE_VARIABLES_TITLE") });

        // Create search container
        const searchContainer = contentEl.createEl("div", { cls: "variable-search-container" });

        // Create search input
        this.searchInput = searchContainer.createEl("input", {
            type: "text",
            placeholder: t("SEARCH_VARIABLES_PLACEHOLDER"),
            cls: "variable-search-input"
        });

        // Add search icon (optional visual enhancement)
        searchContainer.createEl("span", {
            text: "🔍",
            cls: "variable-search-icon"
        });

        // Create content container for the variables
        this.contentContainer = contentEl.createEl("div", { cls: "variable-content-container" });

        // Get categorized variables once
        this.categorizedVariables = this.variableProcessor.getCategorizedVariables();

        // Initial render
        this.renderVariables();

        // Add search functionality
        this.searchInput.addEventListener("input", () => {
            this.handleSearch();
        });

        // Focus on search input
        this.searchInput.focus();
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
                categoryEl.createEl("h4", { text: category, cls: "variable-category-title" });

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
                    nameCell.innerHTML = this.highlightSearchTerm(variable.name, searchTerm);

                    const descCell = row.createEl("td", { cls: "variable-description" });
                    descCell.innerHTML = this.highlightSearchTerm(variable.description, searchTerm);
                    const exampleCell = row.createEl("td", { cls: "variable-example" });
                    exampleCell.innerHTML = this.highlightSearchTerm(variable.example, searchTerm);                    // Add click handler to copy variable name
                    nameCell.addEventListener("click", async () => {
                        try {
                            await navigator.clipboard.writeText(variable.name);

                            // Visual feedback - add CSS class for copy success
                            nameCell.classList.add("variable-name-copied");

                            // Show "Copied!" text temporarily
                            const originalText = nameCell.textContent;
                            nameCell.textContent = t("MSG_COPIED");

                            setTimeout(() => {
                                nameCell.classList.remove("variable-name-copied");
                                nameCell.textContent = originalText;
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
                    nameCell.title = t("TOOLTIP_COPY_VARIABLE");
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

    private highlightSearchTerm(text: string, searchTerm: string): string {
        if (!searchTerm) return text;

        const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<mark>$1</mark>');
    }

    private handleSearch() {
        const searchTerm = this.searchInput.value.trim();
        this.renderVariables(searchTerm);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        this.modalEl.removeClass(this.modalClass); // Remove class on close
    }
}
