import { Editor, EditorPosition, MarkdownView } from "obsidian";
import { createPlaceholderSession, PlaceholderSession } from "./EditorReplacement";

export class EditorContentInserter {
    view: MarkdownView;
    editor: Editor;
    // Cache cursor position
    cursor: EditorPosition;
    private placeholder: PlaceholderSession | null = null;

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
        this.placeholder = createPlaceholderSession(this.editor, text, this.cursor);
        this.cursor = this.placeholder.start;
    }

    /**
     * Replace the loading text with the final response
     * @param res The final content to insert
     */
    insertResponseToEditor(res: string): void {
        if (this.placeholder) {
            this.placeholder.replace(res);
        }
    }


    /**
     * Remove loading text (used for cleanup on error)
     */
    removeLoadingText(): void {
        if (this.placeholder) {
            this.placeholder.remove();
        }
    }
}
