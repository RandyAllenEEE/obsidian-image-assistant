import { App, Setting, TFile, TFolder } from "obsidian";
import ImageConverterPlugin from "../../../../main";
import { BatchTask, BatchItemResult, BatchResult, BatchScope, BatchTaskDiscoveryResult } from "../../../../types/BatchTypes";
import { IBatchMode, ReviewAction } from "./IBatchMode";
import { t } from "../../../../lang/helpers";
import { ImageFileCollector } from "../../../../utils/batch/ImageFileCollector";
import { getContextualReferenceLinks } from "../../../../utils/MarkdownSourceContext";

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
                    .setValue(option.quality * 100)
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

    async loadTasks(): Promise<BatchTaskDiscoveryResult> {
        const tasks: BatchTask[] = [];
        let files: TFile[] = [];
        const collector = new ImageFileCollector(this.app, this.plugin);
        const failedFiles: string[] = [];
        const uncertainFiles: string[] = [];

        try {
        if (this.scope === "note" && this.isFileLike(this.target)) {
            if (this.target.extension === "canvas") {
                const imagePaths = await collector.getImagesFromCanvas(this.target);
                files = imagePaths
                    .map(path => this.app.vault.getAbstractFileByPath(path))
                    .filter((file): file is TFile =>
                        this.isFileLike(file) &&
                        this.plugin.supportedImageFormats.isSupported(file.extension, file.name)
                    );
            } else {
                const cache = this.app.metadataCache.getFileCache(this.target);
                if (cache) {
                    for (const link of [...(cache.embeds ?? []), ...(cache.links ?? [])]) {
                        const file = this.app.metadataCache.getFirstLinkpathDest(link.link, this.target.path);
                        if (this.isFileLike(file) && this.plugin.supportedImageFormats.isSupported(file.extension, file.name)) {
                            files.push(file);
                        }
                    }
                }

                const content = await this.app.vault.read(this.target);
                for (const link of getContextualReferenceLinks(content, {
                    includeFencedCode: this.plugin.settings.global.codeBlockImageLinkIndexing
                })) {
                    const file = this.app.metadataCache.getFirstLinkpathDest(link.path, this.target.path);
                    if (this.isFileLike(file) && this.plugin.supportedImageFormats.isSupported(file.extension, file.name)) {
                        files.push(file);
                    }
                }
            }
        } else if (this.scope === "folder" && this.isFolderLike(this.target)) {
            files = collector.getImageFilesInFolder(this.target, true);
        } else if (this.scope === "vault") {
            files = this.app.vault.getFiles().filter(f => this.plugin.supportedImageFormats.isSupported(f.extension, f.name));
        }
        } catch (error) {
            const targetPath = this.isFileLike(this.target) || this.isFolderLike(this.target)
                ? this.target.path
                : this.scope;
            failedFiles.push(`${targetPath}: ${error instanceof Error ? error.message : String(error)}`);
            uncertainFiles.push(targetPath);
        }

        files = this.filterProcessableFiles([...new Set(files)], collector);

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
        return { tasks, complete: failedFiles.length === 0 && uncertainFiles.length === 0, failedFiles, uncertainFiles };
    }

    private filterProcessableFiles(files: TFile[], collector: ImageFileCollector): TFile[] {
        const {
            convertTo,
            skipFormats: batchSkipFormats,
            skipImagesInTargetFormat
        } = this.plugin.settings.operationDefaults.batchLocal;
        const isKeepOriginalFormat = convertTo === 'disabled' || convertTo === 'Original';
        const skipFormats = collector.parseSkipFormats(batchSkipFormats);

        return files.filter(file =>
            collector.shouldProcessImage(
                file,
                isKeepOriginalFormat,
                convertTo,
                skipFormats,
                skipImagesInTargetFormat
            )
        );
    }

    async processTask(task: BatchTask): Promise<BatchItemResult> {
        try {
            const file = task.source as TFile;
            if (typeof this.plugin.batchImageProcessor.processFile === "function") {
                return await this.plugin.batchImageProcessor.processFile(file);
            }
            const result = await this.plugin.batchImageProcessor.batchProcess([file]);
            return result.successful[0] ?? result.skipped[0] ?? result.failed[0]
                ?? { status: "failed", success: false, item: file, error: t("MSG_UNKNOWN_ERROR") };
        } catch (e) {
            return {
                status: "failed",
                success: false,
                item: task.source as TFile,
                error: e instanceof Error ? e.message : String(e)
            };
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
