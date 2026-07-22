import { App, TFile } from 'obsidian';
import ImageConverterPlugin from '../../main';
import { ImageProcessor } from '../ImageProcessor';
import { FolderAndFilenameManagement } from '../FolderAndFilenameManagement';
import { ResizeMode, EnlargeReduce } from '../../settings/types';
import { BatchItemResult, BatchResult } from '../../types/BatchTypes';
import { ConcurrentQueue } from '../../utils/AsyncLock';
import { t } from '../../lang/helpers';
import { BatchOutputFormat, toBatchOutputFormat } from './BatchFormat';
import { ImageConversionCommitter } from '../ImageConversionCommitter';
import { getErrorMessage } from '../../utils/ErrorUtils';
import { resolveProcessedImageFilename } from '../../utils/ProcessedImageFilename';
import { createReferenceMutationScanPolicy } from '../../utils/ReferenceScanPolicy';
import { detectImageBinaryType } from '../../utils/ImageBinaryType';
import { captureImageFileRevision } from '../../utils/ImageFileRevision';

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
    ): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
        try {
            const sourceData = await this.app.vault.readBinary(file);
            const sourceRevision = await captureImageFileRevision(this.app, file, sourceData);
            const detected = await detectImageBinaryType(sourceData);
            const sourceFile = new File(
                [sourceData],
                file.name,
                { type: detected?.mime ?? 'application/octet-stream' }
            );

            // 1. Process Image
            const processedImage = await this.imageProcessor.processImageDetailed(
                sourceFile,
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

            if (processedImage.outcome !== "converted") {
                return {
                    success: false,
                    skipped: true,
                    error: processedImage.reason ?? t("MSG_SIZE_REDUCTION_INSUFFICIENT")
                };
            }

            // Check Revert to Original logic (including minimum savings)
            const originalSize = file.stat.size;
            const minSavingsKB = (typeof (this.plugin.settings.localProcessing.conversion.minimumCompressionSavingsInKB) === 'number'
                && this.plugin.settings.localProcessing.conversion.minimumCompressionSavingsInKB >= 0)
                ? this.plugin.settings.localProcessing.conversion.minimumCompressionSavingsInKB
                : 30;

            const shouldRevertIfLarger = !allowLargerFiles;

            if (shouldRevertIfLarger && processedImage.data.byteLength + (minSavingsKB * 1024) > originalSize) {
                return { success: false, skipped: true, error: t("MSG_SIZE_REDUCTION_INSUFFICIENT") };
            }

            const newFileName = await resolveProcessedImageFilename(file, sourceData, processedImage);
            const committer = new ImageConversionCommitter(
                this.app,
                this.folderAndFilenameManagement,
                this.plugin.vaultReferenceManager,
                createReferenceMutationScanPolicy(
                    this.plugin.settings.global.codeBlockImageLinkIndexing
                ),
                () => this.plugin.settings.localProcessing.link,
                this.plugin.referenceIndexService,
                () => this.plugin.settings.cleanerSettings
            );
            await committer.commit(file, newFileName, processedImage.data, sourceRevision);
            return { success: true };
        } catch (error) {
            console.error(`Failed to process image ${file.path}:`, error);
            return { success: false, error: error instanceof Error ? error.message : String(error) };
        }
    }

    async processFileWithDefaults(file: TFile): Promise<BatchItemResult> {
        const {
            convertTo,
            quality,
            resizeMode,
            desiredWidth,
            desiredHeight,
            desiredLength,
            enlargeOrReduce
        } = this.plugin.settings.operationDefaults.batchLocal;
        const result = await this.processSingleImage(
            file,
            toBatchOutputFormat(convertTo),
            quality,
            1,
            resizeMode,
            desiredWidth,
            desiredHeight,
            desiredLength,
            enlargeOrReduce,
            this.plugin.settings.localProcessing.conversion.allowLargerFiles
        );
        if (result.success) return { status: "success", success: true, item: file };
        if (result.skipped) {
            return {
                status: "skipped",
                success: false,
                skipped: true,
                item: file,
                error: result.error || t("MSG_SIZE_REDUCTION_INSUFFICIENT")
            };
        }
        return {
            status: "failed",
            success: false,
            item: file,
            error: result.error || t("MSG_UNKNOWN_ERROR")
        };
    }

    /**
     * Batch process multiple files and return results.
     */
    async batchProcess(files: TFile[]): Promise<BatchResult> {
        const result: BatchResult = {
            successful: [],
            failed: [],
            skipped: [],
            cancelled: false
        };

        if (files.length === 0) return result;

        const concurrency = this.plugin.settings.global.batchConcurrency || 3;
        const queue = new ConcurrentQueue(concurrency);

        const tasks = files.map(file => async () => {
            return this.processFileWithDefaults(file);
        });

        const results = await queue.runSettled(tasks);

        results.forEach((res, index) => {
            const task = files[index];
            if (res.status === 'fulfilled') {
                if (res.value.status === "success") result.successful.push(res.value);
                else if (res.value.status === "skipped") result.skipped.push(res.value);
                else result.failed.push(res.value);
            } else {
                result.failed.push({
                    status: "failed",
                    success: false,
                    item: task,
                    error: getErrorMessage(res.reason)
                });
            }
        });

        return result;
    }
}
