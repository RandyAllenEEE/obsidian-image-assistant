import { App, Modal, Setting, Notice, TFile, ButtonComponent, setIcon } from "obsidian";
import ImageConverterPlugin from '../main';
import { t } from '../lang/helpers';
import { UnusedFileCleaner, CleanupResult, FileReferenceInfo, ReferenceLocation } from "./UnusedFileCleaner";

/**
 * 无用文件清理面板
 * 提供文件夹选择、进度显示、结果摘要和删除确认功能
 */
export class UnusedFileCleanerModal extends Modal {
    private plugin: ImageConverterPlugin;
    private cleaner: UnusedFileCleaner;

    // UI 元素
    private folderInputEl: HTMLInputElement | null = null;
    private statusEl: HTMLDivElement | null = null;
    private progressEl: HTMLDivElement | null = null;
    private resultEl: HTMLDivElement | null = null;
    private actionButtonsEl: HTMLDivElement | null = null;

    // 扫描结果
    private cleanupResult: CleanupResult | null = null;
    private isScanning: boolean = false;

    constructor(app: App, plugin: ImageConverterPlugin) {
        super(app);
        this.plugin = plugin;
        this.cleaner = new UnusedFileCleaner(app, plugin);
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("unused-file-cleaner-modal");

        // 标题
        contentEl.createEl("h2", { text: t("CLEANER_MODAL_TITLE") });

        // 说明文字
        const descEl = contentEl.createDiv({ cls: "cleaner-description" });
        descEl.createEl("p", {
            text: t("CLEANER_DESC_1")
        });
        descEl.createEl("p", {
            text: t("CLEANER_DESC_2"),
            cls: "warning-text"
        });

        // 文件夹选择区域
        this.renderFolderSelection(contentEl);

        // 状态显示区域
        this.statusEl = contentEl.createDiv({ cls: "cleaner-status" });

        // 进度显示区域
        this.progressEl = contentEl.createDiv({ cls: "cleaner-progress" });
        this.progressEl.hide();

        // 结果显示区域
        this.resultEl = contentEl.createDiv({ cls: "cleaner-result" });
        this.resultEl.hide();

        // 操作按钮区域
        this.actionButtonsEl = contentEl.createDiv({ cls: "cleaner-actions" });
        this.actionButtonsEl.hide();
    }

    /**
     * 渲染文件夹选择区域
     */
    private renderFolderSelection(containerEl: HTMLElement) {
        const selectionContainer = containerEl.createDiv({ cls: "folder-selection" });

        new Setting(selectionContainer)
            .setName(t("CLEANER_SETTING_FOLDER_NAME"))
            .setDesc(t("CLEANER_SETTING_FOLDER_DESC"))
            .addText(text => {
                this.folderInputEl = text.inputEl;
                text
                    .setPlaceholder(t("CLEANER_SETTING_FOLDER_PLACEHOLDER"))
                    .setValue(this.plugin.settings.cleanerSettings.basePath)
                    .inputEl.style.width = "100%";
            });

        // 开始扫描按钮
        const buttonContainer = selectionContainer.createDiv({ cls: "button-container" });
        const scanButton = new ButtonComponent(buttonContainer)
            .setButtonText(t("CLEANER_BTN_START_SCAN"))
            .setCta()
            .onClick(() => this.startScan());
    }

    /**
     * 开始扫描
     */
    private async startScan() {
        if (this.isScanning) {
            new Notice(t("CLEANER_MSG_SCANNING"));
            return;
        }

        const folderPath = this.folderInputEl?.value.trim() || this.plugin.settings.cleanerSettings.basePath;
        if (!folderPath) {
            new Notice(t("CLEANER_MSG_ENTER_PATH"));
            return;
        }

        // 解析文件类型
        const fileTypes = UnusedFileCleaner.parseFileTypes(
            this.plugin.settings.cleanerSettings.fileTypes
        );

        if (fileTypes.length === 0) {
            new Notice(t("CLEANER_MSG_CONFIG_TYPE"));
            return;
        }

        // 重置界面
        this.isScanning = true;
        this.cleanupResult = null;
        this.resultEl?.hide();
        this.actionButtonsEl?.hide();
        this.progressEl?.show();

        if (this.statusEl) {
            this.statusEl.empty();
            this.statusEl.createEl("p", {
                text: t("CLEANER_STATUS_SCANNING").replace("{0}", folderPath),
                cls: "status-info"
            });
        }

        try {
            // 执行扫描
            this.cleanupResult = await this.cleaner.scanFolder(
                folderPath,
                fileTypes,
                (current, total, currentFile) => {
                    this.updateProgress(current, total, currentFile);
                }
            );

            // 显示结果
            this.showResults();
        } catch (error) {
            console.error("Scan error:", error);
            new Notice(t("CLEANER_SCAN_ERROR").replace("{0}", error.message));

            if (this.statusEl) {
                this.statusEl.empty();
                this.statusEl.createEl("p", {
                    text: t("CLEANER_SCAN_ERROR").replace("{0}", error.message),
                    cls: "status-error"
                });
            }
        } finally {
            this.isScanning = false;
            this.progressEl?.hide();
        }
    }

    /**
     * 更新进度显示
     */
    private updateProgress(current: number, total: number, currentFile: string) {
        if (!this.progressEl) return;

        this.progressEl.empty();

        const progressInfo = this.progressEl.createDiv({ cls: "progress-info" });
        progressInfo.createEl("p", { text: t("CLEANER_PROGRESS_CHECKING").replace("{0}", currentFile) });
        progressInfo.createEl("p", { text: t("CLEANER_PROGRESS_RATIO").replace("{0}", current.toString()).replace("{1}", total.toString()) });

        // 进度条
        const progressBarContainer = this.progressEl.createDiv({ cls: "progress-bar-container" });
        const progressBar = progressBarContainer.createDiv({ cls: "progress-bar" });
        const percentage = (current / total) * 100;
        progressBar.style.width = `${percentage}%`;
    }

    /**
     * 显示扫描结果
     */
    private showResults() {
        if (!this.cleanupResult || !this.resultEl) return;

        this.resultEl.empty();
        this.resultEl.show();

        const { scannedFiles, unreferencedFiles, referencedFiles } = this.cleanupResult;

        // 汇总信息
        const summaryEl = this.resultEl.createDiv({ cls: "result-summary" });
        summaryEl.createEl("h3", { text: t("CLEANER_RESULT_TITLE") });
        summaryEl.createEl("p", { text: t("CLEANER_RESULT_SCANNED").replace("{0}", scannedFiles.toString()) });
        summaryEl.createEl("p", {
            text: t("CLEANER_RESULT_UNREF").replace("{0}", unreferencedFiles.length.toString()),
            cls: "unreferenced-count"
        });
        summaryEl.createEl("p", {
            text: t("CLEANER_RESULT_REF").replace("{0}", referencedFiles.length.toString()),
            cls: "referenced-count"
        });

        // 未引用文件列表
        if (unreferencedFiles.length > 0) {
            this.renderFileList(
                this.resultEl,
                t("CLEANER_LIST_TITLE_UNREF"),
                unreferencedFiles,
                "unreferenced-files"
            );

            // 显示删除按钮
            this.showDeleteActions();
        } else {
            this.resultEl.createEl("p", {
                text: t("CLEANER_MSG_NO_UNUSED"),
                cls: "success-message"
            });
        }

        // 已引用文件列表（可折叠）
        if (referencedFiles.length > 0) {
            this.renderFileList(
                this.resultEl,
                t("CLEANER_LIST_TITLE_REF"),
                referencedFiles,
                "referenced-files",
                true
            );
        }

        // 更新状态
        if (this.statusEl) {
            this.statusEl.empty();
            this.statusEl.createEl("p", {
                text: t("CLEANER_STATUS_COMPLETE"),
                cls: "status-success"
            });
        }
    }

    /**
     * 渲染文件列表
     */
    private renderFileList(
        containerEl: HTMLElement,
        title: string,
        fileList: FileReferenceInfo[],
        className: string,
        collapsible: boolean = false
    ) {
        const listContainer = containerEl.createDiv({ cls: `file-list ${className}` });

        const headerEl = listContainer.createDiv({ cls: "file-list-header" });
        headerEl.createEl("h3", { text: title });

        if (collapsible) {
            const toggleButton = headerEl.createEl("button", {
                text: t("CLEANER_BTN_EXPAND"),
                cls: "toggle-button"
            });

            const contentEl = listContainer.createDiv({ cls: "file-list-content" });
            contentEl.hide();

            toggleButton.addEventListener("click", () => {
                const isHidden = contentEl.style.display === "none";
                if (isHidden) {
                    contentEl.show();
                } else {
                    contentEl.hide();
                }
                toggleButton.setText(isHidden ? t("CLEANER_BTN_COLLAPSE") : t("CLEANER_BTN_EXPAND"));
            });

            this.renderFileItems(contentEl, fileList);
        } else {
            const contentEl = listContainer.createDiv({ cls: "file-list-content" });
            this.renderFileItems(contentEl, fileList);
        }
    }

    /**
     * 渲染文件项
     */
    private renderFileItems(containerEl: HTMLElement, fileList: FileReferenceInfo[]) {
        for (const fileInfo of fileList) {
            const itemEl = containerEl.createDiv({ cls: "file-item" });

            // 文件信息
            const fileInfoEl = itemEl.createDiv({ cls: "file-info" });
            fileInfoEl.createEl("strong", { text: fileInfo.file.name });
            fileInfoEl.createEl("br");
            fileInfoEl.createEl("span", {
                text: fileInfo.file.path,
                cls: "file-path"
            });

            // 引用信息 - 按笔记分组显示
            if (fileInfo.references.length > 0) {
                const refsEl = itemEl.createDiv({ cls: "file-references" });

                // 按笔记路径分组引用
                const groupedRefs = this.groupReferencesByNote(fileInfo.references);
                const noteCount = Object.keys(groupedRefs).length;
                const totalRefCount = fileInfo.references.length;

                refsEl.createEl("p", {
                    text: t("CLEANER_REF_INFO").replace("{0}", noteCount.toString()).replace("{1}", totalRefCount.toString()),
                    cls: "references-title"
                });

                const refList = refsEl.createEl("ul", { cls: "references-list" });

                // 按笔记显示引用
                for (const [notePath, refs] of Object.entries(groupedRefs)) {
                    const noteItem = refList.createEl("li", { cls: "note-item" });

                    // 笔记名称和引用次数
                    const noteHeader = noteItem.createDiv({ cls: "note-header" });
                    noteHeader.createEl("strong", {
                        text: `📄 ${notePath}`,
                        cls: "note-path"
                    });
                    noteHeader.createEl("span", {
                        text: ` (${refs.length} 处引用)`,
                        cls: "ref-count"
                    });

                    // 该笔记中的所有引用位置
                    const locList = noteItem.createEl("ul", { cls: "ref-locations-list" });
                    for (const ref of refs) {
                        const locItem = locList.createEl("li", { cls: "ref-location-item" });
                        locItem.createEl("span", {
                            text: `行 ${ref.lineNumber}: `,
                            cls: "line-number"
                        });
                        locItem.createEl("code", {
                            text: ref.lineContent,
                            cls: "ref-content"
                        });
                    }
                }
            }
        }
    }

    /**
     * 按笔记路径分组引用
     */
    private groupReferencesByNote(references: ReferenceLocation[]): Record<string, ReferenceLocation[]> {
        const grouped: Record<string, ReferenceLocation[]> = {};

        for (const ref of references) {
            if (!grouped[ref.notePath]) {
                grouped[ref.notePath] = [];
            }
            grouped[ref.notePath].push(ref);
        }

        return grouped;
    }

    /**
     * 显示删除操作按钮
     */
    private showDeleteActions() {
        if (!this.actionButtonsEl || !this.cleanupResult) return;

        this.actionButtonsEl.empty();
        this.actionButtonsEl.show();

        const unreferencedCount = this.cleanupResult.unreferencedFiles.length;

        const warningEl = this.actionButtonsEl.createDiv({ cls: "delete-warning" });
        warningEl.createEl("p", {
            text: t("CLEANER_WARNING_DELETE").replace("{0}", unreferencedCount.toString()),
            cls: "warning-text"
        });

        const trashMode = this.plugin.settings.cleanerSettings.trashMode;
        let modeText = "";
        if (trashMode === "system") {
            modeText = t("CLEANER_DELETE_MODE_SYSTEM");
        } else if (trashMode === "obsidian") {
            modeText = t("CLEANER_DELETE_MODE_OBSIDIAN");
        } else if (trashMode === "custom") {
            modeText = t("CLEANER_DELETE_MODE_CUSTOM").replace("{0}", this.plugin.settings.cleanerSettings.customTrashPath);
        }

        warningEl.createEl("p", { text: t("CLEANER_DELETE_MODE_LABEL").replace("{0}", modeText) });

        const buttonContainer = this.actionButtonsEl.createDiv({ cls: "button-container" });

        // 确认删除按钮
        new ButtonComponent(buttonContainer)
            .setButtonText(t("CLEANER_BTN_CONFIRM_DELETE"))
            .setWarning()
            .onClick(() => this.confirmDelete());

        // 取消按钮
        new ButtonComponent(buttonContainer)
            .setButtonText(t("CLEANER_BTN_CANCEL"))
            .onClick(() => {
                this.actionButtonsEl?.hide();
            });
    }

    /**
     * 确认删除
     */
    private async confirmDelete() {
        if (!this.cleanupResult) return;

        const filesToDelete = this.cleanupResult.unreferencedFiles.map(info => info.file);
        const trashMode = this.plugin.settings.cleanerSettings.trashMode;
        const customTrashPath = this.plugin.settings.cleanerSettings.customTrashPath;

        // 显示进度
        if (this.statusEl) {
            this.statusEl.empty();
            this.statusEl.createEl("p", {
                text: t("CLEANER_MSG_DELETING"),
                cls: "status-info"
            });
        }

        try {
            const successCount = await this.cleaner.deleteFiles(
                filesToDelete,
                trashMode,
                customTrashPath
            );

            new Notice(t("CLEANER_MSG_DELETE_SUCCESS").replace("{0}", successCount.toString()));

            // 更新状态
            if (this.statusEl) {
                this.statusEl.empty();
                this.statusEl.createEl("p", {
                    text: t("CLEANER_STATUS_DELETE_SUCCESS").replace("{0}", successCount.toString()),
                    cls: "status-success"
                });
            }

            // 隐藏操作按钮和结果
            this.actionButtonsEl?.hide();
            this.resultEl?.hide();

            // 建议重新扫描
            if (this.statusEl) {
                this.statusEl.createEl("p", {
                    text: t("CLEANER_STATUS_HINT"),
                    cls: "status-hint"
                });
            }
        } catch (error) {
            console.error("Delete error:", error);
            new Notice(t("CLEANER_DELETE_ERROR").replace("{0}", error.message));

            if (this.statusEl) {
                this.statusEl.empty();
                this.statusEl.createEl("p", {
                    text: t("CLEANER_STATUS_DELETE_ERROR").replace("{0}", error.message),
                    cls: "status-error"
                });
            }
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
