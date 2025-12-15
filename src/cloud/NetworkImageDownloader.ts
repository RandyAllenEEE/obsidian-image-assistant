import { App, Notice, requestUrl, normalizePath, TFile } from "obsidian";
import { join, parse } from "path-browserify";
import imageType from "image-type";
import { UploadHelper, ImageLink } from "../utils/UploadHelper";
import { FolderAndFilenameManagement } from "../local/FolderAndFilenameManagement";
import type ImageConverterPlugin from "../main";
import { NetworkImageDownloadModal, DownloadTask, DownloadChoice, DownloadMode } from "./NetworkImageDownloadModal";

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

        // 1. 提取所有图片链接
        const allImages = this.uploadHelper.getAllImageLinks();
        
        // 2. 过滤网络图片
        const networkImages = allImages.filter(img => 
            img.path.startsWith('http://') || img.path.startsWith('https://')
        );

        if (networkImages.length === 0) {
            new Notice("📝 当前笔记没有网络图片");
            return;
        }

        // 3. 应用域名黑名单（如果配置）
        const blackDomains = this.plugin.settings.cloudUploadSettings?.newWorkBlackDomains || "";
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

        let successCount = 0;
        let failedCount = 0;
        let skippedCount = 0;

        new Notice(`🚀 开始处理 ${selectedTasks.length} 张图片...`);

        for (let i = 0; i < selectedTasks.length; i++) {
            const task = selectedTasks[i];
            new Notice(`🔄 (${i + 1}/${selectedTasks.length}): ${task.suggestedName}`);

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
                            task.originalSource,
                            relativePath
                        );
                        successCount++;
                    } else {
                        console.warn(`[Download] Local file not found for: ${task.suggestedName}`);
                        skippedCount++;
                    }
                } else {
                    // 下载模式（仅下载 或 下载并替换）
                    const result = await this.downloadSingleImage(
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
                                task.originalSource,
                                result.localPath
                            );
                        }
                    } else {
                        failedCount++;
                        console.error(`[Download] Failed: ${task.url} - ${result.error}`);
                    }
                }
            } catch (error) {
                failedCount++;
                console.error(`[Download] Error processing ${task.url}:`, error);
            }
        }

        // 显示统计结果
        let message = `✅ 处理完成\n`;
        message += `总计: ${selectedTasks.length} 张\n`;
        message += `成功: ${successCount} 张\n`;
        if (failedCount > 0) message += `失败: ${failedCount} 张\n`;
        if (skippedCount > 0) message += `跳过: ${skippedCount} 张\n`;

        // 根据模式显示不同的成功消息
        if (mode === "download-only") {
            message += `\n📦 图片已下载，链接未更改`;
        } else if (mode === "download-and-replace") {
            message += `\n🔄 图片已下载并替换为本地路径`;
        } else if (mode === "replace-only") {
            message += `\n🔄 链接已替换为本地路径`;
        }

        new Notice(message, 5000);
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
     * 下载单张网络图片
     */
    private async downloadSingleImage(
        url: string,
        folderPath: string,
        suggestedName: string,
        activeFile: TFile
    ): Promise<DownloadResult> {
        try {
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
            const conflictMode = this.plugin.settings.filenamePresets[0]?.conflictResolution || "increment";
            
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
    private async replaceImageLinkInCurrentNote(
        file: TFile,
        originalSource: string,
        localPath: string
    ): Promise<void> {
        try {
            let content = await this.app.vault.read(file);
            
            // 转义特殊字符用于正则匹配
            const escapedSource = originalSource.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            
            // 提取原始的 alt 文本和尺寸参数
            let altText = "";
            let sizeParams = "";
            const markdownMatch = originalSource.match(/!\[([^\]]*)\]/);
            if (markdownMatch) {
                const fullAlt = markdownMatch[1];
                // 检查是否包含尺寸参数 (格式: alt|widthxheight 或 alt|width)
                const sizeMatch = fullAlt.match(/^(.*?)\|(\d+x\d*|\d*x\d+|\d+)$/);
                if (sizeMatch) {
                    altText = sizeMatch[1]; // 纯 alt 文本
                    sizeParams = `|${sizeMatch[2]}`; // 尺寸参数
                } else {
                    altText = fullAlt; // 没有尺寸参数
                }
            }

            // 生成新的链接（保留alt文本和尺寸参数）
            const newLink = `![${altText}${sizeParams}](${encodeURI(localPath)})`;
            
            // 替换链接
            const newContent = content.replace(new RegExp(escapedSource, 'g'), newLink);
            
            if (content !== newContent) {
                await this.app.vault.modify(file, newContent);
                console.log(`[Download] Replaced link in ${file.path}: ${originalSource} → ${newLink}`);
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
