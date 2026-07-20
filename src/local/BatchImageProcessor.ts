// BatchImageProcessor.ts - Orchestrator (Delegation Pattern)
import { App, TFile } from 'obsidian';
import ImageConverterPlugin from '../main';
import { ImageProcessor } from './ImageProcessor';
import { FolderAndFilenameManagement } from "./FolderAndFilenameManagement";
import { BatchItemResult, BatchResult } from "../types/BatchTypes";

import { SingleImageProcessor } from './batch/SingleImageProcessor';

/**
 * BatchImageProcessor - Entry point for batch image processing.
 * Delegates to specialized processors for different scopes.
 * 
 * Structure mirrors CloudImageHandler for consistency.
 */
export class BatchImageProcessor {
    private singleImageProcessor: SingleImageProcessor;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private imageProcessor: ImageProcessor,
        private folderAndFilenameManagement: FolderAndFilenameManagement
    ) {
        this.singleImageProcessor = new SingleImageProcessor(app, plugin, imageProcessor, folderAndFilenameManagement);
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

}
