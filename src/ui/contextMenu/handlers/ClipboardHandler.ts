import { App, MarkdownView, Notice, Component } from 'obsidian';
import { t } from '../../../lang/helpers';
import { FolderAndFilenameManagement } from '../../../local/FolderAndFilenameManagement';
import { ImageMatchFinder } from '../utils/ImageMatchFinder';
import { EditorLinkRemover } from '../utils/EditorLinkRemover';
import { ConfirmDialog } from '../../../settings/SettingsModals';

/**
 * Handles clipboard operations for images (copy, cut, base64)
 */
export class ClipboardHandler extends Component {
    constructor(
        private app: App,
        private folderManagement: FolderAndFilenameManagement,
        private imageMatchFinder: ImageMatchFinder,
        private linkRemover: EditorLinkRemover
    ) {
        super();
    }

    /**
     * Cuts the image and its link from the note, copying the link to clipboard.
     * @param event - The MouseEvent object.
     */
    async cutImageAndLink(event: MouseEvent) {
        const img = event.target as HTMLImageElement;
        const src = img.getAttribute('src');
        if (!src) return;

        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
            new Notice(t("MSG_NO_ACTIVE_VIEW"));
            return;
        }

        try {
            const { editor } = activeView;

            if (src.startsWith('data:image/')) {
                const found = await this.imageMatchFinder.processBase64Image(editor, src, async (editor, lineNumber, line, fullMatch) => {
                    await this.linkRemover.removeImageLink(editor, lineNumber, line, fullMatch, true);
                });
                if (!found) {
                    new Notice(t("MSG_FAIL_BASE64_LINK"));
                }
                return;
            }

            const imagePath = (src.startsWith('http://') || src.startsWith('https://'))
                ? null
                : this.folderManagement.getImagePath(img);

            const isExternal = !imagePath;

            // Use the modified findImageMatches
            const matches = await this.imageMatchFinder.findImageMatches(editor, imagePath, isExternal);

            if (matches.length === 0) {
                new Notice(t("MSG_LINK_NOT_FOUND"));
                return;
            }

            const handleConfirmation = async () => {
                for (const match of matches) {
                    await this.linkRemover.removeImageLink(editor, match.lineNumber, match.line, match.fullMatch, true);
                }
                new Notice(t("MSG_CUT_COPIED"));
            };

            if (matches.length > 1) {
                // Show confirmation modal
                new ConfirmDialog(
                    this.app,
                    t("DIALOG_CUT_TITLE"),
                    t("DIALOG_CUT_MSG", [matches.length.toString()]),
                    t("BUTTON_CUT"),
                    async () => { // Callback for confirmation
                        for (const match of matches) {
                            await this.linkRemover.removeImageLink(editor, match.lineNumber, match.line, match.fullMatch, true);
                        }
                        new Notice(t("MSG_CUT_COPIED"));
                    }
                ).open();
            } else {
                // Proceed directly if only one match
                await handleConfirmation();
            }

        } catch (error) {
            console.error('Error cutting image:', error);
            new Notice(t("MSG_FAIL_CUT"));
        }
    }

    /**
     * Copies the image to the clipboard.
     * @param event - The MouseEvent object.
     */
    async copyImage(event: MouseEvent) {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        const targetImg = event.target as HTMLImageElement;

        // Use this.registerDomEvent() for proper cleanup
        this.registerDomEvent(img, 'load', async () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    new Notice(t("MSG_FAIL_GET_CANVAS"));
                    return;
                }
                ctx.drawImage(img, 0, 0);
                const dataURL = canvas.toDataURL();
                const response = await fetch(dataURL);
                const blob = await response.blob();
                const item = new ClipboardItem({ [blob.type]: blob });
                await navigator.clipboard.write([item]);
                new Notice(t("MSG_COPY_SUCCESS"));
            } catch (error) {
                console.error('Failed to copy image:', error);
                new Notice(t("MSG_COPY_FAIL"));
            }
        });

        img.src = targetImg.src;
    }

    /**
     * Copies the image as a Base64 encoded string to the clipboard.
     * @param event - The MouseEvent object.
     */
    async copyImageAsBase64(event: MouseEvent) {
        const targetImg = event.target as HTMLImageElement;
        const img = new Image();
        img.crossOrigin = 'anonymous';

        this.registerDomEvent(img, 'load', async () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = img.naturalWidth;
                canvas.height = img.naturalHeight;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    new Notice(t("MSG_FAIL_GET_CANVAS"));
                    return;
                }
                ctx.drawImage(img, 0, 0);
                const dataURL = canvas.toDataURL();
                await navigator.clipboard.writeText(`<img src="${dataURL}"/>`);
                new Notice(t("MSG_COPY_BASE64_SUCCESS"));
            } catch (error) {
                console.error('Failed to copy image as Base64:', error);
                new Notice(t("MSG_COPY_BASE64_FAIL"));
            }
        });

        img.src = targetImg.src;
    }
}
