import { App, TFile, TFolder, Notice } from 'obsidian';
import ImageConverterPlugin from '../../main';
import { ImageProcessor } from '../ImageProcessor';
import { FolderAndFilenameManagement } from '../FolderAndFilenameManagement';
import { SingleImageProcessor } from './SingleImageProcessor';

// Unified Batch Tools
import {
    ImageFileCollector,
    BatchExecutor,
    BatchProgressManager,
    showBatchConfirmDialog,
    BatchTask
} from '../../utils/batch';

/**
 * FolderBatchProcessor - Processes all images in a folder.
 * Refactored to use unified batch tools.
 */
export class FolderBatchProcessor {
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

    async processImagesInFolder(folderPath: string, recursive: boolean): Promise<void> {
        try {
            // 1. Validate Folder
            const folder = this.app.vault.getAbstractFileByPath(folderPath);
            if (!(folder instanceof TFolder)) {
                new Notice('Error: Invalid folder path.');
                return;
            }

            // 2. Settings
            const {
                convertTo,
                quality,
                resizeMode,
                desiredWidth,
                desiredHeight,
                desiredLength,
                enlargeOrReduce,
                skipFormats: processCurrentNoteSkipFormats,
            } = this.plugin.settings.processCurrentNote;

            const { revertToOriginalIfLarger } = this.plugin.settings.global;
            const allowLargerFiles = !revertToOriginalIfLarger;

            const outputFormat = convertTo === 'disabled' ? 'ORIGINAL' : convertTo.toUpperCase() as 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL';
            const skipFormats = this.collector.parseSkipFormats(processCurrentNoteSkipFormats);

            // 3. Collect Images
            this.progressManager.start('collecting');
            const images = this.collector.getImageFilesInFolder(folder, recursive);

            if (images.length === 0) {
                new Notice('No images found in the folder.');
                return;
            }

            // 4. Filter Files
            const filesToProcess = images.filter(image =>
                !skipFormats.includes(image.extension.toLowerCase())
            );

            if (filesToProcess.length === 0) {
                new Notice('No images found that need processing (all skipped).');
                return;
            }

            // 5. Confirm Dialog
            const action = await showBatchConfirmDialog(this.app, {
                title: 'Process Folder Images',
                totalCount: filesToProcess.length,
                multiRefItems: [], // Local processing logic replaces in-place or updates links automatically safely
                scopePath: folderPath,
                actions: ['process-only', 'cancel'],
                mode: 'local'
            });

            if (action === 'cancel') return;

            // 6. Execute Batch
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

            // 7. Finalize
            this.progressManager.complete(result.successful.length);

            if (result.failed.length > 0) {
                this.executor.showSummary(tasks.length, result.successful.length, 'Processing');
            }

        } catch (error) {
            console.error('Error processing images in folder:', error);
            new Notice(`Error processing images: ${error.message}`);
            this.progressManager.cancel();
        }
    }
}
