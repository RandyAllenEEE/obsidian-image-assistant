/**
 * Shared Regex patterns for finding image links in Markdown text.
 */

// Matches standard Markdown image links:
// 1. ![alt](<path/to/image.png>)           — angle-bracketed path
// 2. ![alt](<path/to/my image.png> "title") — angle-bracketed path + optional title
// 3. ![alt](path/to/image.png "title")      — plain path + optional title
// 4. ![alt](https://example.com/image.png)  — full URL with extension
// 5. ![alt](https://example.com/image)      — URL without extension
// Extension requirement is intentionally omitted.
export const REGEX_FILE = /!\[([^\]]*)\]\((<[^>\n]+>(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?|(?:[^\s()\\]|\\.|\([^)\n]*\))+(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?)\)/g;

// Matches WikiLinks:
// 1. ![[image.png]]
// 2. ![[image.png|alt text]]
// 3. ![[https://example.com/image.png]] (network image)
export const REGEX_WIKI_FILE = /!\[\[([^\]]+)\]\]/g;

// Matches embedded and ordinary Markdown links. Groups:
// 1. optional embed marker (`!`)
// 2. label/alt text
// 3. destination, possibly with a title suffix
const REGEX_REFERENCE_FILE = /(!?)\[([^\]]*)\]\((<[^>\n]+>(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?|(?:[^\s()\\]|\\.|\([^)\n]*\))+(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?)\)/g;

// Matches embedded and ordinary WikiLinks. Groups:
// 1. optional embed marker (`!`)
// 2. path and optional pipe attributes
const REGEX_REFERENCE_WIKI_FILE = /(!?)\[\[([^\]]+)\]\]/g;

// ==== Pipe Syntax Patterns ====

// Matches align keywords: left, center, right, left-wrap, right-wrap
export const PIPE_ALIGN_PATTERN = /^(left|center|right|left-wrap|right-wrap)$/;

// Obsidian 1.13.4 canonical image sizes: a positive width, optionally followed
// by a positive height. The token is only interpreted as a size when it is the
// final PipeSyntax segment (enforced by PipeSyntaxParser).
export const PIPE_SIZE_PATTERN = /^([1-9]\d*)(?:x([1-9]\d*))?$/;

export interface ImageLink {
    path: string;
    name: string;
    source: string;
    index: number;
}

export interface ReferenceLink extends ImageLink {
    embedded: boolean;
    syntax: "markdown" | "wiki" | "autolink";
}

/**
 * Extract embedded images and ordinary Markdown/Wiki links.
 *
 * Image-only features should keep using getAllImageLinks. Reference safety and
 * path migration use this broader parser so a non-embedded link cannot be
 * silently orphaned when its target image is replaced or deleted.
 */
export function getAllReferenceLinks(text: string): ReferenceLink[] {
    const links: ReferenceLink[] = [];

    const markdownRegex = new RegExp(REGEX_REFERENCE_FILE.source, "g");
    for (const match of text.matchAll(markdownRegex)) {
        const source = match[0];
        const path = extractMarkdownDestinationPath(match[3] ?? "");
        if (!path) continue;

        links.push({
            path,
            name: match[2] ?? "",
            source,
            index: match.index ?? -1,
            embedded: match[1] === "!",
            syntax: "markdown"
        });
    }

    const wikiRegex = new RegExp(REGEX_REFERENCE_WIKI_FILE.source, "g");
    for (const match of text.matchAll(wikiRegex)) {
        const source = match[0];
        const rawContent = match[2] ?? "";
        const pipeIndex = findFirstUnescapedPipe(rawContent);
        const rawPath = pipeIndex < 0
            ? rawContent.trim()
            : rawContent.slice(0, pipeIndex).trim();
        const path = rawPath.replace(/\\\|/g, "|");
        if (!path) continue;

        links.push({
            path,
            name: path,
            source,
            index: match.index ?? -1,
            embedded: match[1] === "!",
            syntax: "wiki"
        });
    }

    const occupiedRanges = links.map(link => ({
        start: link.index,
        end: link.index + link.source.length
    })).sort((left, right) => left.start - right.start);
    const autolinkRegex = /<(https?:\/\/[^>\s]+)>/gi;
    let occupiedIndex = 0;
    for (const match of text.matchAll(autolinkRegex)) {
        const index = match.index ?? -1;
        const end = index + match[0].length;
        while (occupiedIndex < occupiedRanges.length
            && occupiedRanges[occupiedIndex].end <= index) {
            occupiedIndex++;
        }
        const occupied = occupiedRanges[occupiedIndex];
        if (occupied && index < occupied.end && end > occupied.start) continue;

        links.push({
            path: match[1],
            name: match[1],
            source: match[0],
            index,
            embedded: false,
            syntax: "autolink"
        });
    }

    return links.sort((left, right) => left.index - right.index);
}

/**
 * Helper function to extract all image links from a text using the shared regexes.
 *
 * REGEX_FILE groups:
 *   Group 1 = alt text
 *   Group 2 = Markdown destination, possibly with a title suffix
 *
 * WikiLinks are split at the first unescaped pipe so paths can contain `\|`.
 */
export function getAllImageLinks(text: string): ImageLink[] {
    const fileArray: ImageLink[] = [];

    // --- Markdown links ---
    // Using exported REGEX_FILE (same pattern as inline)
    const mdRegex = new RegExp(REGEX_FILE.source, 'g');
    for (const match of text.matchAll(mdRegex)) {
        const source = match[0];
        const name = match[1] ?? "";
        const path = extractMarkdownDestinationPath(match[2] ?? "");

        if (path) {
            fileArray.push({
                path,
                name: name ?? "",
                source,
                index: match.index ?? -1,
            });
        }
    }

    // --- Wiki links ---
    // Using exported REGEX_WIKI_FILE (same pattern as inline)
    const wikiRegex = new RegExp(REGEX_WIKI_FILE.source, 'g');
    for (const match of text.matchAll(wikiRegex)) {
        const source = match[0];
        const rawContent = match[1]; // path|attr|...
        const pipeIdx = findFirstUnescapedPipe(rawContent);
        const rawPath = pipeIdx < 0 ? rawContent.trim() : rawContent.slice(0, pipeIdx).trim();
        const path = rawPath.replace(/\\\|/g, "|");

        fileArray.push({
            path,
            name: path,
            source,
            index: match.index ?? -1,
        });
    }

    return fileArray;
}

function findFirstUnescapedPipe(text: string): number {
    for (let i = 0; i < text.length; i++) {
        if (text[i] !== "|") continue;

        let slashCount = 0;
        for (let j = i - 1; j >= 0 && text[j] === "\\"; j--) {
            slashCount++;
        }

        if (slashCount % 2 === 0) {
            return i;
        }
    }

    return -1;
}

function extractMarkdownDestinationPath(destination: string): string {
    const trimmed = destination.trim();
    if (!trimmed) return "";

    if (trimmed.startsWith("<")) {
        const closing = trimmed.indexOf(">");
        if (closing > 0) {
            return trimmed.slice(1, closing);
        }
    }

    const titleMatch = trimmed.match(/^(.+?)(\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))$/);
    return titleMatch ? titleMatch[1] : trimmed;
}

// ==== Anchored Validators for Parser ====
export const REGEX_WIKI_LINK_VALIDATE = /^!\[\[([^\]]+?)\]\]$/;
