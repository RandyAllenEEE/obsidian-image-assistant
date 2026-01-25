import { App, TFile, Notice } from 'obsidian';
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
    BatchTask,
    BatchAction
} from '../../utils/batch';

/**
 * NoteBatchProcessor - Processes all images linked in a single note.
 * Refactored to use unified batch tools.
 */
export class NoteBatchProcessor {
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

    async processImagesInNote(noteFile: TFile): Promise<void> {
        try {
            // 1. Settings & Preparations
            const {
                convertTo,
                quality,
                resizeMode,
                desiredWidth,
                desiredHeight,
                desiredLength,
                enlargeOrReduce,
                skipFormats: processCurrentNoteSkipFormats,
                skipImagesInTargetFormat: processCurrentNoteSkipImagesInTargetFormat
            } = this.plugin.settings.processCurrentNote;
            const { revertToOriginalIfLarger, modalBehavior } = this.plugin.settings.global;
            const allowLargerFiles = !revertToOriginalIfLarger;

            const isKeepOriginalFormat = convertTo === 'disabled';
            const targetFormat = convertTo;
            const outputFormat = convertTo === 'disabled' ? 'ORIGINAL' : convertTo.toUpperCase() as 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL';
            const skipFormats = this.collector.parseSkipFormats(processCurrentNoteSkipFormats);

            // 2. Collect Images
            this.progressManager.start('collecting');

            let linkedFiles: TFile[] = [];
            if (noteFile.extension === 'canvas') {
                const canvasImagePaths = await this.collector.getImagesFromCanvas(noteFile);
                linkedFiles = canvasImagePaths
                    .map(path => this.app.vault.getAbstractFileByPath(path))
                    .filter((file): file is TFile =>
                        file instanceof TFile &&
                        this.plugin.supportedImageFormats.isSupported(undefined, file.name)
                    );
            } else {
                linkedFiles = this.collector.getLinkedImageFiles(noteFile);
            }

            // De-duplicate
            linkedFiles = this.collector.deduplicateFiles(linkedFiles);

            if (linkedFiles.length === 0) {
                new Notice('No images found in the note.');
                return;
            }

            // 3. Filter Files
            const filesToProcess = linkedFiles.filter(file =>
                this.collector.shouldProcessImage(
                    file,
                    isKeepOriginalFormat,
                    targetFormat,
                    skipFormats,
                    processCurrentNoteSkipImagesInTargetFormat
                )
            );

            if (filesToProcess.length === 0) {
                new Notice('No images found that need processing.');
                return;
            }

            // 4. Confirm Dialog
            // NoteBatchProcessor uses "processCurrentNote" settings which implies user intent.
            // However, unified experience suggests showing confirmation if modal behavior is appropriate.
            // Or just always show minimal confirmation for batch ops to be safe?
            // Local batch didn't have confirm dialog before, adding it now as per plan.

            const action = await showBatchConfirmDialog(this.app, {
                title: 'Process Note Images',
                totalCount: filesToProcess.length,
                multiRefItems: [], // Local processing logic replaces in-place or updates links automatically safely
                scopePath: noteFile.path,
                actions: ['process-only', 'cancel'], // Simplified actions for local: just process
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

            // Show summary if there were errors
            if (result.failed.length > 0) {
                this.executor.showSummary(tasks.length, result.successful.length, 'Processing');
            }

        } catch (error) {
            console.error('Error processing images in current note:', error);
            new Notice(`Error processing images: ${error.message}`);
            this.progressManager.cancel();
        }
    }
}
