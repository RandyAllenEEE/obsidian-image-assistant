/**
 * Safe path-only replacement for Obsidian image links.
 *
 * Goals:
 * - keep original link type (`![[...]]` vs `![...](...)`)
 * - keep original pipe attributes (`|alt|align|size`)
 * - only replace the path portion
 *
 * Obsidian escape conventions:
 *   `\\`  = literal backslash
 *   `\|`  = literal pipe (in wiki links)
 *   In markdown links, `(` `)` inside paths are allowed at one level of nesting.
 */
export class ImageLinkPathReplacer {
    /**
     * Extract plain URL/path from a possible markdown image wrapper.
     * Example: `![x](https://a/b.png)` -> `https://a/b.png`
     * Handles quoted paths: `<https://a/b.png>` -> `https://a/b.png`
     */
    static extractPureUrlFromPossibleMarkdown(input: string): string {
        const trimmed = (input ?? "").trim();
        if (!trimmed) return "";

        // Try to match a markdown image wrapper.
        const mdImageMatch = trimmed.match(/^!\[[^\]]*\]\(([^)]+)\)$/);
        if (!mdImageMatch) return trimmed;

        // Strip optional angle brackets around the path.
        let inside = mdImageMatch[1].trim();
        if (inside.startsWith("<") && inside.endsWith(">")) {
            inside = inside.slice(1, -1);
        }

        // The URL is the first whitespace-delimited token; everything else is title.
        const first = inside.split(/\s+/)[0];
        return first || inside;
    }

    static replacePath(originalLink: string, newPath: string): string {
        const original = (originalLink ?? "").trim();
        if (!original) return originalLink;

        const replacementPath = this.extractPureUrlFromPossibleMarkdown(newPath);
        if (!replacementPath) return originalLink;

        if (original.startsWith("![[") && original.endsWith("]]")) {
            return this.replaceWikiPath(original, replacementPath);
        }
        if (original.startsWith("![") && original.includes("](") && original.endsWith(")")) {
            return this.replaceMarkdownPath(original, replacementPath);
        }

        return originalLink;
    }

    /**
     * Replace a URL appearing in image links within a text.
     * Scans for image links (wiki or markdown) containing oldUrl and replaces
     * just the URL portion while preserving all syntax and attributes.
     * Uses the same link-format detection as replacePath.
     */
    static replaceUrlInLinks(content: string, oldUrl: string, newUrl: string): string {
        if (!content || !oldUrl) return content;

        // Escape special regex chars in URL
        const escapedUrl = oldUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Pattern matches image links containing the URL
        // Markdown: ![alt](<url> "title") or ![alt](url "title") or ![alt](url)
        // Wiki: ![[url|alt|size]]
        // We match any image link that contains the old URL anywhere inside
        const imageLinkPattern = new RegExp(
            `!\\[\\[([^\\]|]+(?:\\|[^\\]]+)*)\\]\\]|` +
            `!\\[[^\\]]*\\]\\(([^)]+)\\)`,
            'g'
        );

        return content.replace(imageLinkPattern, (match) => {
            // Only process links that actually contain the old URL
            if (!match.includes(oldUrl)) return match;

            // Extract the URL from the link
            let linkUrl = '';
            if (match.startsWith('![[')) {
                // Wiki link: ![[url|alt]] or ![[url]]
                const inner = match.slice(4, -2);
                const pipeIdx = inner.indexOf('|');
                linkUrl = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner;
            } else if (match.startsWith('![')) {
                // Markdown link: ![alt](url "title")
                const parenOpen = match.indexOf('](');
                if (parenOpen >= 0) {
                    const pathAndTitle = match.slice(parenOpen + 2, -1);
                    // Extract URL (first token before space/title)
                    const spaceIdx = pathAndTitle.search(/\s/);
                    linkUrl = spaceIdx >= 0 ? pathAndTitle.slice(0, spaceIdx) : pathAndTitle;
                    // Strip angle brackets
                    if (linkUrl.startsWith('<') && linkUrl.endsWith('>')) {
                        linkUrl = linkUrl.slice(1, -1);
                    }
                }
            }

            if (linkUrl !== oldUrl) return match;

            // Use replacePath to rebuild the link with new URL
            return this.replacePath(match, newUrl);
        });
    }

    /**
     * Obsidian wiki link pipe escape:
     *   `\\`  = literal backslash  (so `\\\\` = two backslashes)
     *   `\|`  = literal pipe character in a path
     *
     * This means we need to scan for `\|` as a unit and treat `\\` as a backslash.
     * A pipe is "unescaped" when it is NOT preceded by an odd number of backslashes.
     *
     * Strategy: walk the string, track consecutive backslashes before each char.
     */
    private static findFirstUnescapedPipe(text: string): number {
        let i = 0;
        while (i < text.length) {
            if (text[i] !== "|") { i++; continue; }

            // Count consecutive backslashes immediately before this pipe.
            let bsCount = 0;
            let j = i - 1;
            while (j >= 0 && text[j] === "\\") { bsCount++; j--; }

            // Pipe is unescaped only when preceded by an even number of backslashes
            // (zero is even, meaning no backslash prefix = unescaped).
            if (bsCount % 2 === 0) return i;
            i++;
        }
        return -1;
    }

    private static replaceWikiPath(wikiLink: string, newPath: string): string {
        const inside = wikiLink.slice(3, -2); // strip ![[ and ]]
        const firstPipe = this.findFirstUnescapedPipe(inside);

        if (firstPipe < 0) {
            return `![[${newPath}]]`;
        }

        // newPath itself may contain unescaped pipes — escape them so they don't
        // become attribute separators when we rebuild.
        const escapedNewPath = this.escapeWikiPathPipes(newPath);
        const attrs = inside.slice(firstPipe + 1); // preserve all attrs exactly
        return `![[${escapedNewPath}|${attrs}]]`;
    }

    /**
     * Escape `|` characters in a wiki-link path that are NOT already escaped.
     * `\|` -> `\\|` (escaped pipe), `\\` -> `\\\\` (already escaped backslash stays).
     */
    private static escapeWikiPathPipes(path: string): string {
        let result = "";
        let i = 0;
        while (i < path.length) {
            if (path[i] === "\\") {
                // Skip escaped backslash sequence (\\ or \\\\| etc.)
                let bsCount = 0;
                while (i < path.length && path[i] === "\\") { bsCount++; i++; }
                // Emit the backslashes as-is; they are already escaped.
                result += "\\".repeat(bsCount);
                continue;
            }
            if (path[i] === "|") {
                // Escape this unescaped pipe.
                result += "\\|";
                i++;
                continue;
            }
            result += path[i];
            i++;
        }
        return result;
    }

    private static replaceMarkdownPath(markdownLink: string, newPath: string): string {
        const open = markdownLink.indexOf("](");
        if (open < 0 || !markdownLink.endsWith(")")) return markdownLink;

        // Isolate the "rest" (title etc.) from the ORIGINAL markdown link path area.
        // Example: "url "title""  -> rest = ` "title""`
        // Example: "url"          -> rest = ``
        // We split on the original (unencoded) path token.
        const originalPathToken = markdownLink.slice(open + 2, -1); // e.g. "url (1) "title""
        const { rest } = this.splitFirstMarkdownPathToken(originalPathToken);

        // Encode ( and ) in newPath to avoid breaking the markdown link delimiters.
        const encodedNewPath = newPath.replace(/[()]/g, c => encodeURIComponent(c));

        // Keep the original head + ](); append encoded newPath + original rest + closing ).
        return `${markdownLink.slice(0, open + 2)}${encodedNewPath}${rest})`;
    }

    /**
     * Split the content inside Markdown path parens at the first unescaped space.
     * Title (if present) starts with whitespace or a quote.
     * Handles: `"title"`, ` "title"`, bare paths.
     */
    private static splitFirstMarkdownPathToken(pathAndTitle: string): { token: string; rest: string } {
        let inSingle = false;
        let inDouble = false;
        let escaped = false;

        for (let i = 0; i < pathAndTitle.length; i++) {
            const ch = pathAndTitle[i];
            if (escaped) { escaped = false; continue; }
            if (ch === "\\") { escaped = true; continue; }
            if (ch === "'" && !inDouble) inSingle = !inSingle;
            else if (ch === "\"" && !inSingle) inDouble = !inDouble;

            if (!inSingle && !inDouble && /\s/.test(ch)) {
                return {
                    token: pathAndTitle.slice(0, i),
                    rest: pathAndTitle.slice(i)
                };
            }
        }

        return { token: pathAndTitle, rest: "" };
    }
}

