import { Notice, Setting, setIcon } from "obsidian";
import ImageConverterPlugin from "../../main";
import { AvifEncoder, EnlargeReduce, LocalExternalToolSettings, OutputFormat, ResizeMode } from "../types";
import { ResizeDimension, ResizeScaleMode, ResizeUnits } from "../NonDestructiveResizeSettings";
import { t } from "../../lang/helpers";
import { AVIF_ENCODER_CONFIGS, ImageProcessor } from "../../local/ImageProcessor";
import { findFfmpegExecutablePath, normalizeExecutablePath } from "../../utils/ffmpegPath";
import { addInfoIcon } from "../../utils/settingInfo";

interface RenderContext {
    plugin: ImageConverterPlugin;
    containerEl: HTMLElement;
    refreshDisplay: () => void;
    activeTab: "folder" | "filename" | "conversion" | "linkformat" | "resize";
    setActiveTab: (tab: "folder" | "filename" | "conversion" | "linkformat" | "resize") => void;
}

export function renderLocalProcessingSection(context: RenderContext): void {
    if (context.plugin.settings.pasteHandling.mode !== "local") return;

    const wrapper = context.containerEl.createDiv("image-converter-tab-content-wrapper");
    renderTabs(wrapper, context);
    const form = wrapper.createDiv("image-converter-local-processing-form");

    switch (context.activeTab) {
        case "folder":
            renderFolder(form, context);
            break;
        case "filename":
            renderFilename(form, context);
            break;
        case "conversion":
            renderConversion(form, context);
            break;
        case "linkformat":
            renderLink(form, context);
            break;
        case "resize":
            renderEmbedResize(form, context);
            break;
    }
}

function renderTabs(container: HTMLElement, context: RenderContext): void {
    const tabs = container.createDiv("image-converter-setting-tabs");
    const tabDefs: Array<[RenderContext["activeTab"], string, string]> = [
        ["folder", "folder", t("TAB_FOLDER")],
        ["filename", "pencil", t("TAB_FILENAME")],
        ["conversion", "settings", t("TAB_CONVERSION")],
        ["linkformat", "link", t("TAB_LINK_FORMAT")],
        ["resize", "frame", t("TAB_RESIZE")],
    ];

    for (const [id, icon, label] of tabDefs) {
        const tab = tabs.createDiv(`image-converter-tab image-converter-tab-${id}`);
        tab.setAttr("aria-label", label);
        const iconEl = tab.createSpan({ cls: "image-converter-tab-icon" });
        setIcon(iconEl, icon);
        tab.createSpan({ text: label, cls: "image-converter-tab-label" });
        if (context.activeTab === id) tab.addClass("image-converter-tab-active");
        tab.onclick = () => {
            context.setActiveTab(id);
            context.refreshDisplay();
        };
    }
}

function renderFolder(container: HTMLElement, context: RenderContext): void {
    const destination = context.plugin.settings.localProcessing.destination;

    new Setting(container)
        .setName(t("TAB_FOLDER"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("DEFAULT", t("OPTION_FOLDER_DEFAULT"))
                .addOption("ROOT", t("OPTION_FOLDER_ROOT"))
                .addOption("CURRENT", t("OPTION_FOLDER_CURRENT"))
                .addOption("SUBFOLDER", t("OPTION_FOLDER_SUBFOLDER"))
                .addOption("CUSTOM", t("OPTION_FOLDER_CUSTOM"))
                .setValue(destination.type)
                .onChange(async value => {
                    destination.type = value as any;
                    await context.plugin.saveSettings();
                    context.refreshDisplay();
                });
        });

    if (destination.type === "SUBFOLDER") {
        new Setting(container)
            .setName(t("MODAL_LABEL_SUBFOLDER_TEMPLATE"))
            .addText(text => {
                text.setValue(destination.subfolderTemplate || "")
                    .onChange(async value => {
                        destination.subfolderTemplate = value;
                        await context.plugin.saveSettings();
                    });
                text.inputEl.setAttr("spellcheck", "false");
            });
    }

    if (destination.type === "CUSTOM") {
        new Setting(container)
            .setName(t("LABEL_CUSTOM_PATH"))
            .addText(text => {
                text.setValue(destination.customTemplate || "")
                    .onChange(async value => {
                        destination.customTemplate = value;
                        await context.plugin.saveSettings();
                    });
                text.inputEl.setAttr("spellcheck", "false");
            });
    }
}

function renderFilename(container: HTMLElement, context: RenderContext): void {
    const filename = context.plugin.settings.localProcessing.filename;

    new Setting(container)
        .setName(t("LABEL_CUSTOM_IMAGENAME"))
        .addText(text => {
            text.setValue(filename.customTemplate || "")
                .onChange(async value => {
                    filename.customTemplate = value;
                    await context.plugin.saveSettings();
                });
            text.inputEl.setAttr("spellcheck", "false");
        });

    new Setting(container)
        .setName(t("LABEL_SKIP_RENAME_PATTERNS"))
        .addText(text => {
            text.setValue(filename.skipRenamePatterns || "")
                .onChange(async value => {
                    filename.skipRenamePatterns = value;
                    await context.plugin.saveSettings();
                });
            text.inputEl.setAttr("spellcheck", "false");
        });

    new Setting(container)
        .setName(t("LABEL_CONFLICT_RESOLUTION"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("increment", t("OPTION_INCREMENT"))
                .addOption("reuse", t("OPTION_REUSE"))
                .addOption("skip", t("OPTION_SKIP"))
                .addOption("overwrite", t("OPTION_OVERWRITE"))
                .setValue(filename.conflictResolution)
                .onChange(async value => {
                    filename.conflictResolution = value as any;
                    await context.plugin.saveSettings();
                });
        });
}

function renderConversion(container: HTMLElement, context: RenderContext): void {
    const conversion = context.plugin.settings.localProcessing.conversion;
    const tools = context.plugin.settings.localProcessing.externalTools;

    new Setting(container)
        .setName(t("LABEL_OUTPUT_FORMAT"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("WEBP", t("SETTING_FORMAT_WEBP"))
                .addOption("JPEG", t("SETTING_FORMAT_JPEG"))
                .addOption("PNG", t("SETTING_FORMAT_PNG"))
                .addOption("ORIGINAL", t("SETTING_FORMAT_ORIGINAL"))
                .addOption("NONE", t("SETTING_FORMAT_NONE"))
                .addOption("PNGQUANT", t("SETTING_FORMAT_PNGQUANT"))
                .addOption("AVIF", t("SETTING_FORMAT_AVIF"))
                .setValue(conversion.outputFormat)
                .onChange(async value => {
                    conversion.outputFormat = value as OutputFormat;
                    await context.plugin.saveSettings();
                    context.refreshDisplay();
                });
        });

    if (["WEBP", "JPEG", "ORIGINAL"].includes(conversion.outputFormat)) {
        new Setting(container)
            .setName(t("LABEL_QUALITY"))
            .addSlider(slider => {
                slider.setLimits(1, 100, 1)
                    .setValue(conversion.quality)
                    .setDynamicTooltip()
                    .onChange(async value => {
                        conversion.quality = value;
                        await context.plugin.saveSettings();
                    });
            });
    }

    if (conversion.outputFormat === "PNG") {
        new Setting(container)
            .setName(t("MODAL_COLOR_DEPTH"))
            .addSlider(slider => {
                slider.setLimits(0, 1, 0.1)
                    .setValue(conversion.colorDepth)
                    .setDynamicTooltip()
                    .onChange(async value => {
                        conversion.colorDepth = value;
                        await context.plugin.saveSettings();
                    });
            });
    }

    if (conversion.outputFormat === "PNGQUANT") {
        new Setting(container)
            .setName(t("MODAL_PNGQUANT_PATH"))
            .addText(text => text.setValue(tools.pngquantExecutablePath).onChange(async value => {
                tools.pngquantExecutablePath = value;
                await context.plugin.saveSettings();
            }));
        new Setting(container)
            .setName(t("MODAL_PNGQUANT_QUALITY"))
            .addText(text => text.setValue(tools.pngquantQuality).onChange(async value => {
                tools.pngquantQuality = value;
                await context.plugin.saveSettings();
            }));
    }

    if (conversion.outputFormat === "AVIF") {
        const activeEncoder = getActiveAvifEncoder(tools);
        const encoderConfig = activeEncoder
            ? AVIF_ENCODER_CONFIGS[activeEncoder]
            : AVIF_ENCODER_CONFIGS["libaom-av1"];

        new Setting(container)
            .setName(t("MODAL_FFMPEG_PATH"))
            .setTooltip(t("TOOLTIP_FFMPEG_PATH"))
            .addText(text => text.setValue(tools.ffmpegExecutablePath).onChange(async value => {
                const previousPath = normalizeExecutablePath(tools.ffmpegExecutablePath);
                const nextPath = normalizeExecutablePath(value);
                if (previousPath !== nextPath) {
                    ImageProcessor.clearAvifEncoderCache(previousPath);
                    tools.ffmpegDetectedEncoder = undefined;
                    tools.ffmpegDetectedEncoderPath = undefined;
                }
                tools.ffmpegExecutablePath = value;
                await context.plugin.saveSettings();
            }))
            .addExtraButton(button => {
                button
                    .setIcon("search")
                    .setTooltip(t("BUTTON_FIND_FFMPEG"))
                    .onClick(async () => {
                        const foundPath = await findFfmpegExecutablePath(context.plugin.app);
                        if (!foundPath) {
                            new Notice(t("NOTICE_FFMPEG_NOT_FOUND"));
                            return;
                        }
                        const previousPath = normalizeExecutablePath(tools.ffmpegExecutablePath);
                        tools.ffmpegExecutablePath = foundPath;
                        tools.ffmpegDetectedEncoder = undefined;
                        tools.ffmpegDetectedEncoderPath = undefined;
                        ImageProcessor.clearAvifEncoderCache(previousPath);
                        await context.plugin.saveSettings();
                        new Notice(t("NOTICE_FFMPEG_DETECTED", [foundPath]));
                        context.refreshDisplay();
                    });
            })
            .then(setting => addInfoIcon(setting, t("TOOLTIP_FFMPEG_PATH")));

        new Setting(container)
            .setName(t("MODAL_AVIF_ENCODER"))
            .setDesc(activeEncoder
                ? t("DESC_AVIF_ENCODER_CURRENT", [activeEncoder])
                : t("DESC_AVIF_ENCODER_DETECTION"))
            .addExtraButton(button => {
                button
                    .setIcon("cpu")
                    .setTooltip(t("BUTTON_DETECT_ENCODER"))
                    .onClick(async () => {
                        const executablePath = normalizeExecutablePath(tools.ffmpegExecutablePath);
                        if (!executablePath) {
                            new Notice(t("ERROR_FFMPEG_NOT_SET"));
                            return;
                        }

                        ImageProcessor.clearAvifEncoderCache(executablePath);
                        const encoder = await context.plugin.imageProcessor.detectAvifEncoder(
                            executablePath,
                            tools.ffmpegDetectedEncoder,
                            { forceProbe: true }
                        );
                        if (!encoder) {
                            tools.ffmpegDetectedEncoder = undefined;
                            tools.ffmpegDetectedEncoderPath = undefined;
                            await context.plugin.saveSettings();
                            new Notice(t("NOTICE_ENCODER_NOT_FOUND"));
                            context.refreshDisplay();
                            return;
                        }

                        tools.ffmpegExecutablePath = executablePath;
                        tools.ffmpegDetectedEncoder = encoder;
                        tools.ffmpegDetectedEncoderPath = executablePath;
                        await context.plugin.saveSettings();
                        new Notice(t("NOTICE_ENCODER_DETECTED", [encoder]));
                        context.refreshDisplay();
                    });
            });

        new Setting(container)
            .setName(t("MODAL_FFMPEG_CRF"))
            .setDesc(t("DESC_FFMPEG_CRF_RANGE", [encoderConfig.crfMin, encoderConfig.crfMax]))
            .addSlider(slider => slider.setLimits(encoderConfig.crfMin, encoderConfig.crfMax, 1).setValue(Math.max(encoderConfig.crfMin, Math.min(encoderConfig.crfMax, tools.ffmpegCrf))).setDynamicTooltip().onChange(async value => {
                tools.ffmpegCrf = value;
                await context.plugin.saveSettings();
            }));
        new Setting(container)
            .setName(t("MODAL_FFMPEG_PRESET"))
            .addDropdown(dropdown => {
                getAvifPresetOptions(activeEncoder, tools.ffmpegPreset).forEach(option => dropdown.addOption(option, option));
                dropdown
                    .setValue(tools.ffmpegPreset)
                    .onChange(async value => {
                        tools.ffmpegPreset = value;
                        await context.plugin.saveSettings();
                    });
            });
    }

    renderResizeFields(container, conversion, context);

    new Setting(container)
        .setName(t("LABEL_SKIP_CONVERSION_PATTERNS"))
        .addText(text => {
            text.setValue(conversion.skipConversionPatterns || "")
                .onChange(async value => {
                    conversion.skipConversionPatterns = value;
                    await context.plugin.saveSettings();
                });
            text.inputEl.setAttr("spellcheck", "false");
        });

    new Setting(container)
        .setName(t("LABEL_MINIMUM_SAVINGS"))
        .addText(text => text.setValue(String(conversion.minimumCompressionSavingsInKB)).onChange(async value => {
            conversion.minimumCompressionSavingsInKB = parseInt(value, 10) || 0;
            await context.plugin.saveSettings();
        }));
}

function renderResizeFields(container: HTMLElement, conversion: { resizeMode: ResizeMode; desiredWidth: number; desiredHeight: number; desiredLongestEdge: number; enlargeOrReduce: EnlargeReduce; allowLargerFiles: boolean }, context: RenderContext): void {
    new Setting(container)
        .setName(t("SETTING_RESIZE_MODE"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("None", t("SETTING_RESIZE_NONE"))
                .addOption("Fit", t("SETTING_RESIZE_FIT"))
                .addOption("Fill", t("SETTING_RESIZE_FILL"))
                .addOption("LongestEdge", t("SETTING_RESIZE_LONGEST"))
                .addOption("ShortestEdge", t("SETTING_RESIZE_SHORTEST"))
                .addOption("Width", t("SETTING_RESIZE_WIDTH"))
                .addOption("Height", t("SETTING_RESIZE_HEIGHT"))
                .setValue(conversion.resizeMode)
                .onChange(async value => {
                    conversion.resizeMode = value as ResizeMode;
                    await context.plugin.saveSettings();
                    context.refreshDisplay();
                });
        });

    if (["Fit", "Fill", "Width"].includes(conversion.resizeMode)) {
        addNumberSetting(container, t("LABEL_WIDTH"), conversion.desiredWidth, async value => {
            conversion.desiredWidth = value;
            await context.plugin.saveSettings();
        });
    }
    if (["Fit", "Fill", "Height"].includes(conversion.resizeMode)) {
        addNumberSetting(container, t("LABEL_HEIGHT"), conversion.desiredHeight, async value => {
            conversion.desiredHeight = value;
            await context.plugin.saveSettings();
        });
    }
    if (["LongestEdge", "ShortestEdge"].includes(conversion.resizeMode)) {
        addNumberSetting(container, conversion.resizeMode === "LongestEdge" ? t("MODAL_DESIRED_LONG") : t("MODAL_DESIRED_SHORT"), conversion.desiredLongestEdge, async value => {
            conversion.desiredLongestEdge = value;
            await context.plugin.saveSettings();
        });
    }

    new Setting(container)
        .setName(t("MODAL_ENLARGE_REDUCE"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("Always", t("OPTION_ALWAYS"))
                .addOption("Reduce", t("OPTION_REDUCE"))
                .addOption("Enlarge", t("OPTION_ENLARGE"))
                .addOption("Auto", t("OPTION_AUTO"))
                .setValue(conversion.enlargeOrReduce)
                .onChange(async value => {
                    conversion.enlargeOrReduce = value as EnlargeReduce;
                    await context.plugin.saveSettings();
                });
        });

    new Setting(container)
        .setName(t("MODAL_LABEL_ALLOW_LARGER"))
        .addToggle(toggle => toggle.setValue(conversion.allowLargerFiles).onChange(async value => {
            conversion.allowLargerFiles = value;
            await context.plugin.saveSettings();
        }));
}

function renderLink(container: HTMLElement, context: RenderContext): void {
    const link = context.plugin.settings.localProcessing.link;

    new Setting(container)
        .setName(t("TAB_LINK_FORMAT"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("wikilink", t("OPTION_WIKILINK"))
                .addOption("markdown", t("OPTION_MARKDOWN"))
                .setValue(link.linkFormat)
                .onChange(async value => {
                    link.linkFormat = value as any;
                    await context.plugin.saveSettings();
                });
        });

    new Setting(container)
        .setName(t("LABEL_PATH_FORMAT"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("shortest", t("OPTION_PATH_SHORTEST"))
                .addOption("relative", t("OPTION_RELATIVE"))
                .addOption("absolute", t("OPTION_ABSOLUTE"))
                .setValue(link.pathFormat)
                .onChange(async value => {
                    link.pathFormat = value as any;
                    await context.plugin.saveSettings();
                });
        });

    new Setting(container)
        .setName(t("LABEL_PREPEND_CURRENT_DIR"))
        .addToggle(toggle => toggle.setValue(link.prependCurrentDir).onChange(async value => {
            link.prependCurrentDir = value;
            await context.plugin.saveSettings();
        }));

    new Setting(container)
        .setName(t("LABEL_HIDE_FOLDERS"))
        .addToggle(toggle => toggle.setValue(link.hideFolders).onChange(async value => {
            link.hideFolders = value;
            await context.plugin.saveSettings();
        }));
}

function renderEmbedResize(container: HTMLElement, context: RenderContext): void {
    const resize = context.plugin.settings.localProcessing.embedResize;

    new Setting(container)
        .setName(t("SETTING_RESIZE_DIMENSIONS"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("none", t("SETTING_RESIZE_DIM_NONE"))
                .addOption("width", t("SETTING_RESIZE_DIM_WIDTH"))
                .addOption("height", t("SETTING_RESIZE_DIM_HEIGHT"))
                .addOption("both", t("SETTING_RESIZE_DIM_BOTH"))
                .addOption("longest-edge", t("SETTING_RESIZE_DIM_LONGEST"))
                .addOption("shortest-edge", t("SETTING_RESIZE_DIM_SHORTEST"))
                .addOption("original-width", t("SETTING_RESIZE_DIM_ORIG_WIDTH"))
                .addOption("original-height", t("SETTING_RESIZE_DIM_ORIG_HEIGHT"))
                .addOption("editor-max-width", t("SETTING_RESIZE_DIM_EDITOR_MAX"))
                .setValue(resize.resizeDimension)
                .onChange(async value => {
                    resize.resizeDimension = value as ResizeDimension;
                    await context.plugin.saveSettings();
                    context.refreshDisplay();
                });
        });

    if (["width", "both"].includes(resize.resizeDimension)) {
        addNumberSetting(container, t("LABEL_WIDTH"), resize.width || 0, async value => {
            resize.width = value;
            await context.plugin.saveSettings();
        });
    }
    if (["height", "both"].includes(resize.resizeDimension)) {
        addNumberSetting(container, t("LABEL_HEIGHT"), resize.height || 0, async value => {
            resize.height = value;
            await context.plugin.saveSettings();
        });
    }
    if (resize.resizeDimension === "longest-edge") {
        addNumberSetting(container, t("MODAL_DESIRED_LONG"), resize.longestEdge || 0, async value => {
            resize.longestEdge = value;
            await context.plugin.saveSettings();
        });
    }
    if (resize.resizeDimension === "shortest-edge") {
        addNumberSetting(container, t("MODAL_DESIRED_SHORT"), resize.shortestEdge || 0, async value => {
            resize.shortestEdge = value;
            await context.plugin.saveSettings();
        });
    }

    new Setting(container)
        .setName(t("MODAL_LABEL_SCALE_MODE"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("auto", t("OPTION_AUTO"))
                .addOption("reduce", t("OPTION_REDUCE"))
                .addOption("enlarge", t("OPTION_ENLARGE"))
                .setValue(resize.resizeScaleMode)
                .onChange(async value => {
                    resize.resizeScaleMode = value as ResizeScaleMode;
                    await context.plugin.saveSettings();
                });
        });

    new Setting(container)
        .setName(t("LABEL_RESIZE_UNITS"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("pixels", t("OPTION_PIXELS"))
                .addOption("percentage", t("OPTION_PERCENTAGE"))
                .setValue(resize.resizeUnits)
                .onChange(async value => {
                    resize.resizeUnits = value as ResizeUnits;
                    await context.plugin.saveSettings();
                });
        });

    new Setting(container)
        .setName(t("MODAL_LABEL_MAINTAIN_ASPECT"))
        .addToggle(toggle => toggle.setValue(resize.maintainAspectRatio).onChange(async value => {
            resize.maintainAspectRatio = value;
            await context.plugin.saveSettings();
        }));
}

function getActiveAvifEncoder(tools: LocalExternalToolSettings): AvifEncoder | undefined {
    const encoder = tools.ffmpegDetectedEncoder;
    if (!encoder || !(encoder in AVIF_ENCODER_CONFIGS)) return undefined;

    const encoderPath = tools.ffmpegDetectedEncoderPath;
    if (!encoderPath) return encoder;

    return normalizeExecutablePath(encoderPath) === normalizeExecutablePath(tools.ffmpegExecutablePath)
        ? encoder
        : undefined;
}

function getAvifPresetOptions(encoder?: AvifEncoder, currentPreset: string = ""): string[] {
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

function addNumberSetting(container: HTMLElement, name: string, value: number, onChange: (value: number) => Promise<void>): void {
    new Setting(container)
        .setName(name)
        .addText(text => {
            text.setValue(String(value))
                .onChange(async rawValue => {
                    await onChange(parseInt(rawValue, 10) || 0);
                });
            text.inputEl.setAttr("spellcheck", "false");
        });
}
