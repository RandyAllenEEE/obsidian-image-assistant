import {
    Editor,
    EditorPosition,
    type MarkdownView,
    type TFile
} from "obsidian";
import { createPlaceholderSession, PlaceholderSession } from "./EditorReplacement";

export class EditorContentInserter {
    view: MarkdownView | null;
    editor: Editor;
    // Cache cursor position
    cursor: EditorPosition;
    private placeholder: PlaceholderSession | null = null;
    private readonly ownerFile: TFile | null;

    constructor(target: MarkdownView | Editor, ownerFile?: TFile | null) {
        const candidate = target as Partial<MarkdownView>;
        this.view = candidate.editor
            && typeof candidate.editor.getCursor === "function"
            ? target as MarkdownView
            : null;
        this.editor = this.view?.editor ?? target as Editor;
        this.ownerFile = ownerFile ?? this.view?.file ?? null;
        // Immediately cache cursor position to avoid interference from other plugins
        this.cursor = this.editor.getCursor();
    }

    /**
     * Insert loading text at the cached cursor position
     * @param text The text to display as a placeholder
     */
    insertLoadingText(text: string): void {
        this.placeholder = createPlaceholderSession(
            this.editor,
            text,
            this.cursor,
            { view: this.view, file: this.ownerFile }
        );
        this.cursor = this.placeholder.start;
    }

    /**
     * Replace the loading text with the final response
     * @param res The final content to insert
     */
    insertResponseToEditor(res: string): boolean {
        return this.placeholder?.replace(res) ?? false;
    }


    /**
     * Remove loading text (used for cleanup on error)
     */
    removeLoadingText(): boolean {
        return this.placeholder?.remove() ?? false;
    }

    /**
     * Runs one asynchronous placeholder lifecycle. Completion and failure both
     * remove only a still-owned placeholder and never touch user-edited text.
     */
    async runWithLoadingText<T>(
        text: string,
        operation: (inserter: EditorContentInserter) => Promise<T>
    ): Promise<T> {
        this.insertLoadingText(text);
        return this.runWithCurrentPlaceholder(operation);
    }

    /**
     * Completes a placeholder lifecycle that was inserted earlier. Cleanup is
     * ownership-aware, so a user-edited placeholder is never removed.
     */
    async runWithCurrentPlaceholder<T>(
        operation: (inserter: EditorContentInserter) => Promise<T>
    ): Promise<T> {
        try {
            return await operation(this);
        } finally {
            this.removeLoadingText();
        }
    }
}
