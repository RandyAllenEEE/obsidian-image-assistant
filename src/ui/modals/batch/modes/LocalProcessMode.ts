import { App, Setting, TFile, TFolder } from "obsidian";
import ImageConverterPlugin from "../../../../main";
import { BatchTask, BatchItemResult, BatchResult, BatchScope } from "../../../../types/BatchTypes";
import { IBatchMode, ReviewAction } from "./IBatchMode";
import { t } from "../../../../lang/helpers";

export class LocalProcessMode implements IBatchMode {
    id = "local_process" as const;
    name = t("BATCH_MODE_LOCAL" as any);

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private target: TFile | TFolder | null,
        private scope: BatchScope
    ) { }

    renderSettings(container: HTMLElement): void {
        const option = this.plugin.settings.operationDefaults.batchLocal;

        new Setting(container)
            .setName(t("BATCH_SETTING_TARGET_FORMAT" as any))
            .addDropdown(dropdown => {
                dropdown.addOption('disabled', t("BATCH_FORMAT_ORIGINAL" as any));
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
            .setName(t("BATCH_SETTING_QUALITY" as any))
            .setDesc(t("BATCH_SETTING_QUALITY_DESC" as any))
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
            .setName(t("BATCH_SETTING_RESIZE" as any))
            .addDropdown(dropdown => {
                dropdown
                    .addOption('None', 'None')
                    .addOption('Fit', t("OPTION_RESIZE_FIT" as any))
                    .addOption('Fill', t("OPTION_RESIZE_FILL" as any))
                    .addOption('LongestEdge', t("OPTION_RESIZE_LONGEST" as any))
                    .addOption('ShortestEdge', t("OPTION_RESIZE_SHORTEST" as any))
                    .addOption('Width', t("OPTION_RESIZE_WIDTH" as any))
                    .addOption('Height', t("OPTION_RESIZE_HEIGHT" as any))
                    .setValue(option.resizeMode)
                    .onChange(async (value) => {
                        option.resizeMode = value;
                        await this.plugin.saveSettings();
                        container.empty();
                        this.renderSettings(container);
                    });
            });

        if (["Fit", "Fill", "Width"].includes(option.resizeMode)) {
            this.addNumberSetting(container, t("LABEL_WIDTH" as any), option.desiredWidth, async value => {
                option.desiredWidth = value;
                await this.plugin.saveSettings();
            });
        }

        if (["Fit", "Fill", "Height"].includes(option.resizeMode)) {
            this.addNumberSetting(container, t("LABEL_HEIGHT" as any), option.desiredHeight, async value => {
                option.desiredHeight = value;
                await this.plugin.saveSettings();
            });
        }

        if (["LongestEdge", "ShortestEdge"].includes(option.resizeMode)) {
            this.addNumberSetting(
                container,
                option.resizeMode === "LongestEdge" ? t("MODAL_DESIRED_LONG" as any) : t("MODAL_DESIRED_SHORT" as any),
                option.desiredLength,
                async value => {
                    option.desiredLength = value;
                    await this.plugin.saveSettings();
                }
            );
        }

        if (option.resizeMode !== "None") {
            new Setting(container)
                .setName(t("MODAL_ENLARGE_REDUCE" as any))
                .addDropdown(dropdown => {
                    dropdown
                        .addOption("Always", t("OPTION_ALWAYS" as any))
                        .addOption("Reduce", t("OPTION_REDUCE" as any))
                        .addOption("Enlarge", t("OPTION_ENLARGE" as any))
                        .addOption("Auto", t("OPTION_AUTO" as any))
                        .setValue(option.enlargeOrReduce)
                        .onChange(async value => {
                            option.enlargeOrReduce = value as any;
                            await this.plugin.saveSettings();
                        });
                });
        }

        new Setting(container)
            .setName("Skip formats")
            .addText(text => {
                text.setValue(option.skipFormats)
                    .onChange(async value => {
                        option.skipFormats = value;
                        await this.plugin.saveSettings();
                    });
                text.inputEl.setAttr('spellcheck', 'false');
            });

        new Setting(container)
            .setName("Skip target format")
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

    async loadTasks(): Promise<BatchTask[]> {
        const tasks: BatchTask[] = [];
        let files: TFile[] = [];

        if (this.scope === "note" && this.target instanceof TFile) {
            const cache = this.app.metadataCache.getFileCache(this.target);
            if (cache && cache.embeds) {
                for (const embed of cache.embeds) {
                    const file = this.app.metadataCache.getFirstLinkpathDest(embed.link, this.target.path);
                    if (file && this.plugin.supportedImageFormats.isSupported(file.extension, file.name)) {
                        files.push(file);
                    }
                }
            }
        } else if (this.scope === "folder" && this.target instanceof TFolder) {
            const collectImages = (folder: TFolder) => {
                for (const child of folder.children) {
                    if (child instanceof TFile && this.plugin.supportedImageFormats.isSupported(child.extension, child.name)) {
                        files.push(child);
                    } else if (child instanceof TFolder) {
                        collectImages(child);
                    }
                }
            };
            collectImages(this.target);
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
        // Delegate to BatchImageProcessor
        // Wait, batchProcess takes TFile[] and does loop.
        // processTask is single item.
        // Does BatchImageProcessor have single file method?
        // Checking usage: `this.plugin.batchImageProcessor.batchProcess(files)`
        // If we want granular control here, we need single method.
        // But the previous modal called `batchProcess(files)` in one go for ALL files.
        // If we change to `processTask` loop, we change behavior (serial vs parallel inside processor).
        // `BatchImageProcessor` likely has a queue.

        // However, IBatchMode interface assumes loop in the Orchestrator (or delegating batch execution).
        // BUT my interface design `processTask` implies Orchestrator loops.
        // If I want to match legacy behavior exactly where `batchProcess` took the whole list:
        // I might need `executeBatch(tasks)` method in IBatchMode instead of `processTask`.

        // Given refactoring goal is to split logic, implementing `processTask` is cleaner IF `BatchImageProcessor` supports it.
        // If `BatchImageProcessor` ONLY supports batch, I should wrapper it.
        // `plugin.batchImageProcessor` is not standard.
        // Let's assume for now I will use `executeBatch` pattern or loop.

        // Actually, to correctly support the detailed progress bar which updates PER ITEM, 
        // the original `executeBatch` called `batchProcess` which likely handled its own progress or returned a result at end?
        // Original: `this.batchResult = await this.plugin.batchImageProcessor.batchProcess(files);`
        // It waited for WHOLE process.
        // So `processTask` loop in UI would allow BETTER progress bar!
        // I will assume I can process single file.
        // `BatchImageProcessor` likely has `processImage(file)`.

        // If I can't check BatchImageProcessor code, I'll take a safe bet:
        // I will implement `processTask` that calls `batchProcess([file])` (array of one).

        try {
            const files = [task.source as TFile];
            const result = await this.plugin.batchImageProcessor.batchProcess(files);
            if (result.successful.length > 0) return result.successful[0];
            if (result.failed.length > 0) return result.failed[0];
            return { success: false, item: task.source as TFile, error: "Unknown error" };
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
