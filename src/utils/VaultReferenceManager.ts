import { App, TFile, LinkCache, EmbedCache, normalizePath } from "obsidian";
import type ImageConverterPlugin from "../main";
import { getAllReferenceLinks, type ReferenceLink } from "./RegexPatterns";
import {
    getContextualReferenceLinks,
    MarkdownSourceContextIndex,
    type ContextualReferenceLink,
    type MarkdownSourceScanOptions
} from "./MarkdownSourceContext";
import { isHttpUrl, isSameHttpUrl } from "./NetworkPolicy";
import {
    getComparableLocalBasename,
    inferLocalReferenceSyntax,
    LocalImageTargetResolver,
    type LocalReferenceSyntax
} from "./LocalImageTargetResolver";

export interface ReferenceLocation {
    file: TFile;
    start: number; // offset
    end: number;   // offset
    original: string; // The full original link text (e.g., "![[image.png]]")
    link: string;     // The link path inside (e.g. "image.png")
    line: number;     // The line number (0-indexed)
}

export interface ReferenceUpdateResult {
    found: number;
    replaced: number;
    complete: boolean;
    files: ReferenceFileUpdateResult[];
    failedFiles: string[];
    uncertainFiles: string[];
}

export interface ReferenceFileUpdateResult {
    filePath: string;
    found: number;
    replaced: number;
    error?: string;
}

export interface ReferenceScanResult {
    locations: ReferenceLocation[];
    complete: boolean;
    uncertainFiles: string[];
}

export interface MultiReferenceScanResult {
    references: Map<string, ReferenceLocation[]>;
    complete: boolean;
    uncertainFiles: string[];
}

export class VaultReferenceManager {
    private readonly localTargetResolver: LocalImageTargetResolver;

    constructor(
        private app: App,
        private plugin?: ImageConverterPlugin
    ) {
        this.localTargetResolver = new LocalImageTargetResolver(app);
    }

    private isCodeBlockImageLinkIndexingEnabled(): boolean {
        return !!this.plugin?.settings?.global?.codeBlockImageLinkIndexing;
    }

    private getSourceScanOptions(overrides: MarkdownSourceScanOptions = {}): MarkdownSourceScanOptions {
        return {
            // Standalone consumers historically scanned fences. Plugin-owned
            // instances honor the user setting; the default keeps the helper
            // backward compatible for callers without plugin settings.
            includeFencedCode: this.plugin
                ? this.isCodeBlockImageLinkIndexingEnabled()
                : true,
            ...overrides
        };
    }

    private isSupportedReferenceText(text: string): boolean {
        return this.extractSingleReferencePath(text) !== null;
    }

    /**
     * Read every Markdown file and build a fail-closed reference snapshot.
     * Destructive operations use this instead of relying on potentially stale
     * metadata-cache offsets.
     */
    async scanReferencesDetailed(
        imagePath: string,
        options: MarkdownSourceScanOptions = {}
    ): Promise<ReferenceScanResult> {
        const result = await this.scanReferencesForTargetsDetailed([imagePath], options);
        return {
            locations: result.references.get(imagePath) ?? [],
            complete: result.complete,
            uncertainFiles: result.uncertainFiles
        };
    }

    async scanReferencesForTargetsDetailed(
        targets: string[],
        options: MarkdownSourceScanOptions = {}
    ): Promise<MultiReferenceScanResult> {
        const references = new Map<string, ReferenceLocation[]>();
        const uncertainFiles: string[] = [];
        const localTargets = new Map<string, string[]>();
        const localTargetsByBasename = new Map<string, string[]>();
        const urlTargets: string[] = [];
        const scanOptions = this.getSourceScanOptions(options);

        for (const target of targets) {
            if (references.has(target)) continue;
            references.set(target, []);
            if (isHttpUrl(target)) {
                urlTargets.push(target);
            } else {
                const normalized = normalizePath(this.stripSubpath(target));
                const originals = localTargets.get(normalized) ?? [];
                originals.push(target);
                localTargets.set(normalized, originals);

                const basename = (normalized.split("/").pop() ?? normalized).toLowerCase();
                const basenameTargets = localTargetsByBasename.get(basename) ?? [];
                basenameTargets.push(target);
                localTargetsByBasename.set(basename, basenameTargets);
            }
        }

        for (const file of this.app.vault.getMarkdownFiles()) {
            try {
                const content = await this.app.vault.read(file);
                let hasUnresolvedCandidate = false;
                const parsedLinks = getContextualReferenceLinks(content, scanOptions);
                for (const link of parsedLinks) {
                    const linkPath = this.stripSubpath(link.path);
                    const matchedTargets = new Set<string>();
                    if (isHttpUrl(linkPath)) {
                        for (const target of urlTargets) {
                            if (this.isUrlMatch(linkPath, target)) matchedTargets.add(target);
                        }
                    } else {
                        const syntax = toLocalReferenceSyntax(link.syntax);
                        const resolution = await this.localTargetResolver.resolveAsync(
                            linkPath,
                            file,
                            { syntax }
                        );
                        if (resolution.status === "resolved" && resolution.file) {
                            for (const target of localTargets.get(normalizePath(resolution.file.path)) ?? []) {
                                matchedTargets.add(target);
                            }
                        } else {
                            const candidateMatchesTarget = resolution.candidates.some(candidate =>
                                localTargets.has(normalizePath(candidate.path))
                            );
                            const basename = getComparableLocalBasename(linkPath, syntax);
                            hasUnresolvedCandidate ||= candidateMatchesTarget
                                || localTargetsByBasename.has(basename);
                        }
                    }
                    if (matchedTargets.size === 0) continue;

                    const line = content.slice(0, link.index).split("\n").length - 1;
                    const location: ReferenceLocation = {
                        file,
                        start: link.index,
                        end: link.index + link.source.length,
                        original: link.source,
                        link: link.path,
                        line
                    };
                    for (const target of matchedTargets) references.get(target)?.push(location);
                }
                for (const target of urlTargets) {
                    if (this.hasUnparsedUrlCandidate(content, target, parsedLinks, scanOptions)) {
                        hasUnresolvedCandidate = true;
                    }
                }
                if (hasUnresolvedCandidate) uncertainFiles.push(file.path);
            } catch (error) {
                console.warn(`[VaultReferenceManager] Failed to scan ${file.path}:`, error);
                uncertainFiles.push(file.path);
            }
        }

        return {
            references,
            complete: uncertainFiles.length === 0,
            uncertainFiles
        };
    }

    async updateReferenceLocationsDetailed(
        locations: ReferenceLocation[],
        replacementGenerator: (location: ReferenceLocation) => string
    ): Promise<ReferenceUpdateResult> {
        return this.processUpdatesDetailed(locations, replacementGenerator);
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

        // Callouts and `ad-*` fences are rendered Markdown but are not
        // consistently represented in resolvedLinks. Scan source in every
        // candidate file; the setting only decides whether ordinary fences are
        // included by the shared scanner.
        const targetBasename = normalizedImagePath.split('/').pop() ?? normalizedImagePath;
        const markdownFiles = this.app.vault.getMarkdownFiles();

        for (const file of markdownFiles) {
            if (!(file instanceof TFile)) continue;
            if (candidateFilePaths.has(file.path)) continue;

            const content = await this.app.vault.read(file);
            if (!content.includes(targetBasename)) continue;

            const scanned = await this.scanCodeAndAdmonitionReferences(file, normalizedImagePath, content);
            locations.push(...scanned);
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
        const isUrl = isHttpUrl(targetImagePath);

        // 1) Fast path: use metadataCache positions when available.
        const checkLink = (link: LinkCache | EmbedCache) => {
            const linkpath = this.getCacheLinkPath(link);

            if (isUrl) {
                if (this.isUrlMatch(linkpath, targetImagePath)) {
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
                const syntax = inferLocalReferenceSyntax(link.original ?? "");
                const dest = this.localTargetResolver.resolve(linkpath, file, { syntax });
                if (dest.status === "resolved" && dest.file?.path === targetNormal) {
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

        if (typeof this.app.vault.read !== 'function') return locations;

        // Source offsets are the authoritative view for mutable operations.
        // Metadata may index source-only literals differently across Obsidian
        // versions, so do not merge those positions back into replacements.
        return this.scanCodeAndAdmonitionReferences(file, targetImagePath);
    }

    private async scanCodeAndAdmonitionReferences(
        file: TFile,
        targetImagePath: string,
        contentOverride?: string
    ): Promise<ReferenceLocation[]> {
        const content = contentOverride ?? await this.app.vault.read(file);
        const locations: ReferenceLocation[] = [];
        const targetNormal = normalizePath(targetImagePath);
        const isUrl = isHttpUrl(targetImagePath);

        for (const link of getContextualReferenceLinks(content, this.getSourceScanOptions())) {
            const linkPath = link.path;
            const matches = isUrl
                ? this.isUrlMatch(linkPath, targetImagePath)
                : (await this.localTargetResolver.resolveAsync(linkPath, file, {
                    syntax: toLocalReferenceSyntax(link.syntax)
                })).file?.path === targetNormal;
            if (!matches) continue;

            locations.push({
                file,
                start: link.index,
                end: link.index + link.source.length,
                original: link.source,
                link: linkPath,
                line: content.slice(0, link.index).split('\n').length - 1
            });
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
        const result = await this.updateReferencesDetailed(imagePath, replacementGenerator);
        return result.replaced;
    }

    async updateReferencesDetailed(
        imagePath: string,
        replacementGenerator: (location: ReferenceLocation) => string
    ): Promise<ReferenceUpdateResult> {
        try {
            const isUrl = isHttpUrl(imagePath);
            const locations = isUrl
                ? await this.getFilesReferencingUrl(imagePath)
                : await this.getFilesReferencingImage(imagePath);
            return this.processUpdatesDetailed(locations, replacementGenerator);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                found: 0,
                replaced: 0,
                complete: false,
                files: [],
                failedFiles: [],
                uncertainFiles: [`Reference scan failed: ${message}`]
            };
        }
    }

    /**
     * Efficiently find files referencing ANY of the provided URLs.
     * Scans the vault once.
     */
    async getFilesReferencingUrls(urls: string[]): Promise<Map<string, ReferenceLocation[]>> {
        const results = new Map<string, ReferenceLocation[]>();
        const urlSet = new Set(urls);
        const files = this.app.vault.getMarkdownFiles();

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);
            const foundInFile = new Set<string>();

            // Check embeds
            if (cache?.embeds) {
                for (const embed of cache.embeds) {
                    for (const url of urlSet) {
                        if (this.isUrlMatch(this.getCacheLinkPath(embed), url)) {
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

                        if (this.isUrlMatch(this.getCacheLinkPath(link), url)) {
                            if (!results.has(url)) results.set(url, []);
                            const refs = await this.getReferencesInFile(file, url);
                            results.get(url)?.push(...refs);
                            foundInFile.add(url);
                        }
                    }
                }
            }

            const content = await this.app.vault.read(file);
            if (!content.includes('http://') && !content.includes('https://')) continue;

            for (const url of urlSet) {
                if (!content.includes(url)) continue;
                if (!results.has(url)) results.set(url, []);
                const scanned = await this.scanCodeAndAdmonitionReferences(file, url, content);
                results.get(url)?.push(...scanned);
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

        for (const file of files) {
            const cache = this.app.metadataCache.getFileCache(file);

            // Check embeds
            if (cache?.embeds) {
                for (const embed of cache.embeds) {
                    if (this.isUrlMatch(this.getCacheLinkPath(embed), url)) {
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
                    if (this.isUrlMatch(this.getCacheLinkPath(link), url)) {
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

        const targetToken = url.split(/[?#]/)[0].split('/').pop() ?? url;

        for (const file of files) {
            if (candidateFilePaths.has(file.path)) continue;
            const content = await this.app.vault.read(file);
            if (!content.includes(targetToken)) continue;

            const scanned = await this.scanCodeAndAdmonitionReferences(file, url, content);
            locations.push(...scanned);
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
     * 2. Normalize protocol and host casing.
     * 3. Preserve case-sensitive path, query, and fragment components.
     *
     * We deliberately avoid over-aggressive normalization to preserve the ability
     * to distinguish URLs that differ only in meaningful query parameters.
     */
    private isUrlMatch(link: string, targetUrl: string): boolean {
        return isSameHttpUrl(link, targetUrl);
    }

    private getCacheLinkPath(link: LinkCache | EmbedCache): string {
        const originalPath = this.extractSingleReferencePath(link.original);
        if (originalPath) {
            return originalPath;
        }

        return this.stripCacheLinkText(link.link ?? '');
    }

    private stripCacheLinkText(linkText: string): string {
        const withoutSubpath = this.stripSubpath(linkText);
        const pipeIndex = this.findFirstUnescapedPipe(withoutSubpath);
        const path = pipeIndex === -1 ? withoutSubpath : withoutSubpath.slice(0, pipeIndex);
        return path.replace(/\\\|/g, '|');
    }

    private stripSubpath(path: string): string {
        if (isHttpUrl(path)) return path;
        const hashIndex = path.indexOf('#');
        return hashIndex === -1 ? path : path.slice(0, hashIndex);
    }

    private findFirstUnescapedPipe(text: string): number {
        for (let i = 0; i < text.length; i++) {
            if (text[i] !== '|') continue;

            let slashCount = 0;
            for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) {
                slashCount++;
            }

            if (slashCount % 2 === 0) {
                return i;
            }
        }

        return -1;
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
        return (await this.updateReferencesInFileDetailed(file, imagePath, replacementGenerator)).replaced;
    }

    async updateReferencesInFileDetailed(
        file: TFile,
        imagePath: string,
        replacementGenerator: (location: ReferenceLocation) => string
    ): Promise<ReferenceUpdateResult> {
        try {
            const locations = await this.getReferencesInFile(file, imagePath);
            return this.processUpdatesDetailed(locations, replacementGenerator);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                found: 0,
                replaced: 0,
                complete: false,
                files: [{ filePath: file.path, found: 0, replaced: 0, error: message }],
                failedFiles: [file.path],
                uncertainFiles: [file.path]
            };
        }
    }

    private async processUpdatesDetailed(
        locations: ReferenceLocation[],
        replacementGenerator: (location: ReferenceLocation) => string
    ): Promise<ReferenceUpdateResult> {
        // Deduplicate cache/raw-scan overlap and group by path so each file is
        // processed atomically exactly once, even if callers supplied distinct
        // TFile instances for the same path.
        const filesMap = new Map<string, { file: TFile; locations: ReferenceLocation[] }>();
        const seenLocations = new Set<string>();
        for (const loc of locations) {
            const locationKey = `${loc.file.path}:${loc.start}-${loc.end}`;
            if (seenLocations.has(locationKey)) continue;
            seenLocations.add(locationKey);

            const entry = filesMap.get(loc.file.path) ?? { file: loc.file, locations: [] };
            entry.locations.push(loc);
            filesMap.set(loc.file.path, entry);
        }

        let totalReplaced = 0;
        const fileResults: ReferenceFileUpdateResult[] = [];
        const failedFiles: string[] = [];

        for (const { file, locations: locs } of filesMap.values()) {
            let fileReplaced = 0;
            const issues: string[] = [];
            try {
                await this.app.vault.process(file, (content) => {
                    fileReplaced = 0;
                    issues.length = 0;
                    const sortedLocations = [...locs].sort((a, b) => b.start - a.start);
                    let newContent = content;

                    for (const loc of sortedLocations) {
                        const adjStart = loc.start;
                        const adjEnd = loc.end;

                        if (adjStart < 0 || adjEnd > newContent.length || adjStart >= adjEnd) {
                            issues.push(`Invalid reference range [${adjStart}, ${adjEnd}]`);
                            continue;
                        }

                        const actualOriginal = newContent.substring(adjStart, adjEnd);
                        if (!this.isSupportedReferenceText(actualOriginal)) {
                            issues.push(`Reference text changed at offset ${adjStart}`);
                            continue;
                        }
                        if (!this.isSameReferenceTarget(actualOriginal, loc)) {
                            issues.push(`Reference target changed at offset ${adjStart}`);
                            continue;
                        }

                        const newLinkString = replacementGenerator({
                            ...loc,
                            start: adjStart,
                            end: adjEnd,
                            original: actualOriginal
                        });
                        if (newLinkString === actualOriginal) continue;

                        newContent = newContent.substring(0, adjStart)
                            + newLinkString
                            + newContent.substring(adjEnd);
                        fileReplaced++;
                    }

                    return newContent;
                });

                totalReplaced += fileReplaced;
                if (fileReplaced !== locs.length && issues.length === 0) {
                    issues.push(`Updated ${fileReplaced} of ${locs.length} reference(s)`);
                }
                const error = issues.length > 0 ? issues.join("; ") : undefined;
                fileResults.push({ filePath: file.path, found: locs.length, replaced: fileReplaced, error });
                if (error) failedFiles.push(file.path);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                fileResults.push({ filePath: file.path, found: locs.length, replaced: 0, error: message });
                failedFiles.push(file.path);
            }
        }

        return {
            found: seenLocations.size,
            replaced: totalReplaced,
            complete: failedFiles.length === 0,
            files: fileResults,
            failedFiles,
            uncertainFiles: []
        };
    }

    private isSameReferenceTarget(actualOriginal: string, location: ReferenceLocation): boolean {
        const actualPath = this.extractSingleReferencePath(actualOriginal);
        const expectedPath = this.extractSingleReferencePath(location.original) ?? this.stripCacheLinkText(location.link);
        if (!actualPath || !expectedPath) return false;

        const actualIsUrl = isHttpUrl(actualPath);
        const expectedIsUrl = isHttpUrl(expectedPath);
        if (actualIsUrl || expectedIsUrl) {
            return actualIsUrl && expectedIsUrl && this.isUrlMatch(actualPath, expectedPath);
        }

        // Exact source equality is sufficient to prove that this occurrence
        // did not change after it was scanned. Resolution is still required
        // when two different link texts are being compared.
        if (actualPath === expectedPath) return true;

        const actualDestination = this.localTargetResolver.resolve(actualPath, location.file, {
            syntax: inferLocalReferenceSyntax(actualOriginal)
        });
        const expectedDestination = this.localTargetResolver.resolve(expectedPath, location.file, {
            syntax: inferLocalReferenceSyntax(location.original)
        });
        return actualDestination.status === "resolved"
            && expectedDestination.status === "resolved"
            && actualDestination.file?.path === expectedDestination.file?.path;
    }

    private extractSingleReferencePath(text: string): string | null {
        const links = getAllReferenceLinks(text);
        if (links.length !== 1 || links[0].index !== 0 || links[0].source.length !== text.length) return null;
        return this.stripSubpath(links[0].path);
    }

    private hasUnparsedUrlCandidate(
        content: string,
        targetUrl: string,
        parsedLinks: ContextualReferenceLink[],
        options: MarkdownSourceScanOptions
    ): boolean {
        const matchingRanges = parsedLinks
            .filter(link => isHttpUrl(link.path) && isSameHttpUrl(link.path, targetUrl))
            .map(link => ({ start: link.index, end: link.index + link.source.length }));

        const contextIndex = MarkdownSourceContextIndex.create(content);
        let index = content.indexOf(targetUrl);
        while (index >= 0) {
            const end = index + targetUrl.length;
            if (contextIndex.includes(index, end, options)
                && !matchingRanges.some(range => index >= range.start && end <= range.end)) {
                return true;
            }
            index = content.indexOf(targetUrl, index + targetUrl.length);
        }
        return false;
    }
}

function toLocalReferenceSyntax(syntax: ReferenceLink["syntax"]): LocalReferenceSyntax {
    return syntax === "markdown" ? "markdown" : "wiki";
}
