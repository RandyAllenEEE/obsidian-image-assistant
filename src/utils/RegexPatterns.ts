/**
 * Shared Regex patterns for finding image links in Markdown text.
 */

// Matches standard Markdown image links:
// 1. ![alt](<path/to/image.png>)
// 2. ![alt](path/to/image.png "title")
// 3. ![alt](https://example.com/image.png)
export const REGEX_FILE = /!\[(.* ?)\]\(<(\S+\.\w+)>\)|!\[(.*?)\]\((\S+\.\w+)(?:\s+"[^"]*")?\)|!\[(.*?)\]\((https?:\/\/.*?)\)/g;

// Matches WikiLinks:
// 1. ![[image.png]]
// 2. ![[image.png|alt text]]
// 3. ![[https://example.com/image.png]] (network image)
export const REGEX_WIKI_FILE = /!\[\[(.*?)(\s*?\|.*?)?\]\]/g;

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
 */
export function getAllImageLinks(text: string): ImageLink[] {
    const fileArray: ImageLink[] = [];

    // Match Markdown Links
    // Reset lastIndex because these are global regexes and might have state if reused (though we export consts, 
    // it's safer to treat them as stateless or re-instantiate if needed, but here simple matchAll is fine)
    // Actually, matchAll does not rely on lastIndex of the regex object itself if we use the iterator correctly.
    const matches = text.matchAll(REGEX_FILE);
    for (const match of matches) {
        const source = match[0];

        let name = match[1];
        let path = match[2];

        // Handle different capture groups
        if (name === undefined) {
            name = match[3];
        }
        if (path === undefined) {
            path = match[4];
        }
        if (path === undefined) {
            path = match[6]; // URL case
        }

        if (path) {
            fileArray.push({
                path: path,
                name: name || "",
                source: source,
            });
        }
    }

    // Match Wiki Links
    const wikiMatches = text.matchAll(REGEX_WIKI_FILE);
    for (const match of wikiMatches) {
        const source = match[0];
        const path = match[1];
        let name = path;

        // If there is a custom display name/size
        if (match[2]) {
            name = `${name}${match[2]}`;
        }

        fileArray.push({
            path: path,
            name: name,
            source: source,
        });
    }

    return fileArray;
}
