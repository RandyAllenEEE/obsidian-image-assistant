
import { Editor, EditorPosition } from "obsidian";

export interface ImageHandler {
    handlePaste(event: ClipboardEvent, editor: Editor): Promise<void>;
    handleDrop(event: DragEvent, editor: Editor): Promise<void>;
}
