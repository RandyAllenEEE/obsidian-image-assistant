import { Notice } from "obsidian";
import { t } from "../../../lang/helpers";
import { loadImage } from "../../../utils/ImageLoadUtils";
import type { ImageContextMenuContext } from "../types";

/** Handles clipboard operations against an already resolved image context. */
export class ClipboardHandler {
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
