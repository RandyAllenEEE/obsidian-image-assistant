// NEW: ProcessFolderModal.ts
import {
    App,
    Modal,
    Notice,
    Setting,
    ButtonComponent,
    TFile,
    TFolder,
    TextComponent,
    normalizePath
} from "obsidian";
import ImageConverterPlugin from '../../main';
import { t } from '../../lang/helpers';

import { BatchImageProcessor } from '../../local/BatchImageProcessor';

enum ImageSource {
    DIRECT = "direct",
    LINKED = "linked",
}
export class ProcessFolderModal extends Modal {
    private recursive = false;

    // --- Image Source Enum ---
    private selectedImageSource: ImageSource = ImageSource.DIRECT; // Default to Direct

    // --- Settings UI Elements ---
    imageSourceSetting: Setting | null = null;
    qualitySetting: Setting | null = null;
    convertToSetting: Setting | null = null;
    skipFormatsSetting: Setting | null = null;
    resizeModeSetting: Setting | null = null;
    resizeInputSettings: Setting | null = null;
    enlargeReduceSettings: Setting | null = null;
    skipTargetFormatSetting: Setting | null = null;
    resizeInputsDiv: HTMLDivElement | null = null;
    enlargeReduceDiv: HTMLDivElement | null = null;

    // --- Image Counts ---
    private imageCount = 0;
    private processedCount = 0;
    private skippedCount = 0;
    private imageCountDisplay: HTMLSpanElement;
    private processedCountDisplay: HTMLSpanElement;
    private skippedCountDisplay: HTMLSpanElement;

    // --- Description Updating ---
    private updateImageSourceDescription:
        | ((source: ImageSource | null) => void)
        | null = null;

    constructor(
        app: App,
        private plugin: ImageConverterPlugin,
        private folderPath: string,
        private batchImageProcessor: BatchImageProcessor  // Inject instead of creating new
    ) {
        super(app);
    }



    async onOpen() {
        const { contentEl } = this;
        contentEl.addClass("image-convert-modal"); // Add a class for styling
        await this.createUI(contentEl);

        // Initialize image counts after UI elements are created
        await this.updateImageCountsAndDisplay();
    }

    onClose() {
        // Clear settings UI elements
        this.imageSourceSetting = null;
        this.qualitySetting = null;
        this.convertToSetting = null;
        this.skipFormatsSetting = null;
        this.resizeModeSetting = null;
        this.resizeInputSettings = null;
        this.enlargeReduceSettings = null;
        this.skipTargetFormatSetting = null;
        this.resizeInputsDiv = null;
        this.enlargeReduceDiv = null;

        // Clear description updater
        this.updateImageSourceDescription = null;

        const { contentEl } = this;
        contentEl.empty();
    }

    // --- UI Creation Methods ---

    private async createUI(contentEl: HTMLElement) {
        this.createHeader(contentEl);
        // --- Warning Message ---
        this.createWarningMessage(contentEl);


        // --- Image Counts ---
        this.createImageCountsDisplay(contentEl);


        // Create settings sections (no longer collapsible)
        const settingsContainer = contentEl.createDiv({
            cls: "settings-container",
        });



        this.createImageSourceSettings(settingsContainer);

        // Format and Quality Container
        const formatQualityContainer = settingsContainer.createDiv({
            cls: "format-quality-container",
        });
        this.createGeneralSettings(formatQualityContainer);

        // Resize Container
        const resizeContainer = settingsContainer.createDiv({
            cls: "resize-container",
        });
        this.createResizeSettings(resizeContainer);

        // Skip Container
        const skipContainer = settingsContainer.createDiv({
            cls: "skip-container",
        });
        this.createSkipSettings(skipContainer);

        this.createProcessButton(settingsContainer);

    }

    private createHeader(contentEl: HTMLElement) {
        const folderName = this.folderPath.split("/").pop() || this.folderPath;
        const headerContainer = contentEl.createDiv({ cls: "modal-header" });

        // Main title
        headerContainer.createEl("h2", { text: t("MODAL_PROCESS_IMAGES_TITLE") });

        // Subtitle
        headerContainer.createEl("h6", {
            text: t("MODAL_IN_FOLDER").replace("{0}", `/${folderName}`),
            cls: "modal-subtitle", // Add a class for styling
        });
    }

    // --- Warning Message ---
    private createWarningMessage(contentEl: HTMLElement) {
        contentEl.createEl("p", {
            cls: "modal-warning",
            text: t("MODAL_WARNING_BACKUP"),
        });
    }

    // --- Image Counts Display ---
    private createImageCountsDisplay(contentEl: HTMLElement) {

        const countsDisplay = contentEl.createDiv({
            cls: "image-counts-display-container",
        });

        // Add Image Source Description here
        const imageSourceDesc = countsDisplay.createDiv({
            cls: "image-source-description",
        });
        imageSourceDesc.id = "image-source-description"; // Set ID for aria-describedby

        // Function to update the description text
        const updateDescription = (source: ImageSource | null) => {
            let descText = t("DESC_NO_SELECTION"); // Default text
            if (source === ImageSource.DIRECT) {
                descText = t("DESC_DIRECT_IMAGES");
            } else if (source === ImageSource.LINKED) {
                descText = t("DESC_LINKED_IMAGES");
            }
            imageSourceDesc.setText(descText);
        };

        // Update description when the selected image source changes
        this.updateImageSourceDescription = updateDescription;

        // Set initial description
        updateDescription(this.selectedImageSource);
        // Image Counts
        countsDisplay.createEl("span", { text: t("LABEL_TOTAL_IMAGES") + ": " });
        this.imageCountDisplay = countsDisplay.createEl("span", {
            text: this.imageCount.toString(),
        });

        countsDisplay.createEl("br");

        countsDisplay.createEl("span", { text: t("LABEL_SKIPPED") + ": " });
        this.skippedCountDisplay = countsDisplay.createEl("span", {
            text: this.skippedCount.toString(),
        });

        countsDisplay.createEl("br");

        countsDisplay.createEl("span", { text: t("LABEL_TO_PROCESS") + ": " });
        this.processedCountDisplay = countsDisplay.createEl("span", {
            text: this.processedCount.toString(),
        });


    }

    // --- Image Source Settings with Radio Buttons ---
    private createImageSourceSettings(contentEl: HTMLElement) {
        contentEl.createEl("h4", { text: t("LABEL_IMAGE_SOURCE") }); // Heading for Image Source

        // --- Recursive Setting ---
        new Setting(contentEl)
            .setName(t("LABEL_RECURSIVE"))
            .setDesc(t("SETTING_RECURSIVE_DESC"))
            .addToggle((toggle) =>
                toggle.setValue(this.recursive).onChange(async (value) => {
                    this.recursive = value;
                    await this.updateImageCountsAndDisplay();
                })
            );

        const imageSourceSettingContainer = contentEl.createDiv();
        imageSourceSettingContainer.addClass("image-source-setting-container");

        // Store button references for updating later
        const buttonRefs: Record<ImageSource, any> = {
            [ImageSource.DIRECT]: null,
            [ImageSource.LINKED]: null,
        };

        // Function to update the icons of the radio buttons
        const updateIcons = () => {
            Object.entries(buttonRefs).forEach(([source, button]) => {
                if (button) {
                    button.setIcon(
                        this.selectedImageSource === source
                            ? "lucide-check-circle"
                            : "lucide-circle"
                    );
                }
            });
        };

        // --- Create Radio Buttons ---
        new Setting(imageSourceSettingContainer)
            .setName(t("LABEL_DIRECT_IMAGES"))
            .setDesc(t("SETTING_DIRECT_IMAGES_DESC"))
            .addExtraButton((button) => {
                buttonRefs[ImageSource.DIRECT] = button;
                button
                    .setIcon(
                        this.selectedImageSource === ImageSource.DIRECT
                            ? "lucide-check-circle"
                            : "lucide-circle"
                    )
                    .setTooltip(
                        this.selectedImageSource === ImageSource.DIRECT
                            ? t("TOOLTIP_SELECTED")
                            : t("TOOLTIP_SELECT")
                    )
                    .onClick(async () => {
                        this.selectedImageSource = ImageSource.DIRECT;
                        if (this.updateImageSourceDescription) {
                            this.updateImageSourceDescription(
                                this.selectedImageSource
                            );
                        }
                        await this.updateImageCountsAndDisplay();
                        updateIcons();
                    });
            });

        new Setting(imageSourceSettingContainer)
            .setName(t("LABEL_LINKED_IMAGES"))
            .setDesc(t("SETTING_LINKED_IMAGES_DESC"))
            .addExtraButton((button) => {
                buttonRefs[ImageSource.LINKED] = button;
                button
                    .setIcon(
                        this.selectedImageSource === ImageSource.LINKED
                            ? "lucide-check-circle"
                            : "lucide-circle"
                    )
                    .setTooltip(
                        this.selectedImageSource === ImageSource.LINKED
                            ? t("TOOLTIP_SELECTED")
                            : t("TOOLTIP_SELECT")
                    )
                    .onClick(async () => {
                        this.selectedImageSource = ImageSource.LINKED;
                        if (this.updateImageSourceDescription) {
                            this.updateImageSourceDescription(
                                this.selectedImageSource
                            );
                        }
                        await this.updateImageCountsAndDisplay();
                        updateIcons();
                    });
            });

        // Add the radio button container to contentEl
        contentEl.appendChild(imageSourceSettingContainer);

        // Set initial description and update icons
        if (this.updateImageSourceDescription) {
            this.updateImageSourceDescription(this.selectedImageSource);
        }
        updateIcons();
    }

    // --- General Settings ---
    private async createGeneralSettings(contentEl: HTMLElement) {
        contentEl.createEl("h4", { text: "General" }); // Heading for General Settings

        // --- Convert To Setting ---
        this.convertToSetting = new Setting(contentEl)
            .setName(t("SETTING_CONVERT_TO") + " ⓘ")
            .setDesc(t("SETTING_CONVERT_TO_DESC"))
            .setTooltip(t("SETTING_CONVERT_TO_DESC"))
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("disabled", t("SETTING_SAME_AS_ORIGINAL"))
                    .addOptions({
                        webp: "WebP",
                        jpg: "JPG",
                        png: "PNG",
                    })
                    .setValue(this.plugin.settings.ProcessCurrentNoteconvertTo)
                    .onChange(async (value) => {
                        this.plugin.settings.ProcessCurrentNoteconvertTo = value;
                        await this.plugin.saveSettings();
                        await this.updateImageCountsAndDisplay();
                    });
            });

        // --- Quality Setting ---
        this.qualitySetting = new Setting(contentEl)
            .setName(t("SETTING_QUALITY") + " ⓘ")
            .setDesc(t("SETTING_QUALITY_DESC"))
            .setTooltip(t("SETTING_QUALITY_TOOLTIP"))
            .addText((text) => {
                text
                    .setPlaceholder(t("SETTING_QUALITY_DESC"))
                    .setValue(
                        (
                            this.plugin.settings.ProcessCurrentNotequality * 100
                        ).toString()
                    )
                    .onChange(async (value) => {
                        const quality = parseInt(value, 10);
                        if (
                            !isNaN(quality) &&
                            quality >= 0 &&
                            quality <= 100
                        ) {
                            this.plugin.settings.ProcessCurrentNotequality =
                                quality / 100;
                            await this.plugin.saveSettings();
                            await this.updateImageCountsAndDisplay();
                        } else {
                            // Optionally show an error message to the user
                            // using a Notice or by adding an error class to the input
                        }
                    });
            });
    }

    private createSkipSettings(contentEl: HTMLElement): void {
        contentEl.createEl("h4", { text: "Skip" }); // Heading for Resize Settings

        // --- Skip Formats Setting ---
        this.skipFormatsSetting = new Setting(contentEl)
            .setName(t("SETTING_SKIP_FORMATS") + " ⓘ")
            .setDesc(t("SETTING_SKIP_FORMATS_DESC"))
            .setTooltip(t("SETTING_SKIP_FORMATS_TOOLTIP"))
            .addText((text) => {
                text
                    .setPlaceholder("png,gif")
                    .setValue(
                        this.plugin.settings.ProcessCurrentNoteSkipFormats
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.ProcessCurrentNoteSkipFormats =
                            value;
                        await this.plugin.saveSettings();
                        await this.updateImageCountsAndDisplay();
                    });
            });

        // --- Skip Target Format Setting ---
        this.skipTargetFormatSetting = new Setting(contentEl)
            .setName(t("SETTING_SKIP_TARGET") + " ⓘ")
            .setDesc(t("SETTING_SKIP_TARGET_DESC"))
            .setTooltip(t("SETTING_SKIP_TARGET_TOOLTIP"))
            .addToggle((toggle) => {
                toggle
                    .setValue(
                        this.plugin.settings.ProcessCurrentNoteskipImagesInTargetFormat
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.ProcessCurrentNoteskipImagesInTargetFormat =
                            value;
                        await this.plugin.saveSettings();
                        await this.updateImageCountsAndDisplay(); // Update counts on change
                    });
            });
    }

    // --- Resize Settings ---
    private async createResizeSettings(contentEl: HTMLElement) {
        contentEl.createEl("h4", { text: "Resize" }); // Heading for Resize Settings

        // --- Resize Mode Setting ---
        this.resizeModeSetting = new Setting(contentEl)
            .setName(t("SETTING_RESIZE_MODE") + " ⓘ")
            .setDesc(t("SETTING_RESIZE_MODE_DESC"))
            .setTooltip(t("SETTING_RESIZE_TOOLTIP"))
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        None: "None",
                        Fit: t("OPTION_FIT"),
                        Fill: t("OPTION_FILL"),
                        LongestEdge: t("OPTION_LONGEST"),
                        ShortestEdge: t("OPTION_SHORTEST"),
                        Width: t("OPTION_WIDTH"),
                        Height: t("OPTION_HEIGHT"),
                    })
                    .setValue(
                        this.plugin.settings
                            .ProcessCurrentNoteResizeModalresizeMode
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode =
                            value;
                        await this.plugin.saveSettings();
                        this.updateResizeInputVisibility(value);
                        await this.updateImageCountsAndDisplay();
                    });
            });

        // --- Enlarge/Reduce Setting ---
        this.createEnlargeReduceInputs(contentEl);

        // --- Resize Inputs (Conditional) ---
        this.resizeInputsDiv = contentEl.createDiv({ cls: "resize-inputs" });
        this.updateResizeInputVisibility(
            this.plugin.settings.ProcessCurrentNoteResizeModalresizeMode
        );
    }

    private createEnlargeReduceInputs(contentEl: HTMLElement) {
        this.enlargeReduceDiv = contentEl.createDiv({
            cls: "enlarge-reduce-settings",
        });
        this.createEnlargeReduceSettings();
    }

    private createProcessButton(contentEl: HTMLElement) {
        const buttonContainer = contentEl.createDiv({ cls: "button-container" });
        new ButtonComponent(buttonContainer)
            .setButtonText(t("BUTTON_PROCESS"))
            .setCta()
            .onClick(async () => { // Use async here
                this.close();
                await this.batchImageProcessor.processImagesInFolder(this.folderPath, this.recursive);
            });
    }

    // --- Helper Methods for Settings ---

    private updateResizeInputVisibility(resizeMode: string): void {
        if (resizeMode === "None") {
            this.resizeInputsDiv?.empty();
            this.enlargeReduceDiv?.hide(); // Explicitly hide it
            this.resizeInputSettings = null;
            this.enlargeReduceSettings = null;
        } else {
            if (!this.resizeInputSettings) {
                this.createResizeInputSettings(resizeMode);
            } else {
                this.updateResizeInputSettings(resizeMode);
            }

            if (!this.enlargeReduceSettings) {
                this.createEnlargeReduceSettings();
            }
            this.enlargeReduceDiv?.show(); // Show only when not None
        }
    }

    private createEnlargeReduceSettings(): void {
        if (!this.enlargeReduceDiv) return;

        this.enlargeReduceDiv.empty();

        this.enlargeReduceSettings = new Setting(this.enlargeReduceDiv)
            .setClass("enlarge-reduce-setting")
            .setName(t("SETTING_ENLARGE_REDUCE") + " ⓘ")
            .setDesc(t("SETTING_ENLARGE_REDUCE_DESC"))
            .setTooltip(t("SETTING_ENLARGE_REDUCE_DESC"))
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        Always: t("OPTION_ALWAYS"),
                        Reduce: t("OPTION_REDUCE"),
                        Enlarge: t("OPTION_ENLARGE"),
                    })
                    .setValue(
                        this.plugin.settings.ProcessCurrentNoteEnlargeOrReduce
                    )
                    .onChange(
                        async (value: "Always" | "Reduce" | "Enlarge") => {
                            this.plugin.settings.ProcessCurrentNoteEnlargeOrReduce =
                                value;
                            await this.plugin.saveSettings();
                        }
                    );
            });
    }

    private createResizeInputSettings(resizeMode: string): void {
        if (!this.resizeInputsDiv) return;

        this.resizeInputsDiv.empty();

        this.resizeInputSettings = new Setting(this.resizeInputsDiv).setClass(
            "resize-input-setting"
        );

        this.updateResizeInputSettings(resizeMode);
    }

    private updateResizeInputSettings(resizeMode: string): void {
        if (!this.resizeInputSettings) return;

        this.resizeInputSettings.clear();

        let name = "";
        let desc = "";

        if (["Fit", "Fill"].includes(resizeMode)) {
            name = t("SETTING_RESIZE_DIMENSIONS");
            desc = t("SETTING_RESIZE_WH_DESC");
            this.resizeInputSettings
                .setName(name)
                .setDesc(desc)
                .addText((text: TextComponent) =>
                    text
                        .setPlaceholder(t("LABEL_WIDTH"))
                        .setValue(
                            this.plugin.settings
                                .ProcessCurrentNoteresizeModaldesiredWidth
                                .toString()
                        )
                        .onChange(async (value: string) => {
                            const width = parseInt(value);
                            if (/^\d+$/.test(value) && width > 0) {
                                this.plugin.settings.ProcessCurrentNoteresizeModaldesiredWidth =
                                    width;
                                await this.plugin.saveSettings();
                            }
                        })
                )
                .addText((text: TextComponent) =>
                    text
                        .setPlaceholder(t("LABEL_HEIGHT"))
                        .setValue(
                            this.plugin.settings
                                .ProcessCurrentNoteresizeModaldesiredHeight
                                .toString()
                        )
                        .onChange(async (value: string) => {
                            const height = parseInt(value);
                            if (/^\d+$/.test(value) && height > 0) {
                                this.plugin.settings.ProcessCurrentNoteresizeModaldesiredHeight =
                                    height;
                                await this.plugin.saveSettings();
                            }
                        })
                );
        } else {
            switch (resizeMode) {
                case "LongestEdge":
                case "ShortestEdge":
                    name = resizeMode === "LongestEdge" ? t("OPTION_LONGEST") : t("OPTION_SHORTEST");
                    desc = t("SETTING_RESIZE_LENGTH_DESC");
                    break;
                case "Width":
                    name = t("OPTION_WIDTH");
                    desc = t("SETTING_RESIZE_WIDTH_DESC");
                    break;
                case "Height":
                    name = t("OPTION_HEIGHT");
                    desc = t("SETTING_RESIZE_HEIGHT_DESC");
                    break;
            }

            this.resizeInputSettings
                .setName(name)
                .setDesc(desc)
                .addText((text: TextComponent) =>
                    text
                        .setPlaceholder("")
                        .setValue(this.getInitialValue(resizeMode).toString())
                        .onChange(async (value: string) => {
                            const length = parseInt(value);
                            if (/^\d+$/.test(value) && length > 0) {
                                await this.updateSettingValue(
                                    resizeMode,
                                    length
                                );
                            }
                        })
                );
        }
    }

    private getInitialValue(resizeMode: string): number {
        switch (resizeMode) {
            case "LongestEdge":
            case "ShortestEdge":
                return this.plugin.settings
                    .ProcessCurrentNoteresizeModaldesiredLength;
            case "Width":
                return this.plugin.settings
                    .ProcessCurrentNoteresizeModaldesiredWidth;
            case "Height":
                return this.plugin.settings
                    .ProcessCurrentNoteresizeModaldesiredHeight;
            default:
                return 0;
        }
    }

    private async updateSettingValue(
        resizeMode: string,
        value: number
    ): Promise<void> {
        switch (resizeMode) {
            case "LongestEdge":
            case "ShortestEdge":
                this.plugin.settings.ProcessCurrentNoteresizeModaldesiredLength =
                    value;
                break;
            case "Width":
                this.plugin.settings.ProcessCurrentNoteresizeModaldesiredWidth =
                    value;
                break;
            case "Height":
                this.plugin.settings.ProcessCurrentNoteresizeModaldesiredHeight =
                    value;
                break;
        }
        await this.plugin.saveSettings();
    }

    // --- Image Counting and Updating ---

    private async updateImageCountsAndDisplay() {
        const counts = await this.updateImageCounts();
        this.updateCountDisplays(counts);
    }

    private async updateImageCounts(): Promise<{
        total: number;
        processed: number;
        skipped: number;
    }> {
        const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
        if (!(folder instanceof TFolder)) {
            new Notice("Error: Invalid folder path.");
            return { total: 0, processed: 0, skipped: 0 };
        }

        const skipFormats = this.plugin.settings.ProcessCurrentNoteSkipFormats
            .toLowerCase()
            .split(",")
            .map((format) => format.trim())
            .filter((format) => format.length > 0);

        const targetFormat = this.plugin.settings.ProcessCurrentNoteconvertTo;
        const skipTargetFormat = this.plugin.settings.ProcessCurrentNoteskipImagesInTargetFormat;

        // Use the selectedImageSource to filter images
        const { directImages, linkedImages } = await this.getImageFiles(
            folder,
            this.recursive,
            this.selectedImageSource
        );

        let total = 0;
        let processed = 0;
        let skipped = 0;

        for (const image of directImages) {
            total++;
            if (skipFormats.includes(image.extension.toLowerCase())) {
                skipped++;
            } else if (skipTargetFormat && image.extension.toLowerCase() === targetFormat) {
                skipped++;
            } else {
                processed++;
            }
        }

        for (const image of linkedImages) {
            total++;
            if (skipFormats.includes(image.extension.toLowerCase())) {
                skipped++;
            } else if (skipTargetFormat && image.extension.toLowerCase() === targetFormat) {
                skipped++;
            } else {
                processed++;
            }
        }

        console.log("updateImageCounts:", {
            total,
            processed,
            skipped,
            directImages,
            linkedImages,
        });
        return { total, processed, skipped };
    }

    async getImageFiles(
        folder: TFolder,
        recursive: boolean,
        selectedImageSource: ImageSource
    ): Promise<{
        directImages: TFile[];
        linkedImages: TFile[];
    }> {
        const directImages: TFile[] = [];
        const linkedImages: TFile[] = [];

        for (const file of folder.children) {
            if (file instanceof TFolder) {
                if (recursive) {
                    // Recursive case: process subfolders
                    const {
                        directImages: subfolderDirectImages,
                        linkedImages: subfolderLinkedImages,
                    } = await this.getImageFiles(
                        file,
                        recursive,
                        selectedImageSource
                    );
                    directImages.push(...subfolderDirectImages);
                    linkedImages.push(...subfolderLinkedImages);
                }
            } else if (file instanceof TFile) {
                if (
                    selectedImageSource === ImageSource.DIRECT &&
                    this.plugin.supportedImageFormats.isSupported(undefined, file.name)
                ) {
                    // Direct image and direct source is selected
                    directImages.push(file);
                } else if (
                    selectedImageSource === ImageSource.LINKED &&
                    file.extension === "md"
                ) {
                    // Linked image in Markdown and linked source is selected
                    const linkedImagesInMarkdown =
                        await this.getImagesFromMarkdownFile(file);
                    linkedImages.push(...linkedImagesInMarkdown);
                } else if (
                    selectedImageSource === ImageSource.LINKED &&
                    file.extension === "canvas"
                ) {
                    // Linked image in Canvas and linked source is selected
                    const linkedImagesInCanvas =
                        await this.getImagesFromCanvasFile(file);
                    linkedImages.push(...linkedImagesInCanvas);
                }
            }
        }

        console.log(
            "Images found in folder",
            folder.path,
            ":",
            { directImages, linkedImages },
            "recursive:",
            recursive,
            "selectedImageSource:",
            selectedImageSource
        );
        return { directImages, linkedImages };
    }

    async getImagesFromMarkdownFile(markdownFile: TFile): Promise<TFile[]> {
        console.log("Getting images from Markdown file:", markdownFile.path);
        const images: TFile[] = [];
        const content = await this.app.vault.read(markdownFile);
        const { vault } = this.app;

        // 1. Handle WikiLinks
        const wikiRegex = /!\[\[([^\]]+?)(?:\|[^\]]+?)?\]\]/g; // Matches ![[image.png]] and ![[image.png|141]]
        let match;
        while ((match = wikiRegex.exec(content)) !== null) {
            const [, linkedFileName] = match;
            const linkedFile = this.app.metadataCache.getFirstLinkpathDest(
                linkedFileName,
                markdownFile.path
            );
            if (linkedFile instanceof TFile && this.plugin.supportedImageFormats.isSupported(undefined, linkedFile.name)) {
                images.push(linkedFile);
            }
        }

        // 2. Handle Markdown Links
        const markdownImageRegex = /!\[.*?\]\(([^)]+?)\)/g; // Matches ![alt text](image.png)
        while ((match = markdownImageRegex.exec(content)) !== null) {
            const [, imagePath] = match;
            if (!imagePath.startsWith("http")) {
                // Skip external URLs
                // Resolve the relative path of the image from the root of the vault
                const absoluteImagePath = normalizePath(
                    `${vault.getRoot().path}/${imagePath}`
                );

                const linkedImageFile =
                    vault.getAbstractFileByPath(absoluteImagePath);

                if (
                    linkedImageFile instanceof TFile &&
                    this.plugin.supportedImageFormats.isSupported(undefined, linkedImageFile.name)
                ) {
                    console.log(
                        "Found relative linked image:",
                        linkedImageFile.path
                    );
                    images.push(linkedImageFile);
                }
            }
        }

        console.log(
            "Images found in Markdown file:",
            images.map((file) => file.path)
        );
        return images;
    }

    // Helper function to extract image names from Markdown content (both Wiki and Markdown links)
    extractLinkedImageNames(content: string): string[] {
        const wikiRegex = /!\[\[([^\]]+?)(?:\|[^\]]+?)?\]\]/g; // Matches ![[image.png]] and ![[image.png|141]]
        const markdownRegex = /!\[.*?\]\(([^)]+?)\)/g; // Matches ![alt text](image.png) and ![alt text](image.png "Title")
        const imageNames: string[] = [];
        let match;

        // Find Wiki-style links
        while ((match = wikiRegex.exec(content)) !== null) {
            imageNames.push(match[1]);
        }

        // Find Markdown-style links
        while ((match = markdownRegex.exec(content)) !== null) {
            imageNames.push(match[1]);
        }

        console.log("Image names extracted from Markdown:", imageNames);
        return imageNames;
    }

    // Helper function to get the full path relative to a folder
    getFullPath(parentFolder: TFolder | null, relativePath: string): string {
        if (parentFolder) {
            return normalizePath(`${parentFolder.path}/${relativePath}`);
        }
        // If parentFolder is null, the file is in the root of the vault
        return normalizePath(relativePath);
    }

    async getImagesFromCanvasFile(file: TFile): Promise<TFile[]> {
        const images: TFile[] = [];
        const content = await this.app.vault.read(file);
        const canvasData = JSON.parse(content);

        if (canvasData.nodes && Array.isArray(canvasData.nodes)) {
            for (const node of canvasData.nodes) {
                if (node.type === "file" && node.file) {
                    const linkedFile =
                        this.app.vault.getAbstractFileByPath(node.file);
                    if (!linkedFile) {
                        console.warn("Could not find file:", node.file);
                        continue;
                    }
                    if (linkedFile instanceof TFile && this.plugin.supportedImageFormats.isSupported(undefined, linkedFile.name)) {
                        images.push(linkedFile);
                    }
                }
            }
        }

        return images;
    }

    private updateCountDisplays(counts: {
        total: number;
        processed: number;
        skipped: number;
    }) {
        this.imageCount = counts.total;
        this.processedCount = counts.processed;
        this.skippedCount = counts.skipped;

        this.imageCountDisplay.setText(counts.total.toString());
        this.processedCountDisplay.setText(counts.processed.toString());
        this.skippedCountDisplay.setText(counts.skipped.toString());
    }
}