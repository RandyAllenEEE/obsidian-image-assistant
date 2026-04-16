import { App, TFolder, Notice, TFile } from 'obsidian';
import ImageConverterPlugin from '../../main';
import { CloudBatchUploader } from "./CloudBatchUploader";

/**
 * FolderBatchUploader - Uploads all images in a folder to cloud.
 * Extends CloudBatchUploader to eliminate constructor/filters/task-creation duplication.
 */
export class FolderBatchUploader extends CloudBatchUploader {
    private folderPath: string = '';
    private recursive: boolean = false;

    constructor(
        app: App,
        plugin: ImageConverterPlugin
    ) {
        super(app, plugin);
    }

    protected getFilesToUpload(): Promise<TFile[]> {
        const folder = this.app.vault.getAbstractFileByPath(this.folderPath);
        if (!(folder instanceof TFolder)) {
            return Promise.resolve([]);
        }
        const images = this.collector.getImageFilesInFolder(folder, this.recursive);
        return Promise.resolve(images);
    }

    protected getScopePath(): string {
        return this.folderPath;
    }

    protected getDialogTitle(): string {
        return 'Batch Upload Folder';
    }

    async uploadImagesInFolder(folderPath: string, recursive: boolean): Promise<void> {
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) {
            new Notice('Error: Invalid folder path.');
            return;
        }

        this.folderPath = folderPath;
        this.recursive = recursive;

        await this.executeUpload(['replace-all', 'replace-all-delete', 'process-only', 'cancel']);
    }
}