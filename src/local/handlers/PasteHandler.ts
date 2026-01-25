import { App, Editor, Notice, TFile, MarkdownView, EditorPosition } from "obsidian";
import ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { EditorContentInserter } from "../../utils/EditorContentInserter";
import { PresetSelectionModal } from "../../ui/modals/PresetSelectionModal";
import {
    ConversionPreset,
    FilenamePreset,
    FolderPreset,
    LinkFormatPreset,
    NonDestructiveResizePreset,
    ResizeMode
} from "../../settings/types";
import { ConfirmDialog } from "../../settings/SettingsModals";
import { BasePasteHandler } from "../../core/BasePasteHandler";
import { NotificationManager } from "../../utils/NotificationManager";
import { ConcurrentQueue } from "../../utils/AsyncLock";

export class PasteHandler extends BasePasteHandler {
    constructor(
        app: App,
        plugin: ImageConverterPlugin
    ) {
        super(app, plugin);
    }

    // handlePaste is inherited from BasePasteHandler

    async processFiles(files: File[], editor: Editor): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            if (!activeFile) {
                NotificationManager.showWarning("No active file found!", 3000);
                return;
            }
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
                        NotificationManager.showInfo(t("MSG_PROCESSING_CANCELLED") || "Processing cancelled.");
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
                        // NotificationManager.showError(`Failed to determine destination: ${error.message}`);
                        return;
                    }

                    // Ensure destination folder exists
                    await this.plugin.folderAndFilenameManagement.ensureFolderExists(destinationPath);

                    // Pre-check for skip optimization
                    if (selectedFilenamePreset?.conflictResolution === 'skip') {
                        const fullPath = this.plugin.folderAndFilenameManagement.combinePath(destinationPath, newFilename);
                        if (await this.app.vault.adapter.exists(fullPath)) {
                            new Notice(`Skipping "${file.name}" (already exists).`);
                            await this.plugin.insertLinkWithInserter(inserter, editor, fullPath, selectedLinkFormatPreset, selectedResizePreset);
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

                        // Check Revert to Original logic (including minimum savings)
                        const originalSize = file.size;
                        const minSavingsKB = (typeof (selectedConversionPreset?.minimumCompressionSavingsInKB ?? this.plugin.settings.global.minimumCompressionSavingsInKB) === 'number'
                            && (selectedConversionPreset?.minimumCompressionSavingsInKB ?? this.plugin.settings.global.minimumCompressionSavingsInKB) >= 0)
                            ? (selectedConversionPreset?.minimumCompressionSavingsInKB ?? this.plugin.settings.global.minimumCompressionSavingsInKB)
                            : 30;

                        const shouldRevertIfLarger = this.plugin.settings.global.revertToOriginalIfLarger;

                        // Calculate threshold: processed size must be at least minSavingsKB smaller than original
                        if (shouldRevertIfLarger && processedImage.byteLength + (minSavingsKB * 1024) > originalSize) {
                            new Notice(`Using original image for "${file.name}" because size reduction was less than ${minSavingsKB} KB.`);
                            // If we already have the buffer (rare, only if skipped conversion), good, otherwise get it
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
                        if (conflictMode === 'skip') {
                            new Notice(`Skipping "${file.name}" (File exists)`);
                        }
                    }

                } catch (error) {
                    console.error("Processing failed:", error);
                    new Notice(`Processing failed: ${error.message}`);
                    // NotificationManager.showError(`Processing failed: ${error.message}`);
                    inserter.removeLoadingText();
                }
            };
        });

        // Execute with concurrency
        if (!this.plugin.concurrentQueue) {
            this.plugin.concurrentQueue = new ConcurrentQueue(3);
        }
        await this.plugin.concurrentQueue.run(filePromises);

        if (this.plugin.settings.captions.enabled) {
            this.plugin.imageStateManager?.refreshAllImages();
        }
    }
}
