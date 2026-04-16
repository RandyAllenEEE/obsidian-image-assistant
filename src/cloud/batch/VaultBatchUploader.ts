import { App, Notice, TFile } from 'obsidian';
import ImageConverterPlugin from '../../main';
import { CloudBatchUploader } from "./CloudBatchUploader";

// Unified Batch Tools
import {
    BatchTask,
    computeMultiRefItems
} from "../../utils/batch";

/**
 * VaultBatchUploader - Uploads all images in the entire vault to cloud.
 * Extends CloudBatchUploader to eliminate constructor/filters/task-creation duplication.
 */
export class VaultBatchUploader extends CloudBatchUploader {

    constructor(
        app: App,
        plugin: ImageConverterPlugin
    ) {
        super(app, plugin);
    }

    protected getFilesToUpload(): Promise<TFile[]> {
        return this.collector.getAllImageFiles();
    }

    protected getScopePath(): string {
        return '/';
    }

    protected getDialogTitle(): string {
        return 'Process All Vault Images (Cloud Upload)';
    }

    async uploadAllVaultImages(): Promise<void> {
        await this.executeUpload(['replace-all', 'replace-all-delete', 'process-only', 'cancel']);
    }
}