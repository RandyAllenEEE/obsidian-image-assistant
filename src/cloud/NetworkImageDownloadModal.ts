import { App, Modal, Setting, Notice } from "obsidian";
import { t } from "../lang/helpers";

export type DownloadMode = "download-only" | "download-and-replace" | "replace-only";

export interface DownloadTask {
    url: string;
    originalSource: string;
    suggestedName: string;
    selected: boolean;
    localFileExists?: boolean;  // 用于"仅替换"模式
    localFilePath?: string;     // 用于"仅替换"模式
}

export interface DownloadChoice {
    mode: DownloadMode;
    selectedTasks: DownloadTask[];
}

export class NetworkImageDownloadModal extends Modal {
    private tasks: DownloadTask[];
    private onSubmit: (choice: DownloadChoice) => void;
    private selectedMode: DownloadMode = "download-and-replace";
    private selectAllCheckbox: HTMLInputElement | null = null;

    constructor(
        app: App,
        tasks: DownloadTask[],
        onSubmit: (choice: DownloadChoice) => void
    ) {
        super(app);
        this.tasks = tasks;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("network-image-download-modal");

        // 标题
        contentEl.createEl("h2", { text: t("NET_DL_MODAL_TITLE") });

        // 统计信息
        const statsDiv = contentEl.createDiv("download-stats");
        statsDiv.createEl("p", {
            text: t("NET_DL_STATS").replace("{0}", this.tasks.length.toString()),
            cls: "download-stats-text"
        });

        // 模式选择
        const modeSection = contentEl.createDiv("download-mode-section");
        modeSection.createEl("h3", { text: t("NET_DL_MODE_TITLE") });

        new Setting(modeSection)
            .setName(t("NET_DL_SETTING_MODE"))
            .setDesc(t("NET_DL_SETTING_MODE_DESC"))
            .addDropdown(dropdown => dropdown
                .addOption("download-and-replace", t("NET_DL_OPTION_DL_REPLACE"))
                .addOption("download-only", t("NET_DL_OPTION_DL_ONLY"))
                .addOption("replace-only", t("NET_DL_OPTION_REPLACE_ONLY"))
                .setValue(this.selectedMode)
                .onChange((value: DownloadMode) => {
                    this.selectedMode = value;
                    this.updateModeDescription();
                })
            );

        // 模式说明
        const modeDesc = contentEl.createDiv("download-mode-description");
        modeDesc.setAttribute("data-mode", this.selectedMode);
        this.updateModeDescription();

        // 图片列表
        const listSection = contentEl.createDiv("download-list-section");
        listSection.createEl("h3", { text: t("NET_DL_LIST_TITLE") });

        // 全选/取消全选
        const selectAllDiv = listSection.createDiv("download-select-all");
        this.selectAllCheckbox = selectAllDiv.createEl("input", {
            type: "checkbox",
            attr: { checked: true }
        });
        this.selectAllCheckbox.addEventListener("change", () => {
            const isChecked = this.selectAllCheckbox?.checked || false;
            this.tasks.forEach(task => task.selected = isChecked);
            this.updateTaskCheckboxes();
        });
        selectAllDiv.createEl("label", { text: t("NET_DL_SELECT_ALL") });

        // 任务列表
        const taskList = listSection.createDiv("download-task-list");
        this.renderTaskList(taskList);

        // 按钮组
        const buttonGroup = contentEl.createDiv("download-button-group");

        // 取消按钮
        const cancelBtn = buttonGroup.createEl("button", { text: t("NET_DL_BTN_CANCEL") });
        cancelBtn.addClass("mod-cancel");
        cancelBtn.addEventListener("click", () => {
            this.close();
        });

        // 确认按钮
        const confirmBtn = buttonGroup.createEl("button", { text: t("NET_DL_BTN_START") });
        confirmBtn.addClass("mod-cta");
        confirmBtn.addEventListener("click", () => {
            this.handleSubmit();
        });

        // 添加样式
        this.addStyles();
    }

    private renderTaskList(container: HTMLElement) {
        container.empty();

        this.tasks.forEach((task, index) => {
            const taskItem = container.createDiv("download-task-item");

            // 复选框
            const checkbox = taskItem.createEl("input", {
                type: "checkbox",
                attr: {
                    checked: task.selected,
                    "data-index": index.toString()
                }
            });
            checkbox.addEventListener("change", (e) => {
                const target = e.target as HTMLInputElement;
                task.selected = target.checked;
                this.updateSelectAllCheckbox();
            });

            // 任务信息
            const taskInfo = taskItem.createDiv("task-info");

            // 文件名
            const fileName = taskInfo.createDiv("task-filename");
            fileName.createEl("span", {
                text: task.suggestedName,
                cls: "task-name"
            });

            // URL（截断显示）
            const url = task.url.length > 60
                ? task.url.substring(0, 57) + "..."
                : task.url;
            const urlDiv = taskInfo.createDiv("task-url");
            urlDiv.createEl("span", { text: url, cls: "task-url-text" });

            // 如果是"仅替换"模式，显示本地文件状态
            if (this.selectedMode === "replace-only" && task.localFileExists !== undefined) {
                const statusDiv = taskItem.createDiv("task-status");
                if (task.localFileExists) {
                    statusDiv.createEl("span", {
                        text: t("NET_DL_STATUS_EXISTS"),
                        cls: "task-status-exists"
                    });
                } else {
                    statusDiv.createEl("span", {
                        text: t("NET_DL_STATUS_MISSING"),
                        cls: "task-status-missing"
                    });
                }
            }
        });
    }

    private updateTaskCheckboxes() {
        const checkboxes = this.contentEl.querySelectorAll<HTMLInputElement>('.download-task-item input[type="checkbox"]');
        checkboxes.forEach((checkbox, index) => {
            checkbox.checked = this.tasks[index].selected;
        });
    }

    private updateSelectAllCheckbox() {
        if (!this.selectAllCheckbox) return;

        const allSelected = this.tasks.every(task => task.selected);
        const noneSelected = this.tasks.every(task => !task.selected);

        this.selectAllCheckbox.checked = allSelected;
        this.selectAllCheckbox.indeterminate = !allSelected && !noneSelected;
    }

    private updateModeDescription() {
        const modeDesc = this.contentEl.querySelector(".download-mode-description");
        if (!modeDesc) return;

        modeDesc.empty();
        modeDesc.setAttribute("data-mode", this.selectedMode);

        let icon = "";
        let title = "";
        let description = "";

        switch (this.selectedMode) {
            case "download-and-replace":
                icon = "⬇️";
                title = t("NET_DL_DESC_DL_REPLACE_TITLE");
                description = t("NET_DL_DESC_DL_REPLACE_TEXT");
                break;
            case "download-only":
                icon = "📥";
                title = t("NET_DL_DESC_DL_ONLY_TITLE");
                description = t("NET_DL_DESC_DL_ONLY_TEXT");
                break;
            case "replace-only":
                icon = "🔄";
                title = t("NET_DL_DESC_REPLACE_ONLY_TITLE");
                description = t("NET_DL_DESC_REPLACE_ONLY_TEXT");
                break;
        }

        modeDesc.createEl("div", {
            text: `${icon} ${title}`,
            cls: "mode-desc-title"
        });
        modeDesc.createEl("p", {
            text: description,
            cls: "mode-desc-text"
        });
    }

    private handleSubmit() {
        const selectedTasks = this.tasks.filter(task => task.selected);

        if (selectedTasks.length === 0) {
            new Notice(t("NET_DL_MSG_SELECT_ONE"));
            return;
        }

        this.onSubmit({
            mode: this.selectedMode,
            selectedTasks: selectedTasks
        });

        this.close();
    }

    private addStyles() {
        const styleEl = document.createElement("style");
        styleEl.textContent = `
            .network-image-download-modal {
                padding: 20px;
                max-width: 600px;
            }

            .download-stats {
                margin-bottom: 20px;
                padding: 10px;
                background-color: var(--background-secondary);
                border-radius: 6px;
            }

            .download-stats-text {
                margin: 0;
                font-weight: 500;
            }

            .download-mode-section {
                margin-bottom: 20px;
            }

            .download-mode-section h3 {
                margin-bottom: 10px;
            }

            .download-mode-description {
                margin-top: 15px;
                padding: 15px;
                border-left: 3px solid var(--interactive-accent);
                background-color: var(--background-secondary);
                border-radius: 4px;
            }

            .mode-desc-title {
                font-weight: 600;
                font-size: 1.1em;
                margin-bottom: 8px;
                color: var(--text-accent);
            }

            .mode-desc-text {
                margin: 0;
                color: var(--text-muted);
                line-height: 1.5;
            }

            .download-list-section h3 {
                margin-bottom: 10px;
            }

            .download-select-all {
                margin-bottom: 10px;
                padding: 8px;
                background-color: var(--background-secondary);
                border-radius: 4px;
            }

            .download-select-all label {
                margin-left: 8px;
                cursor: pointer;
                user-select: none;
            }

            .download-task-list {
                max-height: 300px;
                overflow-y: auto;
                border: 1px solid var(--background-modifier-border);
                border-radius: 6px;
                padding: 10px;
            }

            .download-task-item {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                padding: 10px;
                margin-bottom: 8px;
                border-radius: 4px;
                background-color: var(--background-secondary);
            }

            .download-task-item:last-child {
                margin-bottom: 0;
            }

            .download-task-item input[type="checkbox"] {
                margin-top: 4px;
                flex-shrink: 0;
            }

            .task-info {
                flex: 1;
                min-width: 0;
            }

            .task-filename {
                font-weight: 500;
                margin-bottom: 4px;
            }

            .task-name {
                color: var(--text-normal);
            }

            .task-url {
                font-size: 0.9em;
            }

            .task-url-text {
                color: var(--text-muted);
                word-break: break-all;
            }

            .task-status {
                flex-shrink: 0;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 0.85em;
                font-weight: 500;
            }

            .task-status-exists {
                color: var(--text-success);
            }

            .task-status-missing {
                color: var(--text-error);
            }

            .download-button-group {
                display: flex;
                justify-content: flex-end;
                gap: 10px;
                margin-top: 20px;
                padding-top: 15px;
                border-top: 1px solid var(--background-modifier-border);
            }

            .download-button-group button {
                padding: 8px 20px;
                border-radius: 4px;
                cursor: pointer;
            }
        `;
        document.head.appendChild(styleEl);
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
