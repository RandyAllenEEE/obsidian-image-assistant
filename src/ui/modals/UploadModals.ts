import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { t } from "../../lang/helpers";
import { basename } from "path-browserify";

// 引用匹配结果接口
// 引用匹配结果接口
export interface ImageMatch {
    lineNumber: number;
    line: string;
    original: string;
}

export interface ImageMatchResult {
    totalCount: number;
    files: Array<{
        path: string;
        matches: Array<ImageMatch>;
    }>;
}

// 文件匹配信息接口 (用于下载功能)
export interface FileMatchInfo {
    file: TFile;
    count: number;
    content: string;
}

// 上传错误对话框
export class UploadErrorDialog extends Modal {
    private imageName: string;
    private errorMessage: string;
    private onChoice: (choice: 'retry' | 'cancel') => void;

    constructor(
        app: App,
        imageName: string,
        errorMessage: string,
        onChoice: (choice: 'retry' | 'cancel') => void
    ) {
        super(app);
        this.imageName = imageName;
        this.errorMessage = errorMessage;
        this.onChoice = onChoice;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl("h2", { text: t("MODAL_UPLOAD_FAILED_TITLE") });

        contentEl.createEl("p", { text: t("MODAL_IMAGE") + this.imageName });
        contentEl.createEl("p", {
            text: t("MODAL_ERROR") + this.errorMessage,
            cls: "upload-error-message"
        });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText(t("MODAL_BUTTON_RETRY"))
                .setCta()
                .onClick(() => {
                    this.close();
                    this.onChoice('retry');
                })
            )
            .addButton(btn => btn
                .setButtonText(t("MODAL_BUTTON_CANCEL"))
                .onClick(() => {
                    this.close();
                    this.onChoice('cancel');
                })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// 未引用对话框
export class NoReferenceUploadDialog extends Modal {
    private imageName: string;
    private cloudUrl: string;
    private localFile: TFile;
    private onChoice: (choice: 'keep-cloud' | 'delete-all' | 'keep-all') => void;

    constructor(
        app: App,
        imageName: string,
        cloudUrl: string,
        localFile: TFile,
        onChoice: (choice: 'keep-cloud' | 'delete-all' | 'keep-all') => void
    ) {
        super(app);
        this.imageName = imageName;
        this.cloudUrl = cloudUrl;
        this.localFile = localFile;
        this.onChoice = onChoice;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl("h2", { text: t("MODAL_UPLOAD_SUCCESS_TITLE") });

        const content = contentEl.createDiv();
        content.createEl("p", { text: t("MODAL_IMAGE") + this.imageName });
        content.createEl("p", {
            text: t("MODAL_CLOUD_URL") + this.cloudUrl,
            cls: "upload-cloud-url-text"
        });
        content.createEl("p", {
            text: t("MODAL_NO_REF_WARNING"),
            cls: "upload-warning-text"
        });

        new Setting(content)
            .addButton(btn => btn
                .setButtonText(t("MODAL_KEEP_CLOUD"))
                .setTooltip(t("TOOLTIP_KEEP_CLOUD"))
                .onClick(() => {
                    this.close();
                    this.onChoice('keep-cloud');
                })
            )
            .addButton(btn => btn
                .setButtonText(t("MODAL_DELETE_ALL"))
                .setWarning()
                .setTooltip(t("TOOLTIP_DELETE_ALL"))
                .onClick(() => {
                    this.close();
                    this.onChoice('delete-all');
                })
            )
            .addButton(btn => btn
                .setButtonText(t("MODAL_KEEP_ALL"))
                .setTooltip(t("TOOLTIP_KEEP_ALL"))
                .onClick(() => {
                    this.close();
                    this.onChoice('keep-all');
                })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// 单次引用对话框
export class SingleReferenceUploadDialog extends Modal {
    private imageName: string;
    private cloudUrl: string;
    private referenceInfo: { file: string; line: number };
    private onChoice: (choice: 'replace' | 'replace-delete' | 'cancel' | 'undo') => void;

    constructor(
        app: App,
        imageName: string,
        cloudUrl: string,
        referenceInfo: { file: string; line: number },
        onChoice: (choice: 'replace' | 'replace-delete' | 'cancel' | 'undo') => void
    ) {
        super(app);
        this.imageName = imageName;
        this.cloudUrl = cloudUrl;
        this.referenceInfo = referenceInfo;
        this.onChoice = onChoice;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl("h2", { text: t("MODAL_UPLOAD_SUCCESS_TITLE") });

        const content = contentEl.createDiv();
        content.createEl("p", { text: t("MODAL_IMAGE") + this.imageName });
        content.createEl("p", {
            text: t("MODAL_CLOUD_URL") + this.cloudUrl,
            cls: "upload-cloud-url-text"
        });
        content.createEl("p", {
            text: t("MODAL_REF_LOCATION").replace("{0}", basename(this.referenceInfo.file)).replace("{1}", this.referenceInfo.line.toString()),
            cls: "upload-reference-info"
        });

        const buttonContainer = content.createDiv({ cls: "upload-button-container" });

        new Setting(buttonContainer)
            .addButton(btn => btn
                .setButtonText(t("MODAL_REPLACE_REF"))
                .setCta()
                .setTooltip(t("TOOLTIP_REPLACE_REF"))
                .onClick(() => {
                    this.close();
                    this.onChoice('replace');
                })
            )
            .addButton(btn => btn
                .setButtonText(t("MODAL_REPLACE_DELETE"))
                .setTooltip(t("TOOLTIP_REPLACE_DELETE"))
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-delete');
                })
            );

        new Setting(buttonContainer)
            .addButton(btn => btn
                .setButtonText(t("MODAL_BUTTON_CANCEL"))
                .setTooltip(t("TOOLTIP_CANCEL_REPLACE"))
                .onClick(() => {
                    this.close();
                    this.onChoice('cancel');
                })
            )
            .addButton(btn => btn
                .setButtonText(t("MODAL_UNDO_UPLOAD"))
                .setWarning()
                .setTooltip(t("TOOLTIP_UNDO_UPLOAD_CLOUD"))
                .onClick(() => {
                    this.close();
                    this.onChoice('undo');
                })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// 多次引用对话框
export class MultiReferenceUploadDialog extends Modal {
    private imageName: string;
    private cloudUrl: string;
    private matches: ImageMatchResult;
    private currentNotePath?: string;
    private onChoice: (choice: 'replace-current' | 'replace-all' | 'replace-all-delete' | 'cancel') => void;

    constructor(
        app: App,
        imageName: string,
        cloudUrl: string,
        matches: ImageMatchResult,
        currentNotePath: string | undefined,
        onChoice: (choice: 'replace-current' | 'replace-all' | 'replace-all-delete' | 'cancel') => void
    ) {
        super(app);
        this.imageName = imageName;
        this.cloudUrl = cloudUrl;
        this.matches = matches;
        this.currentNotePath = currentNotePath;
        this.onChoice = onChoice;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl("h2", { text: t("MODAL_MULTI_REF_TITLE") });

        const content = contentEl.createDiv();
        content.createEl("p", { text: t("MODAL_IMAGE") + this.imageName });
        content.createEl("p", {
            text: t("MODAL_CLOUD_URL") + this.cloudUrl,
            cls: "upload-cloud-url-text"
        });

        // 统计信息
        const statsDiv = content.createDiv({ cls: "upload-reference-stats" });

        if (this.currentNotePath) {
            const currentMatches = this.matches.files.find(f => f.path === this.currentNotePath);
            const currentCount = currentMatches?.matches.length || 0;
            const otherCount = this.matches.totalCount - currentCount;
            const otherFilesCount = this.matches.files.filter(f => f.path !== this.currentNotePath).length;

            statsDiv.createEl("p", {
                text: t("MODAL_REF_STATS"),
                cls: "upload-stats-title"
            });
            statsDiv.createEl("p", {
                text: t("MSG_REF_COUNT_CURRENT").replace("{0}", basename(this.currentNotePath)).replace("{1}", currentCount.toString()),
                cls: "upload-current-note-stat"
            });
            statsDiv.createEl("p", {
                text: t("MSG_REF_COUNT_OTHER").replace("{0}", otherCount.toString()).replace("{1}", otherFilesCount.toString()),
                cls: "upload-other-notes-stat"
            });
        } else {
            statsDiv.createEl("p", {
                text: t("MSG_STATS_TOTAL").replace("{0}", this.matches.totalCount.toString()).replace("{1}", this.matches.files.length.toString()),
                cls: "upload-stats-title"
            });
        }

        // 详细列表
        const detailsDiv = content.createDiv({ cls: "upload-reference-details" });
        detailsDiv.createEl("p", {
            text: t("MODAL_DETAILS_LIST"),
            cls: "upload-details-title"
        });

        const listEl = detailsDiv.createEl("ul");
        this.matches.files.slice(0, 10).forEach(file => {
            const itemEl = listEl.createEl("li");
            const isCurrent = file.path === this.currentNotePath;
            itemEl.setText(`${isCurrent ? '✓ ' : '  '}${t("MSG_FILE_REFS").replace("{0}", basename(file.path)).replace("{1}", file.matches.length.toString())}`);
            if (isCurrent) {
                itemEl.addClass("upload-current-note-item");
            }
        });

        if (this.matches.files.length > 10) {
            listEl.createEl("li", {
                text: t("MSG_MORE_FILES").replace("{0}", (this.matches.files.length - 10).toString()),
                cls: "upload-more-files"
            });
        }

        // 按钮
        const buttonContainer = content.createDiv({ cls: "upload-button-container" });
        const buttonSetting = new Setting(buttonContainer);

        if (this.currentNotePath) {
            const currentMatches = this.matches.files.find(f => f.path === this.currentNotePath);
            const currentCount = currentMatches?.matches.length || 0;

            buttonSetting.addButton(btn => btn
                .setButtonText(t("MODAL_REPLACE_CURRENT_EXT").replace("{0}", currentCount.toString()))
                .setTooltip(t("TOOLTIP_REPLACE_CURRENT"))
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-current');
                })
            );
        }

        buttonSetting
            .addButton(btn => btn
                .setButtonText(t("MODAL_REPLACE_ALL_EXT").replace("{0}", this.matches.totalCount.toString()))
                .setCta()
                .setTooltip(t("TOOLTIP_REPLACE_ALL"))
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-all');
                })
            );

        new Setting(buttonContainer)
            .addButton(btn => btn
                .setButtonText(t("MODAL_REPLACE_ALL_DELETE"))
                .setTooltip(t("TOOLTIP_REPLACE_ALL_DELETE"))
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-all-delete');
                })
            )
            .addButton(btn => btn
                .setButtonText(t("MODAL_BUTTON_CANCEL"))
                .setTooltip(t("TOOLTIP_CANCEL_REPLACE"))
                .onClick(() => {
                    this.close();
                    this.onChoice('cancel');
                })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// 批量上传任务信息接口
export interface BatchUploadTaskInfo {
    imageName: string;
    vaultReferences: number; // Vault中的总引用次数
    currentNoteReferences: number; // 当前笔记中的引用次数
    otherNotesReferences: number; // 其他笔记中的引用次数
    hasMultipleReferences: boolean; // 是否有多次引用
}

// 批量上传确认对话框
export class BatchUploadConfirmDialog extends Modal {
    private totalImages: number;
    private multiReferenceImages: BatchUploadTaskInfo[];
    private currentNotePath: string;
    private onChoice: (choice: 'replace-current' | 'replace-all' | 'replace-all-delete' | 'cancel') => void;

    constructor(
        app: App,
        totalImages: number,
        multiReferenceImages: BatchUploadTaskInfo[],
        currentNotePath: string,
        onChoice: (choice: 'replace-current' | 'replace-all' | 'replace-all-delete' | 'cancel') => void
    ) {
        super(app);
        this.totalImages = totalImages;
        this.multiReferenceImages = multiReferenceImages;
        this.currentNotePath = currentNotePath;
        this.onChoice = onChoice;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl("h2", { text: t("MODAL_BATCH_UPLOAD_TITLE") });

        const content = contentEl.createDiv();
        content.createEl("p", {
            text: t("MODAL_UPLOAD_SUCCESS_COUNT").replace("{0}", this.totalImages.toString()),
            cls: "upload-success-text"
        });

        if (this.multiReferenceImages.length > 0) {
            // 有多引用图片,显示警告
            const warningDiv = content.createDiv({ cls: "upload-warning-box" });
            warningDiv.createEl("p", {
                text: t("MODAL_MULTI_REF_WARNING").replace("{0}", this.multiReferenceImages.length.toString()),
                cls: "upload-warning-text"
            });

            // 详细列表
            const detailsDiv = content.createDiv({ cls: "upload-reference-details" });
            detailsDiv.createEl("p", {
                text: t("MODAL_DETAILS_LIST"),
                cls: "upload-details-title"
            });

            const listEl = detailsDiv.createEl("ul");
            this.multiReferenceImages.slice(0, 10).forEach(info => {
                const itemEl = listEl.createEl("li");
                itemEl.setText(
                    t("MSG_BATCH_REF_INFO").replace("{0}", info.imageName).replace("{1}", info.currentNoteReferences.toString()).replace("{2}", info.otherNotesReferences.toString())
                );
            });

            if (this.multiReferenceImages.length > 10) {
                listEl.createEl("li", {
                    text: t("MSG_MORE_IMAGES").replace("{0}", (this.multiReferenceImages.length - 10).toString()),
                    cls: "upload-more-files"
                });
            }

            // 说明文字
            content.createEl("p", {
                text: t("MODAL_SELECT_ACTION"),
                cls: "upload-info-text"
            });
        } else {
            // 无多引用图片
            content.createEl("p", {
                text: t("MODAL_ALL_REF_CURRENT"),
                cls: "upload-info-text"
            });
        }

        // 按钮
        const buttonContainer = content.createDiv({ cls: "upload-button-container" });
        const buttonSetting = new Setting(buttonContainer);

        if (this.multiReferenceImages.length > 0) {
            // 有多引用图片,提供三个选项
            buttonSetting.addButton(btn => btn
                .setButtonText(t("MODAL_REPLACE_CURRENT"))
                .setTooltip(t("TOOLTIP_REPLACE_CURRENT_MULTI"))
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-current');
                })
            );
        }

        buttonSetting
            .addButton(btn => btn
                .setButtonText(t("MODAL_REPLACE_ALL"))
                .setCta()
                .setTooltip(t("TOOLTIP_REPLACE_ALL_MULTI"))
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-all');
                })
            );

        new Setting(buttonContainer)
            .addButton(btn => btn
                .setButtonText(t("MODAL_REPLACE_ALL_DELETE"))
                .setTooltip(t("TOOLTIP_REPLACE_ALL_DELETE_MULTI"))
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-all-delete');
                })
            )
            .addButton(btn => btn
                .setButtonText(t("MODAL_BUTTON_CANCEL"))
                .setTooltip(t("TOOLTIP_CANCEL_REPLACE_BATCH"))
                .onClick(() => {
                    this.close();
                    this.onChoice('cancel');
                })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// ========================================
// 批量下载相关接口和对话框
// ========================================

// 下载任务信息接口
export interface DownloadTaskInfo {
    url: string;                    // 图片URL
    originalSource: string;         // 原始markdown文本
    name: string;                   // 清理后的文件名
    vaultReferences: number;        // Vault中的总引用次数
    currentNoteReferences: number;  // 当前笔记中的引用次数
    otherNotesReferences: number;   // 其他笔记中的引用次数
    estimatedSize?: number;         // 预估文件大小(字节)
    selected: boolean;              // 是否选中下载
}

// 批量下载预览对话框
export class BatchDownloadPreviewDialog extends Modal {
    private tasks: DownloadTaskInfo[];
    private multiReferenceTasks: DownloadTaskInfo[];
    private downloadPath: string;
    private onChoice: (choice: { action: 'current' | 'all' | 'cancel', selectedTasks: DownloadTaskInfo[] }) => void;

    constructor(
        app: App,
        tasks: DownloadTaskInfo[],
        multiReferenceTasks: DownloadTaskInfo[],
        downloadPath: string,
        onChoice: (choice: { action: 'current' | 'all' | 'cancel', selectedTasks: DownloadTaskInfo[] }) => void
    ) {
        super(app);
        this.tasks = tasks;
        this.multiReferenceTasks = multiReferenceTasks;
        this.downloadPath = downloadPath;
        this.onChoice = onChoice;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl("h2", { text: t("MODAL_BATCH_DOWNLOAD_TITLE") });

        const content = contentEl.createDiv();

        // 统计信息
        content.createEl("p", {
            text: t("MODAL_FOUND_IMAGES").replace("{0}", this.tasks.length.toString()),
            cls: "download-stats-text"
        });

        // 多引用警告
        if (this.multiReferenceTasks.length > 0) {
            const warningBox = content.createDiv({ cls: "download-multi-reference-warning" });
            warningBox.createEl("p", {
                text: t("MODAL_MULTI_REF_WARNING").replace("{0}", this.multiReferenceTasks.length.toString()),
                cls: "upload-warning-text"
            });

            // 详细列表
            const detailsList = warningBox.createEl("ul", { cls: "download-warning-list" });
            this.multiReferenceTasks.slice(0, 5).forEach(task => {
                detailsList.createEl("li").setText(
                    `${task.name}: 当前笔记 ${task.currentNoteReferences} 次, 其他笔记 ${task.otherNotesReferences} 次`
                );
            });

            if (this.multiReferenceTasks.length > 5) {
                detailsList.createEl("li", {
                    text: t("MSG_MORE_IMAGES").replace("{0}", (this.multiReferenceTasks.length - 5).toString()),
                    cls: "upload-more-files"
                });
            }
        }

        // 下载位置
        content.createEl("p", {
            text: t("MODAL_DOWNLOAD_PATH") + this.downloadPath,
            cls: "download-path-text"
        });

        // 预估大小
        const totalSize = this.tasks.reduce((sum, task) => sum + (task.estimatedSize || 0), 0);
        if (totalSize > 0) {
            const sizeText = totalSize > 1024 * 1024
                ? `${(totalSize / (1024 * 1024)).toFixed(2)} MB`
                : `${(totalSize / 1024).toFixed(2)} KB`;
            content.createEl("p", {
                text: t("MODAL_ESTIMATED_SIZE") + sizeText,
                cls: "download-size-text"
            });
        }

        // 图片列表
        const listContainer = content.createDiv({ cls: "download-preview-list" });
        listContainer.createEl("p", {
            text: t("MODAL_IMAGE_LIST"),
            cls: "download-list-title"
        });

        const imageList = listContainer.createEl("div", { cls: "download-image-list" });
        this.tasks.slice(0, 10).forEach((task, index) => {
            const itemEl = imageList.createDiv({ cls: "download-image-item" });

            // 复选框
            const checkbox = itemEl.createEl("input", {
                type: "checkbox",
                cls: "download-image-checkbox"
            });
            checkbox.checked = task.selected;
            checkbox.addEventListener("change", () => {
                task.selected = checkbox.checked;
            });

            // 图片信息
            const infoEl = itemEl.createDiv({ cls: "download-image-info" });
            const urlText = task.url.length > 60 ? task.url.substring(0, 60) + "..." : task.url;
            infoEl.createEl("span", { text: urlText, cls: "download-image-url" });

            if (task.estimatedSize) {
                const sizeText = task.estimatedSize > 1024 * 1024
                    ? `${(task.estimatedSize / (1024 * 1024)).toFixed(2)} MB`
                    : `${(task.estimatedSize / 1024).toFixed(2)} KB`;
                infoEl.createEl("span", { text: ` (${sizeText})`, cls: "download-image-size" });
            }
        });

        if (this.tasks.length > 10) {
            imageList.createEl("p", {
                text: t("MSG_MORE_IMAGES").replace("{0}", (this.tasks.length - 10).toString()),
                cls: "upload-more-files"
            });
        }

        // 全选/取消全选按钮
        new Setting(content)
            .setName(t("MODAL_SELECT_OP"))
            .addButton(btn => btn
                .setButtonText(t("MODAL_BUTTON_SELECT_ALL"))
                .onClick(() => {
                    this.tasks.forEach(task => task.selected = true);
                    // 更新复选框状态
                    const checkboxes = content.querySelectorAll<HTMLInputElement>(".download-image-checkbox");
                    checkboxes.forEach(cb => cb.checked = true);
                })
            )
            .addButton(btn => btn
                .setButtonText(t("MODAL_BUTTON_DESELECT_ALL"))
                .onClick(() => {
                    this.tasks.forEach(task => task.selected = false);
                    // 更新复选框状态
                    const checkboxes = content.querySelectorAll<HTMLInputElement>(".download-image-checkbox");
                    checkboxes.forEach(cb => cb.checked = false);
                })
            );

        // 按钮
        const buttonContainer = content.createDiv({ cls: "upload-button-container" });
        const buttonSetting = new Setting(buttonContainer);

        if (this.multiReferenceTasks.length > 0) {
            // 有多引用图片,提供两个选项
            buttonSetting.addButton(btn => btn
                .setButtonText(t("MODAL_REPLACE_CURRENT"))
                .setTooltip(t("TOOLTIP_REPLACE_CURRENT_DOWNLOAD"))
                .onClick(() => {
                    this.close();
                    const selectedTasks = this.tasks.filter(t => t.selected);
                    this.onChoice({ action: 'current', selectedTasks });
                })
            );
        }

        buttonSetting.addButton(btn => btn
            .setButtonText(t("MODAL_REPLACE_ALL"))
            .setCta()
            .setTooltip(t("TOOLTIP_REPLACE_ALL_DOWNLOAD"))
            .onClick(() => {
                this.close();
                const selectedTasks = this.tasks.filter(t => t.selected);
                this.onChoice({ action: 'all', selectedTasks });
            })
        );

        new Setting(buttonContainer)
            .addButton(btn => btn
                .setButtonText(t("MODAL_BUTTON_CANCEL"))
                .setTooltip(t("TOOLTIP_CANCEL_DOWNLOAD"))
                .onClick(() => {
                    this.close();
                    this.onChoice({ action: 'cancel', selectedTasks: [] });
                })
            );
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

// 批量下载进度对话框
export class BatchDownloadProgressDialog extends Modal {
    private totalCount: number;
    private onCancel: () => void;
    private progressBar: HTMLElement | null = null;
    private statusText: HTMLElement | null = null;
    private currentImageText: HTMLElement | null = null;

    constructor(
        app: App,
        totalCount: number,
        onCancel: () => void
    ) {
        super(app);
        this.totalCount = totalCount;
        this.onCancel = onCancel;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.createEl("h2", { text: t("MODAL_DOWNLOADING_TITLE") });

        const content = contentEl.createDiv();

        // 进度文本
        this.statusText = content.createEl("p", {
            text: `${t("MODAL_PROGRESS")}: 0/${this.totalCount} (0%)`,
            cls: "download-progress-text"
        });

        // 进度条
        const progressContainer = content.createDiv({ cls: "download-progress-bar" });
        this.progressBar = progressContainer.createDiv({ cls: "download-progress-fill" });
        this.progressBar.style.width = "0%";

        // 当前下载图片
        this.currentImageText = content.createEl("p", {
            text: t("MODAL_PREPARING_DOWNLOAD"),
            cls: "download-current-image-text"
        });

        // 统计信息
        content.createEl("p", {
            text: `${t("MODAL_SUCCESS_COUNT")}: 0 \n${t("MODAL_FAIL_COUNT")}: 0`,
            cls: "download-stats-detail"
        });

        // 取消按钮
        new Setting(content)
            .addButton(btn => btn
                .setButtonText(t("MODAL_CANCEL_DOWNLOAD"))
                .setWarning()
                .onClick(() => {
                    this.onCancel();
                    this.close();
                })
            );
    }

    updateProgress(current: number, currentImageName: string, success: number, failed: number) {
        if (!this.statusText || !this.progressBar || !this.currentImageText) return;

        const percentage = Math.round((current / this.totalCount) * 100);
        this.statusText.setText(`${t("MODAL_PROGRESS")}: ${current}/${this.totalCount} (${percentage}%)`);
        this.progressBar.style.width = `${percentage}%`;
        this.currentImageText.setText(`${t("MODAL_DOWNLOADING_TITLE")}: ${currentImageName}`);

        // 更新统计
        const statsEl = this.contentEl.querySelector(".download-stats-detail");
        if (statsEl) {
            statsEl.setText(`${t("MODAL_SUCCESS_COUNT")}: ${success} \n${t("MODAL_FAIL_COUNT")}: ${failed}`);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
