import { App, Editor, Notice, TFile, MarkdownView, EditorPosition } from "obsidian";
import ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { EditorContentInserter } from "../../utils/EditorContentInserter";
import {
    ResizeMode
} from "../../settings/types";
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
                const localProcessing = this.plugin.settings.localProcessing;
                const { conversion, filename, destination, link, embedResize, externalTools } = localProcessing;

                try {
                    // Determine Destination
                    let destinationPath: string;
                    let newFilename: string;

                    try {
                        ({ destinationPath, newFilename } = await this.plugin.folderAndFilenameManagement.determineDestination(
                            file,
                            activeFile,
                            conversion,
                            filename,
                            destination
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
                    if (filename?.conflictResolution === 'skip') {
                        const fullPath = this.plugin.folderAndFilenameManagement.combinePath(destinationPath, newFilename);
                        if (await this.app.vault.adapter.exists(fullPath)) {
                            new Notice(`Skipping "${file.name}" (already exists).`);
                            await this.plugin.insertLinkWithInserter(inserter, editor, fullPath, link, embedResize);
                            return;
                        }
                    }

                    // Prepare Image Data
                    let finalBuffer: ArrayBuffer;

                    // Check if should skip conversion
                    if (conversion && this.plugin.folderAndFilenameManagement.shouldSkipConversion(file.name, conversion)) {
                        finalBuffer = await file.arrayBuffer();
                    } else {
                        // Process Image
                        const processedImage = await this.plugin.imageProcessor.processImage(
                            file,
                            conversion.outputFormat,
                            conversion.quality / 100,
                            conversion.colorDepth,
                            conversion.resizeMode as ResizeMode,
                            conversion.desiredWidth,
                            conversion.desiredHeight,
                            conversion.desiredLongestEdge,
                            conversion.enlargeOrReduce,
                            conversion.allowLargerFiles,
                            externalTools,
                            this.plugin.settings
                        );

                        // Check Revert to Original logic (including minimum savings)
                        const originalSize = file.size;
                        const minSavingsKB = (typeof conversion.minimumCompressionSavingsInKB === 'number'
                            && conversion.minimumCompressionSavingsInKB >= 0)
                            ? conversion.minimumCompressionSavingsInKB
                            : 30;

                        const shouldRevertIfLarger = !conversion.allowLargerFiles;

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
                    const conflictMode = filename?.conflictResolution || 'increment';
                    const savedFile = await this.plugin.folderAndFilenameManagement.createUniqueBinary(
                        destinationPath,
                        newFilename,
                        finalBuffer,
                        conflictMode
                    );

                    if (savedFile) {
                        await this.plugin.insertLinkWithInserter(inserter, editor, savedFile.path, link, embedResize);
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
