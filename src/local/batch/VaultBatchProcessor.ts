import { App, TFile, Notice } from 'obsidian';
import ImageConverterPlugin from '../../main';
import { ImageProcessor } from '../ImageProcessor';
import { FolderAndFilenameManagement } from '../FolderAndFilenameManagement';
import { SingleImageProcessor } from './SingleImageProcessor';
import { t } from '../../lang/helpers';

// Unified Batch Tools
import {
    ImageFileCollector,
    BatchExecutor,
    BatchProgressManager,
    showBatchConfirmDialog,
    BatchTask
} from '../../utils/batch';

/**
 * VaultBatchProcessor - Processes all images in the entire vault.
 * Refactored to use unified batch tools.
 */
export class VaultBatchProcessor {
    private collector: ImageFileCollector;
    private processor: SingleImageProcessor;
    private executor: BatchExecutor<TFile>;
    private progressManager: BatchProgressManager;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private imageProcessor: ImageProcessor,
        private folderAndFilenameManagement: FolderAndFilenameManagement
    ) {
        this.collector = new ImageFileCollector(app, plugin);
        this.processor = new SingleImageProcessor(app, plugin, imageProcessor, folderAndFilenameManagement);
        this.executor = new BatchExecutor({
            concurrency: this.plugin.settings.pasteHandling.cloud.uploadConcurrency || 3,
            collectErrors: true
        });
        this.progressManager = new BatchProgressManager(plugin);
    }

    async processAllVaultImages(): Promise<void> {
        try {
            // 1. Settings
            const {
                convertTo,
                quality,
                resizeMode,
                desiredWidth,
                desiredHeight,
                desiredLength,
                enlargeOrReduce,
                skipFormats: skipFormatsSetting,
                skipImagesInTargetFormat: skipTargetFormat,
            } = this.plugin.settings.operationDefaults.batchLocal;
            const allowLargerFiles = this.plugin.settings.localProcessing.conversion.allowLargerFiles;

            const targetFormat = convertTo;
            const isKeepOriginalFormat = convertTo === "disabled" || convertTo === "Original";
            const outputFormat =
                isKeepOriginalFormat
                    ? "ORIGINAL"
                    : (convertTo.toUpperCase() as "WEBP" | "JPEG" | "PNG" | "ORIGINAL");
            const skipFormats = this.collector.parseSkipFormats(skipFormatsSetting);

            // 2. Collect Images
            this.progressManager.start('collecting');
            const imageFiles = await this.collector.getAllImageFiles();

            if (imageFiles.length === 0) {
                new Notice(t("NOTICE_NO_IMAGES_IN_VAULT"));
                return;
            }

            // 3. Filter Files
            const filesToProcess = imageFiles.filter(file =>
                this.collector.shouldProcessImage(
                    file,
                    isKeepOriginalFormat,
                    targetFormat,
                    skipFormats,
                    skipTargetFormat
                )
            );

            if (filesToProcess.length === 0) {
                new Notice(t("NOTICE_NO_IMAGES_TO_PROCESS"));
                return;
            }

            // 4. Confirm Dialog
            const action = await showBatchConfirmDialog(this.app, {
                title: t("CMD_PROCESS_ALL_VAULT"),
                totalCount: filesToProcess.length,
                multiRefItems: [],
                scopePath: '/',
                actions: ['process-only', 'cancel'],
                mode: 'local'
            });

            if (action === 'cancel') return;

            // 5. Execute Batch
            const tasks: BatchTask<TFile>[] = BatchExecutor.createTasks(
                filesToProcess,
                file => file.name,
                async (file) => {
                    return this.processor.processSingleImage(
                        file, outputFormat, quality, 1, // colorDepth
                        resizeMode, desiredWidth, desiredHeight, desiredLength,
                        enlargeOrReduce, allowLargerFiles
                    );
                }
            );

            const result = await this.executor.execute(tasks, this.progressManager);

            // 6. Finalize
            this.progressManager.complete(result.successful.length);

            if (result.failed.length > 0) {
                this.executor.showSummary(tasks.length, result.successful.length, 'Processing');
            }

        } catch (error) {
            console.error("Error processing images:", error);
            new Notice(`Error processing images: ${error.message}`);
            this.progressManager.cancel();
        }
    }
}
