import { Editor } from 'obsidian';

/**
 * Utility class for removing image links from editor
 */
export class EditorLinkRemover {
    /**
     * Helper method to remove an image link from the editor.
     * @param editor - The Editor instance.
     * @param lineNumber - The line number where the match was found.
     * @param line - The line content.
     * @param fullMatch - The full matched text.
     * @param copyToClipboard - Whether to copy the text to clipboard before removing.
     * @param matchIndex - Exact character index of the match in the line.
     */
    async removeImageLink(
        editor: Editor,
        lineNumber: number,
        line: string,
        fullMatch: string,
        copyToClipboard: boolean,
        matchIndex?: number
    ) {
        if (copyToClipboard) {
            await navigator.clipboard.writeText(fullMatch);
        }

        const resolvedIndex = typeof matchIndex === 'number'
            ? matchIndex
            : line.indexOf(fullMatch);
        if (resolvedIndex < 0) {
            return;
        }

        const startPos = {
            line: lineNumber,
            ch: resolvedIndex
        };
        const endPos = {
            line: lineNumber,
            ch: startPos.ch + fullMatch.length
        };

        // Calculate trailing whitespace
        let trailingWhitespace = 0;
        while (line[endPos.ch + trailingWhitespace] === ' ' ||
            line[endPos.ch + trailingWhitespace] === '\t') {
            trailingWhitespace++;
        }

        // If this is the only content on the line, delete the entire line
        if (line.trim() === fullMatch.trim()) {
            editor.replaceRange('',
                { line: lineNumber, ch: 0 },
                { line: lineNumber + 1, ch: 0 });
        } else {
            // Otherwise, just delete the match and its trailing whitespace
            editor.replaceRange('',
                startPos,
                { line: lineNumber, ch: endPos.ch + trailingWhitespace });
        }
    }
}
