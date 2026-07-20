import { Notice } from "obsidian";
import { t } from "../../../lang/helpers";
import { loadImage } from "../../../utils/ImageLoadUtils";
import { EditorRangeMutationTransaction } from "../../../utils/EditorRangeMutationTransaction";
import type { ImageContextMenuContext } from "../types";

/** Handles clipboard operations against an already resolved image context. */
export class ClipboardHandler {
    private readonly editorTransaction = new EditorRangeMutationTransaction();

    async cutImageAndLink(context: ImageContextMenuContext): Promise<void> {
        const reference = context.viewContext
            ? {
                owner: context.viewContext,
                line: context.viewContext.match.line,
                start: context.viewContext.match.start,
                linkText: context.viewContext.match.linkText
            }
            : context.dataReference
                ? {
                    owner: context.dataReference.owner,
                    line: context.dataReference.match.lineNumber,
                    start: context.dataReference.match.index,
                    linkText: context.dataReference.match.fullMatch
                }
                : null;
        if (!reference) {
            new Notice(t("MSG_IMAGE_CONTEXT_UNRESOLVED"));
            return;
        }

        try {
            const line = reference.owner.editor.getLine(reference.line);
            if (line.slice(reference.start, reference.start + reference.linkText.length)
                !== reference.linkText) {
                new Notice(t("MSG_IMAGE_CONTEXT_UNRESOLVED"));
                return;
            }
            const clipboard = context.ownerWindow?.navigator.clipboard
                ?? navigator.clipboard;
            await clipboard.writeText(reference.linkText);
            const result = await this.editorTransaction.run(reference.owner, {
                line: reference.line,
                start: reference.start,
                end: reference.start + reference.linkText.length,
                expectedText: reference.linkText,
                replacement: "",
                removeStandaloneLine: true
            });
            if (!result.saved) {
                new Notice(
                    result.stale
                        ? t("MSG_IMAGE_CONTEXT_UNRESOLVED")
                        : result.uncertain
                            ? t("MSG_EDITOR_SAVE_UNCERTAIN")
                            : t("MSG_FAIL_CUT")
                );
                return;
            }
            new Notice(t("MSG_CUT_COPIED"));
        } catch (error) {
            console.error("Error cutting image:", error);
            new Notice(t("MSG_FAIL_CUT"));
        }
    }

    async copyImage(context: ImageContextMenuContext): Promise<void> {
        const target = context.image;
        const ownerDocument = context.ownerDocument;
        const image = ownerDocument.createElement("img");
        image.crossOrigin = "anonymous";

        try {
            await loadImage(image, target.src);
            const dataUrl = this.renderImageDataUrl(ownerDocument, image);
            if (!dataUrl) return;
            const response = await fetch(dataUrl);
            const blob = await response.blob();
            const item = new ClipboardItem({ [blob.type]: blob });
            await navigator.clipboard.write([item]);
            new Notice(t("MSG_COPY_SUCCESS"));
        } catch (error) {
            console.error("Failed to copy image:", error);
            new Notice(t("MSG_COPY_FAIL"));
        }
    }

    async copyImageAsBase64(context: ImageContextMenuContext): Promise<void> {
        const target = context.image;
        const ownerDocument = context.ownerDocument;
        const image = ownerDocument.createElement("img");
        image.crossOrigin = "anonymous";

        try {
            await loadImage(image, target.src);
            const dataUrl = this.renderImageDataUrl(ownerDocument, image);
            if (!dataUrl) return;
            await navigator.clipboard.writeText(`<img src="${dataUrl}"/>`);
            new Notice(t("MSG_COPY_BASE64_SUCCESS"));
        } catch (error) {
            console.error("Failed to copy image as Base64:", error);
            new Notice(t("MSG_COPY_BASE64_FAIL"));
        }
    }

    private renderImageDataUrl(
        ownerDocument: Document,
        image: HTMLImageElement
    ): string | null {
        const canvas = ownerDocument.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        if (!context) {
            new Notice(t("MSG_FAIL_GET_CANVAS"));
            return null;
        }
        context.drawImage(image, 0, 0);
        return canvas.toDataURL();
    }
}
