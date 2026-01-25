import { Editor, EditorPosition, MarkdownView } from "obsidian";

export class EditorContentInserter {
    view: MarkdownView;
    editor: Editor;
    // Cache cursor position
    cursor: EditorPosition;
    private loadingTextLength: number = 0;

    constructor(view: MarkdownView) {
        this.view = view;
        this.editor = view.editor;
        // Immediately cache cursor position to avoid interference from other plugins
        this.cursor = view.editor.getCursor();
    }

    /**
     * Insert loading text at the cached cursor position
     * @param text The text to display as a placeholder
     */
    insertLoadingText(text: string): void {
        this.loadingTextLength = text.length;
        // Use cached cursor position
        this.editor.replaceRange(text, this.cursor);
        this.editor.setCursor({
            line: this.cursor.line,
            ch: this.cursor.ch + this.loadingTextLength,
        });
    }

    /**
     * Replace the loading text with the final response
     * @param res The final content to insert
     */
    insertResponseToEditor(res: string): void {
        // [Safety Check] 1. Check if line is still valid
        if (this.cursor.line >= this.editor.lineCount()) {
            console.warn("EditorContentInserter: Cursor line no longer exists. Aborting insertion.");
            return;
        }

        // [Safety Check] 2. Check if column is within bounds (prevents crash if line was truncated)
        const currentLineLength = this.editor.getLine(this.cursor.line).length;
        if (this.cursor.ch > currentLineLength) {
            console.warn("EditorContentInserter: Cursor column out of bounds. Aborting insertion.");
            return;
        }

        // Use cached cursor position to calculate the end of the placeholder
        this.editor.replaceRange(res, this.cursor, {
            line: this.cursor.line,
            ch: this.cursor.ch + this.loadingTextLength,
        });
    }


    /**
     * Remove loading text (used for cleanup on error)
     */
    removeLoadingText(): void {
        // [Safety Check]
        if (this.cursor.line >= this.editor.lineCount()) return;

        this.editor.replaceRange("", this.cursor, {
            line: this.cursor.line,
            ch: this.cursor.ch + this.loadingTextLength,
        });
    }
}
