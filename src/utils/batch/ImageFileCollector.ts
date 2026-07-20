import { App, TFile, TFolder } from 'obsidian';
import ImageConverterPlugin from '../../main';
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

    async getImagesFromCanvasDetailed(file: TFile): Promise<{
        paths: string[];
        complete: boolean;
        error?: string;
    }> {
        const images = new Set<string>();
        try {
            const content = await this.app.vault.read(file);
            const canvasData = JSON.parse(content) as { nodes?: unknown };

            if (!Array.isArray(canvasData.nodes)) {
                throw new Error("Canvas nodes are invalid");
            }
            for (const rawNode of canvasData.nodes) {
                if (!rawNode || typeof rawNode !== "object") continue;
                const node = rawNode as { type?: unknown; file?: unknown; text?: unknown };
                if (node.type === "file" && typeof node.file === "string") {
                    images.add(this.resolveCanvasFilePath(node.file, file));
                }
                if (typeof node.text === "string") {
                    for (const link of getContextualReferenceLinks(node.text, {
                        includeFencedCode: this.plugin.settings.global.codeBlockImageLinkIndexing
                    })) {
                        if (isHttpUrl(link.path)) continue;
                        images.add(this.resolveCanvasFilePath(link.path, file));
                    }
                }
            }
        } catch (error) {
            console.error(`Error reading canvas file ${file.path}:`, error);
            return {
                paths: [...images].sort(),
                complete: false,
                error: error instanceof Error ? error.message : String(error)
            };
        }

        return { paths: [...images].sort(), complete: true };
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

}
