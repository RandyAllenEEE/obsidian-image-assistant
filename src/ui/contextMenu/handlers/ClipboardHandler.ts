import { App, Notice, Component } from 'obsidian';
import { t } from '../../../lang/helpers';
import { FolderAndFilenameManagement } from '../../../local/FolderAndFilenameManagement';
import { ImageMatchFinder } from '../utils/ImageMatchFinder';
import { EditorLinkRemover } from '../utils/EditorLinkRemover';
import { ConfirmDialog } from '../../../settings/SettingsModals';
import { loadImage } from '../../../utils/ImageLoadUtils';
import { isHttpUrl } from '../../../utils/NetworkPolicy';
import { ImageViewContextResolver } from '../utils/ImageViewContextResolver';

/**
 * Handles clipboard operations for images (copy, cut, base64)
 */
export class ClipboardHandler extends Component {
    private readonly viewContextResolver: ImageViewContextResolver;

    constructor(
        private app: App,
        private folderManagement: FolderAndFilenameManagement,
        private imageMatchFinder: ImageMatchFinder,
        private linkRemover: EditorLinkRemover,
        viewContextResolver?: ImageViewContextResolver
    ) {
        super();
        this.viewContextResolver = viewContextResolver ?? new ImageViewContextResolver(app);
    }

    /**
     * Cuts the image and its link from the note, copying the link to clipboard.
     * @param event - The MouseEvent object.
     */
    async cutImageAndLink(event: MouseEvent, targetImage?: HTMLImageElement) {
        const img = targetImage ?? (event.target as HTMLImageElement | null);
        const src = img?.getAttribute?.('src');
        if (!img || !src) return;

        try {
            if (src.startsWith('data:image/')) {
                const owner = this.viewContextResolver.resolveOwner(img);
                if (!owner) {
                    new Notice(t("MSG_IMAGE_CONTEXT_UNRESOLVED"));
                    return;
                }
                const found = await this.imageMatchFinder.processBase64Image(owner.editor, src, async (editor, lineNumber, line, fullMatch) => {
                    await this.linkRemover.removeImageLink(editor, lineNumber, line, fullMatch, true);
                });
                if (!found) {
                    new Notice(t("MSG_FAIL_BASE64_LINK"));
                }
                return;
            }

            const context = this.viewContextResolver.resolve(img);
            if (!context) {
                new Notice(t("MSG_IMAGE_CONTEXT_UNRESOLVED"));
                return;
            }

            await this.linkRemover.removeImageLink(
                context.editor,
                context.match.line,
                context.editor.getLine(context.match.line),
                context.match.linkText,
                true,
                context.match.start
            );
            new Notice(t("MSG_CUT_COPIED"));

        } catch (error) {
            console.error('Error cutting image:', error);
            new Notice(t("MSG_FAIL_CUT"));
        }
    }

    /**
     * Copies the image to the clipboard.
     * @param event - The MouseEvent object.
     */
    async copyImage(event: MouseEvent, targetImage?: HTMLImageElement) {
        const targetImg = targetImage ?? (event.target as HTMLImageElement);
        const ownerDocument = targetImg.ownerDocument ?? document;
        const ImageCtor = ownerDocument.defaultView?.Image ?? Image;
        const img = new ImageCtor();
        img.crossOrigin = 'anonymous';

        try {
            await loadImage(img, targetImg.src);
            const dataUrl = this.renderImageDataUrl(ownerDocument, img);
            if (!dataUrl) return;

            const response = await fetch(dataUrl);
            const blob = await response.blob();
            const item = new ClipboardItem({ [blob.type]: blob });
            await navigator.clipboard.write([item]);
            new Notice(t("MSG_COPY_SUCCESS"));
        } catch (error) {
            console.error('Failed to copy image:', error);
            new Notice(t("MSG_COPY_FAIL"));
        }
    }

    /**
     * Copies the image as a Base64 encoded string to the clipboard.
     * @param event - The MouseEvent object.
     */
    async copyImageAsBase64(event: MouseEvent, targetImage?: HTMLImageElement) {
        const targetImg = targetImage ?? (event.target as HTMLImageElement);
        const ownerDocument = targetImg.ownerDocument ?? document;
        const ImageCtor = ownerDocument.defaultView?.Image ?? Image;
        const img = new ImageCtor();
        img.crossOrigin = 'anonymous';

        try {
            await loadImage(img, targetImg.src);
            const dataUrl = this.renderImageDataUrl(ownerDocument, img);
            if (!dataUrl) return;

            await navigator.clipboard.writeText(`<img src="${dataUrl}"/>`);
            new Notice(t("MSG_COPY_BASE64_SUCCESS"));
        } catch (error) {
            console.error('Failed to copy image as Base64:', error);
            new Notice(t("MSG_COPY_BASE64_FAIL"));
        }
    }

    async cutAllMatchingImageLinks(img: HTMLImageElement): Promise<void> {
        const context = this.viewContextResolver.resolve(img);
        const src = img.getAttribute('src');
        if (!context || !src) {
            new Notice(t("MSG_IMAGE_CONTEXT_UNRESOLVED"));
            return;
        }

        const isNetworkImage = isHttpUrl(src);
        const imagePath = isNetworkImage ? src : this.folderManagement.getImagePath(img);
        const matches = await this.imageMatchFinder.findImageMatches(
            context.editor,
            imagePath,
            isNetworkImage || !imagePath,
            context.file
        );
        if (matches.length < 2) {
            new Notice(t("MSG_NO_DUPLICATE_IMAGE_LINKS"));
            return;
        }

        new ConfirmDialog(
            this.app,
            t("DIALOG_CUT_ALL_TITLE"),
            t("DIALOG_CUT_ALL_MSG", [matches.length.toString()]),
            t("BUTTON_CUT_ALL", [matches.length.toString()]),
            async () => {
                const clipboardText = [...matches]
                    .sort((a, b) => a.lineNumber - b.lineNumber || a.index - b.index)
                    .map(match => match.fullMatch)
                    .join('\n');
                await navigator.clipboard.writeText(clipboardText);
                for (const match of sortMatchesForRemoval(matches)) {
                    await this.linkRemover.removeImageLink(
                        context.editor,
                        match.lineNumber,
                        context.editor.getLine(match.lineNumber),
                        match.fullMatch,
                        false,
                        match.index
                    );
                }
                new Notice(t("MSG_CUT_ALL_COPIED", [matches.length.toString()]));
            }
        ).open();
    }

    private renderImageDataUrl(ownerDocument: Document, image: HTMLImageElement): string | null {
        const canvas = ownerDocument.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        if (!context) {
            new Notice(t("MSG_FAIL_GET_CANVAS"));
            return null;
        }

        context.drawImage(image, 0, 0);
        return canvas.toDataURL();
    }
}

function sortMatchesForRemoval<T extends { lineNumber: number; index?: number }>(matches: T[]): T[] {
    return [...matches].sort((a, b) => {
        if (a.lineNumber !== b.lineNumber) {
            return b.lineNumber - a.lineNumber;
        }
        return (b.index ?? -1) - (a.index ?? -1);
    });
}
