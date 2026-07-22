import { App, TFile, TFolder, normalizePath, Notice } from "obsidian";
import ImageConverterPlugin from '../main';
import { ReferenceLocation as VaultRefLocation } from './VaultReferenceManager';
import { CanvasFileReference, getCanvasFileReferenceIndexDetailed } from './CanvasReferenceUtils';
import { ReferenceSafetyService } from './ReferenceSafetyService';
import { REFERENCE_SAFETY_SCAN_POLICY } from './ReferenceScanPolicy';
import { getErrorMessage } from './ErrorUtils';
import { normalizeVaultFolderPath } from './VaultPathUtils';
import {
    LocalFileDeletionService,
    type LocalFileDeletionMode
} from "./LocalFileDeletionService";

/**
 * 文件引用信息接口
 */
export interface FileReferenceInfo {
    file: TFile;                    // 被检查的文件
    isReferenced: boolean;          // 是否被引用
    references: readonly ReferenceLocation[]; // 引用位置列表
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
    unknownFiles: FileReferenceInfo[];
    scanComplete: boolean;
    uncertainFiles: string[];
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
        const configuredTrashPath = this.plugin.settings?.cleanerSettings?.trashMode === "custom"
            ? normalizeVaultFolderPath(this.plugin.settings.cleanerSettings.customTrashPath)
            : "";
        const excludedFolder = configuredTrashPath && configuredTrashPath !== normalizedFolder
            ? configuredTrashPath
            : undefined;
        await this.collectFiles(folder, fileExtensions, filesToCheck, excludedFolder);

        const total = filesToCheck.length;
        const unreferencedFiles: FileReferenceInfo[] = [];
        const referencedFiles: FileReferenceInfo[] = [];
        const indexedSnapshots = this.plugin.referenceIndexService
            ? await this.plugin.referenceIndexService.inspectLocalFiles(
                filesToCheck,
                REFERENCE_SAFETY_SCAN_POLICY
            )
            : null;
        const imagePaths = filesToCheck.map(file => file.path);
        const markdownScan = indexedSnapshots
            ? null
            : await this.plugin.vaultReferenceManager.scanReferencesForTargetsDetailed(
                imagePaths,
                REFERENCE_SAFETY_SCAN_POLICY
            );
        const canvasScan = indexedSnapshots
            ? null
            : await getCanvasFileReferenceIndexDetailed(
                this.app,
                filesToCheck,
                REFERENCE_SAFETY_SCAN_POLICY
            );
        const noteContentCache = new Map<string, string[]>();
        const unknownFiles: FileReferenceInfo[] = [];
        const uncertainFiles = new Set<string>();
        let scanComplete = true;

        // 逐个检查文件引用
        for (let i = 0; i < filesToCheck.length; i++) {
            const file = filesToCheck[i];
            const indexed = indexedSnapshots?.get(normalizePath(file.path));
            const fileComplete = indexed
                ? indexed.complete
                : !!markdownScan?.complete && !!canvasScan?.complete;
            if (!fileComplete) scanComplete = false;
            indexed?.uncertainFiles.forEach(path => uncertainFiles.add(path));

            // 调用进度回调
            if (progressCallback) {
                progressCallback(i + 1, total, file.path);
            }

            // 检查文件引用
            const referenceInfo = await this.checkFileReferences(
                file,
                indexed?.markdown
                    ?? markdownScan?.references.get(file.path)
                    ?? [],
                indexed?.canvas
                    ?? canvasScan?.references.get(file.path)
                    ?? [],
                noteContentCache
            );

            if (referenceInfo.isReferenced) {
                referencedFiles.push(referenceInfo);
            } else if (!fileComplete) {
                unknownFiles.push(referenceInfo);
            } else {
                unreferencedFiles.push(referenceInfo);
            }
        }
        markdownScan?.uncertainFiles.forEach(path => uncertainFiles.add(path));
        canvasScan?.uncertainFiles.forEach(path => uncertainFiles.add(path));

        return {
            scannedFiles: total,
            unreferencedFiles,
            referencedFiles,
            unknownFiles,
            scanComplete,
            uncertainFiles: [...uncertainFiles]
        };
    }

    /**
     * 递归收集文件夹中符合条件的文件
     */
    private async collectFiles(
        folder: TFolder,
        fileExtensions: string[],
        result: TFile[],
        excludedFolder?: string
    ): Promise<void> {
        for (const child of folder.children) {
            if (child instanceof TFile) {
                // 检查文件扩展名
                const ext = child.extension.toLowerCase();
                if (fileExtensions.includes(ext)) {
                    result.push(child);
                }
            } else if (child instanceof TFolder) {
                if (excludedFolder && (
                    child.path === excludedFolder || child.path.startsWith(`${excludedFolder}/`)
                )) {
                    continue;
                }
                // 递归处理子文件夹
                await this.collectFiles(child, fileExtensions, result, excludedFolder);
            }
        }
    }

    /**
     * 检查文件在整个库中的引用情况
     * @param file 要检查的文件
     * @returns 文件引用信息
     */
    private async checkFileReferences(
        file: TFile,
        indexedVaultRefs: readonly VaultRefLocation[],
        indexedCanvasRefs: readonly CanvasFileReference[],
        noteContentCache: Map<string, string[]> = new Map()
    ): Promise<FileReferenceInfo> {
        const references: ReferenceLocation[] = []; // Using local interface

        // Use VaultReferenceManager for O(1) lookup
        const vaultRefs = indexedVaultRefs;

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
                    let lines = noteContentCache.get(refFile.path);
                    if (!lines) {
                        lines = (await this.app.vault.read(refFile)).split('\n');
                        noteContentCache.set(refFile.path, lines);
                    }

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
                    for (const loc of locs) {
                        references.push({
                            notePath: refFile.path,
                            lineNumber: loc.line + 1,
                            lineContent: loc.original
                        });
                    }
                }
            }
        }

        const canvasReferences = this.mapCanvasReferences(indexedCanvasRefs);
        references.push(...canvasReferences);

        return {
            file,
            isReferenced: references.length > 0,
            references
        };
    }

    private mapCanvasReferences(
        canvasRefs: readonly CanvasFileReference[]
    ): ReferenceLocation[] {
        return canvasRefs.map((ref) => ({
            notePath: ref.canvasFile.path,
            lineNumber: ref.lineNumber,
            lineContent: `Canvas file node: ${ref.nodeFile}`
        }));
    }

    /**
     * 删除未引用的文件
     * @param files 要删除的文件列表
     * @param trashMode 删除模式
     * @param customTrashPath 自定义垃圾箱路径（当 trashMode 为 'custom' 时使用）
     * @returns 成功删除的文件数量
     */
    async deleteFiles(
        files: TFile[],
        trashMode: LocalFileDeletionMode,
        customTrashPath?: string
    ): Promise<number> {
        let successCount = 0;
        const deletionService = new LocalFileDeletionService(
            this.app,
            () => ({
                trashMode,
                customTrashPath: customTrashPath ?? ""
            })
        );
        const safetyService = new ReferenceSafetyService(
            this.app,
            this.plugin.vaultReferenceManager,
            this.plugin.referenceIndexService
        );
        const referenceIndex = this.plugin.referenceIndexService;
        if (typeof referenceIndex?.reconcile === "function") {
            await referenceIndex.reconcile();
        }
        let indexedSnapshots = referenceIndex
            ? await referenceIndex.inspectLocalFiles(
                files,
                REFERENCE_SAFETY_SCAN_POLICY
            )
            : null;
        let indexedGeneration = referenceIndex?.getGeneration() ?? -1;

        for (let index = 0; index < files.length; index++) {
            const file = files[index];
            try {
                const currentSnapshot = indexedSnapshots?.get(normalizePath(file.path));
                if (referenceIndex
                    && (referenceIndex.getGeneration() !== indexedGeneration
                        || (currentSnapshot
                            && typeof referenceIndex.isTokenCurrent === "function"
                            && !await referenceIndex.isTokenCurrent(currentSnapshot.token)))) {
                    indexedSnapshots = await referenceIndex.inspectLocalFiles(
                        files.slice(index),
                        REFERENCE_SAFETY_SCAN_POLICY
                    );
                    indexedGeneration = referenceIndex.getGeneration();
                }
                const safety = indexedSnapshots?.get(normalizePath(file.path))
                    ?? await safetyService.inspectLocalFile(file);
                if (!safety.safeToDelete) {
                    const reason = safety.complete
                        ? `${safety.referenceCount} reference(s) remain`
                        : `reference scan incomplete: ${safety.uncertainFiles.join(', ')}`;
                    new Notice(`Skipped ${file.name}: ${reason}`);
                    continue;
                }

                await deletionService.delete(file);
                successCount++;
            } catch (error) {
                console.error(`Error deleting file ${file.path}:`, error);
                new Notice(`Failed to delete ${file.name}: ${getErrorMessage(error)}`);
            }
        }

        return successCount;
    }

    /**
     * 解析文件类型字符串（逗号分隔）
     * @param fileTypesStr 文件类型字符串，如 "jpg,png,pdf"
     * @returns 文件扩展名数组
     */
    static parseFileTypes(fileTypesStr: string): string[] {
        const seen = new Set<string>();
        return fileTypesStr
            .split(',')
            .map(type => type.trim().toLowerCase().replace(/^\.+/, ''))
            .filter(type => type.length > 0)
            .filter(type => {
                if (seen.has(type)) return false;
                seen.add(type);
                return true;
            });
    }
}
