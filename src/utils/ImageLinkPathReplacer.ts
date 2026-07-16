import { getContextualImageLinks } from "./MarkdownSourceContext";

/**
 * Safe path-only replacement for Obsidian image and file-reference links.
 *
 * Goals:
 * - keep original link type and embed marker
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
        const markdownMatch = trimmed.match(/^!?\[[^\]]*\]\((.*)\)$/);
        if (!markdownMatch) return trimmed;

        return this.splitMarkdownDestination(markdownMatch[1].trim()).path;
    }

    static replacePath(originalLink: string, newPath: string): string {
        const original = (originalLink ?? "").trim();
        if (!original) return originalLink;

        const replacementPath = this.extractPureUrlFromPossibleMarkdown(newPath);
        if (!replacementPath) return originalLink;

        if ((original.startsWith("![[") || original.startsWith("[[")) && original.endsWith("]]")) {
            return this.replaceWikiPath(original, replacementPath);
        }
        if ((original.startsWith("![") || original.startsWith("["))
            && original.includes("](")
            && original.endsWith(")")) {
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

        const matches = getContextualImageLinks(content)
            .filter((link) => link.path === oldUrl)
            .sort((a, b) => b.index - a.index);

        let updated = content;
        for (const match of matches) {
            const replacement = this.replacePath(match.source, newUrl);
            if (replacement === match.source) continue;

            updated =
                updated.slice(0, match.index) +
                replacement +
                updated.slice(match.index + match.source.length);
        }

        return updated;
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
        const embedded = wikiLink.startsWith("![[");
        const prefix = embedded ? "![[" : "[[";
        const inside = wikiLink.slice(prefix.length, -2);
        const firstPipe = this.findFirstUnescapedPipe(inside);
        const escapedNewPath = this.escapeWikiPathPipes(newPath);

        if (firstPipe < 0) {
            return `${prefix}${escapedNewPath}]]`;
        }

        const attrs = inside.slice(firstPipe + 1); // preserve all attrs exactly
        return `${prefix}${escapedNewPath}|${attrs}]]`;
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

        const originalPathToken = markdownLink.slice(open + 2, -1); // e.g. "url (1) "title""
        const { rest, wasAngleWrapped } = this.splitMarkdownDestination(originalPathToken);

        const formattedNewPath = this.formatMarkdownPath(newPath, wasAngleWrapped);

        return `${markdownLink.slice(0, open + 2)}${formattedNewPath}${rest})`;
    }

    /**
     * Split the content inside Markdown image destination parens into path and
     * the original title suffix. Supports angle-wrapped paths with spaces.
     */
    private static splitMarkdownDestination(pathAndTitle: string): {
        path: string;
        rest: string;
        wasAngleWrapped: boolean;
    } {
        const destination = pathAndTitle.trim();
        if (!destination) {
            return { path: "", rest: "", wasAngleWrapped: false };
        }

        if (destination.startsWith("<")) {
            const close = this.findClosingAngle(destination);
            if (close > 0) {
                return {
                    path: destination.slice(1, close),
                    rest: destination.slice(close + 1),
                    wasAngleWrapped: true
                };
            }
        }

        const titleMatch = destination.match(/^(.+?)(\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\([^)]*\)))$/);
        if (titleMatch) {
            return {
                path: titleMatch[1],
                rest: titleMatch[2],
                wasAngleWrapped: false
            };
        }

        return { path: destination, rest: "", wasAngleWrapped: false };
    }

    private static findClosingAngle(destination: string): number {
        let escaped = false;
        for (let i = 1; i < destination.length; i++) {
            const ch = destination[i];
            if (escaped) {
                escaped = false;
                continue;
            }
            if (ch === "\\") {
                escaped = true;
                continue;
            }
            if (ch === ">") {
                return i;
            }
        }
        return -1;
    }

    private static formatMarkdownPath(path: string, preferAngle: boolean): string {
        if (!preferAngle && !/[\s()]/.test(path)) {
            return path;
        }

        return `<${path.replace(/>/g, "%3E")}>`;
    }
}

