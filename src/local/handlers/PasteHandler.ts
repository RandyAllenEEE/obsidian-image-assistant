import { App, Editor, Notice } from "obsidian";
import ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { EditorContentInserter } from "../../utils/EditorContentInserter";
import {
    ResizeMode
} from "../../settings/types";
import { BasePasteHandler } from "../../core/BasePasteHandler";
import { ConcurrentQueue } from "../../utils/AsyncLock";
import type { ProcessedImageResult } from "../ImageProcessor";
import type { EditorImageInsertionContext } from "../../core/EditorImageInsertionContext";

function replaceFilenameExtension(filename: string, sourceFilename: string): string {
    const sourceDot = sourceFilename.lastIndexOf(".");
    if (sourceDot < 0) return filename;

    const extension = sourceFilename.slice(sourceDot);
    const filenameDot = filename.lastIndexOf(".");
    return filenameDot < 0 ? `${filename}${extension}` : `${filename.slice(0, filenameDot)}${extension}`;
}

export class PasteHandler extends BasePasteHandler {
    constructor(
        app: App,
        plugin: ImageConverterPlugin
    ) {
        super(app, plugin);
    }

    // handlePaste is inherited from BasePasteHandler

    async processFiles(
        files: File[],
        editor: Editor,
        context?: EditorImageInsertionContext
    ): Promise<void> {
        if (!context) return;
        const sourceFile = context.file;
        const filePromises = files.map((file) => {
            const inserter = new EditorContentInserter(
                context.view ?? editor,
                sourceFile
            );
            inserter.insertLoadingText(`${t("LOADING_PROCESS") || "Processing"} ${file.name}...`);

            return async () => inserter.runWithCurrentPlaceholder(async () => {
                const localProcessing = this.plugin.settings.localProcessing;
                const { conversion, filename, destination, link, embedResize, externalTools } = localProcessing;

                try {
                    // Determine Destination
                    const destinationResult = await this.plugin.folderAndFilenameManagement.determineDestination(
                        file,
                        sourceFile,
                        conversion,
                        filename,
                        destination
                    );
                    const destinationPath = destinationResult.destinationPath;
                    let newFilename = destinationResult.newFilename;

                    // Ensure destination folder exists
                    await this.plugin.folderAndFilenameManagement.ensureFolderExists(destinationPath);

                    // Pre-check for skip optimization
                    if (filename?.conflictResolution === 'skip') {
                        const fullPath = this.plugin.folderAndFilenameManagement.combinePath(destinationPath, newFilename);
                        if (await this.app.vault.adapter.exists(fullPath)) {
                            new Notice(t("MSG_LOCAL_PASTE_SKIPPED_EXISTS", [
                                file.name
                            ]));
                            const inserted = await this.plugin.insertLinkWithInserter(
                                inserter,
                                fullPath,
                                sourceFile,
                                link,
                                embedResize,
                                context
                            );
                            if (!inserted) {
                                new Notice(t("MSG_LOCAL_PASTE_LINK_STALE", [fullPath]));
                            }
                            return;
                        }
                    }

                    // Prepare Image Data
                    let finalBuffer: ArrayBuffer | null = null;

                    // Check if should skip conversion
                    if (conversion && this.plugin.folderAndFilenameManagement.shouldSkipConversion(file.name, conversion)) {
                        finalBuffer = await file.arrayBuffer();
                        newFilename = replaceFilenameExtension(newFilename, file.name);
                    } else {
                        let processedImage: ProcessedImageResult | null;
                        try {
                            processedImage = await this.plugin.imageProcessor.processImageDetailed(
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
                        } catch (error) {
                            const message = error instanceof Error ? error.message : String(error);
                            console.error(`Processing ${file.name} failed; preserving the original image:`, error);
                            new Notice(t("MSG_LOCAL_PASTE_USING_ORIGINAL", [
                                file.name,
                                message
                            ]));
                            finalBuffer = await file.arrayBuffer();
                            newFilename = replaceFilenameExtension(newFilename, file.name);
                            processedImage = null;
                        }

                        if (processedImage) {
                            // Check Revert to Original logic (including minimum savings)
                            const originalSize = file.size;
                            const minSavingsKB = (typeof conversion.minimumCompressionSavingsInKB === 'number'
                                && conversion.minimumCompressionSavingsInKB >= 0)
                                ? conversion.minimumCompressionSavingsInKB
                                : 30;

                            const shouldRevertIfLarger = !conversion.allowLargerFiles;

                            if (processedImage.outcome !== "converted") {
                                finalBuffer = processedImage.data;
                                newFilename = replaceFilenameExtension(newFilename, file.name);
                            } else if (shouldRevertIfLarger && processedImage.data.byteLength + (minSavingsKB * 1024) > originalSize) {
                                new Notice(t("MSG_LOCAL_PASTE_SAVINGS_TOO_SMALL", [
                                    file.name,
                                    minSavingsKB
                                ]));
                                finalBuffer = await file.arrayBuffer();
                                newFilename = replaceFilenameExtension(newFilename, file.name);
                            } else {
                                finalBuffer = processedImage.data;
                                newFilename = replaceFilenameExtension(newFilename, `image.${processedImage.extension}`);
                            }
                        }
                    }

                    if (!finalBuffer) {
                        throw new Error(t("MSG_LOCAL_PASTE_NO_DATA", [
                            file.name
                        ]));
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
                        const inserted = await this.plugin.insertLinkWithInserter(
                            inserter,
                            savedFile.path,
                            sourceFile,
                            link,
                            embedResize,
                            context
                        );
                        if (!inserted) {
                            new Notice(t("MSG_LOCAL_PASTE_LINK_STALE", [
                                savedFile.path
                            ]));
                        }
                    } else {
                        if (conflictMode === 'skip') {
                            new Notice(t("MSG_LOCAL_PASTE_SKIPPED_EXISTS", [
                                file.name
                            ]));
                        }
                    }

                } catch (error) {
                    console.error("Processing failed:", error);
                    const message = error instanceof Error ? error.message : String(error);
                    new Notice(t("MSG_LOCAL_PASTE_FAILED", [message]));
                }
            });
        });

        // Execute with concurrency
        if (!this.plugin.concurrentQueue) {
            this.plugin.concurrentQueue = new ConcurrentQueue(this.plugin.settings.global.batchConcurrency || 3);
        }
        await this.plugin.concurrentQueue.run(filePromises);

        if (this.plugin.settings.captions.enabled) {
            this.plugin.imageStateManager?.refreshAllImages();
        }
    }
}
