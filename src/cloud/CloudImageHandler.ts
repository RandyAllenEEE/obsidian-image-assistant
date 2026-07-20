import { App, Editor, TFile, EditorPosition } from "obsidian";
import { ImageHandler } from "../core/ImageHandler";
import { UploaderManager } from "./uploader/index";
import { ConcurrentQueue } from "../utils/AsyncLock";
import ImageConverterPlugin from "../main";

import { PasteHandler } from "./handlers/PasteHandler";
import { DropHandler } from "./handlers/DropHandler";
import { SingleUploadHandler } from "./handlers/SingleUploadHandler";
import { BatchItemResult, BatchResult } from "../types/BatchTypes";
import { NetworkImageDownloader, type DownloadResult } from "./NetworkImageDownloader";
import type { ClickedImageReferenceContext } from "../utils/ImageReferenceWorkflowCoordinator";
import type { EditorImageInsertionContext } from "../core/EditorImageInsertionContext";
import type { FolderAndFilenameManagement } from "../local/FolderAndFilenameManagement";

export class CloudImageHandler implements ImageHandler {
    private app: App;
    private plugin: ImageConverterPlugin;
    private injectedUploaderManager: UploaderManager | null;
    private concurrentQueue: ConcurrentQueue;

    // Sub-handlers
    private pasteHandler: PasteHandler;
    private dropHandler: DropHandler;
    private singleUploadHandler: SingleUploadHandler;
    private networkDownloader: NetworkImageDownloader | null = null;

    /**
     * Initialize the network downloader after dependent components are ready.
     * Called from main.ts initializeComponents() after folderAndFilenameManagement is created.
     */
    initializeDownloader(folderAndFilenameManagement: FolderAndFilenameManagement): void {
        this.networkDownloader = new NetworkImageDownloader(
            this.app,
            this.plugin,
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
        uploaderManager: UploaderManager | null,
        concurrentQueue: ConcurrentQueue
    ) {
        this.app = app;
        this.plugin = plugin;
        this.injectedUploaderManager = uploaderManager;
        this.concurrentQueue = concurrentQueue;

        // Initialize sub-handlers
        this.pasteHandler = new PasteHandler(app, plugin);
        this.dropHandler = new DropHandler(app, plugin);
        this.singleUploadHandler = new SingleUploadHandler(app, plugin);
    }

    async handlePaste(
        evt: ClipboardEvent,
        editor: Editor,
        context: EditorImageInsertionContext
    ): Promise<void> {
        return this.pasteHandler.handlePaste(evt, editor, context);
    }

    async handleDrop(
        evt: DragEvent,
        editor: Editor,
        context: EditorImageInsertionContext
    ): Promise<void> {
        return this.dropHandler.handleDrop(evt, editor, context);
    }

    /* Delegates for Context Menu / Command Palette */

    // Public method for Context Menu usage
    async uploadSingleFile(
        file: TFile,
        clickedContext?: ClickedImageReferenceContext
    ): Promise<void> {
        return this.singleUploadHandler.uploadSingleFile(file, clickedContext);
    }

    async handlePasteText(
        clipboardText: string,
        editor: Editor,
        cursor: EditorPosition,
        evt: ClipboardEvent,
        context: EditorImageInsertionContext
    ): Promise<void> {
        return this.pasteHandler.handlePasteText(
            clipboardText,
            editor,
            cursor,
            evt,
            context
        );
    }

    async batchUpload(files: TFile[]): Promise<BatchResult> {
        return this.runBatchUpload(files);
    }

    async uploadFileHeadless(file: TFile): Promise<BatchItemResult> {
        const uploaderManager = this.injectedUploaderManager ?? new UploaderManager(
            this.plugin.settings.pasteHandling.cloud.uploader,
            this.plugin
        );
        try {
            const uploadRes = await uploaderManager.upload([{
                path: file.path,
                name: file.name,
                source: file.path,
                file,
            }]);
            const uploadedUrl = uploadRes.success && typeof uploadRes.result?.[0] === "string"
                ? uploadRes.result[0].trim()
                : "";
            return uploadedUrl
                ? { status: "success", success: true, item: file, output: uploadedUrl }
                : {
                    status: "failed",
                    success: false,
                    item: file,
                    error: uploadRes.msg || "Upload returned no URL"
                };
        } catch (error) {
            return {
                status: "failed",
                success: false,
                item: file,
                error: error instanceof Error ? error.message : String(error)
            };
        }
    }

    private async runBatchUpload(files: TFile[]): Promise<BatchResult> {
        const result: BatchResult = {
            successful: [],
            failed: [],
            skipped: [],
            cancelled: false
        };

        const tasks = files.map(file => async () => this.uploadFileHeadless(file));

        const settled = await this.concurrentQueue.runSettled(tasks);
        settled.forEach((entry, index) => {
            if (entry.status === "fulfilled") {
                if (entry.value.status === "success") result.successful.push(entry.value);
                else if (entry.value.status === "skipped") result.skipped.push(entry.value);
                else result.failed.push(entry.value);
                return;
            }
            result.failed.push({
                status: "failed",
                success: false,
                item: files[index],
                error: entry.reason instanceof Error ? entry.reason.message : String(entry.reason)
            });
        });
        return result;
    }

    /* Download delegation methods */

    async downloadSingleImageFile(url: string, activeFile: TFile): Promise<DownloadResult> {
        return this.ensureDownloader().downloadSingleImageFile(url, activeFile);
    }

    async downloadImageToFolder(
        url: string,
        targetFolder: string,
        suggestedName: string,
        sourceFile: TFile
    ): Promise<DownloadResult> {
        return this.ensureDownloader().downloadSingleImageInternal(url, targetFolder, suggestedName, sourceFile);
    }

    async undoDownload(result: DownloadResult): Promise<boolean> {
        return this.ensureDownloader().undoDownload(result);
    }

    discardDownloadUndo(result: DownloadResult): void {
        this.ensureDownloader().discardDownloadUndo(result);
    }

    destroy(): void {
        this.networkDownloader?.clearUndoJournal();
        this.networkDownloader = null;
    }
}
