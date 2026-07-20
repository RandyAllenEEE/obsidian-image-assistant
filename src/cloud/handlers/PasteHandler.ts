import { App, Editor, Notice, EditorPosition } from "obsidian";
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
import type { EditorImageInsertionContext } from "../../core/EditorImageInsertionContext";
import { createTrackedRangeSession } from "../../utils/EditorReplacement";
import { ImageLinkPathReplacer } from "../../utils/ImageLinkPathReplacer";

export class PasteHandler extends BasePasteHandler {
    private helpers: CloudResourceHelpers;

    constructor(
        app: App,
        plugin: ImageConverterPlugin
    ) {
        super(app, plugin);
        this.helpers = new CloudResourceHelpers(plugin);
    }

    async handlePaste(
        evt: ClipboardEvent,
        editor: Editor,
        context?: EditorImageInsertionContext
    ): Promise<void> {
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

            if (!this.canProcessFiles(context)) return;
            evt.preventDefault();
            await this.processFiles(supportedFiles, editor, context);
            return;
        }

        await this.handleNonFilePaste(evt, editor, context);
    }

    // override to handle text paste
    protected async handleNonFilePaste(
        evt: ClipboardEvent,
        editor: Editor,
        context?: EditorImageInsertionContext
    ): Promise<void> {
        if (!evt.clipboardData) return;
        const clipboardText = evt.clipboardData.getData('text/plain');
        if (clipboardText) {
            if (!context) return;
            await this.handlePasteText(
                clipboardText,
                editor,
                editor.getCursor(),
                evt,
                context
            );
        }
    }

    public async processFiles(
        files: File[],
        editor: Editor,
        context?: EditorImageInsertionContext
    ): Promise<void> {
        if (!context) return;
        for (const file of files) {
            // Insert uploading placeholder using EditorContentInserter
            const inserter = new EditorContentInserter(
                context.view ?? context.editor,
                context.file
            );

            try {
                await inserter.runWithLoadingText(
                    `${t("LOADING_UPLOAD") || "Uploading"} ${file.name}...`,
                    async session => {
                        const uploaderManager = new UploaderManager(
                            this.plugin.settings.pasteHandling.cloud.uploader,
                            this.plugin
                        );

                        const dataTransfer = new DataTransfer();
                        dataTransfer.items.add(file);
                        const uploadResult = await uploaderManager.uploadByClipboard(
                            dataTransfer.files
                        );
                        if (!uploadResult.success || uploadResult.result.length === 0) {
                            throw new Error(
                                uploadResult.msg
                                    || t("REFERENCE_WORKFLOW_UPLOAD_NO_URL")
                            );
                        }

                        const cloudUrl = uploadResult.result[0];
                        const cloudLink = CloudLinkFormatter.formatCloudLink(
                            cloudUrl,
                            this.plugin.settings.pasteHandling.cloud
                        );
                        if (!session.insertResponseToEditor(cloudLink)) {
                            throw new Error(t("MSG_IMAGE_CONTEXT_UNRESOLVED"));
                        }
                    }
                );
                new Notice(t("MODAL_UPLOAD_SUCCESS"));
            } catch (error) {
                console.error('[Cloud Upload] Upload failed:', error);
                new Notice(`${t("MODAL_UPLOAD_FAILED")}: ${getErrorMessage(error)}`);
            }
        }

        if (this.plugin.settings.captions.enabled) {
            this.plugin.imageStateManager?.refreshAllImages();
        }
    }

    public async handlePasteText(
        clipboardText: string,
        editor: Editor,
        _cursor: EditorPosition,
        evt: ClipboardEvent,
        context?: EditorImageInsertionContext
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

        if (!context) return;
        evt.preventDefault();
        const selectionStart = editor.getCursor("from");
        const selectionEnd = editor.getCursor("to");
        const insertionOffset = editor.posToOffset(selectionStart);
        editor.replaceRange(clipboardText, selectionStart, selectionEnd);
        editor.setCursor(
            editor.offsetToPos(insertionOffset + clipboardText.length)
        );
        const sessions = networkLinks.map(link => ({
            link,
            session: createTrackedRangeSession(
                editor,
                link.source,
                editor.offsetToPos(insertionOffset + link.index),
                { view: context.view, file: context.file }
            )
        }));
        const uploaderManager = new UploaderManager(
            this.plugin.settings.pasteHandling.cloud.uploader,
            this.plugin
        );
        let replaced = 0;
        let failed = 0;
        let stale = 0;

        // Process all network image links (both markdown and wiki format)
        for (const { link, session } of sessions) {
            const originalLink = link.source;
            const imageUrl = link.path;
            try {
                const uploadResult = await uploaderManager.upload([imageUrl]);
                if (uploadResult.success && uploadResult.result.length > 0) {
                    const cloudUrl = uploadResult.result[0];
                    const cloudLink = ImageLinkPathReplacer.replacePath(
                        originalLink,
                        cloudUrl
                    );
                    if (session.replace(cloudLink)) {
                        replaced++;
                    } else {
                        stale++;
                    }
                } else {
                    failed++;
                    session.release();
                }
            } catch (error) {
                console.error(error);
                failed++;
                session.release();
            }
        }
        if (failed > 0 || stale > 0) {
            new Notice(t("MSG_CLOUD_TEXT_PASTE_PARTIAL", [
                replaced,
                failed,
                stale
            ]));
        }
    }
}
