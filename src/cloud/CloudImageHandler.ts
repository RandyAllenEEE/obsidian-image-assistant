
import { App, Editor, Notice, TFile, TFolder, MarkdownView, normalizePath, FileSystemAdapter, EditorPosition } from "obsidian";
import { ImageHandler } from "../core/ImageHandler";
import { UploaderManager } from "./uploader/index";
import { CloudLinkFormatter } from "./CloudLinkFormatter";
import { UploadHelper, ImageLink } from "../utils/UploadHelper";
import { ConcurrentQueue } from "../utils/AsyncLock";
import ImageConverterPlugin from "../main";
import { t } from "../lang/helpers";
import { join, dirname, extname } from "path-browserify";

import {
    UploadErrorDialog,
    NoReferenceUploadDialog,
    SingleReferenceUploadDialog,
    MultiReferenceUploadDialog,
    ImageMatchResult,
    ImageMatch,
    BatchUploadConfirmDialog,
    BatchUploadTaskInfo
} from "../ui/modals/UploadModals";
import { EditorContentInserter } from "../utils/EditorContentInserter";
import { CloudImageDeleter } from "./CloudImageDeleter";
import { NotificationManager } from "../utils/NotificationManager";
import { BatchResult, BatchItemResult } from "../types/BatchTypes";

export class CloudImageHandler implements ImageHandler {
    private app: App;
    private plugin: ImageConverterPlugin;
    private uploaderManager: UploaderManager;
    private concurrentQueue: ConcurrentQueue;

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
    }

    async handlePaste(evt: ClipboardEvent, editor: Editor): Promise<void> {
        if (!evt.clipboardData) return;

        const cursor = editor.getCursor();
        const itemData: { kind: string, type: string, file: File | null }[] = [];
        for (let i = 0; i < evt.clipboardData.items.length; i++) {
            const item = evt.clipboardData.items[i];
            const file = item.kind === "file" ? item.getAsFile() : null;
            itemData.push({ kind: item.kind, type: item.type, file });
        }

        const clipboardText = evt.clipboardData.getData('text/plain');

        const hasSupportedItems = itemData.some(data =>
            data.kind === "file" &&
            data.file &&
            this.plugin.supportedImageFormats.isSupported(data.type, data.file.name) &&
            !this.plugin.folderAndFilenameManagement.matchesPatterns(data.file.name, this.plugin.settings.pasteHandling.neverProcessFilenames)
        );

        if (hasSupportedItems) {
            evt.preventDefault();
            await this.processPasteFiles(itemData, editor, cursor, clipboardText);
        } else if (clipboardText) {
            await this.handlePasteText(clipboardText, editor, cursor, evt);
        }
    }

    async handleDrop(evt: DragEvent, editor: Editor): Promise<void> {
        if (!evt.dataTransfer) return;

        const pos = editor.posAtMouse(evt);
        if (!pos) return;

        const fileData: { name: string, type: string, file: File }[] = [];
        for (let i = 0; i < evt.dataTransfer.files.length; i++) {
            const file = evt.dataTransfer.files[i];
            fileData.push({ name: file.name, type: file.type, file });
        }

        const hasSupportedFiles = fileData.some(data =>
            this.plugin.supportedImageFormats.isSupported(data.type, data.name) &&
            !this.plugin.folderAndFilenameManagement.matchesPatterns(data.name, this.plugin.settings.pasteHandling.neverProcessFilenames)
        );

        if (hasSupportedFiles) {
            evt.preventDefault();
            await this.processDropFiles(fileData, editor, pos);
        }
    }

    /**
     * Handle paste event in cloud mode
     */
    private async processPasteFiles(
        itemData: { kind: string; type: string; file: File | null }[],
        editor: Editor,
        cursor: EditorPosition,
        clipboardText?: string
    ) {
        console.log('[Cloud Upload] processPasteFiles called with', itemData.length, 'items');

        const hasText = clipboardText && clipboardText.trim().length > 0;
        const hasImageFile = itemData.some(data => data.kind === "file" && data.file);

        if (hasText && hasImageFile && !this.plugin.settings.pasteHandling.cloud.applyImage) {
            console.log('[Cloud Upload] Skipping upload: clipboard has both text and image, but applyImage is disabled');
            return;
        }

        const supportedFiles = itemData
            .filter(data => data.kind === "file" && data.file &&
                this.plugin.supportedImageFormats.isSupported(data.type, data.file.name))
            .map(data => data.file!)
            .filter((file): file is File => file !== null);

        if (supportedFiles.length === 0) return;

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file detected.');
            return;
        }

        for (const file of supportedFiles) {
            // Insert uploading placeholder using EditorContentInserter
            const inserter = new EditorContentInserter(this.app.workspace.getActiveViewOfType(MarkdownView)!);
            inserter.insertLoadingText(`${t("LOADING_UPLOAD") || "Uploading"} ${file.name}...`);

            try {
                const uploaderManager = new UploaderManager(
                    this.plugin.settings.pasteHandling.cloud.uploader,
                    this.plugin
                );

                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                const fileList = dataTransfer.files;

                const uploadResult = await uploaderManager.uploadByClipboard(fileList);
                const cloudUrl = uploadResult.result[0];
                const cloudLink = CloudLinkFormatter.formatCloudLink(
                    cloudUrl,
                    this.plugin.settings.pasteHandling.cloud
                );

                inserter.insertResponseToEditor(cloudLink);
                new Notice('Image uploaded successfully!');
            } catch (error) {
                console.error('[Cloud Upload] Upload failed:', error);
                new Notice(`Upload failed: ${error.message}`);
                inserter.removeLoadingText();
            } finally {
                // this.plugin.clearMemory(); // Not needed if we don't access plugin internals essentially
            }
        }

        if (this.plugin.settings.captions.enabled) {
            this.plugin.imageStateManager?.refreshAllImages();
        }
    }

    private async processDropFiles(
        fileData: { name: string; type: string; file: File }[],
        editor: Editor,
        pos: EditorPosition
    ) {
        // Logic similar to processPasteFiles but for Drop
        const supportedFiles = fileData
            .filter(data => this.plugin.supportedImageFormats.isSupported(data.type, data.name))
            .map(data => data.file);

        if (supportedFiles.length === 0) return;

        // Setup inserter logic for Drop is tricky as we need to insert at 'pos'
        // EditorContentInserter usually inserts at cursor.
        // We might need to manually handle insertion for Drop to match cursor 'pos'
        // However, standard logic often moves cursor to drop pos first?
        editor.setCursor(pos);

        for (const file of supportedFiles) {
            const inserter = new EditorContentInserter(this.app.workspace.getActiveViewOfType(MarkdownView)!);
            inserter.insertLoadingText(`${t("LOADING_UPLOAD") || "Uploading"} ${file.name}...`);

            try {
                const uploaderManager = new UploaderManager(
                    this.plugin.settings.pasteHandling.cloud.uploader,
                    this.plugin
                );

                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                const fileList = dataTransfer.files;

                const uploadResult = await uploaderManager.uploadByClipboard(fileList);
                const cloudUrl = uploadResult.result[0];
                const cloudLink = CloudLinkFormatter.formatCloudLink(
                    cloudUrl,
                    this.plugin.settings.pasteHandling.cloud
                );

                inserter.insertResponseToEditor(cloudLink);
                new Notice('Image uploaded successfully!');
            } catch (error) {
                console.error('[Cloud Drop] Upload failed:', error);
                new Notice(`Upload failed: ${error.message}`);
                inserter.removeLoadingText();
            }
        }

        if (this.plugin.settings.captions.enabled) {
            this.plugin.imageStateManager?.refreshAllImages();
        }
    }

    public async handlePasteText(
        clipboardText: string,
        editor: Editor,
        cursor: EditorPosition,
        evt: ClipboardEvent
    ) {
        if (!this.plugin.settings.pasteHandling.cloud.workOnNetWork) {
            return;
        }

        const imageUrlRegex = /!\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g;
        const markdownMatches = [...clipboardText.matchAll(imageUrlRegex)];

        // Import regex from internal utils if possible, or duplicate
        // const { REGEX_WIKI_NETWORK_IMAGE } = await import('../utils/RegexPatterns');
        const REGEX_WIKI_NETWORK_IMAGE = /!\[\[(https?:\/\/[^\]]+)(?:\|([^\]]+))?\]\]/g; // Approximate duplication if import fails
        const wikilinkMatches = [...clipboardText.matchAll(REGEX_WIKI_NETWORK_IMAGE)];

        const totalMatches = markdownMatches.length + wikilinkMatches.length;
        if (totalMatches === 0) return;

        // Filter blacklisted
        const validMarkdownMatches = markdownMatches.filter(match => !this.isBlacklistedDomain(match[2]));
        const validWikilinkMatches = wikilinkMatches.filter(match => !this.isBlacklistedDomain(match[1]));

        if (validMarkdownMatches.length === 0 && validWikilinkMatches.length === 0) return;

        evt.preventDefault();

        // Process logic...
        let newContent = clipboardText;
        const uploaderManager = new UploaderManager(
            this.plugin.settings.pasteHandling.cloud.uploader,
            this.plugin
        );

        // Process Markdown
        for (const match of validMarkdownMatches) {
            const originalLink = match[0];
            const imageUrl = match[2];
            try {
                const uploadResult = await uploaderManager.upload([imageUrl]);
                if (uploadResult.success && uploadResult.result.length > 0) {
                    const cloudUrl = uploadResult.result[0];
                    const cloudLink = CloudLinkFormatter.formatCloudLink(
                        cloudUrl,
                        this.plugin.settings.pasteHandling.cloud,
                        originalLink
                    );
                    newContent = newContent.replace(originalLink, cloudLink);
                }
            } catch (e) { console.error(e); }
        }

        // Process Wikilink
        for (const match of validWikilinkMatches) {
            const originalLink = match[0];
            const imageUrl = match[1];
            try {
                const uploadResult = await uploaderManager.upload([imageUrl]);
                if (uploadResult.success && uploadResult.result.length > 0) {
                    const cloudUrl = uploadResult.result[0];
                    const cloudLink = CloudLinkFormatter.formatCloudLink(
                        cloudUrl,
                        this.plugin.settings.pasteHandling.cloud,
                        originalLink
                    );
                    newContent = newContent.replace(originalLink, cloudLink);
                }
            } catch (e) { console.error(e); }
        }

        editor.replaceRange(newContent, cursor);
    }

    private isBlacklistedDomain(url: string): boolean {
        try {
            const blacklist = this.plugin.settings.pasteHandling.cloud.newWorkBlackDomains;
            if (!blacklist || blacklist.trim() === '') return false;

            const domains = blacklist.split(',').map(d => d.trim().toLowerCase()).filter(d => d.length > 0);
            if (domains.length === 0) return false;

            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();
            return domains.some(domain => hostname === domain || hostname.endsWith('.' + domain));
        } catch (error) {
            return false;
        }
    }

    // Public method for Context Menu usage
    async uploadSingleFile(file: TFile): Promise<void> {
        if (file.path.startsWith('http://') || file.path.startsWith('https://')) {
            new Notice('⚠️ 不能上传网络图片，请只上传本地图片文件');
            return;
        }

        const uploadResult = await this.uploadWithRetry(file);
        if (!uploadResult) return;
        const { cloudUrl } = uploadResult;
        new Notice(`上传成功: ${cloudUrl}`);

        const references = await this.plugin.vaultReferenceManager.getFilesReferencingImage(file.path);

        const matches: ImageMatchResult = { totalCount: references.length, files: [] };
        const fileGroups = new Map<string, ImageMatch[]>();
        for (const ref of references) {
            if (!fileGroups.has(ref.file.path)) fileGroups.set(ref.file.path, []);
            fileGroups.get(ref.file.path)?.push({ lineNumber: 0, line: ref.original, original: ref.original });
        }
        for (const [path, matchItems] of fileGroups.entries()) matches.files.push({ path: path, matches: matchItems });

        if (matches.totalCount > 0) {
            const currentNote = this.app.workspace.getActiveFile();
            const currentNotePath = currentNote ? currentNote.path : undefined;
            if (matches.totalCount === 1) {
                const match = matches.files[0];
                new SingleReferenceUploadDialog(this.app, file.name, cloudUrl, { file: match.path, line: match.matches[0].lineNumber }, (choice) => {
                    if (choice === 'replace') this.updateLinksWithManager(file.path, cloudUrl);
                    else if (choice === 'replace-delete') this.updateLinksWithManager(file.path, cloudUrl).then(() => this.app.vault.trash(file, true));
                    else if (choice === 'undo') this.deleteCloudImage(cloudUrl);
                }).open();
            } else {
                new MultiReferenceUploadDialog(this.app, file.name, cloudUrl, matches, currentNotePath, (choice) => {
                    if (choice === 'replace-current') this.updateLinksWithManager(file.path, cloudUrl, currentNotePath ? [currentNotePath] : undefined);
                    else if (choice === 'replace-all') this.updateLinksWithManager(file.path, cloudUrl);
                    else if (choice === 'replace-all-delete') this.updateLinksWithManager(file.path, cloudUrl).then(() => this.app.vault.trash(file, true));
                }).open();
            }
        } else {
            new NoReferenceUploadDialog(this.app, file.name, cloudUrl, file, (choice) => {
                if (choice === 'delete-all') { this.deleteCloudImage(cloudUrl); this.app.vault.trash(file, true); }
                else if (choice === 'keep-cloud') this.app.vault.trash(file, true);
            }).open();
        }
    }

    private async uploadWithRetry(file: TFile): Promise<{ cloudUrl: string } | null> {
        let retryCount = 0;
        const maxRetries = 3;
        while (retryCount < maxRetries) {
            try {
                new Notice(`正在上传 ${file.name}...`);
                if (!await this.validateFileExists(file)) throw new Error('文件不存在');

                const uploaderManager = new UploaderManager(this.plugin.settings.pasteHandling.cloud.uploader, this.plugin);
                const uploadPath = this.buildUploadPath(file);
                const uploadResult = await uploaderManager.upload([uploadPath]);
                return { cloudUrl: uploadResult.result[0] };
            } catch (error) {
                retryCount++;
                if (retryCount >= maxRetries) {
                    const retry = await new Promise<boolean>((resolve) => {
                        new UploadErrorDialog(this.app, file.name, error.message, (choice) => resolve(choice === 'retry')).open();
                    });
                    if (retry) retryCount = 0; else return null;
                } else {
                    new Notice(`上传失败,正在重试... (${retryCount}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }
        }
        return null;
    }

    private buildUploadPath(file: TFile): string {
        if (this.plugin.settings.pasteHandling.cloud.remoteServerMode) return file.path;
        const basePath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
        return normalizePath(join(basePath, file.path));
    }

    private async validateFileExists(file: TFile): Promise<boolean> {
        return await this.app.vault.adapter.exists(file.path);
    }

    private async updateLinksWithManager(imagePath: string, cloudUrl: string, scopeFiles?: string[]): Promise<number> {
        const count = await this.plugin.vaultReferenceManager.updateReferences(imagePath, (loc) => {
            if (scopeFiles && !scopeFiles.includes(loc.file.path)) return loc.original;
            return CloudLinkFormatter.formatCloudLink(cloudUrl, this.plugin.settings.pasteHandling.cloud, loc.original);
        });
        if (this.plugin.settings.captions.enabled) this.plugin.imageStateManager?.refreshAllImages();
        return count;
    }

    private async deleteCloudImage(cloudUrl: string): Promise<void> {
        if (this.plugin.settings.pasteHandling.cloud.uploader !== 'PicList') {
            new Notice(t("MSG_DELETE_NOT_SUPPORTED")); return;
        }
        try {
            new Notice(t("MSG_DELETING_CLOUD"));
            const deleter = new CloudImageDeleter(this.plugin); // CloudImageDeleter expects Plugin, wait... CloudImageDeleter(plugin: ImageConverterPlugin)
            // But main.ts has: const deleter = new CloudImageDeleter(this);
            // So passing `this.plugin` is correct.
            const success = await deleter.deleteImage({ url: cloudUrl });
            if (success) new Notice(t("MSG_DELETE_CLOUD_SUCCESS"));
            else new Notice(t("MSG_DELETE_CLOUD_FAILED"));
        } catch (error) {
            new Notice(t("MSG_DELETE_CLOUD_ERROR").replace("{0}", error.message));
        }
    }

    /**
     * Headless batch upload method.
     * Uploads a list of files and returns detailed results.
     * Does NOT handle UI notifications or file deletion/replacement directly.
     */
    async batchUpload(files: TFile[]): Promise<BatchResult> {
        const result: BatchResult = {
            successful: [],
            failed: [],
            cancelled: false
        };

        if (files.length === 0) return result;

        const uploaderManager = new UploaderManager(
            this.plugin.settings.pasteHandling.cloud.uploader,
            this.plugin
        );

        // Map TFile to upload path
        const tasks = files.map(file => ({
            file,
            path: this.buildUploadPath(file)
        }));

        // Run uploads
        const uploadResults = await this.concurrentQueue.runSettled(
            tasks.map(task => async () => {
                const res = await uploaderManager.upload([task.path]);
                if (!res.success) {
                    throw new Error(res.msg || 'Upload failed');
                }
                return res.result[0]; // Return Cloud URL
            })
        );

        // Process results
        uploadResults.forEach((res, index) => {
            const task = tasks[index];
            if (res.status === 'fulfilled') {
                result.successful.push({
                    success: true,
                    item: task.file,
                    output: res.value // Cloud URL
                });
            } else {
                result.failed.push({
                    success: false,
                    item: task.file,
                    error: res.reason?.message || "Unknown error"
                });
            }
        });

        return result;
    }

    /**
     * Public method to upload folder images
     * @param folderPath - Path to the folder
     * @param recursive - Whether to process subfolders recursively
     */
    async uploadFolderImages(folderPath: string, recursive: boolean = false): Promise<void> {
        // Step 1: Validate folder
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) {
            new Notice(t("MSG_INVALID_FOLDER"));
            return;
        }

        // Step 2: Collect all image files in folder
        const allFiles = this.app.vault.getFiles();
        const normalizedFolderPath = folderPath.replace(/\\/g, '/').replace(/\/$/, '');
        const prefix = normalizedFolderPath === '' || normalizedFolderPath === '/' ? '' : `${normalizedFolderPath}/`;

        const isImmediateChild = (filePath: string) => {
            if (!prefix) {
                // Root folder: immediate children have no '/'
                return filePath.indexOf('/') === -1;
            }
            if (!filePath.startsWith(prefix)) return false;
            const remainder = filePath.slice(prefix.length);
            return remainder.indexOf('/') === -1;
        };

        const imageFiles = allFiles.filter((file) => {
            if (!this.plugin.supportedImageFormats.isSupported(undefined, file.name)) return false;
            const normalized = file.path.replace(/\\/g, '/');
            if (recursive) {
                return prefix === '' ? true : normalized.startsWith(prefix);
            }
            return isImmediateChild(normalized);
        });

        if (imageFiles.length === 0) {
            new Notice(t("MSG_NO_IMAGES_IN_FOLDER"));
            return;
        }

        console.log('[Folder Upload] Found', imageFiles.length, 'image file(s) in folder:', folderPath);

        // Step 3: Filter out already uploaded images
        const filteredFiles = imageFiles.filter(file => {
            // Skip already uploaded images
            if (this.plugin.historyManager.isLocalPathUploaded(file.path)) {
                console.log('[Folder Upload] Skipping already uploaded image:', file.path);
                return false;
            }
            return true;
        });

        if (filteredFiles.length === 0) {
            new Notice(t("MSG_NO_IMAGES_TO_UPLOAD"));
            return;
        }

        console.log('[Folder Upload] Prepared', filteredFiles.length, 'image(s) to upload');
        new Notice(t("MSG_UPLOADING_IMAGES").replace("{0}", filteredFiles.length.toString()));

        // Step 4: Use NotificationManager to collect errors
        const notificationManager = new NotificationManager();

        // Validate file existence
        const validationErrors: string[] = [];
        for (const file of filteredFiles) {
            const exists = await this.validateFileExists(file);
            if (!exists) {
                notificationManager.collectError(file.name, t("MSG_FILE_NOT_FOUND"));
                validationErrors.push(file.name);
            }
        }

        if (validationErrors.length > 0) {
            console.warn('[Folder Upload] Files not found:', validationErrors);
            const validFiles = filteredFiles.filter(file => !validationErrors.includes(file.name));
            if (validFiles.length === 0) {
                notificationManager.showBatchSummary(
                    filteredFiles.length,
                    0,
                    t("MSG_FOLDER_UPLOAD")
                );
                return;
            }
            filteredFiles.length = 0;
            filteredFiles.push(...validFiles);
        }

        // Step 5: Upload images with concurrent control
        try {
            const uploaderManager = new UploaderManager(
                this.plugin.settings.pasteHandling.cloud.uploader,
                this.plugin
            );

            // Prepare upload paths used for mapping back to files
            // We need a map to correlate results back to original files because order is preserved in runSettled

            interface UploadTask {
                file: TFile;
                path: string;
            }
            const taskList: UploadTask[] = filteredFiles.map(file => ({
                file,
                path: this.buildUploadPath(file)
            }));

            console.log('[Folder Upload] Uploading files:', taskList.map(t => t.path));
            console.log('[Folder Upload] Remote mode:', this.plugin.settings.pasteHandling.cloud.remoteServerMode);

            // Upload with concurrent queue using runSettled for robust error handling
            const uploadResults = await this.concurrentQueue.runSettled(
                taskList.map(task => async () => {
                    const result = await uploaderManager.upload([task.path]);
                    if (!result.success) {
                        throw new Error(result.msg || 'Upload failed');
                    }
                    return result.result[0]; // Return the cloud URL
                })
            );

            // Separate successful and failed uploads
            const successfulUploads: { file: TFile; cloudUrl: string }[] = [];

            uploadResults.forEach((result, index) => {
                const task = taskList[index];
                if (result.status === 'fulfilled') {
                    successfulUploads.push({
                        file: task.file,
                        cloudUrl: result.value
                    });
                } else {
                    console.error(`[Folder Upload] Failed to upload ${task.file.path}:`, result.reason);
                    notificationManager.collectError(task.file.name, result.reason?.message || "Upload Failed");
                }
            });

            const uploadedCount = successfulUploads.length;

            // Check upload result count
            if (uploadedCount !== filteredFiles.length) {
                console.warn('[Folder Upload] Completed with some failures. Expected', filteredFiles.length, 'got', uploadedCount);
            }

            if (uploadedCount === 0) {
                notificationManager.showBatchSummary(
                    filteredFiles.length,
                    0,
                    t("MSG_FOLDER_UPLOAD")
                );
                return;
            }

            // Step 6: Scan for vault-wide references ONLY for successful uploads
            new Notice(t("MSG_SCANNING_REFS"));

            const multiReferenceImages: BatchUploadTaskInfo[] = [];
            const fileWithVaultMatches: Array<{
                file: TFile;
                cloudUrl: string;
                vaultMatches: ImageMatchResult;
            }> = [];

            for (const successItem of successfulUploads) {
                const { file, cloudUrl } = successItem;

                const references = await this.plugin.vaultReferenceManager.getFilesReferencingImage(file.path);

                const fileGroups = new Map<string, ImageMatch[]>();
                for (const ref of references) {
                    if (!fileGroups.has(ref.file.path)) {
                        fileGroups.set(ref.file.path, []);
                    }
                    fileGroups.get(ref.file.path)?.push({
                        lineNumber: 0,
                        line: ref.original,
                        original: ref.original
                    });
                }

                const vaultMatches: ImageMatchResult = {
                    totalCount: references.length,
                    files: []
                };

                for (const [path, matchItems] of fileGroups.entries()) {
                    vaultMatches.files.push({
                        path: path,
                        matches: matchItems
                    });
                }

                fileWithVaultMatches.push({
                    file,
                    cloudUrl,
                    vaultMatches
                });

                if (vaultMatches.totalCount > 0) {
                    multiReferenceImages.push({
                        imageName: file.name,
                        vaultReferences: vaultMatches.totalCount,
                        currentNoteReferences: 0,
                        otherNotesReferences: vaultMatches.totalCount,
                        hasMultipleReferences: true
                    });
                }
            }

            // Step 7: Show confirmation dialog
            // Note: We might want to indicate partial success in the dialog or before it. 
            // For now, standard dialog showing only successful ones is likely safest.
            const userChoice = await new Promise<'replace-current' | 'replace-all' | 'replace-all-delete' | 'cancel'>((resolve) => {
                new BatchUploadConfirmDialog(
                    this.app,
                    uploadedCount, // Only show successful count
                    multiReferenceImages,
                    folderPath,
                    resolve
                ).open();
            });

            if (userChoice === 'cancel') {
                new Notice(t("MSG_UPLOAD_CANCELLED"));
                // Still show summary of what happened during upload (especially failures)
                if (notificationManager.getErrorCount() > 0) {
                    notificationManager.showBatchSummary(filteredFiles.length, uploadedCount, t("MSG_FOLDER_UPLOAD"));
                }
                return;
            }

            // Step 8: Replace links and Delete Source (Safely)
            let replacedLinkCount = 0;

            if (userChoice === 'replace-current') {
                new Notice(t("MSG_UPLOAD_ONLY_NO_REPLACEMENT"));
            } else if (userChoice === 'replace-all' || userChoice === 'replace-all-delete') {
                for (const matchInfo of fileWithVaultMatches) {
                    // Safety check: Only process files that were actually uploaded successfully
                    // (Already filtered by successfulUploads list logic)
                    if (matchInfo) {
                        try {
                            const count = await this.updateLinksWithManager(matchInfo.file.path, matchInfo.cloudUrl);
                            replacedLinkCount += count;
                            console.log(`[Folder Upload] Replaced ${count} references for:`, matchInfo.file.path);
                        } catch (error) {
                            console.error(`[Folder Upload] Failed to update links for ${matchInfo.file.path}`, error);
                            notificationManager.collectError(matchInfo.file.name, "Link Replacement Failed");
                        }
                    }
                }

                new Notice(t("MSG_REPLACED_ALL_LINKS").replace("{0}", replacedLinkCount.toString()));

                if (userChoice === 'replace-all-delete' && successfulUploads.length > 0) {
                    let deletedCount = 0;
                    for (const successItem of successfulUploads) {
                        const file = successItem.file;
                        // Extra safety: Only delete if NOT in the error list for link replacement
                        // (Though updateLinksWithManager error handling above doesn't explicitly mark 'file' as failed for deletion logic, 
                        // strictly speaking we should only delete if update succeeded. 
                        // However, updateReference returns a count, if count > 0 it means it replaced something. 
                        // If count == 0 it might just satisfy no refs.
                        // Ideally we catch the error above. 
                        // For simplicity in this step, we trust that if updateLinksWithManager finished (even with 0), it's safe to delete.
                        // If it threw, we caught it. 

                        // We should probably track which specific files failed link update to avoid deleting them.
                        // But updateLinksWithManager is reasonably safe unless FS error.

                        try {
                            await this.app.fileManager.trashFile(file);
                            deletedCount++;
                            console.log('[Folder Upload] Deleted source file:', file.path);
                        } catch (error) {
                            console.error('[Folder Upload] Failed to delete source file:', file.path, error);
                            notificationManager.collectError(file.name, t("MSG_FILE_NOT_FOUND")); // Reuse error code or generic
                        }
                    }
                    if (deletedCount > 0) {
                        new Notice(t("MSG_DELETED_SOURCE_FILES").replace("{0}", deletedCount.toString()));
                    }
                }
            }

            if (this.plugin.settings.captions.enabled) {
                this.plugin.imageStateManager?.refreshAllImages();
            }

            // Always show summary if there were any errors (upload or otherwise) or partial success
            if (notificationManager.getErrorCount() > 0 || uploadedCount < filteredFiles.length) {
                notificationManager.showBatchSummary(
                    filteredFiles.length,
                    uploadedCount,
                    t("MSG_FOLDER_UPLOAD")
                );
            }

        } catch (error) {
            console.error('[Folder Upload] Critical processing failure:', error);
            new Notice(t("MSG_BATCH_UPLOAD_FAILED").replace("{0}", error.message));
        } finally {
            // this.plugin.clearMemory();
        }
    }

    /**
     * Upload all local images in the current note to cloud storage
     */
    async uploadAllImages(): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file found.');
            return;
        }

        const helper = new UploadHelper(this.app);
        const allImageLinks = helper.getAllImageLinks();

        if (allImageLinks.length === 0) {
            new Notice('No images found in current note.');
            return;
        }

        console.log('[Batch Upload] Found', allImageLinks.length, 'image links');

        const filteredImageLinks = allImageLinks.filter(img => {
            const isNetworkImage = img.path.startsWith('http://') || img.path.startsWith('https://');

            if (this.plugin.historyManager.isUrlUploaded(img.path)) {
                console.log('[Batch Upload] Skipping already uploaded image:', img.path);
                return false;
            }

            if (isNetworkImage) {
                if (!this.plugin.settings.pasteHandling.cloud.workOnNetWork) {
                    console.log('[Batch Upload] Skipping network image (workOnNetWork disabled):', img.path);
                    return false;
                }
                if (this.isBlacklistedDomain(img.path)) {
                    console.log('[Batch Upload] Skipping blacklisted network image:', img.path);
                    return false;
                }
                return true;
            }

            return true;
        });

        if (filteredImageLinks.length === 0) {
            new Notice('No images to upload. All images are filtered or already uploaded.');
            return;
        }

        console.log('[Batch Upload] Found', filteredImageLinks.length, 'image(s) to upload');
        new Notice(`Found ${filteredImageLinks.length} image(s) to upload...`);

        const filePathMap: Record<string, TFile> = {};
        const fileNameMap: Record<string, TFile> = {};

        this.app.vault.getFiles().forEach(file => {
            filePathMap[file.path] = file;
            fileNameMap[file.name] = file;
        });

        interface UploadTask {
            imageLinks: ImageLink[];
            file: TFile | null;
            path: string;
            isNetworkImage: boolean;
        }

        const pathToTaskMap = new Map<string, UploadTask>();

        for (const imageLink of filteredImageLinks) {
            const uri = decodeURI(imageLink.path);
            const isNetworkImage = uri.startsWith('http://') || uri.startsWith('https://');

            let uniquePath: string;
            let file: TFile | null = null;

            if (isNetworkImage) {
                uniquePath = uri;
            } else {
                if (filePathMap[uri]) {
                    file = filePathMap[uri];
                }

                if (!file && (uri.startsWith('./') || uri.startsWith('../'))) {
                    const filePath = normalizePath(
                        join(dirname(activeFile.path), uri)
                    );
                    file = filePathMap[filePath];
                }

                if (!file) {
                    const fileName = extname(uri) ? uri : `${uri}.png`; // Try to match basename
                    const base = uri.split('/').pop() || uri;
                    file = fileNameMap[base];
                }

                if (!file || !this.isImageFile(file.path)) {
                    console.warn('[Batch Upload] Could not find file for image:', imageLink.path);
                    continue;
                }

                uniquePath = normalizePath(file.path);
            }

            if (pathToTaskMap.has(uniquePath)) {
                pathToTaskMap.get(uniquePath)!.imageLinks.push(imageLink);
            } else {
                pathToTaskMap.set(uniquePath, {
                    imageLinks: [imageLink],
                    file: file,
                    path: uniquePath,
                    isNetworkImage: isNetworkImage
                });
            }
        }

        const uploadTasks = Array.from(pathToTaskMap.values());

        if (uploadTasks.length === 0) {
            new Notice('No valid images found to upload.');
            return;
        }

        const totalLinks = uploadTasks.reduce((sum, task) => sum + task.imageLinks.length, 0);
        console.log('[Batch Upload] Prepared', uploadTasks.length, 'unique upload tasks for', totalLinks, 'image links');
        new Notice(`Uploading ${uploadTasks.length} unique image(s)...`);

        const notificationManager = new NotificationManager();

        const validationErrors: string[] = [];
        for (const task of uploadTasks) {
            if (!task.isNetworkImage && task.file) {
                const exists = await this.validateFileExists(task.file);
                if (!exists) {
                    notificationManager.collectError(
                        task.file.name,
                        '文件不存在'
                    );
                    validationErrors.push(task.file.name);
                }
            }
        }

        if (validationErrors.length > 0) {
            console.warn('[Batch Upload] Files not found:', validationErrors);
            const filteredTasks = uploadTasks.filter(task =>
                task.isNetworkImage || !validationErrors.includes(task.file!.name)
            );
            if (filteredTasks.length === 0) {
                notificationManager.showBatchSummary(
                    uploadTasks.length,
                    0,
                    "批量上传"
                );
                return;
            }
            uploadTasks.length = 0;
            uploadTasks.push(...filteredTasks);
        }

        try {
            const uploaderManager = new UploaderManager(
                this.plugin.settings.pasteHandling.cloud.uploader,
                this.plugin
            );

            const pathsToUpload = uploadTasks.map(task => {
                if (task.isNetworkImage) {
                    console.log('[Batch Upload] Network image:', task.path);
                    return task.path;
                }
                return this.buildUploadPath(task.file!);
            });

            const uploadResult = await this.concurrentQueue.run(
                pathsToUpload.map(path => async () => {
                    const result = await uploaderManager.upload([path]);
                    if (!result.success) {
                        throw new Error(result.msg || 'Upload failed');
                    }
                    return result.result[0];
                })
            );

            const uploadedUrls = uploadResult;
            console.log('[Batch Upload] Upload result:', uploadedUrls);

            if (uploadedUrls.length !== uploadTasks.length) {
                notificationManager.collectError(
                    'batch-upload-mismatch',
                    `上传数量不匹配: 期望 ${uploadTasks.length}，实际 ${uploadedUrls.length}`
                );
            }

            new Notice(t("MSG_SCANNING_REFS"));

            const multiReferenceImages: BatchUploadTaskInfo[] = [];
            const taskWithVaultMatches: Array<{
                task: typeof uploadTasks[0];
                cloudUrl: string;
                vaultMatches: ImageMatchResult;
            }> = [];

            for (let i = 0; i < Math.min(uploadTasks.length, uploadedUrls.length); i++) {
                const task = uploadTasks[i];
                const cloudUrl = uploadedUrls[i];

                if (!task.isNetworkImage && task.file) {
                    const references = await this.plugin.vaultReferenceManager.getFilesReferencingImage(task.file.path);

                    const fileGroups = new Map<string, ImageMatch[]>();
                    for (const ref of references) {
                        if (!fileGroups.has(ref.file.path)) {
                            fileGroups.set(ref.file.path, []);
                        }
                        fileGroups.get(ref.file.path)?.push({
                            lineNumber: 0,
                            line: ref.original,
                            original: ref.original
                        });
                    }

                    const vaultMatches: ImageMatchResult = {
                        totalCount: references.length,
                        files: []
                    };

                    for (const [path, matchItems] of fileGroups.entries()) {
                        vaultMatches.files.push({
                            path: path,
                            matches: matchItems
                        });
                    }

                    const totalReferences = vaultMatches.totalCount;
                    const currentNoteReferences = vaultMatches.files.find(
                        f => f.path === activeFile.path
                    )?.matches.length || 0;
                    const otherNotesReferences = totalReferences - currentNoteReferences;

                    taskWithVaultMatches.push({
                        task,
                        cloudUrl,
                        vaultMatches
                    });

                    if (otherNotesReferences > 0) {
                        multiReferenceImages.push({
                            imageName: task.file.name,
                            vaultReferences: totalReferences,
                            currentNoteReferences: currentNoteReferences,
                            otherNotesReferences: otherNotesReferences,
                            hasMultipleReferences: true
                        });
                    }
                }
            }

            const userChoice = await new Promise<'replace-current' | 'replace-all' | 'replace-all-delete' | 'cancel'>((resolve) => {
                new BatchUploadConfirmDialog(
                    this.app,
                    uploadTasks.length,
                    multiReferenceImages,
                    activeFile.path,
                    resolve
                ).open();
            });

            if (userChoice === 'cancel') {
                new Notice(t("MSG_UPLOAD_CANCELLED"));
                return;
            }

            let replacedLinkCount = 0;

            if (userChoice === 'replace-current') {
                let content = helper.getValue();

                for (let i = 0; i < Math.min(uploadTasks.length, uploadedUrls.length); i++) {
                    const task = uploadTasks[i];
                    const cloudUrl = uploadedUrls[i];

                    for (const imageLink of task.imageLinks) {
                        const cloudLink = CloudLinkFormatter.formatCloudLink(
                            cloudUrl,
                            this.plugin.settings.pasteHandling.cloud,
                            imageLink.source
                        );

                        content = content.replaceAll(imageLink.source, cloudLink);
                        replacedLinkCount++;
                    }
                }

                helper.setValue(content);
                new Notice(t("MSG_REPLACED_CURRENT_NOTE").replace("{0}", replacedLinkCount.toString()));

            } else if (userChoice === 'replace-all' || userChoice === 'replace-all-delete') {
                for (let i = 0; i < Math.min(uploadTasks.length, uploadedUrls.length); i++) {
                    const task = uploadTasks[i];
                    const cloudUrl = uploadedUrls[i];

                    const matchInfo = taskWithVaultMatches.find(m => m.task === task);
                    if (matchInfo) {
                        const count = await this.updateLinksWithManager(matchInfo.task.file!.path, cloudUrl);
                        replacedLinkCount += count;
                    } else {
                        let content = helper.getValue();
                        for (const imageLink of task.imageLinks) {
                            const cloudLink = CloudLinkFormatter.formatCloudLink(
                                cloudUrl,
                                this.plugin.settings.pasteHandling.cloud,
                                imageLink.source
                            );

                            content = content.replaceAll(imageLink.source, cloudLink);
                            replacedLinkCount++;
                        }
                        helper.setValue(content);
                    }
                }

                new Notice(t("MSG_REPLACED_ALL_LINKS").replace("{0}", replacedLinkCount.toString()));

                if (userChoice === 'replace-all-delete' && uploadTasks.length > 0) {
                    let deletedCount = 0;
                    for (const task of uploadTasks) {
                        if (!task.isNetworkImage && task.file) {
                            try {
                                await this.app.fileManager.trashFile(task.file);
                                deletedCount++;
                            } catch (error) {
                                console.error('[Batch Upload] Failed to delete source file:', task.file.path, error);
                            }
                        }
                    }
                    if (deletedCount > 0) {
                        new Notice(t("MSG_DELETED_SOURCE_FILES").replace("{0}", deletedCount.toString()));
                    }
                }
            }

            if (this.plugin.settings.captions.enabled) {
                this.plugin.imageStateManager?.refreshAllImages();
            }

        } catch (error) {
            console.error('[Batch Upload] Upload failed:', error);
            new Notice(`Batch upload failed: ${error.message}`);
        } finally {
            // this.plugin.clearMemory();
        }
    }

    private isImageFile(path: string): boolean {
        const ext = extname(path).toLowerCase();
        const imageExts = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.svg', '.tiff', '.webp', '.avif'];
        return imageExts.includes(ext);
    }
}
