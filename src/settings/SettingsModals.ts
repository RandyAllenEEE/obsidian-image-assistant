import { App, Modal, ButtonComponent, Setting, Notice } from "obsidian";
import ImageConverterPlugin from "../main";
import { VariableProcessor } from "../local/VariableProcessor";
import { t } from "../lang/helpers";
import {
    ActivePresetSetting,
    ConversionPreset,
    FilenamePreset,
    FolderPreset,
    LinkFormatPreset,
    NonDestructiveResizePreset
} from "./types";

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

export class SaveGlobalPresetModal extends Modal {
    plugin: ImageConverterPlugin;
    callback: (presetName: string) => void;
    presetName = "";

    constructor(app: App, plugin: ImageConverterPlugin, callback: (presetName: string) => void) {
        super(app);
        this.plugin = plugin;
        this.callback = callback;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: t("MODAL_SAVE_PRESET_TITLE") });

        // Preset Name Input
        new Setting(contentEl)
            .setName(t("MODAL_PRESET_NAME"))
            .addText((text) => {
                text.setPlaceholder(t("MODAL_PRESET_NAME_PLACEHOLDER"))
                    .setValue(this.presetName)
                    .onChange((value) => {
                        this.presetName = value;
                    });
            });

        // Preset Summary
        const summaryEl = contentEl.createEl("div", { cls: "image-converter-preset-summary" });
        this.updateSummary(summaryEl);

        // --- Buttons ---
        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText(t("MODAL_BUTTON_SAVE"))
                    .setCta()
                    .onClick(() => {
                        if (this.presetName) {
                            this.callback(this.presetName);
                            this.close();
                        } else {
                            new Notice(t("MODAL_ENTER_PRESET_NAME"));
                        }
                    })
            )
            .addButton((btn) =>
                btn
                    .setButtonText(t("MODAL_BUTTON_CANCEL"))
                    .onClick(() => {
                        this.close();
                    })
            );

    }

    updateSummary(summaryEl: HTMLElement) {
        summaryEl.empty();
        summaryEl.createEl("h4", { text: t("MODAL_SUMMARY") });

        const folderPreset = this.plugin.settings.folderPresets.find(
            (presetItem: FolderPreset) => presetItem.name === this.plugin.settings.selectedFolderPreset
        );
        const filenamePreset = this.plugin.settings.filenamePresets.find(
            (presetItem: FilenamePreset) => presetItem.name === this.plugin.settings.selectedFilenamePreset
        );
        const conversionPreset = this.plugin.settings.conversionPresets.find(
            (presetItem: ConversionPreset) => presetItem.name === this.plugin.settings.selectedConversionPreset
        );
        const linkFormatPreset = this.plugin.settings.linkFormatSettings.linkFormatPresets.find(
            (presetItem: LinkFormatPreset) => presetItem.name === this.plugin.settings.linkFormatSettings.selectedLinkFormatPreset
        );
        const resizePreset = this.plugin.settings.nonDestructiveResizeSettings.resizePresets.find(
            (presetItem: NonDestructiveResizePreset) => presetItem.name === this.plugin.settings.nonDestructiveResizeSettings.selectedResizePreset
        );

        // Use DocumentFragment for efficient DOM updates
        const fragment = document.createDocumentFragment();

        // Helper function to create a section title
        const createSectionTitle = (title: string) => {
            const titleEl = document.createElement("div");
            titleEl.classList.add("summary-section-title");
            titleEl.textContent = title;
            return titleEl;
        };

        // Helper function to create a summary item
        const createSummaryItem = (label: string, value: string | undefined | number | boolean, boldValue = false) => {
            const itemEl = document.createElement("div");
            itemEl.classList.add("summary-item");
            itemEl.createEl("span", { text: `${label}: `, cls: "summary-label" });
            itemEl.createEl("span", {
                text: value !== undefined && value !== null ? value.toString() : "None",
                cls: boldValue ? "summary-value-bold" : "summary-value",
            });
            return itemEl;
        };

        // Function to add a preset summary section
        const addPresetSummary = (presetType: string, preset: any) => {
            if (preset) {
                const sectionEl = document.createElement("div");
                sectionEl.classList.add("summary-section");
                sectionEl.appendChild(createSectionTitle(t("MODAL_SECTION_PRESET").replace("{0}", presetType).replace("{1}", preset.name)));

                switch (presetType) {
                    case "Folder":
                        sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_TYPE"), preset.type));
                        if (preset.type === "SUBFOLDER") {
                            sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_SUBFOLDER_TEMPLATE"), this.plugin.settings.subfolderTemplate));
                        } else if (preset.type === "CUSTOM") {
                            sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_CUSTOM_TEMPLATE"), preset.customTemplate));
                        }
                        break;
                    case "Filename":
                        sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_TEMPLATE"), preset.customTemplate));
                        break;
                    case "Conversion":
                        sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_OUTPUT_FORMAT_SUMMARY"), preset.outputFormat));
                        if (preset.outputFormat !== "NONE") {
                            sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_QUALITY_SUMMARY"), preset.quality));
                            if (preset.outputFormat === "PNG") {
                                sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_COLOR_DEPTH_SUMMARY"), preset.colorDepth));
                            }
                            sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_RESIZE_MODE_SUMMARY"), preset.resizeMode));
                            switch (preset.resizeMode) {
                                case "Fit":
                                case "Fill":
                                    sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_DIMENSIONS"), `${preset.desiredWidth}x${preset.desiredHeight}`));
                                    break;
                                case "Width":
                                    sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_WIDTH_SUMMARY"), preset.desiredWidth));
                                    break;
                                case "Height":
                                    sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_HEIGHT_SUMMARY"), preset.desiredHeight));
                                    break;
                                case "LongestEdge":
                                case "ShortestEdge":
                                    sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_EDGE"), preset.desiredLongestEdge));
                                    break;
                            }
                            if (preset.resizeMode !== "None") {
                                sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_SCALE_SUMMARY"), preset.enlargeOrReduce));
                            }
                            sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_ALLOW_LARGER"), preset.allowLargerFiles ? t("SETTING_YES") : t("SETTING_NO")));
                            sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_SKIP_PATTERNS"), preset.skipConversionPatterns));
                        }
                        break;
                    case "Link format":
                        sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_LINK_TYPE"), preset.linkFormat));
                        sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_PATH_FORMAT"), preset.pathFormat));
                        break;
                    case "Resize":
                        if (resizePreset) {
                            let resizeDimensionSummary = "";
                            switch (resizePreset.resizeDimension) {
                                case "width":
                                    resizeDimensionSummary = `Width: ${resizePreset.width}${resizePreset.resizeUnits === "percentage" ? "%" : "px"}`;
                                    break;
                                case "height":
                                    resizeDimensionSummary = `Height: ${resizePreset.height}${resizePreset.resizeUnits === "percentage" ? "%" : "px"}`;
                                    break;
                                case "both":
                                    resizeDimensionSummary = `Custom: ${resizePreset.customValue}`;
                                    break;
                                case "longest-edge":
                                    resizeDimensionSummary = t("MODAL_LABEL_LONG_EDGE") + `: ${resizePreset.longestEdge}${resizePreset.resizeUnits === "percentage" ? "%" : "px"}`;
                                    break;
                                case "shortest-edge":
                                    resizeDimensionSummary = t("MODAL_LABEL_SHORT_EDGE") + `: ${resizePreset.shortestEdge}${resizePreset.resizeUnits === "percentage" ? "%" : "px"}`;
                                    break;
                                case "original-width":
                                    resizeDimensionSummary = t("MODAL_LABEL_ORIGINAL_WIDTH");
                                    break;
                                case "original-height":
                                    resizeDimensionSummary = t("MODAL_LABEL_ORIGINAL_HEIGHT");
                                    break;
                                case "editor-max-width":
                                    resizeDimensionSummary = t("MODAL_LABEL_EDITOR_MAX_WIDTH") + `: ${resizePreset.editorMaxWidthValue}${resizePreset.resizeUnits === "percentage" ? "%" : "px"}`;
                                    break;
                                case "none":
                                    resizeDimensionSummary = t("MODAL_LABEL_NO_RESIZING");
                                    break;
                            }
                            sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_DIMENSION_SUMMARY"), resizeDimensionSummary));

                            if (resizePreset.resizeDimension !== "none") {
                                sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_SCALE_MODE"), resizePreset.resizeScaleMode));
                                sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_RESPECT_MAX_WIDTH"), resizePreset.respectEditorMaxWidth ? t("SETTING_YES") : t("SETTING_NO")));
                                if (resizePreset.resizeDimension !== "original-width" && resizePreset.resizeDimension !== "original-height" && resizePreset.resizeDimension !== "editor-max-width") {
                                    sectionEl.appendChild(createSummaryItem(t("MODAL_LABEL_MAINTAIN_ASPECT"), resizePreset.maintainAspectRatio ? t("SETTING_YES") : t("SETTING_NO")));
                                }
                            }
                        }
                        break;
                }

                fragment.appendChild(sectionEl);
            }
        };

        addPresetSummary("Folder", folderPreset);
        addPresetSummary("Filename", filenamePreset);
        addPresetSummary("Conversion", conversionPreset);
        addPresetSummary("Link format", linkFormatPreset);
        addPresetSummary("Resize", resizePreset);

        // Append the fragment to the summary container
        summaryEl.appendChild(fragment);
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
                text: t("MSG_NO_VARIABLES_FOUND").replace("{0}", searchTerm)
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
