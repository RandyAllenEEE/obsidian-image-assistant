import { App, TFile, TFolder, normalizePath, Notice } from "obsidian";
import ImageConverterPlugin from '../main';
import { ReferenceLocation as VaultRefLocation } from './VaultReferenceManager';

/**
 * 文件引用信息接口
 */
export interface FileReferenceInfo {
    file: TFile;                    // 被检查的文件
    isReferenced: boolean;          // 是否被引用
    references: ReferenceLocation[]; // 引用位置列表
}

/**
 * 引用位置接口
 */
export interface ReferenceLocation {
    notePath: string;   // 引用该文件的笔记路径
    lineNumber: number; // 行号
    lineContent: string; // 行内容
}

/**
 * 清理结果接口
 */
export interface CleanupResult {
    scannedFiles: number;       // 扫描的文件总数
    unreferencedFiles: FileReferenceInfo[]; // 未引用的文件
    referencedFiles: FileReferenceInfo[];   // 被引用的文件
}

/**
 * 无用文件清理器
 * 负责扫描指定文件夹，检测文件引用，并提供删除功能
 */
export class UnusedFileCleaner {
    constructor(
        private app: App,
        private plugin: ImageConverterPlugin
    ) { }

    /**
     * 扫描指定文件夹中的附件并检测引用
     * @param targetFolder 要扫描的文件夹路径（相对于库根目录）
     * @param fileExtensions 要检测的文件扩展名数组，如 ['jpg', 'png', 'pdf']
     * @param progressCallback 进度回调函数 (current, total, currentFile)
     * @returns 清理结果
     */
    async scanFolder(
        targetFolder: string,
        fileExtensions: string[],
        progressCallback?: (current: number, total: number, currentFile: string) => void
    ): Promise<CleanupResult> {
        const normalizedFolder = normalizePath(targetFolder);

        // 获取目标文件夹
        const folder = this.app.vault.getAbstractFileByPath(normalizedFolder);
        if (!folder || !(folder instanceof TFolder)) {
            throw new Error(`Folder not found: ${normalizedFolder}`);
        }

        // 收集所有符合条件的文件
        const filesToCheck: TFile[] = [];
        await this.collectFiles(folder, fileExtensions, filesToCheck);

        const total = filesToCheck.length;
        const unreferencedFiles: FileReferenceInfo[] = [];
        const referencedFiles: FileReferenceInfo[] = [];

        // 逐个检查文件引用
        for (let i = 0; i < filesToCheck.length; i++) {
            const file = filesToCheck[i];

            // 调用进度回调
            if (progressCallback) {
                progressCallback(i + 1, total, file.path);
            }

            // 检查文件引用
            const referenceInfo = await this.checkFileReferences(file);

            if (referenceInfo.isReferenced) {
                referencedFiles.push(referenceInfo);
            } else {
                unreferencedFiles.push(referenceInfo);
            }
        }

        return {
            scannedFiles: total,
            unreferencedFiles,
            referencedFiles
        };
    }

    /**
     * 递归收集文件夹中符合条件的文件
     */
    private async collectFiles(
        folder: TFolder,
        fileExtensions: string[],
        result: TFile[]
    ): Promise<void> {
        for (const child of folder.children) {
            if (child instanceof TFile) {
                // 检查文件扩展名
                const ext = child.extension.toLowerCase();
                if (fileExtensions.includes(ext)) {
                    result.push(child);
                }
            } else if (child instanceof TFolder) {
                // 递归处理子文件夹
                await this.collectFiles(child, fileExtensions, result);
            }
        }
    }

    /**
     * 检查文件在整个库中的引用情况
     * @param file 要检查的文件
     * @returns 文件引用信息
     */
    private async checkFileReferences(file: TFile): Promise<FileReferenceInfo> {
        const references: ReferenceLocation[] = []; // Using local interface

        // Use VaultReferenceManager for O(1) lookup
        const vaultRefs = await this.plugin.vaultReferenceManager.getFilesReferencingImage(file.path);

        if (vaultRefs.length > 0) {
            // Group by file to read efficienty
            const fileMap = new Map<TFile, VaultRefLocation[]>();
            for (const ref of vaultRefs) {
                let list = fileMap.get(ref.file);
                if (!list) {
                    list = [];
                    fileMap.set(ref.file, list);
                }
                list.push(ref);
            }

            // Read each referenced file once to get line content
            for (const [refFile, locs] of fileMap.entries()) {
                try {
                    const content = await this.app.vault.read(refFile);
                    const lines = content.split('\n');

                    for (const loc of locs) {
                        const lineContent = lines[loc.line] || "";
                        references.push({
                            notePath: refFile.path,
                            lineNumber: loc.line + 1, // 1-indexed for UI
                            lineContent: lineContent.trim()
                        });
                    }
                } catch (error) {
                    console.error(`Error reading file ${refFile.path}:`, error);
                }
            }
        }

        return {
            file,
            isReferenced: references.length > 0,
            references
        };
    }

    /**
     * 删除未引用的文件
     * @param files 要删除的文件列表
     * @param trashMode 删除模式：'system' | 'obsidian' | 'custom'
     * @param customTrashPath 自定义垃圾箱路径（当 trashMode 为 'custom' 时使用）
     * @returns 成功删除的文件数量
     */
    async deleteFiles(
        files: TFile[],
        trashMode: 'system' | 'obsidian' | 'custom',
        customTrashPath?: string
    ): Promise<number> {
        let successCount = 0;

        for (const file of files) {
            try {
                if (trashMode === 'system') {
                    // 移动到系统回收站
                    await this.app.vault.trash(file, true);
                    successCount++;
                } else if (trashMode === 'obsidian') {
                    // 移动到 Obsidian 回收站 (.trash 文件夹)
                    await this.app.vault.trash(file, false);
                    successCount++;
                } else if (trashMode === 'custom' && customTrashPath) {
                    // 移动到自定义路径
                    await this.moveToCustomTrash(file, customTrashPath);
                    successCount++;
                }
            } catch (error) {
                console.error(`Error deleting file ${file.path}:`, error);
                new Notice(`Failed to delete ${file.name}: ${error.message}`);
            }
        }

        return successCount;
    }

    /**
     * 移动文件到自定义垃圾箱路径
     */
    private async moveToCustomTrash(file: TFile, customTrashPath: string): Promise<void> {
        const normalizedTrashPath = normalizePath(customTrashPath);

        // 确保垃圾箱文件夹存在
        const trashFolder = this.app.vault.getAbstractFileByPath(normalizedTrashPath);
        if (!trashFolder) {
            await this.app.vault.createFolder(normalizedTrashPath);
        }

        // 生成目标路径
        const targetPath = normalizePath(`${normalizedTrashPath}/${file.name}`);

        // 检查目标路径是否已存在文件
        let finalPath = targetPath;
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(finalPath)) {
            const baseName = file.basename;
            const ext = file.extension;
            finalPath = normalizePath(`${normalizedTrashPath}/${baseName}_${counter}.${ext}`);
            counter++;
        }

        // 移动文件
        await this.app.fileManager.renameFile(file, finalPath);
    }

    /**
     * 解析文件类型字符串（逗号分隔）
     * @param fileTypesStr 文件类型字符串，如 "jpg,png,pdf"
     * @returns 文件扩展名数组
     */
    static parseFileTypes(fileTypesStr: string): string[] {
        return fileTypesStr
            .split(',')
            .map(type => type.trim().toLowerCase())
            .filter(type => type.length > 0);
    }
}
