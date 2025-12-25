import { App, Modal, TFile, TFolder, Notice, ButtonComponent, Setting, setIcon } from "obsidian";
import type ImageConverterPlugin from "../../main";
import { BatchMode, BatchResult, BatchScope, BatchTask } from "../../types/BatchTypes";
import { t } from "../../lang/helpers";
import { BatchScopeManager } from "../../utils/BatchScopeManager";
import { CloudLinkFormatter } from "../../cloud/CloudLinkFormatter";
import { CloudImageDeleter } from "../../cloud/CloudImageDeleter";

export class UnifiedBatchProcessModal extends Modal {
    plugin: ImageConverterPlugin;
    batchScope: BatchScope;
    target: TFile | TFolder | null;
    mode: BatchMode;

    settingsContainer: HTMLElement;
    resizeInputsDiv: HTMLElement;
    enlargeReduceDiv: HTMLElement;
    listScrollContainer: HTMLElement;
    tasks: BatchTask[] = [];
    filteredTasks: BatchTask[] = [];
    scopeManager: BatchScopeManager;

    // UI Elements
    contentContainer: HTMLElement;
    taskListContainer: HTMLElement;
    summaryContainer: HTMLElement | null = null;
    progressBar: HTMLElement | null = null;

    constructor(app: App, plugin: ImageConverterPlugin, scope: BatchScope, target: TFile | TFolder | null, initialMode: BatchMode = "local_process") {
        super(app);
        this.plugin = plugin;
        this.batchScope = scope;
        this.target = target;
        this.mode = initialMode;
        this.scopeManager = new BatchScopeManager(app, plugin);
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("image-assistant-batch-modal");

        this.addEffectiveStyles();

        this.renderHeader(contentEl);
        this.renderModeSelector(contentEl);

        this.contentContainer = contentEl.createDiv("batch-content-container");

        // Settings Container (Dynamic based on mode)
        this.settingsContainer = contentEl.createDiv("batch-settings-container");

        this.taskListContainer = contentEl.createDiv("batch-task-list-container");

        this.renderActionButtons(contentEl);

        // Initial render
        await this.onModeChange();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }

    addEffectiveStyles() {
        this.contentEl.createEl("style", {
            text: `
                .image-assistant-batch-modal .batch-mode-selector {
                    display: flex;
                    justify-content: center;
                    margin-bottom: 20px;
                    gap: 10px;
                }
                .image-assistant-batch-modal .task-list {
                    max-height: 400px;
                    overflow-y: auto;
                    border: 1px solid var(--background-modifier-border);
                    border-radius: 4px;
                    padding: 10px;
                    margin-top: 10px;
                }
                .image-assistant-batch-modal .task-row {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 4px 0;
                    border-bottom: 1px solid var(--background-modifier-border);
                }
                .image-assistant-batch-modal .batch-actions {
                    margin-top: 20px;
                    display: flex;
                    justify-content: flex-end;
                    gap: 10px;
                }
                .image-assistant-batch-modal .batch-summary-log {
                     max-height: 200px;
                     overflow-y: auto;
                     background: var(--background-secondary);
                     padding: 10px;
                     margin-bottom: 15px;
                     font-family: monospace;
                     font-size: 0.8em;
                }
                .batch-settings-container {
                    margin-bottom: 20px;
                    border: 1px solid var(--background-modifier-border);
                    padding: 10px;
                    border-radius: 4px;
                }
            `
        });
    }
    renderHeader(container: HTMLElement) {
        let subtitle = "";
        const header = container.createDiv("batch-modal-header");
        header.createEl("h2", { text: t("BATCH_MODAL_TITLE") });

        if (this.batchScope === "note" && this.target instanceof TFile) {
            subtitle = t("BATCH_SCOPE_NOTE").replace("{0}", this.target.basename);
        } else if (this.batchScope === "folder" && this.target instanceof TFolder) {
            subtitle = t("BATCH_SCOPE_FOLDER").replace("{0}", this.target.name);
        } else if (this.batchScope === "vault") {
            subtitle = t("BATCH_SCOPE_VAULT");
        }
        header.createEl("div", { text: subtitle, cls: "batch-scope-indicator" });
    }

    renderModeSelector(container: HTMLElement) {
        const modeContainer = container.createDiv("batch-mode-selector");


        const modes: { id: BatchMode, name: string }[] = [
            { id: "local_process", name: t("BATCH_MODE_LOCAL") },
            { id: "upload", name: t("BATCH_MODE_UPLOAD") },
            { id: "download", name: t("BATCH_MODE_DOWNLOAD") }
        ];

        modes.forEach(m => {
            const btn = new ButtonComponent(modeContainer)
                .setButtonText(m.name)
                .onClick(async () => { // Made async
                    if (this.mode !== m.id) {
                        this.mode = m.id;
                        await this.onModeChange(); // Call onModeChange
                    }
                });

            if (this.mode === m.id) {
                btn.setCta();
            } else {
                btn.buttonEl.removeClass("mod-cta"); // Ensure non-selected buttons don't have cta
            }
        });
    }

    async onModeChange() {
        // 1. Update Mode Button Visuals
        const buttons = this.contentEl.querySelectorAll('.batch-mode-selector button');
        buttons.forEach((b, i) => {
            const modeId = ["local_process", "upload", "download"][i];
            if (this.mode === modeId) {
                b.addClass("mod-cta");
            } else {
                b.removeClass("mod-cta");
            }
        });

        // 2. Render Settings
        this.renderSettings();

        // 3. Load Tasks (Lazy Scan)
        await this.loadTasks();
    }

    renderSettings() {
        this.settingsContainer.empty();

        // Collapsible details for settings
        const details = this.settingsContainer.createEl("details");
        details.open = true; // Default open
        const summary = details.createEl("summary", { text: t("BATCH_SECONDARY_SETTINGS") });
        const content = details.createDiv("settings-content");

        if (this.mode === "local_process") {
            this.renderLocalProcessSettings(content);
        } else if (this.mode === "upload") {
            new Setting(content)
                .setName(t("BATCH_UPLOAD_CONFIG"))
                .setDesc(t("BATCH_UPLOAD_DESC"))
                .addButton(b => b.setButtonText(t("MODAL_BUTTON_SETTINGS")).onClick(() => {
                    this.plugin.commandOpenSettingsTab();
                }));
        } else if (this.mode === "download") {
            new Setting(content)
                .setName(t("BATCH_DOWNLOAD_CONFIG"))
                .setDesc(t("BATCH_DOWNLOAD_DESC"));
        }
    }

    renderLocalProcessSettings(container: HTMLElement) {
        // Reuse logic from ProcessCurrentNote for these settings
        const settings = this.plugin.settings.processCurrentNote;

        // Convert To
        new Setting(container)
            .setName(t("SETTING_CONVERT_TO"))
            .addDropdown(dropdown => dropdown
                .addOptions({
                    disabled: t("SETTING_SAME_AS_ORIGINAL"),
                    webp: 'WebP',
                    jpg: 'JPEG',
                    png: 'PNG'
                })
                .setValue(settings.convertTo)
                .onChange(async value => {
                    settings.convertTo = value;
                    await this.plugin.saveSettings();
                })
            );

        // Quality
        new Setting(container)
            .setName(t("SETTING_QUALITY"))
            .addText(text => text
                .setValue((settings.quality * 100).toString())
                .onChange(async value => {
                    const quality = parseInt(value);
                    if (!isNaN(quality) && quality >= 0 && quality <= 100) {
                        settings.quality = quality / 100;
                        await this.plugin.saveSettings();
                    }
                })
            );

        // Resize Mode
        new Setting(container)
            .setName(t("SETTING_RESIZE_MODE"))
            .addDropdown(dropdown => dropdown
                .addOptions({
                    None: 'None',
                    LongestEdge: t("OPTION_RESIZE_LONGEST"),
                    ShortestEdge: t("OPTION_RESIZE_SHORTEST"),
                    Width: t("OPTION_RESIZE_WIDTH"),
                    Height: t("OPTION_RESIZE_HEIGHT"),
                    Fit: t("OPTION_RESIZE_FIT"),
                    Fill: t("OPTION_RESIZE_FILL"),
                })
                .setValue(settings.resizeMode)
                .onChange(async value => {
                    settings.resizeMode = value;
                    await this.plugin.saveSettings();
                    this.updateResizeInputVisibility(value);
                })
            );

        // Resize Inputs Container
        this.resizeInputsDiv = container.createDiv("resize-inputs");
        this.enlargeReduceDiv = container.createDiv("enlarge-reduce-inputs");

        // Initialize dynamic inputs
        this.updateResizeInputVisibility(settings.resizeMode);
    }

    // Helper to update resize inputs (simplified adaptation)
    updateResizeInputVisibility(mode: string) {
        if (!this.resizeInputsDiv || !this.enlargeReduceDiv) return;
        this.resizeInputsDiv.empty();
        this.enlargeReduceDiv.empty();

        if (mode === "None") return;

        // Add relevant inputs based on mode
        const settings = this.plugin.settings.processCurrentNote;

        if (['Fit', 'Fill'].includes(mode)) {
            new Setting(this.resizeInputsDiv)
                .setName(t("SETTING_RESIZE_DIMENSIONS"))
                .addText(text => text.setPlaceholder("Width").setValue(settings.desiredWidth.toString())
                    .onChange(async v => { settings.desiredWidth = parseInt(v); await this.plugin.saveSettings(); }))
                .addText(text => text.setPlaceholder("Height").setValue(settings.desiredHeight.toString())
                    .onChange(async v => { settings.desiredHeight = parseInt(v); await this.plugin.saveSettings(); }));
        } else if (['Width'].includes(mode)) {
            new Setting(this.resizeInputsDiv)
                .setName(t("PLACEHOLDER_WIDTH"))
                .addText(text => text.setValue(settings.desiredWidth.toString())
                    .onChange(async v => { settings.desiredWidth = parseInt(v); await this.plugin.saveSettings(); }));
        } else if (['Height'].includes(mode)) {
            new Setting(this.resizeInputsDiv)
                .setName(t("PLACEHOLDER_HEIGHT"))
                .addText(text => text.setValue(settings.desiredHeight.toString())
                    .onChange(async v => { settings.desiredHeight = parseInt(v); await this.plugin.saveSettings(); }));
        } else {
            new Setting(this.resizeInputsDiv)
                .setName(t("MODAL_DESIRED_LONG"))
                .addText(text => text.setValue(settings.desiredLength.toString())
                    .onChange(async v => { settings.desiredLength = parseInt(v); await this.plugin.saveSettings(); }));
        }

        // Enlarge/Reduce
        new Setting(this.enlargeReduceDiv)
            .setName(t("SETTING_ENLARGE_REDUCE"))
            .addDropdown(d => d
                .addOptions({ Always: t("OPTION_ALWAYS"), Reduce: t("OPTION_REDUCE"), Enlarge: t("OPTION_ENLARGE") })
                .setValue(settings.enlargeOrReduce)
                .onChange(async v => { settings.enlargeOrReduce = v as any; await this.plugin.saveSettings(); })
            );
    }

    async loadTasks() {
        this.tasks = [];
        this.filteredTasks = [];
        this.taskListContainer.empty();
        this.taskListContainer.createDiv({ cls: "batch-loading", text: t("BATCH_SCANNING") });

        const scopeManager = new BatchScopeManager(this.app, this.plugin);

        // Artificial delay for UX or just async wait
        this.tasks = await scopeManager.getTasks(this.batchScope, this.target as any, this.mode); // Cast target to any for now
        // Default all selected
        this.tasks.forEach(t => t.selected = true);
        this.filteredTasks = [...this.tasks];

        this.renderTasks();
    }

    // renderTaskListArea() { // Removed
    //     this.contentContainer.empty();

    //     const header = this.contentContainer.createDiv("task-list-header");
    //     new Setting(header)
    //         .setName("Items to Process")
    //         .setDesc("Uncheck items to exclude them.")
    //         .addToggle(toggle => toggle
    //             .setValue(true)
    //             .setTooltip("Select/Deselect All")
    //             .onChange(val => this.toggleAll(val)));

    //     this.taskListContainer = this.contentContainer.createDiv("task-list");
    //     this.taskListContainer.createEl("div", { text: "Loading tasks..." });
    // }

    // async loadTasks() { // Replaced by new loadTasks
    //     this.taskListContainer.empty();

    //     this.tasks = await this.scopeManager.getTasks(this.scope, this.target as any, this.mode);

    //     if (this.tasks.length === 0) {
    //         this.taskListContainer.createEl("div", { text: "No items found matching the criteria." });
    //         return;
    //     }

    //     this.renderTasks();
    // }

    renderTasks() {
        this.taskListContainer.empty();

        if (this.tasks.length === 0) {
            this.taskListContainer.createDiv({ cls: "batch-empty", text: t("BATCH_NO_ITEMS") });
            return;
        }

        const listHeader = this.taskListContainer.createDiv("batch-list-header");
        let masterToggle: any = null;

        new Setting(listHeader)
            .setName(t("BATCH_ITEMS_FOUND").replace("{0}", this.tasks.length.toString()))
            .addToggle(toggle => {
                masterToggle = toggle;
                toggle
                    .setValue(this.tasks.every(t => t.selected))
                    .setTooltip(t("BATCH_SELECT_ALL_NONE"))
                    .onChange(val => {
                        this.tasks.forEach(t => t.selected = val);
                        this.renderTaskListItems(masterToggle);
                    });
            });

        const listScroll = this.taskListContainer.createDiv("batch-list-scroll");
        this.listScrollContainer = listScroll;
        this.renderTaskListItems(masterToggle);
    }

    renderTaskListItems(masterToggle?: any) {
        this.listScrollContainer.empty();
        this.tasks.forEach(task => {
            const item = this.listScrollContainer.createDiv("batch-task-item");

            const checkbox = item.createEl("input", { type: "checkbox" });
            checkbox.checked = task.selected;
            checkbox.onclick = () => {
                task.selected = checkbox.checked;
                // Sync master toggle
                if (masterToggle) {
                    const allSelected = this.tasks.every(t => t.selected);
                    masterToggle.setValue(allSelected);
                }
            };

            const label = item.createSpan({ text: task.name });
            label.title = task.path; // tool tip

            // Status logic (if already executed)
            if (task.status === "success") item.addClass("task-success");
            if (task.status === "error") item.addClass("task-error");
        });
    }

    renderActionButtons(container: HTMLElement) {
        const actionContainer = container.createDiv("batch-action-buttons");

        new ButtonComponent(actionContainer)
            .setButtonText(t("BATCH_START_PROCESSING"))
            .setCta()
            .onClick(async () => {
                await this.executeBatch();
            });

        new ButtonComponent(actionContainer)
            .setButtonText(t("MODAL_BUTTON_CANCEL"))
            .onClick(() => this.close());
    }

    // toggleAll(checked: boolean) { // Removed, logic moved to renderTasks
    //     this.tasks.forEach(t => t.selected = checked);
    //     this.renderTasks();
    // }

    // State for Post-Processing
    batchResult: BatchResult | null = null;
    referencingNotes: { file: TFile; count: number; selected: boolean }[] = [];

    async executeBatch() {
        const selectedTasks = this.tasks.filter(t => t.selected);
        if (selectedTasks.length === 0) {
            new Notice(t("MSG_NO_ITEMS_SELECTED"));
            return;
        }

        // 1. Transition to Processing State
        this.contentContainer.empty();
        this.contentContainer.createEl("h3", { text: t("BATCH_PROCESSING_TITLE") });

        // Add progress bar
        const progressContainer = this.contentContainer.createDiv("batch-progress-container");
        const progressBar = progressContainer.createDiv("batch-progress-bar");
        const progressFill = progressBar.createDiv("batch-progress-fill");
        progressFill.style.width = "0%";

        const progressLog = this.contentContainer.createDiv("batch-summary-log");

        const appendLog = (msg: string) => {
            const line = progressLog.createDiv({ text: msg, cls: 'log-line' });
            line.scrollIntoView({ block: "end", behavior: "smooth" });
        };

        try {
            if (this.mode === "upload") {
                const files = selectedTasks.map(t => t.source as TFile);
                appendLog(t("BATCH_LOG_UPLOAD_START").replace("{0}", files.length.toString()));
                this.batchResult = await this.plugin.cloudImageHandler.batchUpload(files);
            } else if (this.mode === "download") {
                appendLog(t("BATCH_LOG_DOWNLOAD_START").replace("{0}", selectedTasks.length.toString()));
                const activeFile = this.plugin.app.workspace.getActiveFile() || this.plugin.app.vault.getMarkdownFiles()[0];
                const attachmentsPath = await this.plugin.app.fileManager.getAvailablePathForAttachment("image.png", activeFile.path);
                const attachmentFolder = this.plugin.folderAndFilenameManagement.getDefaultAttachmentFolderPath(activeFile);

                const downloadTasks = selectedTasks.map(t => ({
                    url: t.path,
                    targetFolder: attachmentFolder,
                    suggestedName: t.name,
                    activeFile: activeFile
                }));

                this.batchResult = await this.plugin.networkDownloader.batchDownload(downloadTasks);
            } else {
                const files = selectedTasks.map(t => t.source as TFile);
                appendLog(t("BATCH_LOG_LOCAL_START").replace("{0}", files.length.toString()));
                this.batchResult = await this.plugin.batchImageProcessor.batchProcess(files);
            }

            progressFill.style.width = "100%";
            appendLog(t("BATCH_LOG_COMPLETE"));

            // 2. Transition to Review State
            await this.prepareReviewState();
            this.renderReviewState();

        } catch (e) {
            appendLog(`Error: ${e.message}`);
            new Notice(`Batch Error: ${e.message}`);
            // Add a "Close" button if fatal error
            new ButtonComponent(this.contentContainer)
                .setButtonText("Close")
                .onClick(() => this.close());
        }
    }

    async prepareReviewState() {
        if (!this.batchResult || (this.mode === "local_process")) return;

        // Find referencing notes for global replace
        const itemsToSearch = this.batchResult.successful;
        this.referencingNotes = [];
        const notesMap = new Map<TFile, number>();

        // Helper to check if file is in current scope
        const isInScope = (file: TFile): boolean => {
            if (this.batchScope === "vault") return true;
            if (this.batchScope === "note" && this.target instanceof TFile) return file.path === this.target.path;
            if (this.batchScope === "folder" && this.target instanceof TFolder) return file.path.startsWith(this.target.path);
            return false;
        };

        // Bulk Scan for Download Mode (Performance Optimization)
        if (this.mode === "download") {
            const urls = itemsToSearch.map(i => i.item as string);
            const results = await this.plugin.vaultReferenceManager.getFilesReferencingUrls(urls);

            // Aggregation
            for (const [url, locations] of results.entries()) {
                locations.forEach(loc => {
                    const count = notesMap.get(loc.file) || 0;
                    notesMap.set(loc.file, count + 1);
                });
            }
        }
        // Standard Loop for Upload Mode (Obsidian API is already efficient for local files via resolvedLinks)
        else if (this.mode === "upload") {
            for (const item of itemsToSearch) {
                const file = item.item as TFile;
                const locations = await this.plugin.vaultReferenceManager.getFilesReferencingImage(file.path);

                locations.forEach(loc => {
                    const count = notesMap.get(loc.file) || 0;
                    notesMap.set(loc.file, count + 1);
                });
            }
        }

        // Convert Map to Array
        for (const [file, count] of notesMap.entries()) {
            this.referencingNotes.push({
                file,
                count,
                selected: isInScope(file) // Default select if in scope
            });
        }

        // Sort: Selected first, then path
        this.referencingNotes.sort((a, b) => {
            if (a.selected !== b.selected) return a.selected ? -1 : 1;
            return a.file.path.localeCompare(b.file.path);
        });
    }

    renderReviewState() {
        this.contentContainer.empty();
        if (!this.batchResult) return;

        this.contentContainer.createEl("h2", { text: t("BATCH_REVIEW_TITLE") });

        // 1. Result Summary
        const summary = this.contentContainer.createDiv("batch-result-summary");
        const successCount = this.batchResult.successful.length;
        const failCount = this.batchResult.failed.length;

        summary.createDiv({ text: t("BATCH_SUCCESS_COUNT").replace("{0}", successCount.toString()), cls: "summary-item success" });
        if (failCount > 0) {
            summary.createDiv({ text: t("BATCH_FAIL_COUNT").replace("{0}", failCount.toString()), cls: "summary-item error" });

            // Detailed Failure Log
            const details = this.contentContainer.createEl("details");
            details.open = true;
            details.createEl("summary", { text: t("BATCH_FAILURE_DETAILS") });
            const errorLog = details.createDiv("batch-error-log");
            this.batchResult.failed.forEach(f => {
                const name = typeof f.item === 'string' ? f.item : (f.item as any).name || 'Unknown';
                errorLog.createDiv({ text: `${name}: ${f.error}`, cls: "error-line" });
            });
        }

        // 2. Global Reference Selection (If applicable)
        if (this.referencingNotes.length > 0) {
            this.contentContainer.createEl("h3", { text: t("BATCH_REF_NOTES") });
            this.contentContainer.createDiv({ text: t("BATCH_REF_DESC"), cls: "setting-item-description" });

            const refList = this.contentContainer.createDiv("batch-ref-list");

            // Header with Count & Select All Toggle
            const header = refList.createDiv("batch-list-header");

            // Store toggle component to update it programmatically later
            let selectAllToggle: any = null;

            new Setting(header)
                .setName(t("BATCH_NOTES_FOUND").replace("{0}", this.referencingNotes.length.toString()))
                .addToggle(toggle => {
                    selectAllToggle = toggle;
                    toggle
                        .setValue(this.referencingNotes.every(n => n.selected))
                        .setTooltip(t("BATCH_SELECT_ALL_NONE"))
                        .onChange(val => {
                            this.referencingNotes.forEach(n => n.selected = val);
                            this.renderReferenceListItems(listScroll, selectAllToggle);
                        });
                });

            const listScroll = refList.createDiv("batch-list-scroll");
            this.renderReferenceListItems(listScroll, selectAllToggle);

        } else if (this.mode !== "local_process" && successCount > 0) {
            this.contentContainer.createDiv({ text: t("MSG_NO_REFERENCING_NOTES"), cls: "batch-empty-notice" });
        }

        // 3. Action Buttons
        this.contentContainer.createEl("hr");
        const actionContainer = this.contentContainer.createDiv("batch-post-actions");

        if (this.mode === "upload") {
            // Option 1: Replace & Delete
            new ButtonComponent(actionContainer)
                .setButtonText(t("BATCH_REPLACE_DELETE_LOCAL"))
                .setWarning()
                .setTooltip(t("TOOLTIP_REPLACE_DELETE_LOCAL"))
                .onClick(() => this.handleUploadAction("replace_delete"));

            // Option 2: Replace Only
            new ButtonComponent(actionContainer)
                .setButtonText(t("BATCH_REPLACE_LINKS_ONLY"))
                .setCta()
                .onClick(() => this.handleUploadAction("replace_only"));

            // Option 3: Undo
            new ButtonComponent(actionContainer)
                .setButtonText(t("BATCH_UNDO_UPLOAD"))
                .setTooltip(t("TOOLTIP_UNDO_UPLOAD"))
                .onClick(() => this.handleUploadAction("undo"));

        } else if (this.mode === "download") {
            // Option 1: Replace & Delete Cloud
            if (this.plugin.settings.pasteHandling.cloud.uploader === 'PicList') {
                new ButtonComponent(actionContainer)
                    .setButtonText(t("BATCH_REPLACE_DELETE_CLOUD"))
                    .setWarning()
                    .onClick(() => this.handleDownloadAction("replace_delete_cloud"));
            }

            // Option 2: Replace Only
            new ButtonComponent(actionContainer)
                .setButtonText(t("BATCH_REPLACE_LINKS_ONLY"))
                .setCta()
                .onClick(() => this.handleDownloadAction("replace_only"));

            // Option 3: Undo Download
            new ButtonComponent(actionContainer)
                .setButtonText(t("BATCH_UNDO_DOWNLOAD"))
                .onClick(() => this.handleDownloadAction("undo"));
        } else {
            new ButtonComponent(actionContainer)
                .setButtonText(t("BATCH_DONE"))
                .setCta()
                .onClick(() => this.close());
        }
    }

    renderReferenceListItems(container: HTMLElement, masterToggle?: any) {
        container.empty();
        this.referencingNotes.forEach(note => {
            const item = container.createDiv("batch-task-item");
            const cb = item.createEl("input", { type: "checkbox" });
            cb.checked = note.selected;
            cb.onclick = () => {
                note.selected = cb.checked;
                // Sync master toggle
                if (masterToggle) {
                    const allSelected = this.referencingNotes.every(n => n.selected);
                    masterToggle.setValue(allSelected);
                }
            };

            const label = item.createSpan({ text: t("BATCH_REF_INFO_LINE").replace("{0}", note.file.path).replace("{1}", note.count.toString()) });
            label.title = note.file.path;
        });
    }

    // --- Action Handlers ---

    async handleUploadAction(action: "replace_delete" | "replace_only" | "undo") {
        if (!this.batchResult) return;

        if (action === "undo") {
            const confirm = this.plugin.settings.pasteHandling.cloud.uploader === 'PicList';
            if (!confirm && !window.confirm(t("MSG_UNDO_CONFIRM_LOCAL"))) return;

            new Notice(t("MSG_UNDOING_UPLOAD"));
            const deleter = new CloudImageDeleter(this.plugin);
            for (const item of this.batchResult.successful) {
                if (confirm) {
                    await deleter.deleteImage({ url: item.output as string });
                }
            }
            new Notice(t("MSG_UNDO_COMPLETE"));
            this.close();
            return;
        }

        const notesToUpdate = this.referencingNotes.filter(n => n.selected).map(n => n.file);

        // SAFETY CHECK: If Replace & Delete, ensure we aren't breaking unselected notes
        if (action === "replace_delete") {
            if (await this.checkBrokenLinks(notesToUpdate)) {
                return; // User cancelled
            }
        }

        let count = 0;
        for (const item of this.batchResult.successful) {
            const file = item.item as TFile; // Local source
            const cloudUrl = item.output as string;

            // Update references in selected notes
            for (const note of notesToUpdate) {
                const updated = await this.plugin.vaultReferenceManager.updateReferencesInFile(note, file.path, (loc) => {
                    return CloudLinkFormatter.formatCloudLink(
                        cloudUrl,
                        this.plugin.settings.pasteHandling.cloud,
                        loc.original
                    );
                });
                count += updated;
            }

            // Delete local if requested
            if (action === "replace_delete") {
                await this.app.vault.trash(file, true);
            }
        }

        new Notice(t("MSG_REPLACED_LINKS").replace("{0}", count.toString()).replace("{1}", notesToUpdate.length.toString()));
        this.close();
    }

    async handleDownloadAction(action: "replace_delete_cloud" | "replace_only" | "undo") {
        if (!this.batchResult) return;

        if (action === "undo") {
            new Notice(t("MSG_DELETING_DOWNLOADED"));
            for (const item of this.batchResult.successful) {
                const output = item.output as any;
                if (output && output.localPath) {
                    const file = this.app.vault.getAbstractFileByPath(output.localPath);
                    if (file instanceof TFile) {
                        await this.app.vault.trash(file, true);
                    }
                }
            }
            new Notice(t("MSG_UNDO_COMPLETE"));
            this.close();
            return;
        }

        const notesToUpdate = this.referencingNotes.filter(n => n.selected).map(n => n.file);

        // SAFETY CHECK: If Replace & Delete Cloud, check broken links
        if (action === "replace_delete_cloud") {
            if (await this.checkBrokenLinks(notesToUpdate)) {
                return; // User cancelled
            }
        }

        let count = 0;

        for (const item of this.batchResult.successful) {
            const url = item.item as string; // Original URL
            const output = item.output as any;
            const localPath = output.localPath;

            if (!localPath) continue;

            const localFile = this.app.vault.getAbstractFileByPath(localPath) as TFile;
            if (!localFile) continue;

            for (const note of notesToUpdate) {
                const updated = await this.plugin.vaultReferenceManager.updateReferencesInFile(note, url, (loc) => {
                    // Generate relative path link
                    const relativePath = this.plugin.app.metadataCache.fileToLinktext(
                        localFile,
                        note.path
                    );
                    return `![[${relativePath}]]`;
                });
                count += updated;
            }

            if (action === "replace_delete_cloud") {
                if (this.plugin.historyManager.isUrlUploaded(url)) {
                    const deleter = new CloudImageDeleter(this.plugin);
                    await deleter.deleteImage({ url: url });
                }
            }
        }

        new Notice(`Replaced ${count} links.`);
        this.close();
    }

    private async checkBrokenLinks(selectedNotes: TFile[]): Promise<boolean> {
        // Find if there are any referencing notes that are NOT selected
        const unselectedRefs = this.referencingNotes.filter(n => !n.selected);

        if (unselectedRefs.length > 0) {
            // Found unselected notes that reference our target items.
            // Since we are deleting the source, these will break.

            return new Promise((resolve) => {
                const confirmModal = new Modal(this.app);
                confirmModal.titleEl.setText("⚠️ Warning: Potential Broken Links");

                const content = confirmModal.contentEl;
                content.createEl("p", {
                    text: `You are about to delete the source files, but the following notes reference them and are NOT selected for updates:`
                });

                const list = content.createEl("ul", { cls: "batch-broken-link-list" });
                unselectedRefs.slice(0, 5).forEach(n => {
                    list.createEl("li", { text: n.file.path });
                });
                if (unselectedRefs.length > 5) {
                    list.createEl("li", { text: `...and ${unselectedRefs.length - 5} more.` });
                }

                content.createEl("p", { text: "If you proceed, these notes will have broken image links." });

                const btnContainer = content.createDiv("modal-button-container");
                new ButtonComponent(btnContainer)
                    .setButtonText("Cancel")
                    .onClick(() => {
                        confirmModal.close();
                        resolve(true); // Return true to indicate "Cancelled"
                    });

                new ButtonComponent(btnContainer)
                    .setButtonText("Proceed Anyway")
                    .setClass("mod-warning")
                    .onClick(() => {
                        confirmModal.close();
                        resolve(false); // Return false to indicate "Continue"
                    });

                confirmModal.open();
            });
        }

        return false; // No broken links detected
    }
}
