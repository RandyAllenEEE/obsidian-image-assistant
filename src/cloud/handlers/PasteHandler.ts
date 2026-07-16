import { App, Editor, Notice, MarkdownView, EditorPosition } from "obsidian";
import ImageConverterPlugin from "../../main";
import { UploaderManager } from "../uploader/index";
import { CloudLinkFormatter } from "../CloudLinkFormatter";
import { EditorContentInserter } from "../../utils/EditorContentInserter";
import { t } from "../../lang/helpers";
import { CloudResourceHelpers } from "../utils/CloudResourceHelpers";
import { getContextualImageLinks } from "../../utils/MarkdownSourceContext";
import { isHttpUrl } from "../../utils/NetworkPolicy";
import { getErrorMessage } from "../../utils/ErrorUtils";

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

    async handlePaste(evt: ClipboardEvent, editor: Editor): Promise<void> {
        if (evt.defaultPrevented) return;
        if (!evt.clipboardData) return;

        const items = this.collectClipboardData(evt);
        const supportedFiles = this.filterSupportedFiles(items);
        const fileItemCount = items.filter(item => item.kind === "file").length;

        if (supportedFiles.length > 0) {
            if (supportedFiles.length !== fileItemCount) return;
            const clipboardText = evt.clipboardData.getData('text/plain') || evt.clipboardData.getData('text') || '';
            if (clipboardText.trim() && !this.plugin.settings.pasteHandling.cloud.applyImage) {
                return;
            }

            if (!this.canProcessFiles()) return;
            evt.preventDefault();
            await this.processFiles(supportedFiles, editor);
            return;
        }

        await this.handleNonFilePaste(evt, editor);
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
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice(t("MSG_NO_ACTIVE_FILE") || 'No active file detected.');
            return;
        }
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
            new Notice(t("MSG_NO_ACTIVE_VIEW") || 'No active Markdown view detected.');
            return;
        }

        for (const file of files) {
            // Insert uploading placeholder using EditorContentInserter
            const inserter = new EditorContentInserter(activeView);
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
                new Notice(`${t("MODAL_UPLOAD_FAILED") || "Upload failed"}: ${getErrorMessage(error)}`);
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
        if (evt.defaultPrevented) return;
        if (this.plugin.settings.pasteHandling.cloud.remoteServerMode) {
            return;
        }

        if (!this.plugin.settings.pasteHandling.cloud.workOnNetWork) {
            return;
        }

        // Do not upload image-looking text copied from source-only Markdown
        // contexts; Admonition content remains eligible.
        const allLinks = getContextualImageLinks(clipboardText);
        const networkLinks = allLinks.filter(link =>
            isHttpUrl(link.path) &&
            !this.helpers.isBlacklistedDomain(link.path)
        );

        if (networkLinks.length === 0) return;

        evt.preventDefault();

        let newContent = clipboardText;
        const uploaderManager = new UploaderManager(
            this.plugin.settings.pasteHandling.cloud.uploader,
            this.plugin
        );

        // Process all network image links (both markdown and wiki format)
        for (const link of networkLinks) {
            const originalLink = link.source;
            const imageUrl = link.path;
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
