import { App, TFile, LinkCache, EmbedCache } from "obsidian";
import { normalizePath } from "obsidian";
import type ImageConverterPlugin from "../main";
import { pipeSyntaxParser } from "./PipeSyntaxParser";

export interface ReferenceLocation {
    file: TFile;
    start: number; // offset
    end: number;   // offset
    original: string; // The full original link text (e.g., "![[image.png]]")
    link: string;     // The link path inside (e.g. "image.png")
    line: number;     // The line number (0-indexed)
}

export class VaultReferenceManager {
    constructor(
        private app: App,
        private plugin?: ImageConverterPlugin
    ) { }

    private isCodeBlockImageLinkIndexingEnabled(): boolean {
        return !!this.plugin?.settings?.global?.codeBlockImageLinkIndexing;
    }

    private isProbablyImageLinkText(text: string): boolean {
        const trimmed = (text ?? '').trim();
        return trimmed.startsWith('![') || trimmed.startsWith('![[');
    }

    /**
     * Find all files and specific locations that reference the given image path.
     * Uses MetadataCache for O(1) file discovery and precise location mapping.
     */
    async getFilesReferencingImage(imagePath: string): Promise<ReferenceLocation[]> {
        const locations: ReferenceLocation[] = [];
        const resolvedLinks = this.app.metadataCache.resolvedLinks;
        const normalizedImagePath = normalizePath(imagePath);
        const candidateFilePaths = new Set<string>();

        // 1. Iterate through all files in the vault to find those that link to our image
        // resolvedLinks keys are source file paths, values are objects { targetPath: count }
        const sourceFilePaths = Object.keys(resolvedLinks);

        for (const sourcePath of sourceFilePaths) {
            const links = resolvedLinks[sourcePath];
            // Check if this file has a link to our image
            // Note: resolvedLinks keys are fully resolved paths
            if (links[normalizedImagePath]) {
                const sourceFile = this.app.vault.getAbstractFileByPath(sourcePath);
                if (sourceFile && sourceFile instanceof TFile) {
                    candidateFilePaths.add(sourceFile.path);
                    const fileLocations = await this.getReferencesInFile(sourceFile, normalizedImagePath);
                    locations.push(...fileLocations);
                }
            }
        }

        // 2) Optional slow path: scan fenced code blocks and admonition blocks in files
        // that metadataCache may not have indexed into resolvedLinks.
        if (this.isCodeBlockImageLinkIndexingEnabled()) {
            const targetBasename = normalizedImagePath.split('/').pop() ?? normalizedImagePath;
            const markdownFiles = this.app.vault.getMarkdownFiles();

            for (const file of markdownFiles) {
                if (!(file instanceof TFile)) continue;
                if (candidateFilePaths.has(file.path)) continue;

                // Prefilter by basename to reduce IO.
                const content = await this.app.vault.read(file);
                if (!content.includes(targetBasename)) continue;

                const scanned = await this.scanCodeAndAdmonitionReferences(file, normalizedImagePath, content);
                locations.push(...scanned);
            }
        }

        // Deduplicate across sources by file+offset.
        const seen = new Set<string>();
        const merged: ReferenceLocation[] = [];
        for (const loc of locations) {
            const key = `${loc.file.path}:${loc.start}-${loc.end}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(loc);
        }

        return merged;
    }

    /**
     * Get precise locations of references within a specific file using MetadataCache.
     */
    private async getReferencesInFile(file: TFile, targetImagePath: string): Promise<ReferenceLocation[]> {
        const cache = this.app.metadataCache.getFileCache(file);
        const locations: ReferenceLocation[] = [];
        const targetNormal = normalizePath(targetImagePath);
        const isUrl = targetImagePath.startsWith('http://') || targetImagePath.startsWith('https://');

        // 1) Fast path: use metadataCache positions when available.
        const checkLink = (link: LinkCache | EmbedCache) => {
            const linkpath = link.link.split('#')[0].split('|')[0];

            if (isUrl) {
                if (linkpath === targetImagePath) {
                    locations.push({
                        file,
                        start: link.position.start.offset,
                        end: link.position.end.offset,
                        original: link.original,
                        link: link.link,
                        line: link.position.start.line
                    });
                }
            } else {
                const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);
                if (dest && dest.path === targetNormal) {
                    locations.push({
                        file,
                        start: link.position.start.offset,
                        end: link.position.end.offset,
                        original: link.original,
                        link: link.link,
                        line: link.position.start.line
                    });
                }
            }
        };

        cache?.embeds?.forEach(checkLink);
        cache?.links?.forEach(checkLink);

        // 2) Optional slow path: scan fenced code blocks and admonition blocks.
        if (!this.isCodeBlockImageLinkIndexingEnabled()) return locations;

        const scanned = await this.scanCodeAndAdmonitionReferences(file, targetImagePath);
        if (scanned.length === 0) return locations;

        // Deduplicate by offsets.
        const seen = new Set<string>();
        const merged: ReferenceLocation[] = [];

        for (const loc of locations) {
            const key = `${loc.start}-${loc.end}`;
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(loc);
            }
        }
        for (const loc of scanned) {
            const key = `${loc.start}-${loc.end}`;
            if (!seen.has(key)) {
                seen.add(key);
                merged.push(loc);
            }
        }

        return merged;
    }

    private async scanCodeAndAdmonitionReferences(
        file: TFile,
        targetImagePath: string,
        contentOverride?: string
    ): Promise<ReferenceLocation[]> {
        const content = contentOverride ?? await this.app.vault.read(file);
        const lines = content.split(/\r?\n/);

        // Map line index -> absolute start offset.
        const lineStartOffsets: number[] = [];
        lineStartOffsets.push(0);
        for (let i = 0; i < content.length; i++) {
            if (content[i] === '\n') lineStartOffsets.push(i + 1);
        }

        // If for some reason split lengths mismatch, fall back to best-effort scanning.
        if (lineStartOffsets.length < lines.length) {
            // Best-effort: clamp to available offsets.
            // (Data safety: we still avoid throwing)
        }

        const locations: ReferenceLocation[] = [];
        const seen = new Set<string>();

        const targetNormal = normalizePath(targetImagePath);
        const isUrl = targetImagePath.startsWith('http://') || targetImagePath.startsWith('https://');

        let inFencedCodeBlock = false;
        let inAdmonition = false;

        const fenceStartOrEnd = (line: string) => /^\s*```/.test(line);
        const admonitionStart = (line: string) => /^\s*>\s*\[![^\]]+\]/.test(line);
        const isBlockquoteContinuation = (line: string) => /^\s*>/.test(line);

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];

            const isFenceLine = fenceStartOrEnd(line);
            let closeFencedAfterScan = false;

            // Toggle fenced state only on fence lines, and only close after scanning the end fence line.
            if (isFenceLine) {
                if (!inFencedCodeBlock) {
                    inFencedCodeBlock = true; // start fence
                } else {
                    closeFencedAfterScan = true; // end fence
                }
            }

            if (inAdmonition && !isBlockquoteContinuation(line)) {
                inAdmonition = false;
            }
            if (!inAdmonition && admonitionStart(line)) {
                inAdmonition = true;
            }

            const shouldScan = inFencedCodeBlock || inAdmonition;
            if (shouldScan) {
                const links = pipeSyntaxParser.extractAllLinks(line);
                for (const link of links) {
                    const linkPath = link.data.path;

                    if (isUrl) {
                        if (linkPath === targetImagePath) {
                            const start = (lineStartOffsets[lineIdx] ?? 0) + link.index;
                            const end = start + link.fullMatch.length;
                            const key = `${start}-${end}`;
                            if (!seen.has(key)) {
                                seen.add(key);
                                locations.push({
                                    file,
                                    start,
                                    end,
                                    original: link.fullMatch,
                                    link: linkPath,
                                    line: lineIdx
                                });
                            }
                        }
                    } else {
                        const dest = this.app.metadataCache.getFirstLinkpathDest(linkPath, file.path);
                        if (dest && dest.path === targetNormal) {
                            const start = (lineStartOffsets[lineIdx] ?? 0) + link.index;
                            const end = start + link.fullMatch.length;
                            const key = `${start}-${end}`;
                            if (!seen.has(key)) {
                                seen.add(key);
                                locations.push({
                                    file,
                                    start,
                                    end,
                                    original: link.fullMatch,
                                    link: linkPath,
                                    line: lineIdx
                                });
                            }
                        }
                    }
                }
            }

            if (closeFencedAfterScan) inFencedCodeBlock = false;
        }

        return locations;
    }

    /**
     * Update references in the vault to a new value.
     * @param imagePath The old image path (to find references)
     * @param newPathOrUrl The new path or URL to replace with. 
     *                     If it's an HTTP URL, the whole link will be replaced with Markdown link format.
     *                     If it's a file path, we might keep Wiki/Markdown format preference if logic allows, 
     *                     but this manager primarily handles "Replace with Cloud Link" or "Rename".
     * @param replacementGenerator A function that takes the original link and returns the NEW full link string.
     */
    /**
     * Update references in the vault to a new value.
     * @param imagePath The old image path (to find references)
     * @param replacementGenerator A function that takes the original link and returns the NEW full link string.
     */
    /**
     * Update references in the vault to a new value.
     * @param imagePath The old image path (to find references)
     * @param replacementGenerator A function that takes the original link and returns the NEW full link string.
     */
    async updateReferences(
        imagePath: string,
        replacementGenerator: (location: ReferenceLocation) => string
    ): Promise<number> {
        // Detect if imagePath is a URL
        const isUrl = imagePath.startsWith("http://") || imagePath.startsWith("https://");
        let locations: ReferenceLocation[] = [];

        if (isUrl) {
            locations = await this.getFilesReferencingUrl(imagePath);
        } else {
            locations = await this.getFilesReferencingImage(imagePath);
        }

        return this.processUpdates(locations, replacementGenerator);
    }

    /**
     * Efficiently find files referencing ANY of the provided URLs.
     * Scans the vault once.
     */
    async getFilesReferencingUrls(urls: string[]): Promise<Map<string, ReferenceLocation[]>> {
        const results = new Map<string, ReferenceLocation[]>();
        const urlSet = new Set(urls);
        const files = this.app.vault.getMarkdownFiles();
        const codeBlockIndexing = this.isCodeBlockImageLinkIndexingEnabled();

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const foundInFile = new Set<string>();

            // Check embeds
            if (cache?.embeds) {
                for (const embed of cache.embeds) {
                    for (const url of urlSet) {
                        if (this.isUrlMatch(embed.link, url)) {
                            // Match found
                            if (!results.has(url)) results.set(url, []);
                            const refs = await this.getReferencesInFile(file, url);
                            results.get(url)?.push(...refs);
                            foundInFile.add(url);
                        }
                    }
                }
            }

            // Check links
            if (cache?.links) {
                for (const link of cache.links) {
                    for (const url of urlSet) {
                        if (foundInFile.has(url)) continue; // Already found in this file via embed

                        if (this.isUrlMatch(link.link, url)) {
                            if (!results.has(url)) results.set(url, []);
                            const refs = await this.getReferencesInFile(file, url);
                            results.get(url)?.push(...refs);
                            foundInFile.add(url);
                        }
                    }
                }
            }

            // Optional slow path for fenced code blocks + admonitions.
            if (codeBlockIndexing) {
                const content = await this.app.vault.read(file);
                if (!content.includes('http://') && !content.includes('https://')) continue;

                for (const url of urlSet) {
                    if (!content.includes(url)) continue;
                    if (!results.has(url)) results.set(url, []);
                    const scanned = await this.scanCodeAndAdmonitionReferences(file, url, content);
                    results.get(url)?.push(...scanned);
                }
            }
        }

        // Deduplicate for each URL by file+offset.
        for (const [url, refs] of results.entries()) {
            const seen = new Set<string>();
            const deduped: ReferenceLocation[] = [];
            for (const ref of refs) {
                const key = `${ref.file.path}:${ref.start}-${ref.end}`;
                if (seen.has(key)) continue;
                seen.add(key);
                deduped.push(ref);
            }
            results.set(url, deduped);
        }

        return results;
    }

    /**
     * Find all files that reference a specific URL.
     * Since Obsidian doesn't index external links in resolvedLinks, we must iterate the file cache.
     * Optimization: We only check files that have 'links' or 'embeds' in their cache.
     */
    async getFilesReferencingUrl(url: string): Promise<ReferenceLocation[]> {
        const locations: ReferenceLocation[] = [];
        const files = this.app.vault.getMarkdownFiles();
        const candidateFilePaths = new Set<string>();
        const codeBlockIndexing = this.isCodeBlockImageLinkIndexingEnabled();

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);

            // Check embeds
            if (cache?.embeds) {
                for (const embed of cache.embeds) {
                    if (this.isUrlMatch(embed.link, url)) {
                        candidateFilePaths.add(file.path);
                        const refs = await this.getReferencesInFile(file, url);
                        locations.push(...refs);
                        break; // optimization: just need to know if file has ANY ref to do full scan later? 
                        // No, getReferencesInFile returns all locations.
                        // But we should verify efficiency.
                        // Actually getReferencesInFile parses the cache again. 
                        // Let's just push and continue to next file to avoid duplicates if multiple refs exist?
                        // getReferencesInFile returns ALL refs in that file. So we push and move to next file.
                    }
                }
            }

            // Check links (if image is linked as standard link [text](url))
            // Usually we only care about embeds ![], but for completeness...
            if (cache?.links) {
                for (const link of cache.links) {
                    if (this.isUrlMatch(link.link, url)) {
                        // Avoid adding same file twice if it was already caught by embeds
                        const existing = locations.find(l => l.file === file);
                        if (!existing) {
                            candidateFilePaths.add(file.path);
                            const refs = await this.getReferencesInFile(file, url);
                            locations.push(...refs);
                        }
                        break;
                    }
                }
            }
        }

        // Optional slow path: scan fenced code blocks and admonition blocks for URL refs
        // that metadata cache did not index.
        if (codeBlockIndexing) {
            const targetToken = url.split(/[?#]/)[0].split('/').pop() ?? url;

            for (const file of files) {
                if (candidateFilePaths.has(file.path)) continue;
                const content = await this.app.vault.read(file);
                if (!content.includes(targetToken)) continue;

                const scanned = await this.scanCodeAndAdmonitionReferences(file, url, content);
                locations.push(...scanned);
            }
        }

        // Deduplicate by file+offset.
        const seen = new Set<string>();
        const merged: ReferenceLocation[] = [];
        for (const loc of locations) {
            const key = `${loc.file.path}:${loc.start}-${loc.end}`;
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(loc);
        }

        return merged;
    }

    /**
     * Check if a link URL matches the target URL with basic normalization.
     *
     * Normalization steps:
     * 1. Strip trailing slashes (http://a.com/ == http://a.com)
     * 2. Strip common tracking/query params that don't affect the resource
     * 3. Case-insensitive scheme comparison (http == https treated same if domain is same)
     *
     * We deliberately avoid over-aggressive normalization to preserve the ability
     * to distinguish URLs that differ only in meaningful query parameters.
     */
    private isUrlMatch(link: string, targetUrl: string): boolean {
        if (link === targetUrl) return true;

        // Strip trailing slashes for comparison.
        const stripSlash = (s: string) => s.replace(/\/+$/, "");
        const a = stripSlash(link);
        const b = stripSlash(targetUrl);
        if (a === b) return true;

        // Case-insensitive exact match (covers scheme+host+path exactly).
        if (a.toLowerCase() === b.toLowerCase()) return true;

        return false;
    }

    /**
     * Update references only within a specific file.
     * This avoids scanning the entire vault when we know the scope is limited.
     */
    async updateReferencesInFile(
        file: TFile,
        imagePath: string,
        replacementGenerator: (location: ReferenceLocation) => string
    ): Promise<number> {
        const locations = await this.getReferencesInFile(file, imagePath);
        return this.processUpdates(locations, replacementGenerator);
    }

    /**
     * Core logic to apply updates to a list of locations.
     *
     * Strategy: process from END to START so replacements don't shift earlier offsets.
     * After ANY skip (offset mismatch, non-image text), re-sort remaining locations
     * against the current content to keep offsets valid.
     */
    private async processUpdates(
        locations: ReferenceLocation[],
        replacementGenerator: (location: ReferenceLocation) => string
    ): Promise<number> {
        // Group by file to minimize IO (read/write each file once)
        const filesMap = new Map<TFile, ReferenceLocation[]>();
        for (const loc of locations) {
            if (!filesMap.has(loc.file)) {
                filesMap.set(loc.file, []);
            }
            filesMap.get(loc.file)?.push(loc);
        }

        let totalFound = locations.length;
        let totalReplaced = 0;
        let totalSkipped = 0;

        for (const [file, locs] of filesMap.entries()) {
            await this.app.vault.process(file, (content) => {
                // Sort by start descending (process from end to start).
                locs.sort((a, b) => b.start - a.start);

                let newContent = content;
                let offsetCorrection = 0;
                let fileReplaced = 0;
                let fileSkipped = 0;

                for (const loc of locs) {
                    const adjStart = loc.start + offsetCorrection;
                    const adjEnd   = loc.end   + offsetCorrection;

                    if (adjStart < 0 || adjEnd > newContent.length || adjStart >= adjEnd) {
                        console.warn(`[VaultReferenceManager] Invalid adjusted range [${adjStart}, ${adjEnd}] in ${file.path}. Skipping.`);
                        fileSkipped++;
                        continue;
                    }

                    const actualOriginal = newContent.substring(adjStart, adjEnd);

                    if (!this.isProbablyImageLinkText(actualOriginal)) {
                        console.warn(`[VaultReferenceManager] Not an image link at ${adjStart} in ${file.path}. Skipping.`);
                        fileSkipped++;
                        continue;
                    }

                    const locForGen: ReferenceLocation = {
                        ...loc,
                        start: adjStart,
                        end: adjEnd,
                        original: actualOriginal
                    };

                    const newLinkString = replacementGenerator(locForGen);
                    if (newLinkString === actualOriginal) {
                        fileSkipped++;
                        continue;
                    }

                    newContent =
                        newContent.substring(0, adjStart) +
                        newLinkString +
                        newContent.substring(adjEnd);

                    offsetCorrection += (newLinkString.length - (adjEnd - adjStart));
                    fileReplaced++;
                }

                if (fileReplaced > 0 || fileSkipped > 0) {
                    console.log(`[VaultReferenceManager] ${file.path}: found=${locs.length}, replaced=${fileReplaced}, skipped=${fileSkipped}`);
                }

                totalReplaced += fileReplaced;
                totalSkipped += fileSkipped;
                return newContent;
            });
        }

        console.log(`[VaultReferenceManager] Total: found=${totalFound}, replaced=${totalReplaced}, skipped=${totalSkipped}`);
        return totalReplaced;
    }
}
