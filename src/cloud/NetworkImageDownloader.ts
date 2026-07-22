import { App, Notice, normalizePath, TFile } from "obsidian";
import {
    FolderAndFilenameManagement,
    type BinaryWriteDisposition
} from "../local/FolderAndFilenameManagement";
import type ImageConverterPlugin from "../main";
import { isDomainBlacklisted, isPrivateOrReservedAddress, validatePublicHttpUrl } from "../utils/NetworkPolicy";
import { isIP } from "net";
import { ReferenceSafetyService } from "../utils/ReferenceSafetyService";
import { getErrorMessage } from "../utils/ErrorUtils";
import { detectImageBinaryType } from "../utils/ImageBinaryType";
import { t } from "../lang/helpers";
import {
    StreamingImageFetcher,
    type StreamingImageFetchResult
} from "../utils/StreamingImageFetcher";
import { sha256Hex } from "../utils/BinaryHash";
import { LocalFileDeletionService } from "../utils/LocalFileDeletionService";

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
    errorCode?: "not-image";
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
    private readonly localFileDeletion: LocalFileDeletionService;
    private readonly undoJournal = new Map<string, DownloadUndoEntry>();

    constructor(
        app: App,
        plugin: ImageConverterPlugin,
        folderManager: FolderAndFilenameManagement,
        private readonly imageFetcher = new StreamingImageFetcher()
    ) {
        this.app = app;
        this.plugin = plugin;
        this.folderManager = folderManager;
        this.localFileDeletion = new LocalFileDeletionService(
            app,
            () => plugin.settings.cleanerSettings
        );
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

            const response = await this.imageFetcher.fetch(url);

            const contentType = (this.getResponseHeader(response.headers, "content-type") ?? "")
                .split(";")[0]
                .trim()
                .toLowerCase();
            const type = await detectImageBinaryType(response.data);
            if (!type) {
                return {
                    success: false,
                    url: url,
                    error: t("MSG_DOWNLOAD_NOT_IMAGE"),
                    errorCode: "not-image"
                };
            }

            if (contentType && !contentType.startsWith("image/") && contentType !== "application/octet-stream") {
                console.warn(
                    `[Download] Server declared ${contentType}; using verified ${type.mime} bytes instead.`
                );
            }

            const baseNameWithoutExt = suggestedName.replace(/\.[^/.]+$/, "");
            const fallbackName = `image-${(await this.getContentDigest(response.data)).slice(0, 12)}`;
            const sanitizedName = this.folderManager.sanitizeFilename(baseNameWithoutExt)
                || fallbackName;
            const finalName = `${sanitizedName}.${type.ext}`;

            const conflictMode = this.plugin.settings.localProcessing.filename.conflictResolution || "increment";
            const writeResult = await this.folderManager.createUniqueBinaryDetailed(
                folderPath,
                finalName,
                response.data,
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
                        downloadedDigest: await this.getContentDigest(response.data)
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
                error: getErrorMessage(error, t("MSG_UNKNOWN_ERROR"))
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
                const referenceIndex = this.plugin.referenceIndexService;
                if (typeof referenceIndex?.reconcile === "function") {
                    await referenceIndex.reconcile();
                }
                const indexedSafety = referenceIndex
                    ? await referenceIndex.inspectLocalFile(file, {
                        includeFencedCode: true
                    })
                    : null;
                const safety = indexedSafety ?? await new ReferenceSafetyService(
                    this.app,
                    this.plugin.vaultReferenceManager
                ).inspectLocalFile(file);
                if (!safety.safeToDelete) {
                    const reason = safety.complete
                        ? t("BATCH_REFERENCES_REMAIN", [safety.referenceCount.toString()])
                        : t("MSG_SOURCE_KEPT_SCAN_INCOMPLETE", [safety.uncertainFiles.join(", ")]);
                    new Notice(t("MSG_DOWNLOAD_UNDO_KEPT", [reason]));
                    return false;
                }
                if (indexedSafety
                    && referenceIndex
                    && typeof referenceIndex.isTokenCurrent === "function"
                    && !await referenceIndex.isTokenCurrent(indexedSafety.token)) {
                    new Notice(t("MSG_DOWNLOAD_UNDO_KEPT", [
                        t("REFERENCE_WORKFLOW_CHANGED")
                    ]));
                    return false;
                }
                const finalData = await this.app.vault.readBinary(file);
                if (await this.getContentDigest(finalData) !== entry.downloadedDigest) {
                    new Notice(t("MSG_DOWNLOAD_UNDO_CHANGED"));
                    return false;
                }
                await this.localFileDeletion.delete(file);
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
        return sha256Hex(data);
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

            return !fileName || fileName === "-" ? "" : fileName;
        } catch (error) {
            console.error("[Download] Error extracting filename:", error);
            return "";
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

    private getResponseHeader(
        headers: StreamingImageFetchResult["headers"],
        name: string
    ): string | undefined {
        if (!headers) return undefined;
        const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
        return entry?.[1];
    }
}
