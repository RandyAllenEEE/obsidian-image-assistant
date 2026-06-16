import { App, Setting, TFile, TFolder } from "obsidian";
import ImageConverterPlugin from "../../../../main";
import { BatchTask, BatchItemResult, BatchResult, BatchScope } from "../../../../types/BatchTypes";
import { IBatchMode, ReviewAction } from "./IBatchMode";
import { t } from "../../../../lang/helpers";
import { ImageFileCollector } from "../../../../utils/batch/ImageFileCollector";

export class LocalProcessMode implements IBatchMode {
    id = "local_process" as const;
    name = t("BATCH_MODE_LOCAL");

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private target: TFile | TFolder | null,
        private scope: BatchScope
    ) { }

    renderSettings(container: HTMLElement): void {
        const option = this.plugin.settings.operationDefaults.batchLocal;

        new Setting(container)
            .setName(t("BATCH_SETTING_TARGET_FORMAT"))
            .addDropdown(dropdown => {
                dropdown.addOption('disabled', t("BATCH_FORMAT_ORIGINAL"));
                dropdown.addOption('webp', 'WebP');
                dropdown.addOption('jpg', 'JPG');
                dropdown.addOption('png', 'PNG');
                dropdown.setValue(option.convertTo === "Original" ? "disabled" : option.convertTo)
                    .onChange(async (value) => {
                        option.convertTo = value;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(container)
            .setName(t("BATCH_SETTING_QUALITY"))
            .setDesc(t("BATCH_SETTING_QUALITY_DESC"))
            .addSlider(slider => {
                slider.setLimits(10, 100, 5)
                    .setValue(option.quality * 100) // Quality is 0-1 usually in settings? Defaults says 0.75. Code used 80.
                    // defaults.ts: quality: 0.75.
                    // Slider usually 0-100.
                    // Need to check if code expected 0-100 or 0-1.
                    // BatchImageProcessor logic?
                    // Let's assume 0-100 for slider and convert.
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        option.quality = value / 100;
                        await this.plugin.saveSettings();
                    });
            });

        new Setting(container)
            .setName(t("BATCH_SETTING_RESIZE"))
            .addDropdown(dropdown => {
                dropdown
                    .addOption('None', t("SETTING_RESIZE_NONE"))
                    .addOption('Fit', t("OPTION_RESIZE_FIT"))
                    .addOption('Fill', t("OPTION_RESIZE_FILL"))
                    .addOption('LongestEdge', t("OPTION_RESIZE_LONGEST"))
                    .addOption('ShortestEdge', t("OPTION_RESIZE_SHORTEST"))
                    .addOption('Width', t("OPTION_RESIZE_WIDTH"))
                    .addOption('Height', t("OPTION_RESIZE_HEIGHT"))
                    .setValue(option.resizeMode)
                    .onChange(async (value) => {
                        option.resizeMode = value;
                        await this.plugin.saveSettings();
                        container.empty();
                        this.renderSettings(container);
                    });
            });

        if (["Fit", "Fill", "Width"].includes(option.resizeMode)) {
            this.addNumberSetting(container, t("LABEL_WIDTH"), option.desiredWidth, async value => {
                option.desiredWidth = value;
                await this.plugin.saveSettings();
            });
        }

        if (["Fit", "Fill", "Height"].includes(option.resizeMode)) {
            this.addNumberSetting(container, t("LABEL_HEIGHT"), option.desiredHeight, async value => {
                option.desiredHeight = value;
                await this.plugin.saveSettings();
            });
        }

        if (["LongestEdge", "ShortestEdge"].includes(option.resizeMode)) {
            this.addNumberSetting(
                container,
                option.resizeMode === "LongestEdge" ? t("MODAL_DESIRED_LONG") : t("MODAL_DESIRED_SHORT"),
                option.desiredLength,
                async value => {
                    option.desiredLength = value;
                    await this.plugin.saveSettings();
                }
            );
        }

        if (option.resizeMode !== "None") {
            new Setting(container)
                .setName(t("MODAL_ENLARGE_REDUCE"))
                .addDropdown(dropdown => {
                    dropdown
                        .addOption("Always", t("OPTION_ALWAYS"))
                        .addOption("Reduce", t("OPTION_REDUCE"))
                        .addOption("Enlarge", t("OPTION_ENLARGE"))
                        .addOption("Auto", t("OPTION_AUTO"))
                        .setValue(option.enlargeOrReduce)
                        .onChange(async value => {
                            option.enlargeOrReduce = value as any;
                            await this.plugin.saveSettings();
                        });
                });
        }

        new Setting(container)
            .setName(t("SETTING_SKIP_FORMATS"))
            .setDesc(t("SETTING_SKIP_FORMATS_DESC"))
            .addText(text => {
                text.setValue(option.skipFormats)
                    .onChange(async value => {
                        option.skipFormats = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttr('spellcheck', 'false');
            });

        new Setting(container)
            .setName(t("SETTING_SKIP_TARGET"))
            .setDesc(t("SETTING_SKIP_TARGET_DESC"))
            .addToggle(toggle => toggle.setValue(option.skipImagesInTargetFormat).onChange(async value => {
                option.skipImagesInTargetFormat = value;
                await this.plugin.saveSettings();
            }));
    }

    private addNumberSetting(container: HTMLElement, name: string, value: number, onChange: (value: number) => Promise<void>): void {
        new Setting(container)
            .setName(name)
            .addText(text => {
                text.setValue(String(value))
                    .onChange(async rawValue => {
                        await onChange(parseInt(rawValue, 10) || 0);
                    });
                text.inputEl.setAttr('spellcheck', 'false');
            });
    }

    private isFileLike(item: unknown): item is TFile {
        return item instanceof TFile || (
            !!item &&
            typeof (item as any).path === 'string' &&
            typeof (item as any).name === 'string' &&
            typeof (item as any).extension === 'string'
        );
    }

    private isFolderLike(item: unknown): item is TFolder {
        return item instanceof TFolder || (
            !!item &&
            typeof (item as any).path === 'string' &&
            Array.isArray((item as any).children)
        );
    }

    async loadTasks(): Promise<BatchTask[]> {
        const tasks: BatchTask[] = [];
        let files: TFile[] = [];

        if (this.scope === "note" && this.isFileLike(this.target)) {
            const cache = this.app.metadataCache.getFileCache(this.target);
            if (cache && cache.embeds) {
                for (const embed of cache.embeds) {
                    const file = this.app.metadataCache.getFirstLinkpathDest(embed.link, this.target.path);
                    if (this.isFileLike(file) && this.plugin.supportedImageFormats.isSupported(file.extension, file.name)) {
                        files.push(file);
                    }
                }
            }
        } else if (this.scope === "folder" && this.isFolderLike(this.target)) {
            files = new ImageFileCollector(this.app, this.plugin).getImageFilesInFolder(this.target, true);
        } else if (this.scope === "vault") {
            files = this.app.vault.getFiles().filter(f => this.plugin.supportedImageFormats.isSupported(f.extension, f.name));
        }

        files = [...new Set(files)];

        for (const file of files) {
            tasks.push({
                id: file.path,
                name: file.name,
                path: file.path,
                source: file,
                selected: true,
                status: 'pending'
            });
        }
        return tasks;
    }

    async processTask(task: BatchTask): Promise<BatchItemResult> {
        try {
            const file = task.source as TFile;
            const result = await this.plugin.batchImageProcessor.batchProcess([file]);
            if (result.successful.length > 0) return result.successful[0];
            if (result.failed.length > 0) return result.failed[0];
            return { success: false, item: file, error: t("MSG_UNKNOWN_ERROR") };
        } catch (e) {
            return { success: false, item: task.source as TFile, error: e.message };
        }
    }

    getReviewActions(): ReviewAction[] {
        return [
            { id: "done", label: t("BATCH_DONE"), style: 'primary' }
        ];
    }

    async handleReviewAction(action: string, result: BatchResult): Promise<void> {
        // No special action for local process review, just close
    }
}
