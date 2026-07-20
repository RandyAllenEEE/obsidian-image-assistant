import { App, Editor } from "obsidian";
import ImageConverterPlugin from "../../main";
import { PasteHandler } from "./PasteHandler";
import type { EditorImageInsertionContext } from "../../core/EditorImageInsertionContext";

export class DropHandler {
    private pasteHandler: PasteHandler;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin
    ) {
        this.pasteHandler = new PasteHandler(app, plugin);
    }

    async handleDrop(
        evt: DragEvent,
        editor: Editor,
        context?: EditorImageInsertionContext
    ): Promise<void> {
        if (evt.defaultPrevented) return;
        if (evt.ctrlKey) return;
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
        if (supportedFiles.length !== fileData.length) return;
        if (!this.pasteHandler.canProcessFiles(context)) return;

        evt.preventDefault();
        editor.setCursor(pos);
        await this.pasteHandler.processFiles(supportedFiles, editor, context);
    }
}
