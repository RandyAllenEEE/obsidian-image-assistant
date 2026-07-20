import type { Editor } from "obsidian";
import type { ImageMatch } from "../types";

/** Finds exact HTML Base64 image occurrences for fail-closed source actions. */
export class ImageMatchFinder {
    findBase64ImageMatches(editor: Editor, src: string): ImageMatch[] {
        const matches: ImageMatch[] = [];
        const lineCount = editor.lineCount();
        for (let lineNumber = 0; lineNumber < lineCount; lineNumber++) {
            const line = editor.getLine(lineNumber);
            for (const match of line.matchAll(
                /<img\b[^>]*\bsrc\s*=\s*(["'])(data:image\/[^"']+)\1[^>]*>/gi
            )) {
                if (match[2] !== src || match.index === undefined) continue;
                matches.push({
                    lineNumber,
                    line,
                    fullMatch: match[0],
                    index: match.index
                });
            }
        }
        return matches;
    }
}
