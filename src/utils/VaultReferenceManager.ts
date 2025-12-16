import { App, TFile, Notice, LinkCache, EmbedCache } from "obsidian";
import { normalizePath } from "obsidian";

export interface ReferenceLocation {
    file: TFile;
    start: number; // offset
    end: number;   // offset
    original: string; // The full original link text (e.g., "![[image.png]]")
    link: string;     // The link path inside (e.g. "image.png")
}

export class VaultReferenceManager {
    constructor(private app: App) { }

    /**
     * Find all files and specific locations that reference the given image path.
     * Uses MetadataCache for O(1) file discovery and precise location mapping.
     */
    async getFilesReferencingImage(imagePath: string): Promise<ReferenceLocation[]> {
        const locations: ReferenceLocation[] = [];
        const resolvedLinks = this.app.metadataCache.resolvedLinks;
        const normalizedImagePath = normalizePath(imagePath);

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
                    const fileLocations = this.getReferencesInFile(sourceFile, normalizedImagePath);
                    locations.push(...fileLocations);
                }
            }
        }

        return locations;
    }

    /**
     * Get precise locations of references within a specific file using MetadataCache.
     */
    private getReferencesInFile(file: TFile, targetImagePath: string): ReferenceLocation[] {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache) return [];

        const locations: ReferenceLocation[] = [];
        const targetNormal = normalizePath(targetImagePath);

        // Helper to check if a link points to our target
        const checkLink = (link: LinkCache | EmbedCache) => {
            // Resolve the link relative to the source file to see if it matches target
            const linkpath = link.link.split('#')[0].split('|')[0];
            const dest = this.app.metadataCache.getFirstLinkpathDest(linkpath, file.path);

            if (dest && dest.path === targetNormal) {
                locations.push({
                    file: file,
                    start: link.position.start.offset,
                    end: link.position.end.offset,
                    original: link.original,
                    link: link.link
                });
            }
        };

        if (cache.embeds) {
            cache.embeds.forEach(checkLink);
        }

        if (cache.links) {
            cache.links.forEach(checkLink);
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
    async updateReferences(
        imagePath: string,
        replacementGenerator: (location: ReferenceLocation) => string
    ): Promise<number> {
        const locations = await this.getFilesReferencingImage(imagePath);

        // Group by file to minimize IO (read/write each file once)
        const filesMap = new Map<TFile, ReferenceLocation[]>();
        for (const loc of locations) {
            if (!filesMap.has(loc.file)) {
                filesMap.set(loc.file, []);
            }
            filesMap.get(loc.file)?.push(loc);
        }

        let totalReplaced = 0;

        for (const [file, locs] of filesMap.entries()) {
            await this.app.vault.process(file, (content) => {
                // We MUST process from end to start to preserve offsets
                // Sort locations by start offset descending
                locs.sort((a, b) => b.start - a.start);

                let newContent = content;
                for (const loc of locs) {
                    const newLinkString = replacementGenerator(loc);

                    // Double check bounds to be safe (though cache should be accurate)
                    if (newContent.substring(loc.start, loc.end) === loc.original) {
                        newContent =
                            newContent.substring(0, loc.start) +
                            newLinkString +
                            newContent.substring(loc.end);
                        totalReplaced++;
                    } else {
                        console.warn(`[VaultReferenceManager] Cache mismatch in ${file.path} at ${loc.start}. Skipping.`);
                    }
                }
                return newContent;
            });
        }

        return totalReplaced;
    }
}
