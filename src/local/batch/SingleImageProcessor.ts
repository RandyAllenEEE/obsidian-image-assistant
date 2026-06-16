import { App, TFile } from 'obsidian';
import ImageConverterPlugin from '../../main';
import { ImageProcessor } from '../ImageProcessor';
import { FolderAndFilenameManagement } from '../FolderAndFilenameManagement';
import { ResizeMode, EnlargeReduce } from '../../settings/types';
import { BatchResult } from '../../types/BatchTypes';
import { ConcurrentQueue } from '../../utils/AsyncLock';
import { ImageLinkPathReplacer } from '../../utils/ImageLinkPathReplacer';
import { t } from '../../lang/helpers';
import { BatchOutputFormat, getOutputExtension, toBatchOutputFormat } from './BatchFormat';

/**
 * SingleImageProcessor - Shared logic for processing a single image.
 * Used by all batch processors.
 */
export class SingleImageProcessor {
    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private imageProcessor: ImageProcessor,
        private folderAndFilenameManagement: FolderAndFilenameManagement
    ) { }

    async processSingleImage(
        file: TFile,
        outputFormat: BatchOutputFormat,
        quality: number,
        colorDepth: number,
        resizeMode: string,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: string,
        allowLargerFiles: boolean
    ): Promise<{ success: boolean; error?: string }> {
        try {
            // 1. Process Image
            const processedImageData = await this.imageProcessor.processImage(
                file,
                outputFormat,
                quality,
                colorDepth,
                resizeMode as ResizeMode,
                desiredWidth,
                desiredHeight,
                desiredLongestEdge,
                enlargeOrReduce as EnlargeReduce,
                allowLargerFiles
            );

            // Check Revert to Original logic (including minimum savings)
            const originalSize = file.stat.size;
            const minSavingsKB = (typeof (this.plugin.settings.localProcessing.conversion.minimumCompressionSavingsInKB) === 'number'
                && this.plugin.settings.localProcessing.conversion.minimumCompressionSavingsInKB >= 0)
                ? this.plugin.settings.localProcessing.conversion.minimumCompressionSavingsInKB
                : 30;

            const shouldRevertIfLarger = !allowLargerFiles;

            if (shouldRevertIfLarger && processedImageData.byteLength + (minSavingsKB * 1024) > originalSize) {
                console.log(`Using original image for "${file.name}" because size reduction was less than ${minSavingsKB} KB.`);
                // Use original buffer
                const originalBuffer = await this.app.vault.readBinary(file);
                const originalOutputName = `${file.basename}.${getOutputExtension(file.extension, outputFormat)}`;
                if (file.name === originalOutputName) {
                    // Same file, effectively no-op if we revert to original, but maybe we want to just stop?
                    // If we are modifying in place, and we revert to original, we just don't write.
                    return { success: true };
                } else {
                    // Different extension requested, but we revert to original content.
                    // Wait, if output format is different (e.g. png -> webp), but we revert to original,
                    // do we keep original EXTENSION too?
                    // Usually "Revert to original" means keep original file entirely.
                    // If so, we shouldn't create a new file with .webp extension containing .png header.
                    // We should probably just SKIP processing.
                    return { success: true, error: t("MSG_SIZE_REDUCTION_INSUFFICIENT") };
                }
            }

            // 2. Determine New Path and Filename
            const newFileName = `${file.basename}.${getOutputExtension(file.extension, outputFormat)}`;
            const parentPath = file.parent ? file.parent.path : "";

            // Check if we are doing in-place update
            const isSameFile = file.name === newFileName;

            if (isSameFile) {
                // In-place update
                await this.app.vault.modifyBinary(file, processedImageData);
            } else {
                // Format change: Create New -> Update Links -> Delete Old

                // Ensure parent folder exists? (It must exist if source file is there)

                const newFile = await this.folderAndFilenameManagement.createUniqueBinary(
                    parentPath,
                    newFileName,
                    processedImageData,
                    'increment'
                );

                if (newFile) {
                    // Update References
                    await this.plugin.vaultReferenceManager.updateReferences(file.path, (loc) => {
                        return ImageLinkPathReplacer.replacePath(loc.original, newFile.name);
                    });

                    // Delete Old File
                    await this.app.vault.trash(file, true);
                }
            }
            return { success: true };
        } catch (error) {
            console.error(`Failed to process image ${file.path}:`, error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Batch process multiple files and return results.
     */
    async batchProcess(files: TFile[]): Promise<BatchResult> {
        const result: BatchResult = {
            successful: [],
            failed: [],
            cancelled: false
        };

        if (files.length === 0) return result;

        const {
            convertTo,
            quality,
            resizeMode,
            desiredWidth,
            desiredHeight,
            desiredLength,
            enlargeOrReduce
        } = this.plugin.settings.operationDefaults.batchLocal;
        const allowLargerFiles = this.plugin.settings.localProcessing.conversion.allowLargerFiles;

        const outputFormat = toBatchOutputFormat(convertTo);
        const colorDepth = 1;

        const concurrency = this.plugin.settings.pasteHandling.cloud.uploadConcurrency || 3;
        const queue = new ConcurrentQueue(concurrency);

        const tasks = files.map(file => async () => {
            const res = await this.processSingleImage(
                file,
                outputFormat,
                quality,
                colorDepth,
                resizeMode,
                desiredWidth,
                desiredHeight,
                desiredLength,
                enlargeOrReduce,
                allowLargerFiles
            );
            return { file, res };
        });

        const results = await queue.runSettled(tasks);

        results.forEach((res, index) => {
            const task = files[index];
            if (res.status === 'fulfilled') {
                const { success, error } = res.value.res;
                if (success) {
                    result.successful.push({
                        success: true,
                        item: task
                    });
                } else {
                    result.failed.push({
                        success: false,
                        item: task,
                        error: error || "Processing failed"
                    });
                }
            } else {
                result.failed.push({
                    success: false,
                    item: task,
                    error: res.reason?.message || "Unknown error"
                });
            }
        });

        return result;
    }
}
