import { App, Notice, requestUrl, normalizePath, TFile } from "obsidian";
import {
    FolderAndFilenameManagement,
    type BinaryWriteDisposition
} from "../local/FolderAndFilenameManagement";
import type ImageConverterPlugin from "../main";
import { ConcurrentQueue } from "../utils/AsyncLock";
import { ImageReferenceReplacer } from "../utils/ImageReferenceReplacer";
import { BatchResult } from "../types/BatchTypes";
import { isDomainBlacklisted, isPrivateOrReservedAddress, validatePublicHttpUrl } from "../utils/NetworkPolicy";
import { withTimeout } from "../utils/NetworkRequestUtils";
import { isIP } from "net";
import { ReferenceSafetyService } from "../utils/ReferenceSafetyService";
import { getErrorMessage } from "../utils/ErrorUtils";
import { detectImageBinaryType } from "../utils/ImageBinaryType";
import { t } from "../lang/helpers";

const DOWNLOAD_TIMEOUT_MS = 60_000;
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024;

export interface DownloadResult {
    success: boolean;
    skipped?: boolean;
    url: string;
    vaultPath?: string;
    localPath?: string;
    fileName?: string;
    disposition?: BinaryWriteDisposition;
    undoToken?: string;
    replaced?: number;
    error?: string;
}

interface DownloadUndoEntry {
    vaultPath: string;
    disposition: "created" | "overwritten";
    previousData?: ArrayBuffer;
    downloadedDigest: string;
}

export class NetworkImageDownloader {
    private app: App;
    private plugin: ImageConverterPlugin;
    private folderManager: FolderAndFilenameManagement;
    private readonly undoJournal = new Map<string, DownloadUndoEntry>();

    constructor(
        app: App,
        plugin: ImageConverterPlugin,
        folderManager: FolderAndFilenameManagement
    ) {
        this.app = app;
        this.plugin = plugin;
        this.folderManager = folderManager;
    }

    private getReferenceReplacer(): ImageReferenceReplacer {
        return new ImageReferenceReplacer(
            this.app,
            this.plugin.vaultReferenceManager,
            () => this.plugin.settings.localProcessing.link
        );
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
            skipped: [],
            cancelled: false
        };

        if (tasks.length === 0) return result;

        const concurrency = this.plugin.settings.global.batchConcurrency || 3;
        const queue = new ConcurrentQueue(concurrency);

        const downloadTasks = tasks.map(task => async () => this.downloadSingleImageInternal(
                task.url,
                task.targetFolder,
                task.suggestedName,
                task.activeFile
            ));

        const results = await queue.runSettled(downloadTasks);

        results.forEach((res, index) => {
            const task = tasks[index];
            if (res.status === 'fulfilled') {
                if (res.value.success) {
                    result.successful.push({
                        status: "success",
                        success: true,
                        item: task.url,
                        output: res.value
                    });
                } else if (res.value.skipped) {
                    result.skipped.push({
                        status: "skipped",
                        success: false,
                        skipped: true,
                        item: task.url,
                        error: res.value.error
                    });
                } else {
                    result.failed.push({
                        status: "failed",
                        success: false,
                        item: task.url,
                        error: res.value.error || "Download failed"
                    });
                }
            } else {
                result.failed.push({
                    status: "failed",
                    success: false,
                    item: task.url,
                    error: getErrorMessage(res.reason)
                });
            }
        });

        return result;
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
        const result = await this.downloadSingleImageDetailed(url, activeFile);
        try {
            return result.success;
        } finally {
            // This compatibility facade only returns a boolean, so callers
            // cannot invoke undo or inspect partial-success details.
            this.discardDownloadUndo(result);
        }
    }

    async downloadSingleImageDetailed(
        url: string,
        activeFile: TFile
    ): Promise<DownloadResult> {
        try {
            const result = await this.downloadSingleImageFile(url, activeFile);

            if (result.success && result.vaultPath) {
                const replaced = await this.replaceImageLinkInCurrentNote(
                    activeFile,
                    url,
                    result.vaultPath
                );
                if (replaced > 0) return { ...result, replaced };

                return {
                    ...result,
                    success: false,
                    replaced: 0,
                    error: `Downloaded to ${result.vaultPath}, but no matching image reference remained in ${activeFile.path}`
                };
            }

            console.error(`[Download] Failed to download ${url}: ${result.error}`);
            return result;
        } catch (error) {
            console.error('[Download] Error in downloadSingleImage:', error);
            return { success: false, url, error: getErrorMessage(error) };
        }
    }

    /** Downloads a URL using the note's attachment rules without replacing references. */
    async downloadSingleImageFile(url: string, activeFile: TFile): Promise<DownloadResult> {
        const folderPath = this.folderManager.getDefaultAttachmentFolderPath(activeFile);
        await this.folderManager.ensureFolderExists(folderPath);
        return this.downloadSingleImageInternal(
            url,
            folderPath,
            this.extractFilenameFromUrl(url),
            activeFile
        );
    }

    async downloadSingleImageInternal(
        url: string,
        folderPath: string,
        suggestedName: string,
        activeFile: TFile
    ): Promise<DownloadResult> {
        try {
            if (isDomainBlacklisted(url, this.plugin.settings.pasteHandling.cloud.newWorkBlackDomains || "")) {
                return { success: false, url, error: "The image domain is blocked by the network image blacklist" };
            }
            const syntaxError = this.validateUrl(url);
            if (syntaxError) return { success: false, url, error: syntaxError };
            const validationError = await validatePublicHttpUrl(url);
            if (validationError) {
                return {
                    success: false,
                    url: url,
                    error: validationError
                };
            }

            const response = await withTimeout(
                requestUrl({ url }),
                DOWNLOAD_TIMEOUT_MS,
                "Image download"
            );

            if (response.status !== 200) {
                return {
                    success: false,
                    url: url,
                    error: `HTTP ${response.status}`
                };
            }

            const contentLength = Number(this.getResponseHeader(response.headers, "content-length"));
            if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) {
                return { success: false, url, error: "Image exceeds the 100 MiB download limit" };
            }
            if (response.arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
                return { success: false, url, error: "Image exceeds the 100 MiB download limit" };
            }

            const contentType = (this.getResponseHeader(response.headers, "content-type") ?? "")
                .split(";")[0]
                .trim()
                .toLowerCase();
            const type = await detectImageBinaryType(response.arrayBuffer);
            if (!type) {
                return {
                    success: false,
                    url: url,
                    error: "无法识别图片类型"
                };
            }

            if (contentType && !contentType.startsWith("image/") && contentType !== "application/octet-stream") {
                console.warn(
                    `[Download] Server declared ${contentType}; using verified ${type.mime} bytes instead.`
                );
            }

            const baseNameWithoutExt = suggestedName.replace(/\.[^/.]+$/, ""); // 移除原扩展名
            const sanitizedName = this.folderManager.sanitizeFilename(baseNameWithoutExt) || "image";
            const finalName = `${sanitizedName}.${type.ext}`;

            const conflictMode = this.plugin.settings.localProcessing.filename.conflictResolution || "increment";
            const writeResult = await this.folderManager.createUniqueBinaryDetailed(
                folderPath,
                finalName,
                response.arrayBuffer,
                conflictMode,
                { capturePreviousData: true }
            );
            if (!writeResult.file) {
                return {
                    success: false,
                    skipped: true,
                    url,
                    disposition: "skipped",
                    error: `Skipped ${finalName} because the destination already exists`
                };
            }

            const fullPath = writeResult.file.path;
            let undoToken: string | undefined;
            if (writeResult.disposition === "created" || writeResult.disposition === "overwritten") {
                try {
                    undoToken = crypto.randomUUID();
                    this.undoJournal.set(undoToken, {
                        vaultPath: fullPath,
                        disposition: writeResult.disposition,
                        previousData: writeResult.previousData,
                        downloadedDigest: await this.getContentDigest(response.arrayBuffer)
                    });
                } catch (error) {
                    // A download remains valid when the runtime cannot provide Web Crypto;
                    // it simply cannot offer a safe undo operation.
                    console.warn("[Download] Undo was disabled because the download fingerprint could not be created", error);
                    undoToken = undefined;
                }
            }

            // 6. 计算相对路径（相对于当前笔记）
            const activeFolder = activeFile.parent?.path || "";
            const relativePath = this.getRelativePath(activeFolder, fullPath);

            return {
                success: true,
                url: url,
                vaultPath: fullPath,
                localPath: relativePath,
                fileName: writeResult.file.name,
                disposition: writeResult.disposition,
                undoToken
            };

        } catch (error) {
            return {
                success: false,
                url: url,
                error: getErrorMessage(error, "未知错误")
            };
        }
    }

    async undoDownload(result: DownloadResult): Promise<boolean> {
        if (result.disposition === "reused" || result.disposition === "skipped") return true;
        if (!result.undoToken) return false;
        const entry = this.undoJournal.get(result.undoToken);
        if (!entry) return false;

        const file = this.app.vault.getAbstractFileByPath(entry.vaultPath);
        if (!(file instanceof TFile)) {
            this.undoJournal.delete(result.undoToken);
            return false;
        }

        try {
            const currentData = await this.app.vault.readBinary(file);
            if (await this.getContentDigest(currentData) !== entry.downloadedDigest) {
                new Notice(t("MSG_DOWNLOAD_UNDO_CHANGED"));
                return false;
            }

            if (entry.disposition === "created") {
                const safety = await new ReferenceSafetyService(
                    this.app,
                    this.plugin.vaultReferenceManager,
                    { includeFencedCode: this.plugin.settings.global.codeBlockImageLinkIndexing }
                ).inspectLocalFile(file);
                if (!safety.safeToDelete) {
                    const reason = safety.complete
                        ? t("BATCH_REFERENCES_REMAIN", [safety.referenceCount.toString()])
                        : t("MSG_SOURCE_KEPT_SCAN_INCOMPLETE", [safety.uncertainFiles.join(", ")]);
                    new Notice(t("MSG_DOWNLOAD_UNDO_KEPT", [reason]));
                    return false;
                }
                await this.app.vault.trash(file, true);
            } else if (entry.previousData) {
                await this.app.vault.modifyBinary(file, entry.previousData);
            } else {
                return false;
            }

            this.undoJournal.delete(result.undoToken);
            return true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[Download] Undo failed:", error);
            new Notice(t("MSG_DOWNLOAD_UNDO_FAILED", [message]));
            return false;
        }
    }

    discardDownloadUndo(result: DownloadResult): void {
        if (result.undoToken) this.undoJournal.delete(result.undoToken);
    }

    clearUndoJournal(): void {
        this.undoJournal.clear();
    }

    private async getContentDigest(data: ArrayBuffer): Promise<string> {
        const hash = await crypto.subtle.digest("SHA-256", data);
        return Array.from(new Uint8Array(hash), value => value.toString(16).padStart(2, "0")).join("");
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
    private async replaceImageLinkInCurrentNote(
        file: TFile,
        url: string,
        localVaultPath: string
    ): Promise<number> {
        try {
            const result = await this.getReferenceReplacer().replaceUrlInFile(file, url, localVaultPath);

            if (result === 0) {
                console.warn(`[Download] No links found for ${url} in ${file.path} (Cache might be stale)`);
            }
            return result;
        } catch (error) {
            console.error(`[Download] Failed to replace link in ${file.path}:`, error);
            const message = error instanceof Error ? error.message : String(error);
            new Notice(t("MSG_DOWNLOAD_REPLACE_FAILED", [message]));
            return 0;
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

    private validateUrl(url: string): string | null {
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch {
            return "Invalid URL format";
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
            return `Invalid protocol: ${parsed.protocol}`;
        }
        const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
        if (hostname === "localhost" || hostname.endsWith(".localhost")) {
            return `Security error: localhost address ${hostname} is not allowed`;
        }
        if (isIP(hostname) && isPrivateOrReservedAddress(hostname)) {
            const label = hostname.startsWith("169.254.") ? "Link-local" : "Private network";
            return `Security error: ${label} address ${hostname} is not allowed`;
        }
        return null;
    }

    private getResponseHeader(headers: Record<string, string> | undefined, name: string): string | undefined {
        if (!headers) return undefined;
        const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
        return entry?.[1];
    }
}
