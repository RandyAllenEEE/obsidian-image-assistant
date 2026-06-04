import { App, Notice, requestUrl, normalizePath, TFile, TFolder } from "obsidian";
import { join, parse } from "path-browserify";
import imageType from "image-type";
import { UploadHelper, ImageLink } from "../utils/UploadHelper";
import { FolderAndFilenameManagement } from "../local/FolderAndFilenameManagement";
import type ImageConverterPlugin from "../main";
import { NetworkImageDownloadModal, DownloadTask, DownloadChoice, DownloadMode } from "./NetworkImageDownloadModal";
import { NotificationManager } from "../utils/NotificationManager";
import { ConcurrentQueue } from "../utils/AsyncLock";
import { ImageLinkPathReplacer } from "../utils/ImageLinkPathReplacer";
import { pipeSyntaxParser } from "../utils/PipeSyntaxParser";
import { getAllImageLinks } from "../utils/RegexPatterns";
import { t } from "../lang/helpers";
import { BatchResult, BatchItemResult } from "../types/BatchTypes";

interface DownloadResult {
    success: boolean;
    url: string;
    localPath?: string;
    fileName?: string;
    error?: string;
}

export class NetworkImageDownloader {
    private app: App;
    private plugin: ImageConverterPlugin;
    private uploadHelper: UploadHelper;
    private folderManager: FolderAndFilenameManagement;

    constructor(
        app: App,
        plugin: ImageConverterPlugin,
        uploadHelper: UploadHelper,
        folderManager: FolderAndFilenameManagement
    ) {
        this.app = app;
        this.plugin = plugin;
        this.uploadHelper = uploadHelper;
        this.folderManager = folderManager;
    }

    /**
     * 下载当前笔记中的所有网络图片到本地
     */
    async downloadAllNetworkImages(): Promise<void> {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice("⚠️ 请先打开一个笔记");
            return;
        }

        // 1. 提取所有图片链接（直接读取文件内容，使用 getAllImageLinks）
        // getAllImageLinks respects codeBlockImageLinkIndexing via the fence/admonition scanning
        // in downloadFolderImages, but for single-note download we scan the raw content directly.
        const activeContent = await this.app.vault.read(activeFile);
        const allImages = getAllImageLinks(activeContent);

        // 2. 过滤网络图片
        const networkImages = allImages.filter(img =>
            img.path.startsWith('http://') || img.path.startsWith('https://')
        );

        if (networkImages.length === 0) {
            new Notice("📝 当前笔记没有网络图片");
            return;
        }

        // 3. 应用域名黑名单（如果配置）
        const blackDomains = this.plugin.settings.pasteHandling.cloud.newWorkBlackDomains || "";
        const filteredImages = networkImages.filter(img => {
            if (!blackDomains.trim()) return true;
            return !this.hasBlackDomain(img.path, blackDomains);
        });

        if (filteredImages.length < networkImages.length) {
            new Notice(`🚫 已过滤 ${networkImages.length - filteredImages.length} 张黑名单域名图片`);
        }

        if (filteredImages.length === 0) {
            new Notice("📝 所有网络图片都在黑名单中");
            return;
        }

        // 4. 准备下载任务
        const tasks: DownloadTask[] = filteredImages.map(img => ({
            url: img.path,
            originalSource: img.source,
            suggestedName: this.extractFilenameFromUrl(img.path),
            selected: true
        }));

        // 5. 显示预览对话框
        const modal = new NetworkImageDownloadModal(
            this.app,
            tasks,
            async (choice: DownloadChoice) => {
                await this.executeDownload(choice, activeFile);
            }
        );

        modal.open();
    }

    /**
     * Download all network images referenced in notes within a folder
     * 批量下载文件夹内笔记引用的所有网络图片
     * @param folderPath - Folder path
     * @param recursive - Whether to include subfolders
     */
    async downloadFolderImages(folderPath: string, recursive: boolean = false): Promise<void> {
        // Step 1: Validate folder
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) {
            new Notice(t("MSG_INVALID_FOLDER"));
            return;
        }

        // Step 2: Collect all markdown files in folder
        const allFiles = this.app.vault.getMarkdownFiles();
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

        const markdownFiles = allFiles.filter((file) => {
            const normalized = file.path.replace(/\\/g, '/');
            if (recursive) {
                return prefix === '' ? true : normalized.startsWith(prefix);
            }
            return isImmediateChild(normalized);
        });

        if (markdownFiles.length === 0) {
            new Notice(t("MSG_NO_NOTES_IN_FOLDER"));
            return;
        }

        console.log('[Folder Download] Found', markdownFiles.length, 'markdown file(s) in folder:', folderPath);

        // Step 3: Extract all network images from notes
        // Respects codeBlockImageLinkIndexing setting:
        //   ON  -> scan note content using getAllImageLinks, filter HTTP/HTTPS, skip code blocks/admonitions
        //   OFF -> use metadataCache (fast path only)
        const networkImageMap = new Map<string, { url: string; notes: TFile[] }>();
        const useContentScan = !!this.plugin.settings.global.codeBlockImageLinkIndexing;

        for (const noteFile of markdownFiles) {
            try {
                const cache = this.app.metadataCache.getFileCache(noteFile);
                const foundUrls = new Set<string>();

                // Fast path: metadataCache for embeds and links (always runs).
                if (cache?.embeds) {
                    for (const embed of cache.embeds) {
                        const raw = embed.link ?? '';
                        if (raw.startsWith('http://') || raw.startsWith('https://')) {
                            foundUrls.add(raw);
                        }
                    }
                }
                if (cache?.links) {
                    for (const link of cache.links) {
                        const raw = link.link ?? '';
                        if ((raw.startsWith('http://') || raw.startsWith('https://'))
                            && this.plugin.supportedImageFormats.isSupported(undefined, raw)) {
                            foundUrls.add(raw);
                        }
                    }
                }

                // Slow path: content scan (only when setting is ON).
                if (useContentScan) {
                    const content = await this.app.vault.read(noteFile);
                    // pipeSyntaxParser.extractAllLinks gives { fullMatch, index, data } with absolute positions.
                    const links = pipeSyntaxParser.extractAllLinks(content);
                    if (links.length === 0) continue;

                    // Build line-index -> offset mapping.
                    const lines = content.split(/\r?\n/);
                    const lineStartOffsets: number[] = [0];
                    for (let i = 0; i < content.length; i++) {
                        if (content[i] === '\n') lineStartOffsets.push(i + 1);
                    }

                    // Walk lines in order, tracking fenced/admonition state.
                    let inFencedCode = false;
                    let inAdmonition = false;

                    for (let li = 0; li < lines.length; li++) {
                        const line = lines[li];

                        // Determine block state AFTER this line's content (before processing links on this line).
                        let lineEndsFenced = false;
                        let lineEndsAdmonition = false;

                        if (/^\s*```/.test(line)) {
                            // Fence line: if currently outside, this line STARTS the block (links here are excluded).
                            // If currently inside, this line ENDS the block (links here are included).
                            if (!inFencedCode) {
                                // Link on this line should NOT be included (block starts here).
                                // We handle this by NOT toggling yet.
                            } else {
                                lineEndsFenced = true; // block ends after this line
                            }
                        } else if (!inFencedCode) {
                            // Only check admonitions outside fenced blocks.
                            if (/^\s*>\s*\[![^\]]+\]/.test(line)) {
                                inAdmonition = true; // starts here, link IS included
                            } else if (!/^\s*>/.test(line)) {
                                lineEndsAdmonition = true;
                            }
                        }

                        // Which absolute range does this line cover?
                        const lineAbsStart = lineStartOffsets[li]!;
                        const lineAbsEnd = lineStartOffsets[li + 1] ?? content.length;

                        // Evaluate all links whose absolute position falls within this line.
                        for (const link of links) {
                            const absStart = lineStartOffsets[li]! + link.index;
                            const absEnd = absStart + link.fullMatch.length;
                            if (absEnd <= lineAbsStart || absStart >= lineAbsEnd) continue; // not on this line

                            // Link on a fence line: exclude if currently outside (block hasn't started yet).
                            if (/^\s*```/.test(line) && !inFencedCode) continue;

                            // Link outside fenced blocks AND inside admonition: include.
                            if (!inFencedCode && inAdmonition) {
                                const raw = link.data.path ?? '';
                                if (raw.startsWith('http://') || raw.startsWith('https://')) {
                                    foundUrls.add(raw);
                                }
                            }
                        }

                        // Now apply state transitions for next line.
                        if (/^\s*```/.test(line)) {
                            if (!inFencedCode) {
                                inFencedCode = true; // entered fenced block
                            } else {
                                inFencedCode = false; // exited fenced block
                            }
                        }
                        if (lineEndsAdmonition) inAdmonition = false;
                    }
                }

                // Register all found URLs for this note.
                for (const url of foundUrls) {
                    if (!networkImageMap.has(url)) {
                        networkImageMap.set(url, { url, notes: [] });
                    }
                    const existing = networkImageMap.get(url)!;
                    if (!existing.notes.includes(noteFile)) {
                        existing.notes.push(noteFile);
                    }
                }
            } catch (error) {
                console.error('[Folder Download] Failed to read note:', noteFile.path, error);
            }
        }

        const networkImages = Array.from(networkImageMap.values());

        if (networkImages.length === 0) {
            new Notice(t("MSG_NO_NETWORK_IMAGES_IN_FOLDER"));
            return;
        }

        console.log('[Folder Download] Found', networkImages.length, 'unique network image(s)');

        // Step 4: Apply blacklist filter
        const blackDomains = this.plugin.settings.pasteHandling.cloud.newWorkBlackDomains || "";
        const filteredImages = networkImages.filter(img => {
            if (!blackDomains.trim()) return true;
            return !this.hasBlackDomain(img.url, blackDomains);
        });

        if (filteredImages.length < networkImages.length) {
            new Notice(t("MSG_FILTERED_BLACKLISTED", [(networkImages.length - filteredImages.length).toString()]));
        }

        if (filteredImages.length === 0) {
            new Notice(t("MSG_ALL_IMAGES_BLACKLISTED"));
            return;
        }

        // Step 5: Build download tasks with reference information
        const tasks: any[] = filteredImages.map(img => {
            const filename = this.extractFilenameFromUrl(img.url);
            return {
                url: img.url,
                originalSource: img.url,
                suggestedName: filename,
                selected: true
            };
        });

        // Step 6: Show download modal
        const { NetworkImageDownloadModal } = await import('./NetworkImageDownloadModal');

        const modal = new NetworkImageDownloadModal(
            this.app,
            tasks,
            async (choice) => {
                await this.executeFolderDownload(choice, filteredImages, folderPath);
            }
        );

        modal.open();
    }

    /**
     * Headless batch download method.
     * Downloads a list of images to specified folders.
     */
    async batchDownload(
        tasks: { url: string; targetFolder: string; suggestedName: string; activeFile: TFile }[]
    ): Promise<BatchResult> {
        const result: BatchResult = {
            successful: [],
            failed: [],
            cancelled: false
        };

        if (tasks.length === 0) return result;

        const concurrency = this.plugin.settings.pasteHandling.cloud.uploadConcurrency || 3;
        const queue = new ConcurrentQueue(concurrency);

        const downloadTasks = tasks.map(task => async () => {
            const res = await this.downloadSingleImageInternal(
                task.url,
                task.targetFolder,
                task.suggestedName,
                task.activeFile
            );

            if (res.success && res.localPath) {
                return {
                    success: true,
                    url: task.url,
                    localPath: res.localPath,
                    fileName: res.fileName
                };
            } else {
                throw new Error(res.error || "Download failed");
            }
        });

        const results = await queue.runSettled(downloadTasks);

        results.forEach((res, index) => {
            const task = tasks[index];
            if (res.status === 'fulfilled') {
                result.successful.push({
                    success: true,
                    item: task.url,
                    output: res.value // Contains localPath
                });
            } else {
                result.failed.push({
                    success: false,
                    item: task.url,
                    error: res.reason?.message || "Unknown error"
                });
            }
        });

        return result;
    }

    /**
     * Execute folder download operation
     */
    private async executeFolderDownload(
        choice: { mode: string; selectedTasks: any[] },
        imageData: Array<{ url: string; notes: TFile[] }>,
        folderPath: string
    ): Promise<void> {
        const { mode, selectedTasks } = choice;
        const notificationManager = new NotificationManager();

        try {
            let successCount = 0;

            // Use concurrent queue for download
            const concurrency = this.plugin.settings.pasteHandling.cloud.uploadConcurrency || 3;
            const queue = new ConcurrentQueue(concurrency);

            const downloadTasks = selectedTasks.map(task => async () => {
                const imageInfo = imageData.find(img => img.url === task.url);
                if (!imageInfo) return;

                try {
                    // Get attachment folder for the first note that references this image
                    const firstNote = imageInfo.notes[0];
                    const attachmentPath = await this.app.fileManager.getAvailablePathForAttachment(
                        "",
                        firstNote.path
                    );

                    // Download image using NetworkImageDownloader
                    // Use `downloadSingleImageInternal` which is already defined in this class
                    const result = await this.downloadSingleImageInternal(
                        task.url,
                        attachmentPath,
                        task.suggestedName,
                        firstNote
                    );

                    if (result.success && result.localPath) {
                        successCount++;

                        // Replace links in all notes that reference this image (if mode is download-and-replace)
                        if (mode === "download-and-replace") {
                            for (const noteFile of imageInfo.notes) {
                                try {
                                    await this.plugin.vaultReferenceManager.updateReferencesInFile(
                                        noteFile,
                                        task.url,
                                        (location) => {
                                            const relativePath = this.app.metadataCache.fileToLinktext(
                                                this.app.vault.getAbstractFileByPath(result.localPath!) as TFile,
                                                noteFile.path
                                            );

                                            // Path-only replacement: preserve wiki/markdown syntax and pipe syntax.
                                            return ImageLinkPathReplacer.replacePath(location.original, relativePath);
                                        }
                                    );
                                    console.log('[Folder Download] Replaced links in:', noteFile.path);
                                } catch (error) {
                                    console.error('[Folder Download] Failed to replace links in:', noteFile.path, error);
                                    notificationManager.collectError(
                                        noteFile.name,
                                        t("MSG_REPLACE_FAILED", [error.message])
                                    );
                                }
                            }
                        }
                    } else {
                        notificationManager.collectError(
                            task.suggestedName,
                            result.error || t("MSG_UNKNOWN_ERROR"),
                            task.url
                        );
                        console.error('[Folder Download] Failed:', task.url, '-', result.error);
                    }
                } catch (error) {
                    notificationManager.collectError(
                        task.suggestedName,
                        error.message || t("MSG_PROCESSING_FAILED"),
                        task.url
                    );
                    console.error('[Folder Download] Error processing', task.url, ':', error);
                }
            });

            // Execute download tasks with concurrency control
            await queue.run(downloadTasks);

            // Show completion notice
            const totalSelected = selectedTasks.length;
            if (mode === "download-and-replace") {
                new Notice(t("MSG_DOWNLOAD_REPLACE_COMPLETE", [successCount.toString(), totalSelected.toString()]));
            } else if (mode === "download-only") {
                new Notice(t("MSG_DOWNLOAD_COMPLETE", [successCount.toString(), totalSelected.toString()]));
            }

            // Show batch summary if there were errors
            const totalErrors = notificationManager.getErrorCount();
            if (totalErrors > 0) {
                notificationManager.showBatchSummary(
                    totalSelected,
                    successCount,
                    t("MSG_FOLDER_DOWNLOAD")
                );
            }

            // Refresh image captions (if enabled)
            if (this.plugin.settings.captions.enabled) {
                this.plugin.imageStateManager?.refreshAllImages();
            }

        } catch (error) {
            console.error('[Folder Download] Download failed:', error);
            new Notice(t("MSG_BATCH_DOWNLOAD_FAILED", [error.message]));
        } finally {
            // this.plugin.clearMemory();
        }
    }

    /**
     * Download a single network image from context menu
     * 从右键菜单下载单个网络图片
     * @param url - Network image URL
     * @param activeFile - Current active file
     * @param editor - Editor instance (optional, for link replacement)
     * @returns true if download succeeded
     */
    async downloadSingleImage(
        url: string,
        activeFile: TFile,
        editor?: any
    ): Promise<boolean> {
        try {
            // Get attachment folder path
            const folderPath = await this.app.fileManager.getAvailablePathForAttachment(
                "",
                activeFile.path
            );

            // Ensure folder exists
            await this.folderManager.ensureFolderExists(folderPath);

            // Extract filename from URL
            const suggestedName = this.extractFilenameFromUrl(url);

            // Download the image
            const result = await this.downloadSingleImageInternal(
                url,
                folderPath,
                suggestedName,
                activeFile
            );

            if (result.success && result.localPath) {
                // Replace link if editor is provided
                if (editor) {
                    await this.replaceImageLinkInCurrentNote(
                        activeFile,
                        url,
                        result.localPath
                    );
                }
                return true;
            } else {
                console.error(`[Download] Failed to download ${url}: ${result.error}`);
                return false;
            }
        } catch (error) {
            console.error('[Download] Error in downloadSingleImage:', error);
            return false;
        }
    }

    /**
     * 执行下载操作
     */
    private async executeDownload(
        choice: DownloadChoice,
        activeFile: TFile
    ): Promise<void> {
        const { mode, selectedTasks } = choice;

        // 获取附件文件夹路径
        const folderPath = await this.app.fileManager.getAvailablePathForAttachment(
            "",
            activeFile.path
        );

        // 确保文件夹存在
        await this.folderManager.ensureFolderExists(folderPath);

        // 使用NotificationManager收集错误
        const notificationManager = new NotificationManager();
        let successCount = 0;
        let skippedCount = 0;

        new Notice(`🚀 开始处理 ${selectedTasks.length} 张图片...`);

        // Use uploadConcurrency setting for batch download
        const concurrency = this.plugin.settings.pasteHandling.cloud.uploadConcurrency || 3;
        const queue = new ConcurrentQueue(concurrency);

        let processedCount = 0;
        const tasks = selectedTasks.map(task => async () => {
            processedCount++;
            // 仅在特定间隔显示进度，避免通知刷屏
            notificationManager.showProgress(processedCount, selectedTasks.length, task.suggestedName);

            try {
                if (mode === "replace-only") {
                    // 仅替换模式：查找本地文件并替换
                    const localPath = await this.findLocalFile(folderPath, task.suggestedName);
                    if (localPath) {
                        const relativePath = this.getRelativePath(
                            activeFile.parent?.path || "",
                            localPath
                        );
                        await this.replaceImageLinkInCurrentNote(
                            activeFile,
                            task.url,
                            relativePath
                        );
                        successCount++;
                    } else {
                        console.warn(`[Download] Local file not found for: ${task.suggestedName}`);
                        notificationManager.collectError(
                            task.suggestedName,
                            "本地文件不存在",
                            task.url
                        );
                        skippedCount++;
                    }
                } else {
                    // 下载模式（仅下载 或 下载并替换）
                    const result = await this.downloadSingleImageInternal(
                        task.url,
                        folderPath,
                        task.suggestedName,
                        activeFile
                    );

                    if (result.success && result.localPath) {
                        successCount++;

                        // 如果是"下载并替换"模式，替换链接
                        if (mode === "download-and-replace") {
                            await this.replaceImageLinkInCurrentNote(
                                activeFile,
                                task.url,
                                result.localPath
                            );
                        }
                    } else {
                        // 收集错误而非立即通知
                        notificationManager.collectError(
                            task.suggestedName,
                            result.error || "未知错误",
                            task.url
                        );
                        console.error(`[Download] Failed: ${task.url} - ${result.error}`);
                    }
                }
            } catch (error) {
                // 收集异常错误
                notificationManager.collectError(
                    task.suggestedName,
                    error.message || "处理失败",
                    task.url
                );
                console.error(`[Download] Error processing ${task.url}:`, error);
            }
        });

        // Execute tasks with concurrency control
        await queue.run(tasks);

        // 准备额外信息
        let extraInfo = "";
        if (skippedCount > 0) {
            extraInfo += `跳过: ${skippedCount} 张\n`;
        }

        // 根据模式显示不同的成功消息
        if (mode === "download-only") {
            extraInfo += `📦 图片已下载，链接未更改`;
        } else if (mode === "download-and-replace") {
            extraInfo += `🔄 图片已下载并替换为本地路径`;
        } else if (mode === "replace-only") {
            extraInfo += `🔄 链接已替换为本地路径`;
        }

        // 使用NotificationManager显示汇总通知
        const operationType = mode === "download-only"
            ? "图片下载"
            : mode === "download-and-replace"
                ? "下载并替换"
                : "链接替换";

        notificationManager.showBatchSummary(
            selectedTasks.length,
            successCount,
            operationType,
            extraInfo.trim()
        );
    }

    /**
     * 查找本地文件（用于"仅替换"模式）
     */
    private async findLocalFile(
        folderPath: string,
        suggestedName: string
    ): Promise<string | null> {
        try {
            // 尝试直接匹配文件名
            const directPath = normalizePath(join(folderPath, suggestedName));
            if (await this.app.vault.adapter.exists(directPath)) {
                return directPath;
            }

            // 尝试匹配不同扩展名
            const baseName = suggestedName.replace(/\.[^/.]+$/, "");
            const extensions = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'avif'];

            for (const ext of extensions) {
                const testPath = normalizePath(join(folderPath, `${baseName}.${ext}`));
                if (await this.app.vault.adapter.exists(testPath)) {
                    return testPath;
                }
            }

            // 尝试匹配带序号的文件（如 image_1.jpg, image_2.jpg）
            for (let i = 1; i <= 10; i++) {
                for (const ext of extensions) {
                    const testPath = normalizePath(join(folderPath, `${baseName}_${i}.${ext}`));
                    if (await this.app.vault.adapter.exists(testPath)) {
                        return testPath;
                    }
                }
            }

            return null;
        } catch (error) {
            console.error("[Download] Error finding local file:", error);
            return null;
        }
    }

    /**
     * 下载单张网络图片（内部方法，现公开以供批量下载使用）
     */
    async downloadSingleImageInternal(
        url: string,
        folderPath: string,
        suggestedName: string,
        activeFile: TFile
    ): Promise<DownloadResult> {
        try {
            // 安全验证: 检查 URL 协议和域名
            const validationError = this.validateUrl(url);
            if (validationError) {
                return {
                    success: false,
                    url: url,
                    error: validationError
                };
            }

            // 1. 下载图片
            const response = await requestUrl({ url });

            if (response.status !== 200) {
                return {
                    success: false,
                    url: url,
                    error: `HTTP ${response.status}`
                };
            }

            // 2. 检测图片类型（魔数方式）
            const type = await imageType(new Uint8Array(response.arrayBuffer));
            if (!type) {
                return {
                    success: false,
                    url: url,
                    error: "无法识别图片类型"
                };
            }

            // 3. 构建文件名
            const baseNameWithoutExt = suggestedName.replace(/\.[^/.]+$/, ""); // 移除原扩展名
            const sanitizedName = this.folderManager.sanitizeFilename(baseNameWithoutExt);
            const finalName = `${sanitizedName}.${type.ext}`;

            // 4. 处理文件名冲突
            const conflictMode = this.plugin.settings.localProcessing.filename.conflictResolution || "increment";

            const uniqueName = await this.folderManager.handleNameConflicts(
                folderPath,
                finalName,
                conflictMode
            );

            // 5. 保存到 vault
            const fullPath = normalizePath(join(folderPath, uniqueName));
            await this.app.vault.adapter.writeBinary(fullPath, response.arrayBuffer);

            // 6. 计算相对路径（相对于当前笔记）
            const activeFolder = activeFile.parent?.path || "";
            const relativePath = this.getRelativePath(activeFolder, fullPath);

            return {
                success: true,
                url: url,
                localPath: relativePath,
                fileName: uniqueName
            };

        } catch (error) {
            return {
                success: false,
                url: url,
                error: error.message || "未知错误"
            };
        }
    }

    /**
     * 从URL提取文件名
     */
    private extractFilenameFromUrl(url: string): string {
        try {
            // 1. 移除查询参数和锚点
            const cleanUrl = url.split('?')[0].split('#')[0];

            // 2. 提取路径最后一段
            const asset = cleanUrl.substring(1 + cleanUrl.lastIndexOf("/"));

            // 3. 解码 URL 编码
            let fileName = decodeURIComponent(asset);

            // 4. 移除路径分隔符和非法字符
            fileName = fileName.replace(/[\\/:*?"<>|]/g, "-");

            // 5. 如果为空，使用默认名称
            if (!fileName || fileName === "-") {
                fileName = "image-" + Date.now();
            }

            return fileName;
        } catch (error) {
            console.error("[Download] Error extracting filename:", error);
            return "image-" + Date.now();
        }
    }

    /**
     * 在当前笔记中替换图片链接
     */
    /**
     * 在当前笔记中替换图片链接
     */
    private async replaceImageLinkInCurrentNote(
        file: TFile,
        url: string,
        localPath: string
    ): Promise<void> {
        try {
            const result = await this.plugin.vaultReferenceManager.updateReferencesInFile(
                file,
                url, // Find by URL
                (location) => {
                    // Path-only replacement: preserve wiki/markdown syntax and pipe syntax.
                    return ImageLinkPathReplacer.replacePath(location.original, localPath);
                }
            );

            if (result > 0) {
                console.log(`[Download] Replaced ${result} links in ${file.path} for ${url}`);
            } else {
                console.warn(`[Download] No links found for ${url} in ${file.path} (Cache might be stale)`);
            }
        } catch (error) {
            console.error(`[Download] Failed to replace link in ${file.path}:`, error);
            new Notice(`⚠️ 替换链接失败: ${error.message}`);
        }
    }

    /**
     * 计算相对路径
     */
    private getRelativePath(fromFolder: string, toPath: string): string {
        if (!fromFolder) return toPath;

        // 处理根目录情况
        if (fromFolder === "/") {
            return toPath.startsWith('/') ? toPath.substring(1) : toPath;
        }

        const fromParts = normalizePath(fromFolder).split('/').filter(Boolean);
        const toParts = normalizePath(toPath).split('/').filter(Boolean);

        // 找到公共路径长度
        let commonLength = 0;
        while (
            commonLength < fromParts.length &&
            commonLength < toParts.length &&
            fromParts[commonLength] === toParts[commonLength]
        ) {
            commonLength++;
        }

        // 计算需要向上的层数
        const upLevels = fromParts.length - commonLength;

        // 计算剩余路径
        const downPath = toParts.slice(commonLength);

        // 组合相对路径
        if (upLevels === 0) {
            // 同级目录
            return './' + downPath.join('/');
        } else {
            // 需要向上
            const relativeParts = Array(upLevels).fill('..').concat(downPath);
            return relativeParts.join('/');
        }
    }

    /**
     * 验证 URL 的安全性
     * 返回错误消息，如果验证通过则返回 null
     */
    private validateUrl(url: string): string | null {
        try {
            const urlObj = new URL(url);

            // 1. 验证协议：只允许 http 和 https
            if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
                return `Invalid protocol: ${urlObj.protocol}. Only HTTP and HTTPS are allowed.`;
            }

            // 2. 验证域名：不允许内网地址
            const hostname = urlObj.hostname.toLowerCase();

            // 检查 localhost
            if (hostname === 'localhost' || hostname === '127.0.0.1') {
                return 'Security: Internal network addresses are not allowed (localhost/127.0.0.1).';
            }

            // 检查私有 IP 范围
            if (
                hostname.startsWith('192.168.') ||
                hostname.startsWith('10.') ||
                /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname) // 172.16.x.x - 172.31.x.x
            ) {
                return 'Security: Private network addresses are not allowed.';
            }

            // 检查链路本地地址 169.254.x.x
            if (hostname.startsWith('169.254.')) {
                return 'Security: Link-local addresses are not allowed.';
            }

            return null; // 验证通过
        } catch (error) {
            return `Invalid URL format: ${error.message}`;
        }
    }

    /**
     * 检查URL是否在黑名单域名中
     */
    private hasBlackDomain(url: string, blackDomains: string): boolean {
        if (blackDomains.trim() === "") {
            return false;
        }

        try {
            const blackDomainList = blackDomains
                .split("\n")
                .map(line => line.trim())
                .filter(line => line.length > 0);

            const urlObj = new URL(url);
            const domain = urlObj.hostname;

            return blackDomainList.some(blackDomain =>
                domain.includes(blackDomain.trim())
            );
        } catch (error) {
            console.error("[Download] Invalid URL:", url);
            return false;
        }
    }
}
