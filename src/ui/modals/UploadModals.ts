import { App, Modal, Notice, Setting, TFile } from "obsidian";
import { basename } from "path-browserify";

// 引用匹配结果接口
export interface ImageMatchResult {
    totalCount: number;
    files: Array<{
        path: string;
        matches: Array<{
            lineNumber: number;
            line: string;
            original: string;
        }>;
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

        contentEl.createEl("h2", { text: "上传失败" });

        contentEl.createEl("p", { text: `图片: ${this.imageName}` });
        contentEl.createEl("p", {
            text: `错误: ${this.errorMessage}`,
            cls: "upload-error-message"
        });

        new Setting(contentEl)
            .addButton(btn => btn
                .setButtonText("重试")
                .setCta()
                .onClick(() => {
                    this.close();
                    this.onChoice('retry');
                })
            )
            .addButton(btn => btn
                .setButtonText("取消")
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

        contentEl.createEl("h2", { text: "图片已上传" });

        const content = contentEl.createDiv();
        content.createEl("p", { text: `图片: ${this.imageName}` });
        content.createEl("p", {
            text: `云端链接: ${this.cloudUrl}`,
            cls: "upload-cloud-url-text"
        });
        content.createEl("p", {
            text: "⚠️ 未在任何笔记中找到此图片的引用",
            cls: "upload-warning-text"
        });

        new Setting(content)
            .addButton(btn => btn
                .setButtonText("仅保留云端")
                .setTooltip("删除本地文件,保留云端备份")
                .onClick(() => {
                    this.close();
                    this.onChoice('keep-cloud');
                })
            )
            .addButton(btn => btn
                .setButtonText("删除云端和本地")
                .setWarning()
                .setTooltip("撤销上传,删除所有文件")
                .onClick(() => {
                    this.close();
                    this.onChoice('delete-all');
                })
            )
            .addButton(btn => btn
                .setButtonText("全部保留")
                .setTooltip("保留云端和本地文件")
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

        contentEl.createEl("h2", { text: "图片已上传" });

        const content = contentEl.createDiv();
        content.createEl("p", { text: `图片: ${this.imageName}` });
        content.createEl("p", {
            text: `云端链接: ${this.cloudUrl}`,
            cls: "upload-cloud-url-text"
        });
        content.createEl("p", {
            text: `📍 引用于: ${basename(this.referenceInfo.file)} (第${this.referenceInfo.line}行)`,
            cls: "upload-reference-info"
        });

        const buttonContainer = content.createDiv({ cls: "upload-button-container" });

        new Setting(buttonContainer)
            .addButton(btn => btn
                .setButtonText("替换引用")
                .setCta()
                .setTooltip("将引用替换为云端链接")
                .onClick(() => {
                    this.close();
                    this.onChoice('replace');
                })
            )
            .addButton(btn => btn
                .setButtonText("替换并删除本地")
                .setTooltip("替换引用并删除本地文件")
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-delete');
                })
            );

        new Setting(buttonContainer)
            .addButton(btn => btn
                .setButtonText("取消")
                .setTooltip("保留上传,不替换引用")
                .onClick(() => {
                    this.close();
                    this.onChoice('cancel');
                })
            )
            .addButton(btn => btn
                .setButtonText("撤销上传")
                .setWarning()
                .setTooltip("删除云端图片")
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

        contentEl.createEl("h2", { text: "图片被多次引用" });

        const content = contentEl.createDiv();
        content.createEl("p", { text: `图片: ${this.imageName}` });
        content.createEl("p", {
            text: `云端链接: ${this.cloudUrl}`,
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
                text: `📊 引用统计:`,
                cls: "upload-stats-title"
            });
            statsDiv.createEl("p", {
                text: `- 当前笔记 (${basename(this.currentNotePath)}): ${currentCount} 次`,
                cls: "upload-current-note-stat"
            });
            statsDiv.createEl("p", {
                text: `- 其他笔记: ${otherCount} 次,涉及 ${otherFilesCount} 个文件`,
                cls: "upload-other-notes-stat"
            });
        } else {
            statsDiv.createEl("p", {
                text: `📊 引用统计: ${this.matches.totalCount} 次,涉及 ${this.matches.files.length} 个文件`,
                cls: "upload-stats-title"
            });
        }

        // 详细列表
        const detailsDiv = content.createDiv({ cls: "upload-reference-details" });
        detailsDiv.createEl("p", {
            text: "详细列表:",
            cls: "upload-details-title"
        });

        const listEl = detailsDiv.createEl("ul");
        this.matches.files.slice(0, 10).forEach(file => {
            const itemEl = listEl.createEl("li");
            const isCurrent = file.path === this.currentNotePath;
            itemEl.setText(`${isCurrent ? '✓ ' : '  '}${basename(file.path)}: ${file.matches.length} 次`);
            if (isCurrent) {
                itemEl.addClass("upload-current-note-item");
            }
        });

        if (this.matches.files.length > 10) {
            listEl.createEl("li", {
                text: `... 还有 ${this.matches.files.length - 10} 个文件`,
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
                .setButtonText(`仅替换当前笔记 (${currentCount}次)`)
                .setTooltip("只替换当前笔记中的引用")
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-current');
                })
            );
        }

        buttonSetting
            .addButton(btn => btn
                .setButtonText(`替换所有引用 (共${this.matches.totalCount}次)`)
                .setCta()
                .setTooltip("替换所有笔记中的引用")
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-all');
                })
            );

        new Setting(buttonContainer)
            .addButton(btn => btn
                .setButtonText("替换所有并删除本地")
                .setTooltip("替换所有引用并删除本地文件")
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-all-delete');
                })
            )
            .addButton(btn => btn
                .setButtonText("取消")
                .setTooltip("保留上传,不替换引用")
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

        contentEl.createEl("h2", { text: "批量上传确认" });

        const content = contentEl.createDiv();
        content.createEl("p", { 
            text: `✓ 已成功上传 ${this.totalImages} 张图片`,
            cls: "upload-success-text"
        });

        if (this.multiReferenceImages.length > 0) {
            // 有多引用图片,显示警告
            const warningDiv = content.createDiv({ cls: "upload-warning-box" });
            warningDiv.createEl("p", {
                text: `⚠️ 发现 ${this.multiReferenceImages.length} 张图片在其他笔记中也被引用`,
                cls: "upload-warning-text"
            });

            // 详细列表
            const detailsDiv = content.createDiv({ cls: "upload-reference-details" });
            detailsDiv.createEl("p", {
                text: "详细信息:",
                cls: "upload-details-title"
            });

            const listEl = detailsDiv.createEl("ul");
            this.multiReferenceImages.slice(0, 10).forEach(info => {
                const itemEl = listEl.createEl("li");
                itemEl.setText(
                    `${info.imageName}: 当前笔记 ${info.currentNoteReferences} 次, 其他笔记 ${info.otherNotesReferences} 次`
                );
            });

            if (this.multiReferenceImages.length > 10) {
                listEl.createEl("li", {
                    text: `... 还有 ${this.multiReferenceImages.length - 10} 张图片`,
                    cls: "upload-more-files"
                });
            }

            // 说明文字
            content.createEl("p", {
                text: "请选择如何处理:",
                cls: "upload-info-text"
            });
        } else {
            // 无多引用图片
            content.createEl("p", {
                text: "所有图片仅在当前笔记中被引用",
                cls: "upload-info-text"
            });
        }

        // 按钮
        const buttonContainer = content.createDiv({ cls: "upload-button-container" });
        const buttonSetting = new Setting(buttonContainer);

        if (this.multiReferenceImages.length > 0) {
            // 有多引用图片,提供三个选项
            buttonSetting.addButton(btn => btn
                .setButtonText("仅替换当前笔记")
                .setTooltip("只替换当前笔记中的图片链接,其他笔记保持不变")
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-current');
                })
            );
        }

        buttonSetting
            .addButton(btn => btn
                .setButtonText("替换所有引用")
                .setCta()
                .setTooltip("替换所有笔记中的图片链接")
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-all');
                })
            );

        new Setting(buttonContainer)
            .addButton(btn => btn
                .setButtonText("替换所有并删除本地")
                .setTooltip("替换所有引用并删除本地图片文件")
                .onClick(() => {
                    this.close();
                    this.onChoice('replace-all-delete');
                })
            )
            .addButton(btn => btn
                .setButtonText("取消")
                .setTooltip("取消替换操作,仅保留上传结果")
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

        contentEl.createEl("h2", { text: "批量下载预览" });

        const content = contentEl.createDiv();
        
        // 统计信息
        content.createEl("p", {
            text: `📊 找到 ${this.tasks.length} 张网络图片`,
            cls: "download-stats-text"
        });

        // 多引用警告
        if (this.multiReferenceTasks.length > 0) {
            const warningBox = content.createDiv({ cls: "download-multi-reference-warning" });
            warningBox.createEl("p", {
                text: `⚠️ 警告: ${this.multiReferenceTasks.length} 张图片在其他笔记中也被引用`,
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
                    text: `... 还有 ${this.multiReferenceTasks.length - 5} 张图片`,
                    cls: "upload-more-files"
                });
            }
        }

        // 下载位置
        content.createEl("p", {
            text: `📁 下载位置: ${this.downloadPath}`,
            cls: "download-path-text"
        });

        // 预估大小
        const totalSize = this.tasks.reduce((sum, task) => sum + (task.estimatedSize || 0), 0);
        if (totalSize > 0) {
            const sizeText = totalSize > 1024 * 1024 
                ? `${(totalSize / (1024 * 1024)).toFixed(2)} MB`
                : `${(totalSize / 1024).toFixed(2)} KB`;
            content.createEl("p", {
                text: `💾 预计占用: ~${sizeText}`,
                cls: "download-size-text"
            });
        }

        // 图片列表
        const listContainer = content.createDiv({ cls: "download-preview-list" });
        listContainer.createEl("p", {
            text: "图片列表:",
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
                text: `... 还有 ${this.tasks.length - 10} 张图片`,
                cls: "upload-more-files"
            });
        }

        // 全选/取消全选按钮
        new Setting(content)
            .setName("选择操作")
            .addButton(btn => btn
                .setButtonText("全选")
                .onClick(() => {
                    this.tasks.forEach(task => task.selected = true);
                    // 更新复选框状态
                    const checkboxes = content.querySelectorAll<HTMLInputElement>(".download-image-checkbox");
                    checkboxes.forEach(cb => cb.checked = true);
                })
            )
            .addButton(btn => btn
                .setButtonText("取消全选")
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
                .setButtonText("仅替换当前笔记")
                .setTooltip("只更新当前笔记中的图片链接,其他笔记保持不变")
                .onClick(() => {
                    this.close();
                    const selectedTasks = this.tasks.filter(t => t.selected);
                    this.onChoice({ action: 'current', selectedTasks });
                })
            );
        }

        buttonSetting.addButton(btn => btn
            .setButtonText("替换所有引用")
            .setCta()
            .setTooltip("更新所有笔记中的图片链接")
            .onClick(() => {
                this.close();
                const selectedTasks = this.tasks.filter(t => t.selected);
                this.onChoice({ action: 'all', selectedTasks });
            })
        );

        new Setting(buttonContainer)
            .addButton(btn => btn
                .setButtonText("取消")
                .setTooltip("取消下载操作")
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

        contentEl.createEl("h2", { text: "正在下载图片" });

        const content = contentEl.createDiv();

        // 进度文本
        this.statusText = content.createEl("p", {
            text: `进度: 0/${this.totalCount} (0%)`,
            cls: "download-progress-text"
        });

        // 进度条
        const progressContainer = content.createDiv({ cls: "download-progress-bar" });
        this.progressBar = progressContainer.createDiv({ cls: "download-progress-fill" });
        this.progressBar.style.width = "0%";

        // 当前下载图片
        this.currentImageText = content.createEl("p", {
            text: "准备下载...",
            cls: "download-current-image-text"
        });

        // 统计信息
        content.createEl("p", {
            text: "已成功: 0 张\n失败: 0 张",
            cls: "download-stats-detail"
        });

        // 取消按钮
        new Setting(content)
            .addButton(btn => btn
                .setButtonText("取消下载")
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
        this.statusText.setText(`进度: ${current}/${this.totalCount} (${percentage}%)`);
        this.progressBar.style.width = `${percentage}%`;
        this.currentImageText.setText(`正在下载: ${currentImageName}`);

        // 更新统计
        const statsEl = this.contentEl.querySelector(".download-stats-detail");
        if (statsEl) {
            statsEl.setText(`已成功: ${success} 张\n失败: ${failed} 张`);
        }
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
