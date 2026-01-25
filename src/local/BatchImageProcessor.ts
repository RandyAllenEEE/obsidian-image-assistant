// BatchImageProcessor.ts - Orchestrator (Delegation Pattern)
import { App, TFile } from 'obsidian';
import ImageConverterPlugin from '../main';
import { ImageProcessor } from './ImageProcessor';
import { FolderAndFilenameManagement } from "./FolderAndFilenameManagement";
import { BatchResult } from "../types/BatchTypes";

// Import sub-processors
import { NoteBatchProcessor } from './batch/NoteBatchProcessor';
import { FolderBatchProcessor } from './batch/FolderBatchProcessor';
import { VaultBatchProcessor } from './batch/VaultBatchProcessor';
import { SingleImageProcessor } from './batch/SingleImageProcessor';
import { ImageFileCollector } from '../utils/batch/ImageFileCollector';

/**
 * BatchImageProcessor - Entry point for batch image processing.
 * Delegates to specialized processors for different scopes.
 * 
 * Structure mirrors CloudImageHandler for consistency.
 */
export class BatchImageProcessor {
    // Sub-processors
    private noteBatchProcessor: NoteBatchProcessor;
    private folderBatchProcessor: FolderBatchProcessor;
    private vaultBatchProcessor: VaultBatchProcessor;
    private singleImageProcessor: SingleImageProcessor;
    private imageFileCollector: ImageFileCollector;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private imageProcessor: ImageProcessor,
        private folderAndFilenameManagement: FolderAndFilenameManagement
    ) {
        // Initialize sub-processors
        this.noteBatchProcessor = new NoteBatchProcessor(app, plugin, imageProcessor, folderAndFilenameManagement);
        this.folderBatchProcessor = new FolderBatchProcessor(app, plugin, imageProcessor, folderAndFilenameManagement);
        this.vaultBatchProcessor = new VaultBatchProcessor(app, plugin, imageProcessor, folderAndFilenameManagement);
        this.singleImageProcessor = new SingleImageProcessor(app, plugin, imageProcessor, folderAndFilenameManagement);
        this.imageFileCollector = new ImageFileCollector(app, plugin);
    }

    /**
     * Process all images linked in a note.
     */
    async processImagesInNote(noteFile: TFile): Promise<void> {
        return this.noteBatchProcessor.processImagesInNote(noteFile);
    }

    /**
     * Process all images in a folder.
     */
    async processImagesInFolder(folderPath: string, recursive: boolean): Promise<void> {
        return this.folderBatchProcessor.processImagesInFolder(folderPath, recursive);
    }

    /**
     * Process all images in the entire vault.
     */
    async processAllVaultImages(): Promise<void> {
        return this.vaultBatchProcessor.processAllVaultImages();
    }

    /**
     * Headless batch processing method for UnifiedBatchProcessModal.
     */
    async batchProcess(files: TFile[]): Promise<BatchResult> {
        return this.singleImageProcessor.batchProcess(files);
    }

    /**
     * Get all image files in the vault.
     * Exposed for external usage (e.g., modals).
     */
    async getAllImageFiles(): Promise<TFile[]> {
        return this.imageFileCollector.getAllImageFiles();
    }

    /**
     * Get images from a canvas file.
     * Exposed for external usage.
     */
    async getImagesFromCanvas(file: TFile): Promise<string[]> {
        return this.imageFileCollector.getImagesFromCanvas(file);
    }

    /**
     * Get linked image files in a note.
     * Exposed for external usage.
     */
    getLinkedImageFiles(noteFile: TFile): TFile[] {
        return this.imageFileCollector.getLinkedImageFiles(noteFile);
    }

    /**
     * Check if an image should be processed.
     * Exposed for external usage.
     */
    shouldProcessImage(
        image: TFile,
        isKeepOriginalFormat: boolean,
        targetFormat: string,
        skipFormats: string[],
        skipImagesInTargetFormat: boolean
    ): boolean {
        return this.imageFileCollector.shouldProcessImage(
            image, isKeepOriginalFormat, targetFormat, skipFormats, skipImagesInTargetFormat
        );
    }
}
