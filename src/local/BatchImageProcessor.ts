// BatchImageProcessor.ts - Orchestrator (Delegation Pattern)
import { App, TFile } from 'obsidian';
import ImageConverterPlugin from '../main';
import { ImageProcessor } from './ImageProcessor';
import { FolderAndFilenameManagement } from "./FolderAndFilenameManagement";
import { BatchItemResult, BatchResult } from "../types/BatchTypes";

import { SingleImageProcessor } from './batch/SingleImageProcessor';
import { ImageFileCollector } from '../utils/batch/ImageFileCollector';

/**
 * BatchImageProcessor - Entry point for batch image processing.
 * Delegates to specialized processors for different scopes.
 * 
 * Structure mirrors CloudImageHandler for consistency.
 */
export class BatchImageProcessor {
    private singleImageProcessor: SingleImageProcessor;
    private imageFileCollector: ImageFileCollector;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private imageProcessor: ImageProcessor,
        private folderAndFilenameManagement: FolderAndFilenameManagement
    ) {
        this.singleImageProcessor = new SingleImageProcessor(app, plugin, imageProcessor, folderAndFilenameManagement);
        this.imageFileCollector = new ImageFileCollector(app, plugin);
    }

    /**
     * Headless batch processing method for UnifiedBatchProcessModal.
     */
    async batchProcess(files: TFile[]): Promise<BatchResult> {
        return this.singleImageProcessor.batchProcess(files);
    }

    async processFile(file: TFile): Promise<BatchItemResult> {
        return this.singleImageProcessor.processFileWithDefaults(file);
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
