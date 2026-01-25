import { App, Editor, Notice, MarkdownView, EditorPosition } from "obsidian";
import ImageConverterPlugin from "../../main";
import { PasteHandler } from "./PasteHandler";

/**
 * DropHandler for Local mode.
 * Handles drag-and-drop events for local image processing.
 * Reuses PasteHandler's processFiles logic for actual file processing.
 */
export class DropHandler {
    private pasteHandler: PasteHandler;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin
    ) {
        // Reuse PasteHandler for file processing logic
        this.pasteHandler = new PasteHandler(app, plugin);
    }

    async handleDrop(evt: DragEvent, editor: Editor): Promise<void> {
        if (!evt.dataTransfer) return;

        const pos = editor.posAtMouse(evt);
        if (!pos) return;

        const fileData: { name: string, type: string, file: File }[] = [];
        for (let i = 0; i < evt.dataTransfer.files.length; i++) {
            const file = evt.dataTransfer.files[i];
            fileData.push({ name: file.name, type: file.type, file });
        }

        const supportedFiles = fileData
            .filter(data => this.plugin.supportedImageFormats.isSupported(data.type, data.name) &&
                !this.plugin.folderAndFilenameManagement.matchesPatterns(data.name, this.plugin.settings.pasteHandling.neverProcessFilenames))
            .map(data => data.file);

        if (supportedFiles.length === 0) return;

        // For Drop, we must ensure cursor is where drop happened
        editor.setCursor(pos);

        evt.preventDefault();

        // Delegate to PasteHandler's processFiles method
        await this.pasteHandler.processFiles(supportedFiles, editor);
    }
}
