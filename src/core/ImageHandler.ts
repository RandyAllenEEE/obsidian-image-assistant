
import type { Editor } from "obsidian";
import type { EditorImageInsertionContext } from "./EditorImageInsertionContext";

export interface ImageHandler {
    handlePaste(
        event: ClipboardEvent,
        editor: Editor,
        context: EditorImageInsertionContext
    ): Promise<void>;
    handleDrop(
        event: DragEvent,
        editor: Editor,
        context: EditorImageInsertionContext
    ): Promise<void>;
}
