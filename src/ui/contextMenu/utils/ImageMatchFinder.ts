import { App, Editor, normalizePath, TFile } from 'obsidian';
import * as path from 'path';
import { pipeSyntaxParser } from '../../../utils/PipeSyntaxParser';
import { ImagePathUtils } from './ImagePathUtils';
import { isHttpUrl } from '../../../utils/NetworkPolicy';
import { getContextualImageLinks } from '../../../utils/MarkdownSourceContext';

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
        isExternal: boolean,
        sourceFile: TFile | null = this.app.workspace.getActiveFile()
    ): Promise<{ lineNumber: number, line: string, fullMatch: string, index: number }[]> {
        const lineCount = editor.getDoc().lineCount();
        const matches: { lineNumber: number, line: string, fullMatch: string, index: number }[] = [];
        const activeFile = sourceFile;

        if (!activeFile) return matches;

        const lines = Array.from({ length: lineCount }, (_, index) => editor.getLine(index));
        const content = lines.join('\n');
        const lineStarts = getLineStarts(lines);
        for (const sourceLink of getContextualImageLinks(content)) {
            const parsed = pipeSyntaxParser.parsePipeSyntax(sourceLink.source);
            if (!parsed) continue;
            const linkPath = parsed.path;
            const lineNumber = getLineForOffset(lineStarts, sourceLink.index);
            const index = sourceLink.index - lineStarts[lineNumber];
            const line = lines[lineNumber];

            if (isExternal) {
                if (imagePath && this.areExternalUrlsEquivalent(linkPath, imagePath)) {
                    matches.push({ lineNumber, line, fullMatch: sourceLink.source, index });
                }
                continue;
            }

            if (imagePath && !isHttpUrl(linkPath)) {
                const resolveRelativePath = (p: string, activeFilePath: string): string => {
                    const activeFileDir = path.dirname(activeFilePath);
                    if (p.startsWith('./') || p.startsWith('../')) {
                        return normalizePath(path.join(activeFileDir, p));
                    }
                    return normalizePath(p);
                };

                const normalizedImagePath = ImagePathUtils.normalizeImagePath(imagePath);
                const metadataDest = this.app.metadataCache.getFirstLinkpathDest(linkPath, activeFile.path);
                if (metadataDest instanceof TFile) {
                    if (ImagePathUtils.normalizeImagePath(metadataDest.path) === normalizedImagePath) {
                        matches.push({ lineNumber, line, fullMatch: sourceLink.source, index });
                    }
                    continue;
                }

                const resolvedLinkPath = resolveRelativePath(linkPath, activeFile.path);
                const normalizedResolvedPath = ImagePathUtils.normalizeImagePath(resolvedLinkPath);
                const normalizedResolvedSuffix = normalizedResolvedPath.replace(/^\/+/, '');

                if (normalizedImagePath === normalizedResolvedPath ||
                    normalizedImagePath.endsWith(`/${normalizedResolvedSuffix}`)) {
                    matches.push({ lineNumber, line, fullMatch: sourceLink.source, index });
                }
            }
        }

        return matches;
    }

    private areExternalUrlsEquivalent(linkPath: string, imagePath: string): boolean {
        if (linkPath === imagePath) {
            return true;
        }

        return this.normalizeExternalUrlForComparison(linkPath) ===
            this.normalizeExternalUrlForComparison(imagePath);
    }

    private normalizeExternalUrlForComparison(url: string): string {
        const trimmed = (url ?? '').trim();
        try {
            return decodeURI(trimmed);
        } catch {
            return trimmed;
        }
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
            const base64Matches = [...line.matchAll(/<img\b[^>]*\bsrc\s*=\s*(["'])(data:image\/[^"']+)\1[^>]*>/gi)];

            for (const match of base64Matches) {
                if (match[2] === src) {
                    await processor(editor, i, line, match[0]);
                    return true;
                }
            }
        }
        return false;
    }
}

function getLineStarts(lines: string[]): number[] {
    const starts: number[] = [];
    let offset = 0;
    for (const line of lines) {
        starts.push(offset);
        offset += line.length + 1;
    }
    return starts;
}

function getLineForOffset(lineStarts: number[], offset: number): number {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        const start = lineStarts[middle];
        const next = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY;
        if (offset < start) high = middle - 1;
        else if (offset >= next) low = middle + 1;
        else return middle;
    }
    return Math.max(0, lineStarts.length - 1);
}
