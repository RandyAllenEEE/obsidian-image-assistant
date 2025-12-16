// ProcessAllVaultModal.ts
import {
    App,
    Modal,
    Setting,
    ButtonComponent,
} from "obsidian";
import ImageConverterPlugin from '../../main';
import { BatchImageProcessor } from '../../local/BatchImageProcessor';
import { t } from '../../lang/helpers';

export class ProcessAllVaultModal extends Modal {
    private enlargeReduceSettings: Setting | null = null;
    private resizeInputSettings: Setting | null = null;
    // private submitButton: ButtonComponent | null = null;
    private resizeInputsDiv: HTMLDivElement | null = null;
    private enlargeReduceDiv: HTMLDivElement | null = null;

    constructor(
        app: App,
        private plugin: ImageConverterPlugin,
        private batchImageProcessor: BatchImageProcessor
    ) {
        super(app);
        this.modalEl.addClass("image-convert-modal");
    }

    onOpen() {
        const { contentEl } = this;
        this.createUI(contentEl);
    }

    onClose() {
        // Clear nullable UI elements
        this.enlargeReduceSettings = null;
        this.resizeInputSettings = null;
        this.resizeInputsDiv = null;
        this.enlargeReduceDiv = null;

        const { contentEl } = this;
        contentEl.empty();
    }

    // --- UI Creation Methods ---

    private createUI(contentEl: HTMLElement) {
        this.createHeader(contentEl);
        this.createWarningMessage(contentEl);

        const settingsContainer = contentEl.createDiv({
            cls: "settings-container",
        });

        const formatQualityContainer = settingsContainer.createDiv({
            cls: "format-quality-container",
        });
        this.createGeneralSettings(formatQualityContainer);

        const resizeContainer = settingsContainer.createDiv({
            cls: "resize-container",
        });
        this.createResizeSettings(resizeContainer);

        const skipContainer = settingsContainer.createDiv({
            cls: "skip-container",
        });
        this.createSkipSettings(skipContainer);

        this.createProcessButton(settingsContainer);
    }

    private createHeader(contentEl: HTMLElement) {
        const headerContainer = contentEl.createDiv({ cls: "modal-header" });
        headerContainer.createEl("h2", {
            text: t("MODAL_PROCESS_IMAGES_TITLE"),
        });
        headerContainer.createEl("h6", {
            text: t("MODAL_IN_VAULT"),
            cls: "modal-subtitle",
        });
    }

    private createWarningMessage(contentEl: HTMLElement) {
        contentEl.createEl("p", {
            cls: "modal-warning",
            text: t("MODAL_WARNING_BACKUP"),
        });
    }

    private createGeneralSettings(contentEl: HTMLElement) {
        new Setting(contentEl)
            .setName(t("SETTING_CONVERT_TO") + " ⓘ")
            .setDesc(
                t("SETTING_CONVERT_TO_DESC")
            )
            .setTooltip(
                t("SETTING_CONVERT_TO_DESC")
            )
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("disabled", t("SETTING_SAME_AS_ORIGINAL"))
                    .addOptions({
                        webp: "WebP",
                        jpg: "JPG",
                        png: "PNG",
                    })
                    .setValue(this.plugin.settings.ProcessAllVaultconvertTo)
                    .onChange(async (value) => {
                        this.plugin.settings.ProcessAllVaultconvertTo = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(contentEl)
            .setName(t("SETTING_QUALITY") + " ⓘ")
            .setDesc(t("SETTING_QUALITY_DESC"))
            .setTooltip(
                t("SETTING_QUALITY_TOOLTIP")
            )
            .addText((text) => {
                text
                    .setPlaceholder(t("SETTING_QUALITY_DESC"))
                    .setValue(
                        (
                            this.plugin.settings.ProcessAllVaultquality * 100
                        ).toString()
                    )
                    .onChange(async (value) => {
                        const quality = parseInt(value, 10);
                        if (
                            !isNaN(quality) &&
                            quality >= 0 &&
                            quality <= 100
                        ) {
                            this.plugin.settings.ProcessAllVaultquality =
                                quality / 100;
                            await this.plugin.saveSettings();
                        }
                    });
            });
    }

    private createResizeSettings(contentEl: HTMLElement) {
        new Setting(contentEl)
            .setName(t("SETTING_RESIZE_MODE") + " ⓘ")
            .setDesc(
                t("SETTING_RESIZE_MODE_DESC")
            )
            .setTooltip(
                t("SETTING_RESIZE_TOOLTIP")
            )
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
                            .ProcessAllVaultResizeModalresizeMode
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.ProcessAllVaultResizeModalresizeMode =
                            value;
                        await this.plugin.saveSettings();
                        this.updateResizeInputVisibility(value);
                    });
            });

        this.resizeInputsDiv = contentEl.createDiv({ cls: "resize-inputs" });
        this.enlargeReduceDiv = contentEl.createDiv({
            cls: "enlarge-reduce-settings",
        });

        this.updateResizeInputVisibility(
            this.plugin.settings.ProcessAllVaultResizeModalresizeMode
        );
    }

    private createSkipSettings(contentEl: HTMLElement) {
        new Setting(contentEl)
            .setName(t("SETTING_SKIP_FORMATS") + " ⓘ")
            .setDesc(
                t("SETTING_SKIP_FORMATS_DESC")
            )
            .setTooltip(
                t("SETTING_SKIP_FORMATS_TOOLTIP")
            )
            .addText((text) => {
                text
                    .setPlaceholder("png,gif")
                    .setValue(this.plugin.settings.ProcessAllVaultSkipFormats)
                    .onChange(async (value) => {
                        this.plugin.settings.ProcessAllVaultSkipFormats = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(contentEl)
            .setName(t("SETTING_SKIP_TARGET") + " ⓘ")
            .setDesc(
                t("SETTING_SKIP_TARGET_DESC")
            )
            .setTooltip(
                t("SETTING_SKIP_TARGET_TOOLTIP")
            )
            .addToggle((toggle) => {
                toggle
                    .setValue(
                        this.plugin.settings.ProcessAllVaultskipImagesInTargetFormat
                    )
                    .onChange(async (value) => {
                        this.plugin.settings.ProcessAllVaultskipImagesInTargetFormat =
                            value;
                        await this.plugin.saveSettings();
                    });
            });
    }

    private createProcessButton(contentEl: HTMLElement) {
        const buttonContainer = contentEl.createDiv({
            cls: "button-container",
        });
        new ButtonComponent(buttonContainer)
            .setButtonText(t("BUTTON_PROCESS_ALL"))
            .setCta()
            .onClick(async () => {
                this.close();
                await this.batchImageProcessor.processAllVaultImages();
            });
    }

    // --- Helper Methods for Settings ---

    private updateResizeInputVisibility(resizeMode: string): void {
        if (resizeMode === "None") {
            this.resizeInputsDiv?.empty();
            this.enlargeReduceDiv?.hide();
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
            this.enlargeReduceDiv?.show();
        }
    }

    private createEnlargeReduceSettings(): void {
        if (!this.enlargeReduceDiv) return;

        this.enlargeReduceDiv.empty();

        this.enlargeReduceSettings = new Setting(this.enlargeReduceDiv)
            .setClass("enlarge-reduce-setting")
            .setName(t("SETTING_ENLARGE_REDUCE") + " ⓘ")
            .setDesc(
                t("SETTING_ENLARGE_REDUCE_DESC")
            )
            .setTooltip(
                t("SETTING_ENLARGE_REDUCE_DESC")
            )
            .addDropdown((dropdown) => {
                dropdown
                    .addOptions({
                        Always: t("OPTION_ALWAYS"),
                        Reduce: t("OPTION_REDUCE"),
                        Enlarge: t("OPTION_ENLARGE"),
                    })
                    .setValue(
                        this.plugin.settings.ProcessAllVaultEnlargeOrReduce
                    )
                    .onChange(
                        async (value: "Always" | "Reduce" | "Enlarge") => {
                            this.plugin.settings.ProcessAllVaultEnlargeOrReduce =
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
                .addText((text) =>
                    text
                        .setPlaceholder(t("LABEL_WIDTH"))
                        .setValue(
                            this.plugin.settings
                                .ProcessAllVaultResizeModaldesiredWidth
                                .toString()
                        )
                        .onChange(async (value: string) => {
                            const width = parseInt(value);
                            if (/^\d+$/.test(value) && width > 0) {
                                this.plugin.settings.ProcessAllVaultResizeModaldesiredWidth =
                                    width;
                                await this.plugin.saveSettings();
                            }
                        })
                )
                .addText((text) =>
                    text
                        .setPlaceholder(t("LABEL_HEIGHT"))
                        .setValue(
                            this.plugin.settings
                                .ProcessAllVaultResizeModaldesiredHeight
                                .toString()
                        )
                        .onChange(async (value: string) => {
                            const height = parseInt(value);
                            if (/^\d+$/.test(value) && height > 0) {
                                this.plugin.settings.ProcessAllVaultResizeModaldesiredHeight =
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
                .addText((text) =>
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
                    .ProcessAllVaultResizeModaldesiredLength;
            case "Width":
                return this.plugin.settings
                    .ProcessAllVaultResizeModaldesiredWidth;
            case "Height":
                return this.plugin.settings
                    .ProcessAllVaultResizeModaldesiredHeight;
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
                this.plugin.settings.ProcessAllVaultResizeModaldesiredLength =
                    value;
                break;
            case "Width":
                this.plugin.settings.ProcessAllVaultResizeModaldesiredWidth =
                    value;
                break;
            case "Height":
                this.plugin.settings.ProcessAllVaultResizeModaldesiredHeight =
                    value;
                break;
        }
        await this.plugin.saveSettings();
    }
}