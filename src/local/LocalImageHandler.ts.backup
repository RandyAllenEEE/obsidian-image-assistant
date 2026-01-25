
import { App, Editor, Notice, TFile, MarkdownView, EditorPosition, Modal } from "obsidian";
import { ImageHandler } from "../core/ImageHandler";
import ImageConverterPlugin from "../main";
import { t } from "../lang/helpers";
import { EditorContentInserter } from "../utils/EditorContentInserter";
import { PresetSelectionModal } from "../ui/modals/PresetSelectionModal";
import {
    ConversionPreset,
    FilenamePreset,
    FolderPreset,
    LinkFormatPreset,
    NonDestructiveResizePreset,
    ResizeMode
} from "../settings/types";
import { ConfirmDialog } from "../settings/SettingsModals";

export class LocalImageHandler implements ImageHandler {
    private app: App;
    private plugin: ImageConverterPlugin;

    constructor(app: App, plugin: ImageConverterPlugin) {
        this.app = app;
        this.plugin = plugin;
    }

    async handlePaste(evt: ClipboardEvent, editor: Editor): Promise<void> {
        if (!evt.clipboardData) return;

        const cursor = editor.getCursor();
        const itemData: { kind: string, type: string, file: File | null }[] = [];
        for (let i = 0; i < evt.clipboardData.items.length; i++) {
            const item = evt.clipboardData.items[i];
            const file = item.kind === "file" ? item.getAsFile() : null;
            itemData.push({ kind: item.kind, type: item.type, file });
        }

        const supportedFiles = itemData
            .filter(data => data.kind === "file" && data.file &&
                this.plugin.supportedImageFormats.isSupported(data.type, data.file.name) &&
                !this.plugin.folderAndFilenameManagement.matchesPatterns(data.file.name, this.plugin.settings.pasteHandling.neverProcessFilenames))
            .map(data => data.file!)
            .filter((file): file is File => file !== null);

        if (supportedFiles.length === 0) return;

        // Local logic strictly ignores pasted text unless it is handled by some other plugin logic?
        // Original logic: handlePaste only processes files. Text paste logic for Cloud was separate.
        // For Local, we don't have a "download network images on paste" feature in the same way (implied by "Net Downloader").

        evt.preventDefault();
        await this.processFiles(supportedFiles, editor);
    }

    async handleDrop(evt: DragEvent, editor: Editor): Promise<void> {
        if (!evt.dataTransfer) return;

        const pos = editor.posAtMouse(evt);
        if (!pos) return;

        const fileData: { name: string, type: string, file: File }[] = [];
        for (let i = 0; i < evt.dataTransfer.files.length; i++) {
            const file = evt.dataTransfer.files[i];
            fileData.push({ name: file.name, type: file.type, file });
        }

        const supportedFiles = fileData
            .filter(data => this.plugin.supportedImageFormats.isSupported(data.type, data.name) &&
                !this.plugin.folderAndFilenameManagement.matchesPatterns(data.name, this.plugin.settings.pasteHandling.neverProcessFilenames))
            .map(data => data.file);

        if (supportedFiles.length === 0) return;

        // For Drop, we must ensure cursor is where drop happened
        editor.setCursor(pos);

        evt.preventDefault();
        await this.processFiles(supportedFiles, editor);
    }

    private async processFiles(files: File[], editor: Editor) {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file found!');
            return;
        }

        const filePromises = files.map((file) => {
            const inserter = new EditorContentInserter(this.app.workspace.getActiveViewOfType(MarkdownView)!);
            inserter.insertLoadingText(`${t("LOADING_PROCESS") || "Processing"} ${file.name}...`);

            return async () => {
                // Check modal behavior setting
                const { modalBehavior } = this.plugin.settings.global;
                let showModal = modalBehavior === "always";

                if (modalBehavior === "ask") {
                    showModal = await new Promise<boolean>((resolve) => {
                        new ConfirmDialog(
                            this.app,
                            "Show Preset Selection Modal?",
                            "Do you want to select presets for this image?",
                            "Yes",
                            () => resolve(true)
                        ).open();
                    });
                }

                let selectedConversionPreset: ConversionPreset;
                let selectedFilenamePreset: FilenamePreset;
                let selectedFolderPreset: FolderPreset;
                let selectedLinkFormatPreset: LinkFormatPreset;
                let selectedResizePreset: NonDestructiveResizePreset;

                if (showModal) {
                    const result = await new Promise<{
                        selectedConversionPreset: ConversionPreset;
                        selectedFilenamePreset: FilenamePreset;
                        selectedFolderPreset: FolderPreset;
                        selectedLinkFormatPreset: LinkFormatPreset;
                        selectedResizePreset: NonDestructiveResizePreset;
                    } | null>((resolve) => {
                        new PresetSelectionModal(
                            this.app,
                            this.plugin.settings,
                            (conversionPreset, filenamePreset, folderPreset, linkFormatPreset, resizePreset) => {
                                resolve({
                                    selectedConversionPreset: conversionPreset,
                                    selectedFilenamePreset: filenamePreset,
                                    selectedFolderPreset: folderPreset,
                                    selectedLinkFormatPreset: linkFormatPreset,
                                    selectedResizePreset: resizePreset,
                                });
                            },
                            () => resolve(null),
                            this.plugin,
                            this.plugin.variableProcessor
                        ).open();
                    });

                    if (!result) {
                        new Notice(t("MSG_PROCESSING_CANCELLED") || "Processing cancelled.");
                        inserter.removeLoadingText();
                        return;
                    }

                    ({
                        selectedConversionPreset,
                        selectedFilenamePreset,
                        selectedFolderPreset,
                        selectedLinkFormatPreset,
                        selectedResizePreset
                    } = result);
                } else {
                    // Use generic getter from Plugin instance exposed?
                    // Plugin main.ts has `getPresetByName`. I can make it public or duplicate logic.
                    // To avoid dependency loops or access issues, I might simple access settings.
                    // But `getPresetByName` is useful. I will assume I can access it or reimplement simple find.

                    selectedConversionPreset = this.plugin.settings.conversionPresets.find((p: ConversionPreset) => p.name === this.plugin.settings.selectedConversionPreset) || this.plugin.settings.conversionPresets[0];
                    selectedFilenamePreset = this.plugin.settings.filenamePresets.find((p: FilenamePreset) => p.name === this.plugin.settings.selectedFilenamePreset) || this.plugin.settings.filenamePresets[0];
                    selectedFolderPreset = this.plugin.settings.folderPresets.find((p: FolderPreset) => p.name === this.plugin.settings.selectedFolderPreset) || this.plugin.settings.folderPresets[0];
                    selectedLinkFormatPreset = this.plugin.settings.linkFormatSettings.linkFormatPresets.find((p: LinkFormatPreset) => p.name === this.plugin.settings.linkFormatSettings.selectedLinkFormatPreset) || this.plugin.settings.linkFormatSettings.linkFormatPresets[0];
                    selectedResizePreset = this.plugin.settings.nonDestructiveResizeSettings.resizePresets.find((p: NonDestructiveResizePreset) => p.name === this.plugin.settings.nonDestructiveResizeSettings.selectedResizePreset) || this.plugin.settings.nonDestructiveResizeSettings.resizePresets[0];
                }

                try {
                    // Determine Destination
                    let destinationPath: string;
                    let newFilename: string;

                    try {
                        ({ destinationPath, newFilename } = await this.plugin.folderAndFilenameManagement.determineDestination(
                            file,
                            activeFile,
                            selectedConversionPreset,
                            selectedFilenamePreset,
                            selectedFolderPreset
                        ));
                    } catch (error) {
                        console.error("Error determining destination:", error);
                        new Notice(`Failed to determine destination: ${error.message}`);
                        return;
                    }

                    // Pre-check for skip optimization (non-atomic but safe optimization, real atomic check happens in createUniqueBinary)
                    if (selectedFilenamePreset?.conflictResolution === 'skip') {
                        const fullPath = this.plugin.folderAndFilenameManagement.combinePath(destinationPath, newFilename);
                        if (await this.app.vault.adapter.exists(fullPath)) {
                            new Notice(`Skipping "${file.name}" (already exists).`);
                            await this.plugin.insertLinkWithInserter(inserter, editor, fullPath, selectedLinkFormatPreset, selectedResizePreset); // Link to existing
                            return;
                        }
                    }

                    // Prepare Image Data
                    let finalBuffer: ArrayBuffer;

                    // Check if should skip conversion
                    if (selectedConversionPreset && this.plugin.folderAndFilenameManagement.shouldSkipConversion(file.name, selectedConversionPreset)) {
                        finalBuffer = await file.arrayBuffer();
                    } else {
                        // Process Image
                        const processedImage = await this.plugin.imageProcessor.processImage(
                            file,
                            selectedConversionPreset ? selectedConversionPreset.outputFormat : this.plugin.settings.global.outputFormat,
                            selectedConversionPreset ? selectedConversionPreset.quality / 100 : this.plugin.settings.global.quality / 100,
                            selectedConversionPreset ? selectedConversionPreset.colorDepth : this.plugin.settings.global.colorDepth,
                            selectedConversionPreset ? selectedConversionPreset.resizeMode : this.plugin.settings.processCurrentNote.resizeMode as ResizeMode,
                            selectedConversionPreset ? selectedConversionPreset.desiredWidth : this.plugin.settings.processCurrentNote.desiredWidth,
                            selectedConversionPreset ? selectedConversionPreset.desiredHeight : this.plugin.settings.processCurrentNote.desiredHeight,
                            selectedConversionPreset ? selectedConversionPreset.desiredLongestEdge : this.plugin.settings.processCurrentNote.desiredLength,
                            selectedConversionPreset ? selectedConversionPreset.enlargeOrReduce : this.plugin.settings.processCurrentNote.enlargeOrReduce,
                            selectedConversionPreset ? selectedConversionPreset.allowLargerFiles : !this.plugin.settings.global.revertToOriginalIfLarger,
                            selectedConversionPreset,
                            this.plugin.settings
                        );

                        // Check Revert to Original logic
                        if (this.plugin.settings.global.revertToOriginalIfLarger && processedImage.byteLength > file.size) {
                            finalBuffer = await file.arrayBuffer();
                        } else {
                            finalBuffer = processedImage;
                        }
                    }

                    // Atomic Creation / Conflict Resolution
                    const conflictMode = selectedFilenamePreset?.conflictResolution || 'increment';
                    const savedFile = await this.plugin.folderAndFilenameManagement.createUniqueBinary(
                        destinationPath,
                        newFilename,
                        finalBuffer,
                        conflictMode
                    );

                    if (savedFile) {
                        await this.plugin.insertLinkWithInserter(inserter, editor, savedFile.path, selectedLinkFormatPreset, selectedResizePreset);
                    } else {
                        // Should potentially handle 'null' return if skip happened inside atomic call (redundant but safe)
                        if (conflictMode === 'skip') {
                            new Notice(`Skipping "${file.name}" (File exists)`);
                        }
                    }

                } catch (error) {
                    console.error("Processing failed:", error);
                    new Notice(`Processing failed: ${error.message}`);
                    inserter.removeLoadingText();
                }
            };
        });

        // Execute with concurrency
        if (!this.plugin.concurrentQueue) {
            this.plugin.concurrentQueue = new ConcurrentQueue(3); // Temporary fallback? Main should have it.
        }
        await this.plugin.concurrentQueue.run(filePromises);

        if (this.plugin.settings.captions.enabled) {
            this.plugin.imageStateManager?.refreshAllImages();
        }
    }
}

// Helper class for imports if needed?
// No, I imported ConcurrentQueue from utils.
import { ConcurrentQueue } from "../utils/AsyncLock";
