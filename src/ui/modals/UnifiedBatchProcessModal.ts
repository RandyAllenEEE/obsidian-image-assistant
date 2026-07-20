import { App, Modal, TFile, TFolder, ButtonComponent, Notice } from "obsidian";
import ImageConverterPlugin from "../../main";
import { BatchMode, BatchResult, BatchScope, BatchTask, BatchTaskDiscoveryResult } from "../../types/BatchTypes";
import { t } from "../../lang/helpers";

import { IBatchMode } from "./batch/modes/IBatchMode";
import { LocalProcessMode } from "./batch/modes/LocalProcessMode";
import { UploadMode } from "./batch/modes/UploadMode";
import { DownloadMode } from "./batch/modes/DownloadMode";
import { TaskRenderer } from "./batch/ui/TaskRenderer";
import { ReviewRenderer } from "./batch/ui/ReviewRenderer";
import { runCancellableBatch } from "../../utils/CancellableBatchRunner";

export class UnifiedBatchProcessModal extends Modal {
    private plugin: ImageConverterPlugin;
    private batchScope: BatchScope;
    private target: TFile | TFolder | null;

    private currentMode: IBatchMode;
    private modeMap: Map<BatchMode, IBatchMode>;

    // UI Elements
    private contentContainer: HTMLElement;
    private sidebarContainer: HTMLElement;
    private settingsContainer: HTMLElement;
    private taskListContainer: HTMLElement;

    // State
    private tasks: BatchTask[] = [];
    private discovery: BatchTaskDiscoveryResult = {
        tasks: [],
        complete: true,
        failedFiles: [],
        uncertainFiles: []
    };
    private batchResult: BatchResult | null = null;
    private state: 'loading' | 'ready' | 'preparing' | 'running' | 'review' | 'closed' = 'loading';
    private loadVersion = 0;
    private executionVersion = 0;
    private cancelRequested = false;
    private startButton: ButtonComponent;

    // Renderers
    private taskRenderer: TaskRenderer;
    private reviewRenderer: ReviewRenderer;

    private isClosed(): boolean {
        return this.state === 'closed';
    }

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
        this.executionVersion++;
        this.state = 'loading';
        this.cancelRequested = false;
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("image-converter-batch-modal");

        this.renderHeader(contentEl);

        // Main Grid Layout
        const grid = contentEl.createDiv("batch-modal-grid");

        // Sidebar (Mode + Settings)
        const sidebar = grid.createDiv("batch-sidebar");
        this.sidebarContainer = sidebar;
        this.renderModeSelector(sidebar);
        this.settingsContainer = sidebar.createDiv("batch-settings-container");
        this.currentMode.renderSettings(this.settingsContainer);

        // Main Content (Tasks / Progress / Review)
        this.contentContainer = grid.createDiv("batch-main-content");
        this.taskListContainer = this.contentContainer.createDiv("batch-task-list");

        // Action Footer
        this.renderActionButtons(contentEl);

        // Initial Load
        void this.loadTasks();
    }

    onClose() {
        if (this.batchResult) {
            this.batchResult.successful.forEach(result => this.currentMode.disposeItemResult?.(result));
            this.batchResult = null;
        }
        this.executionVersion++;
        this.state = 'closed';
        this.cancelRequested = true;
        this.loadVersion++;
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
                        const switched = await this.switchMode(m.id);
                        if (!switched) return;
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

    private async switchMode(modeId: BatchMode): Promise<boolean> {
        if (this.state === 'preparing'
            || this.state === 'running'
            || this.state === 'review'
            || this.state === 'closed') return false;
        const newMode = this.modeMap.get(modeId);
        if (!newMode) return false;

        this.currentMode = newMode;

        // Refresh Settings
        this.settingsContainer.empty();
        this.currentMode.renderSettings(this.settingsContainer);

        // Refresh Tasks
        await this.loadTasks();
        return !this.isClosed() && this.currentMode === newMode && this.state === 'ready';
    }

    private async loadTasks() {
        const version = ++this.loadVersion;
        const mode = this.currentMode;
        this.state = 'loading';
        this.startButton?.setDisabled(true);
        this.taskListContainer.show();
        this.taskListContainer.empty();
        this.taskListContainer.createDiv({ text: t("LOADING"), cls: "loading-spinner" }); // Simple loading text

        try {
            const loaded = await mode.loadTasks();
            const discovery: BatchTaskDiscoveryResult = Array.isArray(loaded)
                ? { tasks: loaded, complete: true, failedFiles: [], uncertainFiles: [] }
                : loaded;
            if (this.isClosed() || version !== this.loadVersion || mode !== this.currentMode) return;

            this.discovery = discovery;
            this.tasks = discovery.tasks;
            this.taskListContainer.empty();
            this.taskRenderer.render(this.taskListContainer, this.tasks, discovery);
            this.state = 'ready';
            this.startButton?.setDisabled(false);
        } catch (error) {
            if (this.isClosed() || version !== this.loadVersion) return;
            const message = error instanceof Error ? error.message : String(error);
            console.error(`[Image Assistant] Failed to load ${mode.id} batch tasks:`, error);
            this.tasks = [];
            this.taskListContainer.empty();
            this.taskListContainer.createDiv({ text: message, cls: 'batch-empty' });
            this.state = 'ready';
            this.startButton?.setDisabled(false);
        }
    }

    private renderActionButtons(container: HTMLElement) {
        const footer = container.createDiv("batch-modal-footer");
        new ButtonComponent(footer)
            .setButtonText(t("MODAL_BUTTON_CANCEL"))
            .onClick(() => this.close());

        this.startButton = new ButtonComponent(footer)
            .setButtonText(t("BATCH_START_PROCESS"))
            .setCta()
            .setDisabled(true)
            .onClick(() => this.executeBatch());
    }

    private async executeBatch() {
        if (this.state !== 'ready') return;
        const selectedTasks = this.tasks.filter(t => t.selected);
        if (selectedTasks.length === 0) {
            new Notice(t("MSG_NO_ITEMS_SELECTED"));
            return;
        }

        const mode = this.currentMode;
        const preparationVersion = this.executionVersion;
        this.state = 'preparing';
        this.startButton.setDisabled(true);
        this.setSidebarDisabled(true);
        try {
            if (mode.prepareExecution
                && !await mode.prepareExecution(selectedTasks)) {
                if (this.executionVersion === preparationVersion
                    && !this.isClosed()
                    && this.currentMode === mode) {
                    this.state = 'ready';
                    this.startButton.setDisabled(false);
                    this.setSidebarDisabled(false);
                }
                return;
            }
        } catch (error) {
            if (this.executionVersion === preparationVersion
                && !this.isClosed()
                && this.currentMode === mode) {
                const message = error instanceof Error
                    ? error.message
                    : String(error);
                console.error(
                    `[Image Assistant] Failed to prepare ${mode.id} batch execution:`,
                    error
                );
                this.state = 'ready';
                this.startButton.setDisabled(false);
                this.setSidebarDisabled(false);
                new Notice(t("MSG_BATCH_ERROR", [message]));
            }
            return;
        }
        if (this.executionVersion !== preparationVersion
            || this.isClosed()
            || this.currentMode !== mode) {
            return;
        }

        const executionVersion = ++this.executionVersion;
        const isCurrentExecution = () =>
            this.executionVersion === executionVersion && !this.isClosed();
        this.state = 'running';
        this.cancelRequested = false;
        this.startButton.setDisabled(true);
        this.setSidebarDisabled(true);
        // Transition: Hide Task List, Show Progress
        this.taskListContainer.hide();

        const progressContainer = this.contentContainer.createDiv("batch-progress-container");
        progressContainer.createEl("h3", { text: t("BATCH_PROCESSING_TITLE") });
        const progressBar = progressContainer.createDiv("batch-progress-bar");
        const progressFill = progressBar.createDiv("batch-progress-fill");
        progressFill.style.width = "0%";
        const progressLog = progressContainer.createDiv("batch-summary-log");

        const appendLog = (msg: string) => {
            if (this.isClosed()) return;
            const line = progressLog.createDiv({ text: msg, cls: 'log-line' });
            line.scrollIntoView?.({ block: "end", behavior: "smooth" });
        };

        const result: BatchResult = {
            successful: [],
            failed: [],
            skipped: [],
            cancelled: false,
            discovery: {
                complete: this.discovery.complete,
                failedFiles: [...this.discovery.failedFiles],
                uncertainFiles: [...this.discovery.uncertainFiles]
            }
        };

        try {
            let processed = 0;
            const total = selectedTasks.length;
            const entries = await runCancellableBatch(
                selectedTasks,
                task => mode.processTask(task),
                {
                    concurrency: this.plugin.settings.global.batchConcurrency,
                    isCancelled: () => this.cancelRequested || !isCurrentExecution(),
                    onStart: task => {
                        if (!isCurrentExecution()) return;
                        task.status = "processing";
                        appendLog(t("BATCH_LOG_PROCESSING_ITEM", [task.name]));
                    },
                    onSettled: entry => {
                        if (!isCurrentExecution()) return;
                        processed++;
                        progressFill.style.width = `${(processed / total) * 100}%`;
                        if (entry.status === "rejected") {
                            const message = entry.error instanceof Error ? entry.error.message : String(entry.error);
                            entry.item.status = "error";
                            appendLog(t("BATCH_LOG_FAILED_ITEM", [entry.item.name, message]));
                            return;
                        }

                        const itemResult = entry.value!;
                        if (itemResult.status === "success") {
                            entry.item.status = "success";
                            appendLog(t("BATCH_LOG_SUCCESS_ITEM", [entry.item.name]));
                        } else if (itemResult.status === "skipped") {
                            entry.item.status = "skipped";
                            appendLog(itemResult.error || entry.item.name);
                        } else {
                            entry.item.status = "error";
                            appendLog(t("BATCH_LOG_FAILED_ITEM", [entry.item.name, itemResult.error || ""]));
                        }
                    }
                }
            );

            if (!isCurrentExecution()) {
                entries.forEach(entry => {
                    if (entry.status === "fulfilled" && entry.value) {
                        mode.disposeItemResult?.(entry.value);
                    }
                });
                return;
            }
            for (const entry of entries) {
                if (entry.status === "rejected") {
                    result.failed.push({
                        status: "failed",
                        success: false,
                        item: entry.item.source as TFile | string,
                        error: entry.error instanceof Error ? entry.error.message : String(entry.error)
                    });
                } else if (entry.value?.status === "success") {
                    result.successful.push(entry.value);
                } else if (entry.value?.status === "skipped") {
                    result.skipped.push(entry.value);
                } else if (entry.value) {
                    result.failed.push(entry.value);
                }
            }
            result.cancelled = entries.length < selectedTasks.length || this.cancelRequested;

            appendLog(t("BATCH_LOG_COMPLETE"));
            this.batchResult = result;
            if (this.isClosed()) return;
            this.state = 'review';

            // Transition to Review
            progressContainer.remove(); // Or hide? Remove to clear view

            this.reviewRenderer.render(
                this.contentContainer,
                this.batchResult,
                mode.getReviewActions(),
                async actionId => {
                    if (!isCurrentExecution() || this.state !== 'review') return;
                    const completed = await mode.handleReviewAction(actionId, this.batchResult!);
                    if (!isCurrentExecution() || this.state !== 'review') return;
                    if (completed === false) return;
                    if (["done", "undo", "replace_delete", "replace_delete_cloud", "replace_only"].includes(actionId)) {
                        this.close();
                    }
                }
            );

        } catch (e) {
            if (!isCurrentExecution()) return;
            const message = e instanceof Error ? e.message : String(e);
            appendLog(t("BATCH_LOG_CRITICAL_ERROR", [message]));
            new Notice(t("MSG_BATCH_ERROR", [message]));
            this.state = 'ready';
            this.startButton.setDisabled(false);
            this.setSidebarDisabled(false);
        }
    }

    private setSidebarDisabled(disabled: boolean): void {
        if (!this.sidebarContainer) return;
        this.sidebarContainer
            .querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
                "button, input, select, textarea"
            )
            .forEach(control => {
                control.disabled = disabled;
            });
    }
}
