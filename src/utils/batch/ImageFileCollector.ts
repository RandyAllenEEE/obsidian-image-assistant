import { App, TFile, TFolder } from 'obsidian';
import ImageConverterPlugin from '../../main';
import { CollectedFiles, FileCollectorOptions } from './types';
import { isHttpUrl } from '../NetworkPolicy';
import { getContextualReferenceLinks } from '../MarkdownSourceContext';

/**
 * ImageFileCollector - Shared utility for collecting image files.
 * Used by both Local and Cloud batch processors.
 */
export class ImageFileCollector {
    constructor(
        private app: App,
        private plugin: ImageConverterPlugin
    ) { }

    // ============ Note-based Collection ============

    /**
     * Get all image files linked in a note.
     */
    getLinkedImageFiles(noteFile: TFile): TFile[] {
        const { resolvedLinks } = this.app.metadataCache;
        const linksInCurrentNote = resolvedLinks[noteFile.path];

        if (!linksInCurrentNote) return [];

        return Object.keys(linksInCurrentNote)
            .map(link => this.app.vault.getAbstractFileByPath(link))
            .filter((file): file is TFile =>
                file instanceof TFile &&
                this.plugin.supportedImageFormats.isSupported(undefined, file.name)
            );
    }

    // ============ Folder-based Collection ============

    /**
     * Get image files from a folder.
     */
    getImageFilesInFolder(folder: TFolder, recursive: boolean): TFile[] {
        const allFiles = this.app.vault.getFiles();
        const folderPath = folder.path.replace(/\\/g, '/').replace(/\/$/, '');
        const prefix = folderPath === '' || folderPath === '/' ? '' : `${folderPath}/`;

        const isImmediateChild = (filePath: string) => {
            if (!prefix) {
                return filePath.indexOf('/') === -1;
            }
            if (!filePath.startsWith(prefix)) return false;
            const remainder = filePath.slice(prefix.length);
            return remainder.indexOf('/') === -1;
        };

        return allFiles.filter((file) => {
            if (!this.plugin.supportedImageFormats.isSupported(undefined, file.name)) return false;
            const normalized = file.path.replace(/\\/g, '/');
            if (recursive) {
                return prefix === '' ? true : normalized.startsWith(prefix);
            }
            return isImmediateChild(normalized);
        });
    }

    /**
     * Get image files from a folder by path string.
     */
    getImageFilesInFolderPath(folderPath: string, recursive: boolean): TFile[] {
        const folder = this.app.vault.getAbstractFileByPath(folderPath);
        if (!(folder instanceof TFolder)) {
            return [];
        }
        return this.getImageFilesInFolder(folder, recursive);
    }

    // ============ Vault-wide Collection ============

    /**
     * Get all image files in the vault.
     */
    async getAllImageFiles(): Promise<TFile[]> {
        const allFiles = this.app.vault.getFiles();
        const imageFiles = allFiles.filter(file =>
            this.plugin.supportedImageFormats.isSupported(undefined, file.name)
        );

        // Also include images from canvas files
        const canvasFiles = allFiles.filter(file =>
            file instanceof TFile &&
            file.extension === 'canvas'
        );

        for (const canvasFile of canvasFiles) {
            const canvasImages = await this.getImagesFromCanvas(canvasFile);
            for (const imagePath of canvasImages) {
                const imageFile = this.app.vault.getAbstractFileByPath(imagePath);
                if (imageFile instanceof TFile && this.plugin.supportedImageFormats.isSupported(undefined, imageFile.name)) {
                    if (!imageFiles.find(existing => existing.path === imageFile.path)) {
                        imageFiles.push(imageFile);
                    }
                }
            }
        }

        return imageFiles;
    }

    // ============ Canvas Support ============

    /**
     * Get images from a canvas file.
     */
    async getImagesFromCanvas(file: TFile): Promise<string[]> {
        const images = new Set<string>();
        try {
            const content = await this.app.vault.read(file);
            const canvasData = JSON.parse(content);

            if (canvasData.nodes && Array.isArray(canvasData.nodes)) {
                for (const node of canvasData.nodes) {
                    if (node?.type === "file" && typeof node.file === "string") {
                        images.add(this.resolveCanvasFilePath(node.file, file));
                    }
                    if (typeof node?.text === "string") {
                        for (const link of getContextualReferenceLinks(node.text, {
                            includeFencedCode: this.plugin.settings.global.codeBlockImageLinkIndexing
                        })) {
                            if (isHttpUrl(link.path)) continue;
                            images.add(this.resolveCanvasFilePath(link.path, file));
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error reading canvas file ${file.path}:`, error);
        }

        return [...images];
    }

    private resolveCanvasFilePath(canvasPath: string, canvasFile: TFile): string {
        const directFile = this.app.vault.getAbstractFileByPath(canvasPath);
        if (directFile instanceof TFile) {
            return directFile.path;
        }

        const resolved = this.app.metadataCache.getFirstLinkpathDest(canvasPath, canvasFile.path);
        if (resolved instanceof TFile) {
            return resolved.path;
        }

        return canvasPath;
    }

    // ============ Validation & Filtering ============

    /**
     * Validate that a file exists.
     */
    async validateFileExists(file: TFile): Promise<boolean> {
        return await this.app.vault.adapter.exists(file.path);
    }

    /**
     * Check if an image should be processed based on format settings.
     */
    shouldProcessImage(
        image: TFile,
        isKeepOriginalFormat: boolean,
        targetFormat: string,
        skipFormats: string[],
        skipImagesInTargetFormat: boolean
    ): boolean {
        const effectiveTargetFormat = isKeepOriginalFormat
            ? image.extension
            : targetFormat;

        if (skipFormats.includes(image.extension.toLowerCase())) {
            return false;
        }

        if (skipImagesInTargetFormat &&
            image.extension === effectiveTargetFormat) {
            return false;
        }

        return true;
    }

    /**
     * Parse skip formats from settings string.
     */
    parseSkipFormats(skipFormatsSetting: string): string[] {
        return skipFormatsSetting
            .toLowerCase()
            .split(',')
            .map(format => format.trim())
            .filter(format => format.length > 0);
    }

    /**
     * De-duplicate files by path while preserving order.
     */
    deduplicateFiles(files: TFile[]): TFile[] {
        const seen = new Set<string>();
        return files.filter((file) => {
            if (seen.has(file.path)) return false;
            seen.add(file.path);
            return true;
        });
    }

    // ============ Advanced Collection with Options ============

    /**
     * Collect files with validation and filtering options.
     */
    async collectFilesWithOptions(
        files: TFile[],
        options: Partial<FileCollectorOptions> = {}
    ): Promise<CollectedFiles> {
        const result: CollectedFiles = {
            files: [],
            skipped: [],
            errors: []
        };

        const skipFormats = options.skipFormats || [];

        for (const file of files) {
            // Check skip formats
            if (skipFormats.includes(file.extension.toLowerCase())) {
                result.skipped.push({ file, reason: 'Format in skip list' });
                continue;
            }

            // Validate exists
            if (options.validateExists) {
                const exists = await this.validateFileExists(file);
                if (!exists) {
                    result.errors.push({ path: file.path, error: 'File not found' });
                    continue;
                }
            }

            // Custom filter
            if (options.filterCallback && !options.filterCallback(file)) {
                result.skipped.push({ file, reason: 'Filtered by custom callback' });
                continue;
            }

            result.files.push(file);
        }

        return result;
    }
}
