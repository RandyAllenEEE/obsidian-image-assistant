import { App, Modal, TFile, TFolder, ButtonComponent, Notice } from "obsidian";
import ImageConverterPlugin from "../../main";
import { BatchMode, BatchResult, BatchScope, BatchTask } from "../../types/BatchTypes";
import { t } from "../../lang/helpers";

import { IBatchMode } from "./batch/modes/IBatchMode";
import { LocalProcessMode } from "./batch/modes/LocalProcessMode";
import { UploadMode } from "./batch/modes/UploadMode";
import { DownloadMode } from "./batch/modes/DownloadMode";
import { TaskRenderer } from "./batch/ui/TaskRenderer";
import { ReviewRenderer } from "./batch/ui/ReviewRenderer";

export class UnifiedBatchProcessModal extends Modal {
    private plugin: ImageConverterPlugin;
    private batchScope: BatchScope;
    private target: TFile | TFolder | null;

    private currentMode: IBatchMode;
    private modeMap: Map<BatchMode, IBatchMode>;

    // UI Elements
    private contentContainer: HTMLElement;
    private settingsContainer: HTMLElement;
    private taskListContainer: HTMLElement;

    // State
    private tasks: BatchTask[] = [];
    private batchResult: BatchResult | null = null;

    // Renderers
    private taskRenderer: TaskRenderer;
    private reviewRenderer: ReviewRenderer;

    constructor(app: App, plugin: ImageConverterPlugin, scope: BatchScope, target: TFile | TFolder | null, initialMode: BatchMode = "local_process") {
        super(app);
        this.plugin = plugin;
        this.batchScope = scope;
        this.target = target;

        // Initialize modes
        this.modeMap = new Map();
        this.modeMap.set("local_process", new LocalProcessMode(app, plugin, target, scope));
        this.modeMap.set("upload", new UploadMode(app, plugin, target, scope));
        this.modeMap.set("download", new DownloadMode(app, plugin, target, scope));

        this.currentMode = this.modeMap.get(initialMode) || this.modeMap.get("local_process")!;

        this.taskRenderer = new TaskRenderer();
        this.reviewRenderer = new ReviewRenderer();
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("image-converter-batch-modal");

        this.renderHeader(contentEl);

        // Main Grid Layout
        const grid = contentEl.createDiv("batch-modal-grid");

        // Sidebar (Mode + Settings)
        const sidebar = grid.createDiv("batch-sidebar");
        this.renderModeSelector(sidebar);
        this.settingsContainer = sidebar.createDiv("batch-settings-container");
        this.currentMode.renderSettings(this.settingsContainer);

        // Main Content (Tasks / Progress / Review)
        this.contentContainer = grid.createDiv("batch-main-content");
        this.taskListContainer = this.contentContainer.createDiv("batch-task-list");

        // Action Footer
        this.renderActionButtons(contentEl);

        // Initial Load
        this.loadTasks();
    }

    onClose() {
        this.contentEl.empty();
    }

    private renderHeader(container: HTMLElement) {
        const header = container.createDiv("batch-modal-header");
        header.createEl("h1", { text: t("BATCH_MODAL_TITLE") });

        let subtitle = "";
        if (this.batchScope === "note" && this.target instanceof TFile) {
            subtitle = t("BATCH_SCOPE_NOTE", [this.target.basename]);
        } else if (this.batchScope === "folder" && this.target instanceof TFolder) {
            subtitle = t("BATCH_SCOPE_FOLDER", [this.target.name]);
        } else if (this.batchScope === "vault") {
            subtitle = t("BATCH_SCOPE_VAULT");
        }
        header.createEl("div", { text: subtitle, cls: "batch-scope-indicator" });
    }

    private renderModeSelector(container: HTMLElement) {
        const modeContainer = container.createDiv("batch-mode-selector");
        const modes: { id: BatchMode, name: string }[] = [
            { id: "local_process", name: t("BATCH_MODE_LOCAL") },
            { id: "upload", name: t("BATCH_MODE_UPLOAD") },
            { id: "download", name: t("BATCH_MODE_DOWNLOAD") }
        ];

        /*
            // CSS fix needed: Ensure .batch-mode-selector button uses flex/grid
            container is .batch-sidebar
        */

        const buttons: ButtonComponent[] = [];
        modes.forEach(m => {
            const btn = new ButtonComponent(modeContainer)
                .setButtonText(m.name)
                .onClick(async () => {
                    if (this.currentMode.id !== m.id) {
                        this.switchMode(m.id);
                        // Update visual state
                        buttons.forEach(b => {
                            if (b.buttonEl.innerText === m.name) b.setCta();
                            else b.buttonEl.removeClass("mod-cta");
                        });
                    }
                });

            if (this.currentMode.id === m.id) btn.setCta();
            buttons.push(btn);
        });
    }

    private async switchMode(modeId: BatchMode) {
        const newMode = this.modeMap.get(modeId);
        if (!newMode) return;

        this.currentMode = newMode;

        // Refresh Settings
        this.settingsContainer.empty();
        this.currentMode.renderSettings(this.settingsContainer);

        // Refresh Tasks
        await this.loadTasks();
    }

    private async loadTasks() {
        this.taskListContainer.empty();
        this.taskListContainer.createDiv({ text: t("LOADING"), cls: "loading-spinner" }); // Simple loading text

        this.tasks = await this.currentMode.loadTasks();

        this.taskListContainer.empty();
        this.taskRenderer.render(this.taskListContainer, this.tasks);
    }

    private renderActionButtons(container: HTMLElement) {
        const footer = container.createDiv("batch-modal-footer");
        new ButtonComponent(footer)
            .setButtonText(t("MODAL_BUTTON_CANCEL"))
            .onClick(() => this.close());

        new ButtonComponent(footer)
            .setButtonText(t("BATCH_START_PROCESS"))
            .setCta()
            .onClick(() => this.executeBatch());
    }

    private async executeBatch() {
        const selectedTasks = this.tasks.filter(t => t.selected);
        if (selectedTasks.length === 0) {
            new Notice(t("MSG_NO_ITEMS_SELECTED"));
            return;
        }

        // Transition: Hide Task List, Show Progress
        this.taskListContainer.hide();

        const progressContainer = this.contentContainer.createDiv("batch-progress-container");
        progressContainer.createEl("h3", { text: t("BATCH_PROCESSING_TITLE") });
        const progressBar = progressContainer.createDiv("batch-progress-bar");
        const progressFill = progressBar.createDiv("batch-progress-fill");
        progressFill.style.width = "0%";
        const progressLog = progressContainer.createDiv("batch-summary-log");

        const appendLog = (msg: string) => {
            const line = progressLog.createDiv({ text: msg, cls: 'log-line' });
            line.scrollIntoView({ block: "end", behavior: "smooth" });
        };

        const result: BatchResult = {
            successful: [],
            failed: [],
            cancelled: false
        };

        try {
            let processed = 0;
            const total = selectedTasks.length;

            for (const task of selectedTasks) {
                appendLog(t("BATCH_LOG_PROCESSING_ITEM", [task.name]));

                const itemResult = await this.currentMode.processTask(task);

                if (itemResult.success) {
                    result.successful.push(itemResult);
                    appendLog(t("BATCH_LOG_SUCCESS_ITEM", [task.name]));
                } else {
                    result.failed.push(itemResult);
                    appendLog(t("BATCH_LOG_FAILED_ITEM", [task.name, itemResult.error || ""]));
                }

                processed++;
                progressFill.style.width = `${(processed / total) * 100}%`;
            }

            appendLog(t("BATCH_LOG_COMPLETE"));
            this.batchResult = result;

            // Transition to Review
            progressContainer.remove(); // Or hide? Remove to clear view

            this.reviewRenderer.render(
                this.contentContainer,
                this.batchResult,
                this.currentMode.getReviewActions(),
                (actionId) => this.currentMode.handleReviewAction(actionId, this.batchResult!)
                    .then(() => {
                        if (actionId === 'undo' || actionId === 'replace_delete' || actionId === 'replace_delete_cloud' || actionId === 'replace_only') {
                            this.close(); // Close after major actions usually
                        }
                    })
            );

        } catch (e) {
            appendLog(t("BATCH_LOG_CRITICAL_ERROR", [e.message]));
            new Notice(t("MSG_BATCH_ERROR", [e.message]));
        }
    }
}
