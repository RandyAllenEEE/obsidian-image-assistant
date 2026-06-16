// ProcessSingleImageModal.ts
import { App, Modal, Notice, TFile, Setting, MarkdownView } from "obsidian";
import ImageConverterPlugin from "../../main";
import { createAnyLinkRegex } from "../../utils/RegexPatterns";
import { ImageLinkPathReplacer } from "../../utils/ImageLinkPathReplacer";
import { ImageAssistantSettings } from "../../settings/defaults";
import { AvifEncoder, OutputFormat, ResizeMode, EnlargeReduce, SingleImageOperationDefaults } from "../../settings/types";
import { t } from "../../lang/helpers";
import { AVIF_ENCODER_CONFIGS, ImageProcessor } from "../../local/ImageProcessor";
import { findFfmpegExecutablePath, normalizeExecutablePath } from "../../utils/ffmpegPath";

export interface SingleImageModalSettings extends SingleImageOperationDefaults {
    outputFormat: OutputFormat;
    quality: number;
    colorDepth: number;
    resizeMode: ResizeMode;
    desiredWidth: number;
    desiredHeight: number;
    desiredLongestEdge: number;
    enlargeOrReduce: EnlargeReduce;
    allowLargerFiles: boolean;
    pngquantExecutablePath: string;
    pngquantQuality: string;
    ffmpegExecutablePath: string;
    ffmpegCrf: number;
    ffmpegPreset: string;
    ffmpegDetectedEncoder?: AvifEncoder;
    ffmpegDetectedEncoderPath?: string;
}

export class ProcessSingleImageModal extends Modal {
    private imageFile: TFile;
    private modalSettings: SingleImageModalSettings;
    private previewImageUrl: string | null = null;
    private previewContainer: HTMLDivElement;

    // --- Dedicated containers for each section ---
    private conversionSettingsContainer: HTMLDivElement;
    private resizeSettingsContainer: HTMLDivElement;
    private buttonContainer: HTMLDivElement;

    constructor(app: App, private plugin: ImageConverterPlugin, file: TFile) {
        super(app);
        this.imageFile = file;
        this.loadModalSettings();
        this.titleEl.setText(t("MODAL_SINGLE_IMG_TITLE") + file.name);
    }

    private loadModalSettings() {
        const savedSettings = this.plugin.settings.operationDefaults?.singleImage;
        this.modalSettings = { ...this.getInitialSettings(), ...savedSettings };
    }

    private getInitialSettings(): SingleImageModalSettings {
        return this.plugin.getDefaultSingleImageOperationSettings() as SingleImageModalSettings;
    }

    private saveModalSettings() {
        this.plugin.settings.operationDefaults.singleImage = { ...this.modalSettings };
        this.plugin.saveSettings();
    }

    async onOpen() {
        this.contentEl.empty();
        this.contentEl.addClass("process-single-image-modal");

        this.previewContainer = this.contentEl.createDiv("preview-image-container");
        this.previewContainer.setCssStyles({
            border: "1px solid #ccc",
            padding: "10px",
            margin: "1em 0",
            textAlign: "center",
            maxHeight: "400px",
            overflowY: "auto",
            overflowX: "hidden",
        });
        this.conversionSettingsContainer = this.contentEl.createDiv("conversion-settings-container");
        this.resizeSettingsContainer = this.contentEl.createDiv("resize-settings-container");
        this.buttonContainer = this.contentEl.createDiv("process-single-image-modal-buttons");

        const windowWidth = window.innerWidth;
        const maxWidth = 800;
        const modalWidth = Math.min(windowWidth * 0.9, maxWidth);
        this.modalEl.setCssStyles({ width: `${modalWidth}px` });

        this.renderSettings();
        await this.generatePreview();  // Initial preview, may be skipped.
        this.renderActionButtons();
    }

    private renderSettings() {
        this.renderConversionSettings();
        this.renderResizeSettings();
    }

    private renderConversionSettings() {
        this.conversionSettingsContainer.empty();

        new Setting(this.conversionSettingsContainer)
            .setName(t("MODAL_OUTPUT_FORMAT"))
            .addDropdown(dropdown => {
                const options: Record<OutputFormat, string> = {
                    "WEBP": "WEBP",
                    "JPEG": "JPEG",
                    "PNG": "PNG",
                    "ORIGINAL": t("OPTION_COMPRESS"),
                    "NONE": t("OPTION_NO_CONVERSION"),
                    "PNGQUANT": t("OPTION_PNGQUANT"),
                    "AVIF": t("OPTION_AVIF")
                };
                Object.entries(options).forEach(([key, value]) => {
                    dropdown.addOption(key, value);
                });
                dropdown.setValue(this.modalSettings.outputFormat);
                dropdown.onChange(async (value: OutputFormat) => {
                    const currentPngquantPath = this.modalSettings.pngquantExecutablePath;
                    const currentFfmpegPath = this.modalSettings.ffmpegExecutablePath;
                    const currentFfmpegDetectedEncoder = this.modalSettings.ffmpegDetectedEncoder;
                    const currentFfmpegDetectedEncoderPath = this.modalSettings.ffmpegDetectedEncoderPath;

                    this.modalSettings.outputFormat = value;
                    this.modalSettings.pngquantExecutablePath = currentPngquantPath;
                    this.modalSettings.ffmpegExecutablePath = currentFfmpegPath;
                    this.modalSettings.ffmpegDetectedEncoder = currentFfmpegDetectedEncoder;
                    this.modalSettings.ffmpegDetectedEncoderPath = currentFfmpegDetectedEncoderPath;

                    this.renderConversionSettings();
                    await this.generatePreview(); // Regenerate preview (conditional)
                });
            });

        if (["WEBP", "JPEG", "ORIGINAL"].includes(this.modalSettings.outputFormat)) {
            new Setting(this.conversionSettingsContainer)
                .setName(t("MODAL_QUALITY"))
                .addSlider(slider => {
                    slider.setLimits(1, 100, 1)
                        .setValue(this.modalSettings.quality)
                        .setDynamicTooltip()
                        .onChange(async (value) => {
                            this.modalSettings.quality = value;
                            await this.generatePreview(); // Regenerate preview (conditional)
                        });
                });
        }

        if (this.modalSettings.outputFormat === "PNG") {
            new Setting(this.conversionSettingsContainer)
                .setName(t("MODAL_COLOR_DEPTH"))
                .addSlider(slider => {
                    slider.setLimits(0, 1, 0.1)
                        .setValue(this.modalSettings.colorDepth)
                        .setDynamicTooltip()
                        .onChange(async (value) => {
                            this.modalSettings.colorDepth = value;
                            await this.generatePreview(); // Regenerate preview (conditional)
                        });
                });
        }

        if (this.modalSettings.outputFormat === "PNGQUANT") {
            new Setting(this.conversionSettingsContainer)
                .setName(t("MODAL_PNGQUANT_PATH"))
                .setTooltip(t("TOOLTIP_PNGQUANT_PATH"))
                .addText(text => {
                    text.setValue(this.modalSettings.pngquantExecutablePath)
                        .onChange(async value => {
                            this.modalSettings.pngquantExecutablePath = value;
                            // NO PREVIEW for pngquant
                        });
                    text.inputEl.setAttr('spellcheck', 'false');
                });

            new Setting(this.conversionSettingsContainer)
                .setName(t("MODAL_PNGQUANT_QUALITY"))
                .setTooltip(t("TOOLTIP_PNGQUANT_QUALITY"))
                .addText(text => {
                    text.setValue(this.modalSettings.pngquantQuality)
                        .onChange(async value => {
                            this.modalSettings.pngquantQuality = value;
                            // NO PREVIEW for pngquant
                        });
                    text.inputEl.setAttr('spellcheck', 'false');
                });
        }

        if (this.modalSettings.outputFormat === "AVIF") {
            const activeEncoder = this.getActiveAvifEncoder();
            const encoderConfig = activeEncoder
                ? AVIF_ENCODER_CONFIGS[activeEncoder]
                : AVIF_ENCODER_CONFIGS["libaom-av1"];

            new Setting(this.conversionSettingsContainer)
                .setName(t("MODAL_FFMPEG_PATH"))
                .setTooltip(t("TOOLTIP_FFMPEG_PATH"))
                .addText(text => {
                    text.setValue(this.modalSettings.ffmpegExecutablePath)
                        .onChange(async value => {
                            const previousPath = normalizeExecutablePath(this.modalSettings.ffmpegExecutablePath);
                            const nextPath = normalizeExecutablePath(value);
                            if (previousPath !== nextPath) {
                                ImageProcessor.clearAvifEncoderCache(previousPath);
                                this.modalSettings.ffmpegDetectedEncoder = undefined;
                                this.modalSettings.ffmpegDetectedEncoderPath = undefined;
                            }
                            this.modalSettings.ffmpegExecutablePath = value;
                            // NO PREVIEW for AVIF
                        });
                    text.inputEl.setAttr('spellcheck', 'false');
                })
                .addExtraButton(button => {
                    button
                        .setIcon("search")
                        .setTooltip(t("BUTTON_FIND_FFMPEG"))
                        .onClick(async () => {
                            const foundPath = await findFfmpegExecutablePath(this.app);
                            if (!foundPath) {
                                new Notice(t("NOTICE_FFMPEG_NOT_FOUND"));
                                return;
                            }
                            const previousPath = normalizeExecutablePath(this.modalSettings.ffmpegExecutablePath);
                            this.modalSettings.ffmpegExecutablePath = foundPath;
                            this.modalSettings.ffmpegDetectedEncoder = undefined;
                            this.modalSettings.ffmpegDetectedEncoderPath = undefined;
                            ImageProcessor.clearAvifEncoderCache(previousPath);
                            this.syncFfmpegSettingsToGlobal();
                            await this.plugin.saveSettings();
                            new Notice(t("NOTICE_FFMPEG_DETECTED", [foundPath]));
                            this.renderConversionSettings();
                        });
                });

            new Setting(this.conversionSettingsContainer)
                .setName(t("MODAL_AVIF_ENCODER"))
                .setDesc(activeEncoder
                    ? t("DESC_AVIF_ENCODER_CURRENT", [activeEncoder])
                    : t("DESC_AVIF_ENCODER_DETECTION"))
                .addExtraButton(button => {
                    button
                        .setIcon("cpu")
                        .setTooltip(t("BUTTON_DETECT_ENCODER"))
                        .onClick(() => this.detectAvifEncoderForModal());
                });

            new Setting(this.conversionSettingsContainer)
                .setName(t("MODAL_FFMPEG_CRF"))
                .setDesc(t("DESC_FFMPEG_CRF_RANGE", [encoderConfig.crfMin, encoderConfig.crfMax]))
                .addSlider(slider => {
                    slider.setLimits(encoderConfig.crfMin, encoderConfig.crfMax, 1)
                        .setValue(Math.max(encoderConfig.crfMin, Math.min(encoderConfig.crfMax, this.modalSettings.ffmpegCrf)))
                        .setDynamicTooltip()
                        .onChange(async (value) => {
                            this.modalSettings.ffmpegCrf = value;
                            // NO PREVIEW for AVIF
                        });
                });

            new Setting(this.conversionSettingsContainer)
                .setName(t("MODAL_FFMPEG_PRESET"))
                .addDropdown(dropdown => {
                    this.getAvifPresetOptions(activeEncoder, this.modalSettings.ffmpegPreset).forEach(option => dropdown.addOption(option, option));
                    dropdown.setValue(this.modalSettings.ffmpegPreset);
                    dropdown.onChange(async (value) => {
                        this.modalSettings.ffmpegPreset = value;
                        // NO PREVIEW for AVIF
                    });
                });
        }
    }

    private renderResizeSettings() {
        this.resizeSettingsContainer.empty();

        new Setting(this.resizeSettingsContainer)
            .setName(t("MODAL_RESIZE_MODE"))
            .addDropdown(dropdown => {
                const resizeOptions: Record<ResizeMode, string> = {
                    "None": "None",
                    "Fit": t("OPTION_RESIZE_FIT"),
                    "Fill": t("OPTION_RESIZE_FILL"),
                    "Scale": "Scale",
                    "LongestEdge": t("OPTION_RESIZE_LONGEST"),
                    "ShortestEdge": t("OPTION_RESIZE_SHORTEST"),
                    "Width": t("OPTION_RESIZE_WIDTH"),
                    "Height": t("OPTION_RESIZE_HEIGHT"),
                };
                Object.entries(resizeOptions).forEach(([key, value]) => {
                    dropdown.addOption(key, value);
                });
                dropdown.setValue(this.modalSettings.resizeMode)
                    .onChange(async (value: ResizeMode) => {
                        this.modalSettings.resizeMode = value;
                        this.renderResizeSettings();
                        await this.generatePreview(); // Regenerate preview (conditional)
                    });
            });

        if (["Fit", "Fill", "Width", "Height", "LongestEdge", "ShortestEdge"].includes(this.modalSettings.resizeMode)) {
            //Consolidate all text inputs that effect the generate preview function
            if (["Fit", "Fill", "Width"].includes(this.modalSettings.resizeMode)) {
                new Setting(this.resizeSettingsContainer)
                    .setName(t("MODAL_DESIRED_WIDTH"))
                    .addText(text => {
                        text.setPlaceholder(t("PLACEHOLDER_WIDTH"))
                            .setValue(this.modalSettings.desiredWidth.toString())
                            .onChange(async (value) => {
                                this.modalSettings.desiredWidth = parseInt(value, 10) || 0;
                                if (!(["PNGQUANT", "AVIF"].includes(this.modalSettings.outputFormat))) {
                                    await this.generatePreview();
                                }
                            });
                        text.inputEl.setAttr('spellcheck', 'false');
                    });
            }
            if (["Fit", "Fill", "Height"].includes(this.modalSettings.resizeMode)) {
                new Setting(this.resizeSettingsContainer)
                    .setName(t("MODAL_DESIRED_HEIGHT"))
                    .addText(text => {
                        text.setPlaceholder(t("PLACEHOLDER_HEIGHT"))
                            .setValue(this.modalSettings.desiredHeight.toString())
                            .onChange(async (value) => {
                                this.modalSettings.desiredHeight = parseInt(value, 10) || 0;
                                if (!(["PNGQUANT", "AVIF"].includes(this.modalSettings.outputFormat))) {
                                    await this.generatePreview();
                                }
                            });
                        text.inputEl.setAttr('spellcheck', 'false');
                    });
            }

            if (["LongestEdge", "ShortestEdge"].includes(this.modalSettings.resizeMode)) {
                new Setting(this.resizeSettingsContainer)
                    .setName(this.modalSettings.resizeMode === "LongestEdge" ? t("MODAL_DESIRED_LONG") : t("MODAL_DESIRED_SHORT"))
                    .addText(text => {
                        text.setValue(this.modalSettings.desiredLongestEdge.toString())
                            .onChange(async (value) => {
                                this.modalSettings.desiredLongestEdge = parseInt(value, 10) || 0;
                                if (!(["PNGQUANT", "AVIF"].includes(this.modalSettings.outputFormat))) {
                                    await this.generatePreview();
                                }
                            });
                        text.inputEl.setAttr('spellcheck', 'false');
                    });
            }

            new Setting(this.resizeSettingsContainer)
                .setName(t("MODAL_ENLARGE_REDUCE"))
                .addDropdown(dropdown => {
                    const enlargeReduceOptions: Record<EnlargeReduce, string> = {
                        "Always": t("OPTION_ALWAYS"),
                        "Reduce": t("OPTION_REDUCE"),
                        "Enlarge": t("OPTION_ENLARGE"),
                        "Auto": t("OPTION_AUTO")
                    };
                    Object.entries(enlargeReduceOptions).forEach(([key, value]) => {
                        dropdown.addOption(key, value);
                    });
                    dropdown.setValue(this.modalSettings.enlargeOrReduce)
                        .onChange(async (value: EnlargeReduce) => {
                            this.modalSettings.enlargeOrReduce = value;
                            if (!(["PNGQUANT", "AVIF"].includes(this.modalSettings.outputFormat))) {
                                await this.generatePreview();
                            }
                        });
                });
        }
    }

    private renderActionButtons() {
        this.buttonContainer.empty();
        new Setting(this.buttonContainer)
            .addButton(button => {
                button.setButtonText(t("MODAL_BUTTON_PROCESS"))
                    .setCta()
                    .onClick(() => this.processImage());
            })
            .addButton(button => {
                button.setButtonText(t("MODAL_BUTTON_CANCEL"))
                    .onClick(() => this.close());
            });
    }



    private async generatePreview() {
        //  Skip preview for PNGQUANT and AVIF
        if (this.modalSettings.outputFormat === "PNGQUANT" || this.modalSettings.outputFormat === "AVIF") {
            this.previewContainer.empty();
            this.previewContainer.createEl("p", { text: t("MODAL_PREVIEW_UNAVAILABLE") });
            return;
        }

        this.previewContainer.empty();
        const loadingEl = this.previewContainer.createEl("p", { text: t("MODAL_GENERATING_PREVIEW") });

        try {
            const fileBuffer = await this.app.vault.readBinary(this.imageFile);
            const imageBlob = new Blob([fileBuffer], { type: this.imageFile.extension ? `image/${this.imageFile.extension}` : 'application/octet-stream' });

            // Preview uses modal settings directly.

            const processedImageBuffer = await this.plugin.imageProcessor.processImage(
                imageBlob,
                this.modalSettings.outputFormat,
                this.modalSettings.quality / 100,
                this.modalSettings.colorDepth,
                this.modalSettings.resizeMode,
                this.modalSettings.desiredWidth,
                this.modalSettings.desiredHeight,
                this.modalSettings.desiredLongestEdge,
                this.modalSettings.enlargeOrReduce,
                this.modalSettings.allowLargerFiles,
                undefined,
                this.plugin.settings
            );

            const blob = new Blob([processedImageBuffer], { type: `image/${this.modalSettings.outputFormat.toLowerCase()}` });
            this.previewImageUrl = URL.createObjectURL(blob);

            const img = this.previewContainer.createEl("img", {
                attr: {
                    src: this.previewImageUrl,
                },
                cls: "preview-image",
            });
            img.setCssStyles({
                maxWidth: "100%",
                maxHeight: "350px",
                height: "auto",
                display: "block",
                margin: "0 auto",
            });

            loadingEl.remove();

        } catch (error) {
            loadingEl.setText(t("MODAL_PREVIEW_FAILED") + error.message);
            console.error("Preview generation failed:", error);
        }
    }
    private async processImage() {
        //No Changes needed
        try {
            const fileBuffer = await this.app.vault.readBinary(this.imageFile);
            const imageFile = new File([fileBuffer], this.imageFile.name, { type: this.imageFile.extension ? `image/${this.imageFile.extension}` : 'application/octet-stream' });

            const destinationPath: string = this.imageFile.parent?.path || "";
            let newFilename: string = (this.modalSettings.outputFormat === "NONE" || this.modalSettings.outputFormat === "ORIGINAL")
                ? this.imageFile.name
                : `${this.imageFile.name.substring(0, this.imageFile.name.lastIndexOf("."))}.${this.modalSettings.outputFormat.toLowerCase()}`;

            //  Handle PNGQuant extension
            if (this.modalSettings.outputFormat === "PNGQUANT") {
                newFilename = `${this.imageFile.name.substring(0, this.imageFile.name.lastIndexOf("."))}.png`; // Force .png
            }

            const fullPath: string = this.plugin.folderAndFilenameManagement.combinePath(destinationPath, newFilename);

            // Skip if the conversion is not needed
            if (this.modalSettings.outputFormat === "NONE" && this.modalSettings.resizeMode === "None") {
                new Notice(`No processing needed for "${this.imageFile.name}".`, 1000);
                this.close();
                return;
            }

            const originalSize = this.imageFile.stat.size;
            let processedImageBuffer: ArrayBuffer | undefined;

            // --- Handle NONE and ORIGINAL formats, and resizing ---
            if (this.modalSettings.outputFormat === "NONE" && this.modalSettings.resizeMode !== "None") {
                // No conversion, BUT resizing is needed.
                processedImageBuffer = await this.plugin.imageProcessor.resizeImage(
                    imageFile,
                    this.modalSettings.resizeMode,
                    this.modalSettings.desiredWidth,
                    this.modalSettings.desiredHeight,
                    this.modalSettings.desiredLongestEdge,
                    this.modalSettings.enlargeOrReduce
                );
            } else if (this.modalSettings.outputFormat === "ORIGINAL") {
                // Compress using the original format.
                processedImageBuffer = await this.plugin.imageProcessor.compressOriginalImage(
                    imageFile,
                    this.modalSettings.quality / 100,
                    this.modalSettings.resizeMode,
                    this.modalSettings.desiredWidth,
                    this.modalSettings.desiredHeight,
                    this.modalSettings.desiredLongestEdge,
                    this.modalSettings.enlargeOrReduce
                );

            } else {
                // All other conversion cases (WEBP, JPEG, PNG, etc.)
                // Pass pngquant settings if applicable
                processedImageBuffer = await this.plugin.imageProcessor.processImage(
                    imageFile,
                    this.modalSettings.outputFormat,
                    this.modalSettings.outputFormat === "AVIF" ? 100 : this.modalSettings.quality / 100, // Pass 100 for quality, it is ignored,
                    this.modalSettings.colorDepth,
                    this.modalSettings.resizeMode,
                    this.modalSettings.desiredWidth,
                    this.modalSettings.desiredHeight,
                    this.modalSettings.desiredLongestEdge,
                    this.modalSettings.enlargeOrReduce,
                    this.modalSettings.allowLargerFiles,
                    ["PNGQUANT", "AVIF"].includes(this.modalSettings.outputFormat) ? {
                        pngquantExecutablePath: this.modalSettings.pngquantExecutablePath,
                        pngquantQuality: this.modalSettings.pngquantQuality,
                        ffmpegExecutablePath: this.modalSettings.ffmpegExecutablePath,
                        ffmpegCrf: this.modalSettings.ffmpegCrf,
                        ffmpegPreset: this.modalSettings.ffmpegPreset,
                        ffmpegDetectedEncoder: this.modalSettings.ffmpegDetectedEncoder,
                        ffmpegDetectedEncoderPath: this.modalSettings.ffmpegDetectedEncoderPath,
                        useSystemPathForBinary: this.plugin.settings.localProcessing.externalTools.useSystemPathForBinary,
                    } : undefined,
                    this.plugin.settings
                );
            }


            // --- File Creation/Replacement ---
            if (processedImageBuffer && !this.modalSettings.allowLargerFiles && processedImageBuffer.byteLength > originalSize) {
                this.plugin.showSizeComparisonNotification(originalSize, processedImageBuffer.byteLength);
                new Notice(`Using original image for "${this.imageFile.name}" as processed image is larger.`, 1000);
                // We don't create/modify a file, but the link *might* need updating (if format changed).
            } else if (processedImageBuffer) {
                this.plugin.showSizeComparisonNotification(originalSize, processedImageBuffer.byteLength);

                // Check if the file needs renaming *before* modifying it
                if (this.imageFile.path !== fullPath) {
                    // File needs to be renamed. Use renameFile for atomic operation.
                    await this.app.fileManager.renameFile(this.imageFile, fullPath);
                    // Get a reference to the *renamed* file.
                    const renamedFile = this.app.vault.getAbstractFileByPath(fullPath);
                    if (renamedFile instanceof TFile) {
                        // Now modify the *renamed* file.
                        await this.app.vault.modifyBinary(renamedFile, processedImageBuffer);
                    } else {
                        new Notice(`Error: Could not find renamed file at ${fullPath}`);
                        return; // Exit if rename failed
                    }
                } else {
                    // No rename needed, just modify the existing file in place.
                    await this.app.vault.modifyBinary(this.imageFile, processedImageBuffer); // Modify in place
                }

            } // If there is no `processedImageBuffer` then only rename happened, so do nothing.


            // --- Update Link in Active Note ---
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
                const { editor } = activeView;
                const fileContent = editor.getValue();

                // const escapedOriginalName = this.imageFile.name.replace(/[[\]]/g, '\\$&');
                // const linkRegex = new RegExp(`!\\[\\[${ escapedOriginalName }(?: \\| [^\\]] +)?\\]\\[\\] | !\\[.*?\\]\\((${ escapedOriginalName }) (?: \\?[^)] *)?\\)`, 'g');

                // Use centralized factory
                const linkRegex = createAnyLinkRegex(this.imageFile.name);

                // Use ImageLinkPathReplacer to preserve wiki/markdown format and pipe syntax
                const newContent = fileContent.replace(linkRegex, (match) => {
                    return ImageLinkPathReplacer.replacePath(match, newFilename);
                });
                if (newContent !== fileContent) {
                    editor.setValue(newContent);
                    new Notice(`Link updated in "${activeView.file?.name}"`, 1000);
                }
            }

            this.refreshActiveNote();
            new Notice(`Image "${this.imageFile.name}" processed`, 1000);
            this.close();

        } catch (error) {
            console.error("Error processing image:", error);
            new Notice(`Failed to process image: ${error.message}`, 2000);
        } finally {
            if (this.previewImageUrl) {
                URL.revokeObjectURL(this.previewImageUrl);
                this.previewImageUrl = null;
            }
        }
    }

    async refreshActiveNote() {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            const activeLeaf = this.app.workspace.getLeaf();
            if (activeLeaf) {
                // Get the current leaf using getMostRecentLeaf (or getLeaf for specific cases)
                const leaf = this.app.workspace.getMostRecentLeaf();
                if (leaf) {
                    // Store current state
                    const currentState = leaf.getViewState();

                    // Switch to a different view type temporarily
                    await leaf.setViewState({
                        type: 'empty',
                        state: {}
                    });

                    // Switch back to the original view
                    await leaf.setViewState(currentState);

                }
                // Reopen the file to refresh its content
                await activeLeaf.openFile(activeFile, { active: true });
            }
        }
    }
    onClose() {
        // No Changes
        this.saveModalSettings();
        if (this.previewImageUrl) {
            URL.revokeObjectURL(this.previewImageUrl);
            this.previewImageUrl = null;
        }
        this.contentEl.empty();
    }

    private getActiveAvifEncoder(): AvifEncoder | undefined {
        const encoder = this.modalSettings.ffmpegDetectedEncoder;
        if (!encoder || !(encoder in AVIF_ENCODER_CONFIGS)) return undefined;

        const encoderPath = this.modalSettings.ffmpegDetectedEncoderPath;
        if (!encoderPath) return encoder;

        return normalizeExecutablePath(encoderPath) === normalizeExecutablePath(this.modalSettings.ffmpegExecutablePath)
            ? encoder
            : undefined;
    }

    private getAvifPresetOptions(encoder?: AvifEncoder, currentPreset: string = ""): string[] {
        if (!encoder) {
            return [
                "ultrafast",
                "superfast",
                "veryfast",
                "faster",
                "fast",
                "medium",
                "slow",
                "slower",
                "veryslow",
                "placebo",
            ];
        }

        const config = encoder ? AVIF_ENCODER_CONFIGS[encoder] : AVIF_ENCODER_CONFIGS["libaom-av1"];
        const options = config.supportsPreset && config.presetNames?.length
            ? config.presetNames
            : ["medium"];
        return currentPreset && !options.includes(currentPreset)
            ? [currentPreset, ...options]
            : options;
    }

    private syncFfmpegSettingsToGlobal(): void {
        const tools = this.plugin.settings.localProcessing.externalTools;
        tools.ffmpegExecutablePath = this.modalSettings.ffmpegExecutablePath;
        tools.ffmpegCrf = this.modalSettings.ffmpegCrf;
        tools.ffmpegPreset = this.modalSettings.ffmpegPreset;
        tools.ffmpegDetectedEncoder = this.modalSettings.ffmpegDetectedEncoder;
        tools.ffmpegDetectedEncoderPath = this.modalSettings.ffmpegDetectedEncoderPath;
    }

    private async detectAvifEncoderForModal(): Promise<void> {
        const executablePath = normalizeExecutablePath(this.modalSettings.ffmpegExecutablePath);
        if (!executablePath) {
            new Notice(t("ERROR_FFMPEG_NOT_SET"));
            return;
        }

        ImageProcessor.clearAvifEncoderCache(executablePath);
        const encoder = await this.plugin.imageProcessor.detectAvifEncoder(
            executablePath,
            this.modalSettings.ffmpegDetectedEncoder,
            { forceProbe: true }
        );

        if (!encoder) {
            this.modalSettings.ffmpegDetectedEncoder = undefined;
            this.modalSettings.ffmpegDetectedEncoderPath = undefined;
            this.syncFfmpegSettingsToGlobal();
            await this.plugin.saveSettings();
            new Notice(t("NOTICE_ENCODER_NOT_FOUND"));
            this.renderConversionSettings();
            return;
        }

        this.modalSettings.ffmpegExecutablePath = executablePath;
        this.modalSettings.ffmpegDetectedEncoder = encoder;
        this.modalSettings.ffmpegDetectedEncoderPath = executablePath;
        this.syncFfmpegSettingsToGlobal();
        await this.plugin.saveSettings();
        new Notice(t("NOTICE_ENCODER_DETECTED", [encoder]));
        this.renderConversionSettings();
    }
}
