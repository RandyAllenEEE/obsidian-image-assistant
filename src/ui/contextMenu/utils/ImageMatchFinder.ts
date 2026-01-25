import { App, Editor, normalizePath } from 'obsidian';
import * as path from 'path';
import { pipeSyntaxParser } from '../../../utils/PipeSyntaxParser';
import { ImagePathUtils } from './ImagePathUtils';

/**
 * Utility class for finding image matches in editor content
 */
export class ImageMatchFinder {
    constructor(private app: App) { }

    /**
     * Finds the line number where the frontmatter section ends in the editor.
     *
     * @param editor - The Obsidian Editor instance.
     * @returns The line number of the frontmatter end, or -1 if not found.
     */
    findFrontmatterEnd(editor: Editor): number {
        let inFrontmatter = false;
        const lineCount = editor.getDoc().lineCount();

        for (let i = 0; i < lineCount; i++) {
            const line = editor.getLine(i).trim();
            if (line === '---') {
                if (!inFrontmatter && i === 0) {
                    inFrontmatter = true;
                } else if (inFrontmatter) {
                    return i;
                }
            }
        }
        return -1;
    }

    /**
     * Finds image links in the editor's content based on the provided criteria.
     *
     * @param editor - The Obsidian Editor instance.
     * @param imagePath - The path of the image (for local images) or null (for external images).
     * @param isExternal - A flag indicating whether the image is external.
     * @returns An array of objects, each containing the line number, line content, and full match
     *          for each matching image link found. Returns an empty array if no matches are found.
     */
    async findImageMatches(
        editor: Editor,
        imagePath: string | null,
        isExternal: boolean
    ): Promise<{ lineNumber: number, line: string, fullMatch: string, index: number }[]> {
        const lineCount = editor.getDoc().lineCount();
        const frontmatterEnd = this.findFrontmatterEnd(editor);
        const matches: { lineNumber: number, line: string, fullMatch: string, index: number }[] = [];
        const activeFile = this.app.workspace.getActiveFile();

        if (!activeFile) return matches;

        for (let i = frontmatterEnd + 1; i < lineCount; i++) {
            const line = editor.getLine(i);
            const links = pipeSyntaxParser.extractAllLinks(line);

            for (const link of links) {
                const linkPath = link.data.path;

                if (isExternal) {
                    // For external/network images, imagePath is effectively the URL
                    // We compare the path in the link with the passed imagePath (URL)
                    if (imagePath && linkPath === imagePath) {
                        matches.push({ lineNumber: i, line, fullMatch: link.fullMatch, index: link.index });
                    }
                } else {
                    // For local images
                    if (imagePath && !linkPath.startsWith('http')) {
                        // Helper to resolve relative paths
                        const resolveRelativePath = (p: string, activeFilePath: string): string => {
                            const activeFileDir = path.dirname(activeFilePath);
                            if (p.startsWith('./') || p.startsWith('../')) {
                                return normalizePath(path.join(activeFileDir, p));
                            }
                            return normalizePath(p);
                        };

                        const resolvedLinkPath = resolveRelativePath(linkPath, activeFile.path);
                        const normalizedImagePath = ImagePathUtils.normalizeImagePath(imagePath);
                        const normalizedResolvedPath = ImagePathUtils.normalizeImagePath(resolvedLinkPath);

                        // Check for exact match or if the normalized image path ends with the resolved path
                        if (normalizedImagePath === normalizedResolvedPath ||
                            normalizedImagePath.endsWith(normalizedResolvedPath)) {
                            matches.push({ lineNumber: i, line, fullMatch: link.fullMatch, index: link.index });
                        }
                    }
                }
            }
        }

        return matches;
    }

    /**
     * Processes the first Base64 image found in the editor's content.
     *
     * @param editor - The Obsidian Editor instance.
     * @param src - The `src` attribute of the Base64 image to search for.
     * @param processor - A callback function to process the matched Base64 image.
     *                    This function takes the editor, line number, line content, and full match as arguments.
     * @returns True if a Base64 image was found and processed, false otherwise.
     */
    async processBase64Image(
        editor: Editor,
        src: string,
        processor: (editor: Editor, lineNumber: number, line: string, fullMatch: string) => Promise<void>
    ): Promise<boolean> {
        const lineCount = editor.getDoc().lineCount();
        for (let i = 0; i < lineCount; i++) {
            const line = editor.getLine(i);
            const base64Matches = [...line.matchAll(/<img\s+src="data:image\/[^"]+"\s*\/?>/g)];

            for (const match of base64Matches) {
                if (match[0].includes(src)) {
                    await processor(editor, i, line, match[0]);
                    return true;
                }
            }
        }
        return false;
    }
}
