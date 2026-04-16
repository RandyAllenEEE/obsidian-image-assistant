import { App, Editor, TFile, EditorPosition, FileSystemAdapter, normalizePath } from "obsidian";
import { join } from "path-browserify";
import { ImageHandler } from "../core/ImageHandler";
import { UploaderManager } from "./uploader/index";
import { ConcurrentQueue } from "../utils/AsyncLock";
import ImageConverterPlugin from "../main";

import { PasteHandler } from "./handlers/PasteHandler";
import { DropHandler } from "./handlers/DropHandler";
import { SingleUploadHandler } from "./handlers/SingleUploadHandler";
import { FolderBatchUploader } from "./batch/FolderBatchUploader";
import { NoteBatchUploader } from "./batch/NoteBatchUploader";
import { VaultBatchUploader } from "./batch/VaultBatchUploader";
import { CloudResourceHelpers } from "./utils/CloudResourceHelpers";
import { BatchResult } from "../types/BatchTypes";
import { NotificationManager } from "../utils/NotificationManager";
import { t } from "../lang/helpers";
import { NetworkImageDownloader } from "./NetworkImageDownloader";

export class CloudImageHandler implements ImageHandler {
    private app: App;
    private plugin: ImageConverterPlugin;
    private uploaderManager: UploaderManager;
    private concurrentQueue: ConcurrentQueue;

    // Sub-handlers
    private pasteHandler: PasteHandler;
    private dropHandler: DropHandler;
    private singleUploadHandler: SingleUploadHandler;
    private folderBatchUploader: FolderBatchUploader;
    private noteBatchUploader: NoteBatchUploader;
    private vaultBatchUploader: VaultBatchUploader;
    private helpers: CloudResourceHelpers;
    private networkDownloader: NetworkImageDownloader | null = null;

    /**
     * Initialize the network downloader after dependent components are ready.
     * Called from main.ts initializeComponents() after uploadHelper and folderAndFilenameManagement are created.
     */
    initializeDownloader(uploadHelper: any, folderAndFilenameManagement: any): void {
        this.networkDownloader = new NetworkImageDownloader(
            this.app,
            this.plugin,
            uploadHelper,
            folderAndFilenameManagement
        );
    }

    private ensureDownloader(): NetworkImageDownloader {
        if (!this.networkDownloader) {
            throw new Error("NetworkImageDownloader not initialized. Call initializeDownloader() first.");
        }
        return this.networkDownloader;
    }

    constructor(
        app: App,
        plugin: ImageConverterPlugin,
        uploaderManager: UploaderManager,
        concurrentQueue: ConcurrentQueue
    ) {
        this.app = app;
        this.plugin = plugin;
        this.uploaderManager = uploaderManager;
        this.concurrentQueue = concurrentQueue;

        // Initialize sub-handlers
        this.pasteHandler = new PasteHandler(app, plugin);
        this.dropHandler = new DropHandler(app, plugin);
        this.singleUploadHandler = new SingleUploadHandler(app, plugin);
        this.folderBatchUploader = new FolderBatchUploader(app, plugin);
        this.noteBatchUploader = new NoteBatchUploader(app, plugin);
        this.vaultBatchUploader = new VaultBatchUploader(app, plugin);
        this.helpers = new CloudResourceHelpers(plugin);
    }

    async handlePaste(evt: ClipboardEvent, editor: Editor): Promise<void> {
        return this.pasteHandler.handlePaste(evt, editor);
    }

    async handleDrop(evt: DragEvent, editor: Editor): Promise<void> {
        return this.dropHandler.handleDrop(evt, editor);
    }

    /**
     * Handle paste event in cloud mode
     * @deprecated functionality moved to PasteHandler, this method kept for potential external calls if any, but implementation delegated
     */
    private async processPasteFiles(
        itemData: { kind: string; type: string; file: File | null }[],
        editor: Editor,
        cursor: EditorPosition,
        clipboardText?: string
    ) {
        // This is a private method in original, so we don't strictly need to expose it,
        // but PasteHandler logic uses it internally.
        // If we need to expose it, we'd need to cast 'this.pasteHandler' to any or expose it in PasteHandler.
    }

    /* Delegates for Context Menu / Command Palette */

    // Public method for Context Menu usage
    async uploadSingleFile(file: TFile): Promise<void> {
        return this.singleUploadHandler.uploadSingleFile(file);
    }

    /**
     * Upload all local images in the current note to cloud storage
     */
    async uploadAllImages(): Promise<void> {
        return this.noteBatchUploader.uploadAllImages();
    }

    /**
     * Upload all images in the entire vault to cloud storage (New Feature)
     */
    async uploadAllVaultImages(): Promise<void> {
        return this.vaultBatchUploader.uploadAllVaultImages();
    }

    /**
     * Public method to upload folder images
     * @param folderPath - Path to the folder
     * @param recursive - Whether to process subfolders recursively
     */
    async uploadFolderImages(folderPath: string, recursive: boolean = false): Promise<void> {
        return this.folderBatchUploader.uploadImagesInFolder(folderPath, recursive);
    }

    /**
     * Headless batch upload method.
     * Uploads a list of files and returns detailed results.
     * Does NOT handle UI notifications or file deletion/replacement directly.
     * Kept here or moved? It serves general purpose batching.
     * Note: This logic was relatively small (~50 lines) compared to the others.
     * We can keep it here or move to a general 'BatchUploader' service.
     * Given it relies heavily on uploaderManager and concurrentQueue, keeping it or moving to `src/cloud/batch/BatchWorker.ts` is fine.
     * For now, I'll keep it to minimize complexity unless requested, but refactoring task said "Batch Workers".
     * Let's move it to `src/cloud/batch/HeadlessBatchUploader.ts`?
     * Or just re-implement here since it's a utility for the UnifiedModal primarily?
     * The refactoring plan mentioned NoteBatch and FolderBatch.
     * I will keep it here for now or delegate to FolderBatchUploader if it has similar logic? No, it takes TFile[].
     * 
     * Update: Re-reading plan. I didn't explicitly plan for `batchUpload(files: TFile[])`.
     * I will leave it here implementation-wise for now or move it if I see fit.
     * Actually, looking at `uploadFolderImages` in `FolderBatchUploader`, it uses similar logic.
     * I'll leave it here to avoid over-engineering right now, as it's not the "bloated" part (bloated parts were uploadAllImages and uploadFolderImages).
     */
    async handlePasteText(
        clipboardText: string,
        editor: Editor,
        cursor: EditorPosition,
        evt: ClipboardEvent
    ): Promise<void> {
        return this.pasteHandler.handlePasteText(clipboardText, editor, cursor, evt);
    }

    async batchUpload(files: TFile[]): Promise<BatchResult> {
        return this.runBatchUpload(files);
    }

    private async runBatchUpload(files: TFile[]): Promise<BatchResult> {
        const result: BatchResult = {
            successful: [],
            failed: [],
            cancelled: false
        };

        // Use the class's existing uploaderManager instance instead of creating a new one
        const tasks = files.map(file => async () => {
            try {
                let uploadPath = file.path;
                if (!this.plugin.settings.pasteHandling.cloud.remoteServerMode) {
                    const adapter = this.app.vault.adapter;
                    if (adapter instanceof FileSystemAdapter) {
                        const basePath = adapter.getBasePath();
                        uploadPath = normalizePath(join(basePath, file.path));
                    }
                }

                const uploadRes = await this.uploaderManager.upload([uploadPath]);

                if (uploadRes.success) {
                    result.successful.push({
                        success: true,
                        item: file,
                        output: uploadRes.result[0]
                    });
                } else {
                    result.failed.push({
                        success: false,
                        item: file,
                        error: uploadRes.msg || "Upload failed"
                    });
                }
            } catch (e) {
                result.failed.push({
                    success: false,
                    item: file,
                    error: e.message
                });
            }
        });

        await this.concurrentQueue.runSettled(tasks);
        return result;
    }

    // Proxy for blacklisted domain check if needed externally?
    // It was private, used by handlePasteText (now in PasteHandler) and uploadAllImages (NoteBatchUploader).
    // So no need to expose.

    /* Download delegation methods */

    async downloadSingleImage(url: string, activeFile: TFile, editor: Editor): Promise<boolean> {
        return this.ensureDownloader().downloadSingleImage(url, activeFile, editor);
    }

    async downloadAllNetworkImages(): Promise<void> {
        return this.ensureDownloader().downloadAllNetworkImages();
    }

    async downloadFolderImages(folderPath: string, recursive: boolean): Promise<void> {
        return this.ensureDownloader().downloadFolderImages(folderPath, recursive);
    }

    async batchDownload(tasks: any[]): Promise<any> {
        return this.ensureDownloader().batchDownload(tasks);
    }
}
