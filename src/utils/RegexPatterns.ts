/**
 * Shared Regex patterns for finding image links in Markdown text.
 */

// Matches standard Markdown image links:
// 1. ![alt](<path/to/image.png>)           — angle-bracketed path
// 2. ![alt](path/to/image.png "title")     — plain path + optional title
// 3. ![alt](https://example.com/image.png) — full URL with extension
// 4. ![alt](https://example.com/image)      — URL without extension
// 5. ![alt](data:image/png;base64,...)     — data URI
// Extension requirement (\.\w+) is now OPTIONAL.
export const REGEX_FILE = /!\[(.*?)?\]\(<([^)>]+)>\)|!\[(.*?)?\]\((\S+)(?:\s+"[^"]*")?\)|!\[(.*?)?\]\((https?:\/\/\S+)\)/g;

// Matches WikiLinks:
// 1. ![[image.png]]
// 2. ![[image.png|alt text]]
// 3. ![[https://example.com/image.png]] (network image)
export const REGEX_WIKI_FILE = /!\[\[([^\]]+?)(?:\s*\|[^\]]*)?\]\]/g;

// Matches WikiLink network images specifically:
// ![[https://example.com/image.png]]
// ![[https://example.com/image.png|alt text]]
export const REGEX_WIKI_NETWORK_IMAGE = /!\[\[(https?:\/\/[^\]|]+)(\s*?\|.*?)?\]\]/g;

// ==== Pipe Syntax Patterns ====

// Matches align keywords: left, center, right, left-wrap, right-wrap
export const PIPE_ALIGN_PATTERN = /^(left|center|right|left-wrap|right-wrap)$/;

// Matches size formats: 300x200, 300, 300x, x200
export const PIPE_SIZE_PATTERN = /^(\d+)(x(\d+)?)?$|^x(\d+)$/i;

// Matches Wiki link with full pipe syntax: ![[path|attr1|attr2|...]]
export const WIKI_LINK_FULL_PATTERN = /!\[\[([^\]]+?)(?:\|([^\]]+?))?\]\]/;

// Matches Markdown link with full pipe syntax: ![attr1|attr2|...](path)
export const MARKDOWN_LINK_FULL_PATTERN = /!\[([^\]]*)\]\(([^)]+)\)/;

export interface ImageLink {
    path: string;
    name: string;
    source: string;
}

/**
 * Helper function to extract all image links from a text using the shared regexes.
 *
 * REGEX_FILE groups:
 *   Alt 1: !\[(...)?\]\(<([^)>]+)>\)
 *   Alt 2: !\[(...)?\]\((\S+)(?:\s+"[^"]*")?\)
 *   Alt 3: !\[(...)?\]\((https?:\/\/\S+)\)
 *
 *   Group 1 = alt (alt 1),  Group 2 = path (alt 1)
 *   Group 3 = alt (alt 2),  Group 4 = path (alt 2)
 *   Group 5 = alt (alt 3),  Group 6 = url  (alt 3)
 *
 * For WikiLinks REGEX_WIKI_FILE, the non-greedy .*? stops at the first `|` in the path,
 * which breaks for paths containing literal pipes (e.g. `image|file.png`).
 * We accept this limitation and treat everything after the first `|` as attributes.
 */
export function getAllImageLinks(text: string): ImageLink[] {
    const fileArray: ImageLink[] = [];

    // --- Markdown links ---
    // Using exported REGEX_FILE (same pattern as inline)
    const mdRegex = new RegExp(REGEX_FILE.source, 'g');
    for (const match of text.matchAll(mdRegex)) {
        const source = match[0];

        let name: string | undefined;
        let path: string | undefined;

        // Alt 1: angle-bracketed path
        if (match[2] !== undefined) {
            name = match[1];
            path = match[2];
        }
        // Alt 2: plain path + optional title
        else if (match[4] !== undefined) {
            name = match[3];
            path = match[4];
        }
        // Alt 3: URL
        else if (match[6] !== undefined) {
            name = match[5];
            path = match[6];
        }

        if (path) {
            fileArray.push({
                path,
                name: name ?? "",
                source,
            });
        }
    }

    // --- Wiki links ---
    // Using exported REGEX_WIKI_FILE (same pattern as inline)
    const wikiRegex = new RegExp(REGEX_WIKI_FILE.source, 'g');
    for (const match of text.matchAll(wikiRegex)) {
        const source = match[0];
        const rawContent = match[1]; // path|attr|...
        const pipeIdx = rawContent.indexOf("|");
        const path = pipeIdx < 0 ? rawContent.trim() : rawContent.slice(0, pipeIdx).trim();

        fileArray.push({
            path,
            name: path,
            source,
        });
    }

    return fileArray;
}

// ==== Anchored Validators for Parser ====
export const REGEX_WIKI_LINK_VALIDATE = /^!\[\[([^\]]+?)\]\]$/;
export const REGEX_MD_LINK_VALIDATE = /^!\[([^\]]*)\]\(([^)]+)\)$/;

// ==== Dynamic Regex Factories ====

export function createWikiLinkRegex(filename: string): RegExp {
    // ![[ ... filename ... ]]
    // Captures path
    return new RegExp(`!\\[\\[([^\\]]*${filename}[^\\]]*)\\]\\]`, 'g');
}

export function createMarkdownLinkRegex(filename: string): RegExp {
    // ![ ... ]( ... filename ... )
    // Captures alt, path
    return new RegExp(`!\\[([^\\]]*)\\]\\(([^)]*${filename}[^)]*)\\)`, 'g');
}

export function createUrlLinkRegex(escapedUrl: string, escapedDecodedUrl: string): RegExp {
    // ![...](...url...)
    return new RegExp(`!\\[([^\\]]*)\\]\\(([^)]*(${escapedUrl}|${escapedDecodedUrl})[^)]*)\\)`, 'g');
}

export function createAnyLinkRegex(filename: string): RegExp {
    // Matches both Wiki and Markdown links for a given filename
    // Used for global search/replace operations
    const escapedName = filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`!\\[\\[${escapedName}(?:\\|[^\\]]+)?\\]\\]|!\\[.*?\\]\\((${escapedName})(?:\\?[^)]*)?\\)`, 'g');
}
