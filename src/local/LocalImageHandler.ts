import { App, Editor } from "obsidian";
import { ImageHandler } from "../core/ImageHandler";
import ImageConverterPlugin from "../main";

import { PasteHandler } from "./handlers/PasteHandler";
import { DropHandler } from "./handlers/DropHandler";

/**
 * LocalImageHandler - Entry point for local image processing.
 * Implements ImageHandler interface and delegates to specialized handlers.
 * 
 * Structure mirrors CloudImageHandler for consistency.
 */
export class LocalImageHandler implements ImageHandler {
    private app: App;
    private plugin: ImageConverterPlugin;

    // Sub-handlers
    private pasteHandler: PasteHandler;
    private dropHandler: DropHandler;

    constructor(app: App, plugin: ImageConverterPlugin) {
        this.app = app;
        this.plugin = plugin;

        // Initialize sub-handlers
        this.pasteHandler = new PasteHandler(app, plugin);
        this.dropHandler = new DropHandler(app, plugin);
    }

    async handlePaste(evt: ClipboardEvent, editor: Editor): Promise<void> {
        return this.pasteHandler.handlePaste(evt, editor);
    }

    async handleDrop(evt: DragEvent, editor: Editor): Promise<void> {
        return this.dropHandler.handleDrop(evt, editor);
    }

    /**
     * Process files directly (for programmatic use or testing).
     * Delegates to PasteHandler which contains the core processing logic.
     */
    async processFiles(files: File[], editor: Editor): Promise<void> {
        return this.pasteHandler.processFiles(files, editor);
    }
}
