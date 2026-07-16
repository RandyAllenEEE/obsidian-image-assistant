
import { App, Editor, MarkdownView } from "obsidian";
import ImageConverterPlugin from "../main";

export interface ClipboardItemData {
    kind: string;
    type: string;
    file: File | null;
}

export abstract class BasePasteHandler {
    constructor(
        protected app: App,
        protected plugin: ImageConverterPlugin
    ) { }

    /**
     * Entry point for paste events.
     * Can be overridden by subclasses if they need specific handling (e.g. text paste).
     */
    async handlePaste(evt: ClipboardEvent, editor: Editor): Promise<void> {
        if (evt.defaultPrevented) return;
        if (!evt.clipboardData) return;

        const items = this.collectClipboardData(evt);
        const supportedFiles = this.filterSupportedFiles(items);
        const fileItemCount = items.filter(item => item.kind === "file").length;

        if (supportedFiles.length > 0) {
            if (supportedFiles.length !== fileItemCount) return;
            if (!this.canProcessFiles()) return;
            evt.preventDefault();
            await this.processFiles(supportedFiles, editor);
        } else {
            // Give subclasses a chance to handle non-file paste (e.g. text/network links)
            await this.handleNonFilePaste(evt, editor);
        }
    }

    /**
     * Optional hook for subclasses to handle non-file paste events
     */
    protected async handleNonFilePaste(evt: ClipboardEvent, editor: Editor): Promise<void> {
        // Default implementation does nothing
    }

    /**
     * Collects all items from the clipboard event
     */
    protected collectClipboardData(evt: ClipboardEvent): ClipboardItemData[] {
        const itemData: ClipboardItemData[] = [];
        if (!evt.clipboardData) return itemData;

        for (let i = 0; i < evt.clipboardData.items.length; i++) {
            const item = evt.clipboardData.items[i];
            const file = item.kind === "file" ? item.getAsFile() : null;
            itemData.push({ kind: item.kind, type: item.type, file });
        }
        return itemData;
    }

    /**
     * Filters files based on supported formats and ignored patterns
     */
    protected filterSupportedFiles(items: ClipboardItemData[]): File[] {
        return items
            .filter(data => data.kind === "file" && data.file &&
                this.plugin.supportedImageFormats.isSupported(data.type, data.file.name) &&
                !this.plugin.folderAndFilenameManagement.matchesPatterns(data.file.name, this.plugin.settings.pasteHandling.neverProcessFilenames))
            .map(data => data.file!)
            .filter((file): file is File => file !== null);
    }

    /**
     * Only consume native editor input when we have the same writable Markdown
     * context that processFiles requires. Otherwise Obsidian remains in charge.
     */
    public canProcessFiles(): boolean {
        return !!this.app.workspace.getActiveFile()
            && !!this.app.workspace.getActiveViewOfType(MarkdownView);
    }

    /**
     * Abstract method to process the filtered files.
     * Must be implemented by subclasses (Local/Cloud).
     */
    abstract processFiles(files: File[], editor: Editor): Promise<void>;
}
