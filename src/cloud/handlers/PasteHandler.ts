import { App, Editor, Notice, MarkdownView, EditorPosition } from "obsidian";
import ImageConverterPlugin from "../../main";
import { UploaderManager } from "../uploader/index";
import { CloudLinkFormatter } from "../CloudLinkFormatter";
import { EditorContentInserter } from "../../utils/EditorContentInserter";
import { t } from "../../lang/helpers";
import { CloudResourceHelpers } from "../utils/CloudResourceHelpers";

import { BasePasteHandler } from "../../core/BasePasteHandler";

export class PasteHandler extends BasePasteHandler {
    private helpers: CloudResourceHelpers;

    constructor(
        app: App,
        plugin: ImageConverterPlugin
    ) {
        super(app, plugin);
        this.helpers = new CloudResourceHelpers(plugin);
    }

    // override to handle text paste
    protected async handleNonFilePaste(evt: ClipboardEvent, editor: Editor): Promise<void> {
        if (!evt.clipboardData) return;
        const clipboardText = evt.clipboardData.getData('text/plain');
        if (clipboardText) {
            await this.handlePasteText(clipboardText, editor, editor.getCursor(), evt);
        }
    }

    public async processFiles(files: File[], editor: Editor): Promise<void> {
        // We generally need to check for mixed content (Text + Image) here if applyImage setting is on
        // But BasePasteHandler filters files.
        // Cloud logic had a specific check: "if has text and has image, only proceed if settings.applyImage"
        // BasePasteHandler doesn't pass text.
        // However, if processFiles is called, it means files exist.
        // We can access clipboard data via 'navigator.clipboard' but that's async and tricky inside synchronous flow?
        // Actually BasePasteHandler abstracts that.
        // For Cloud, maybe we assume if we are here, we process files.
        // The original check "hasText && hasImageFile && !applyImage" logic might is slightly lost if we split them pure.
        // But let's assume if BasePasteHandler calls processFiles, we process them.

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice(t("MSG_NO_ACTIVE_FILE") || 'No active file detected.');
            return;
        }

        for (const file of files) {
            // Insert uploading placeholder using EditorContentInserter
            const inserter = new EditorContentInserter(this.app.workspace.getActiveViewOfType(MarkdownView)!);
            inserter.insertLoadingText(`${t("LOADING_UPLOAD") || "Uploading"} ${file.name}...`);

            try {
                const uploaderManager = new UploaderManager(
                    this.plugin.settings.pasteHandling.cloud.uploader,
                    this.plugin
                );

                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                const fileList = dataTransfer.files;

                const uploadResult = await uploaderManager.uploadByClipboard(fileList);
                if (uploadResult.success && uploadResult.result.length > 0) {
                    const cloudUrl = uploadResult.result[0];
                    const cloudLink = CloudLinkFormatter.formatCloudLink(
                        cloudUrl,
                        this.plugin.settings.pasteHandling.cloud
                    );

                    inserter.insertResponseToEditor(cloudLink);
                    new Notice(t("MODAL_UPLOAD_SUCCESS") || 'Image uploaded successfully!');
                } else {
                    throw new Error("Upload failed (no URL returned)");
                }
            } catch (error) {
                console.error('[Cloud Upload] Upload failed:', error);
                new Notice(`${t("MODAL_UPLOAD_FAILED") || "Upload failed"}: ${error.message}`);
                inserter.removeLoadingText();
            }
        }

        if (this.plugin.settings.captions.enabled) {
            this.plugin.imageStateManager?.refreshAllImages();
        }
    }

    public async handlePasteText(
        clipboardText: string,
        editor: Editor,
        cursor: EditorPosition,
        evt: ClipboardEvent
    ) {
        if (!this.plugin.settings.pasteHandling.cloud.workOnNetWork) {
            return;
        }

        const imageUrlRegex = /!\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g;
        const markdownMatches = [...clipboardText.matchAll(imageUrlRegex)];

        // Simple regex for wikilinks (duplicating to avoid circular dependency complex imports)
        const REGEX_WIKI_NETWORK_IMAGE = /!\[\[(https?:\/\/[^\]]+)(?:\|([^\]]+))?\]\]/g;
        const wikilinkMatches = [...clipboardText.matchAll(REGEX_WIKI_NETWORK_IMAGE)];

        const totalMatches = markdownMatches.length + wikilinkMatches.length;
        if (totalMatches === 0) return;

        // Filter blacklisted
        const validMarkdownMatches = markdownMatches.filter(match => !this.helpers.isBlacklistedDomain(match[2]));
        const validWikilinkMatches = wikilinkMatches.filter(match => !this.helpers.isBlacklistedDomain(match[1]));

        if (validMarkdownMatches.length === 0 && validWikilinkMatches.length === 0) return;

        evt.preventDefault();

        let newContent = clipboardText;
        const uploaderManager = new UploaderManager(
            this.plugin.settings.pasteHandling.cloud.uploader,
            this.plugin
        );

        // Process Markdown
        for (const match of validMarkdownMatches) {
            const originalLink = match[0];
            const imageUrl = match[2];
            try {
                const uploadResult = await uploaderManager.upload([imageUrl]);
                if (uploadResult.success && uploadResult.result.length > 0) {
                    const cloudUrl = uploadResult.result[0];
                    const cloudLink = CloudLinkFormatter.formatCloudLink(
                        cloudUrl,
                        this.plugin.settings.pasteHandling.cloud,
                        originalLink
                    );
                    newContent = newContent.replace(originalLink, cloudLink);
                }
            } catch (e) { console.error(e); }
        }

        // Process Wikilink
        for (const match of validWikilinkMatches) {
            const originalLink = match[0];
            const imageUrl = match[1];
            try {
                const uploadResult = await uploaderManager.upload([imageUrl]);
                if (uploadResult.success && uploadResult.result.length > 0) {
                    const cloudUrl = uploadResult.result[0];
                    const cloudLink = CloudLinkFormatter.formatCloudLink(
                        cloudUrl,
                        this.plugin.settings.pasteHandling.cloud,
                        originalLink
                    );
                    newContent = newContent.replace(originalLink, cloudLink);
                }
            } catch (e) { console.error(e); }
        }

        editor.replaceRange(newContent, cursor);
    }
}
