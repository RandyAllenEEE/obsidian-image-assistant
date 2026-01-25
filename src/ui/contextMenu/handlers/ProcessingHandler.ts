import { App, MarkdownView, Notice, TFile } from 'obsidian';
import { t } from '../../../lang/helpers';
import ImageConverterPlugin from '../../../main';
import { ProcessSingleImageModal } from '../../modals/ProcessSingleImageModal';
import { Crop } from '../../Crop';
import { ImageAnnotationModal } from '../../ImageAnnotation';

/**
 * Handles image processing operations (convert, crop, annotate)
 */
export class ProcessingHandler {
    constructor(
        private app: App,
        private plugin: ImageConverterPlugin
    ) { }

    /**
     * Process/Convert/Compress image
     * @param img - The HTMLImageElement
     */
    async processImage(img: HTMLImageElement) {
        try {
            // Ensure there is an active markdown view
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView) {
                new Notice(t("MSG_NO_ACTIVE_VIEW"));
                return;
            }

            // Get the current note being viewed
            const currentFile = activeView.file;
            if (!currentFile) {
                new Notice(t("MSG_NO_CURRENT_FILE"));
                return;
            }

            // Extract the filename from the img's src attribute
            const srcAttribute = img.getAttribute("src");
            if (!srcAttribute) {
                new Notice(t("MSG_NO_SOURCE_ATTR"));
                return;
            }

            // Decode the filename from the src attribute
            const filename = decodeURIComponent(srcAttribute.split("?")[0].split("/").pop() || "");
            if (!filename) {
                new Notice(t("MSG_NO_FILENAME"));
                return;
            }

            // Search for matching files in the vault
            const matchingFiles = this.app.vault.getFiles().filter((file) => file.name === filename);
            if (matchingFiles.length === 0) {
                console.error("No matching files found for:", filename);
                new Notice(t("MSG_NO_MATCHING_FILES", [filename]));
                return;
            }

            // If multiple matches, prefer files in the same folder as the current note
            const file =
                matchingFiles.length === 1
                    ? matchingFiles[0]
                    : matchingFiles.find((fileItem) => {
                        const parentPath = currentFile.parent?.path;
                        return parentPath ? fileItem.path.startsWith(parentPath) : false;
                    }) || matchingFiles[0];

            // Process the found file
            if (file instanceof TFile) {
                new ProcessSingleImageModal(this.app, this.plugin, file).open();
            } else {
                new Notice(t("MSG_NOT_IMAGE_FILE"));
            }

        } catch (error) {
            console.error("Error processing image:", error);
            new Notice(t("MSG_PROCESS_ERROR"));
        }
    }

    /**
     * Crop/Rotate/Flip image
     * @param img - The HTMLImageElement
     */
    async cropRotateFlip(img: HTMLImageElement) {
        // Get the active markdown view
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
            new Notice(t("MSG_NO_ACTIVE_VIEW"));
            return;
        }

        // Get the current file (note) being viewed
        const currentFile = activeView.file;
        if (!currentFile) {
            new Notice(t("MSG_NO_CURRENT_FILE"));
            return;
        }

        // Get the filename from the src attribute
        const srcAttribute = img.getAttribute('src');
        if (!srcAttribute) {
            new Notice(t("MSG_NO_SOURCE_ATTR"));
            return;
        }

        // Extract just the filename
        const filename = decodeURIComponent(srcAttribute.split('?')[0].split('/').pop() || '');

        // Search for the file in the vault
        const matchingFiles = this.app.vault.getFiles().filter(file =>
            file.name === filename
        );

        if (matchingFiles.length === 0) {
            console.error('No matching files found for:', filename);
            new Notice(t("MSG_NO_MATCHING_FILES", [filename]));
            return;
        }

        // If multiple matches, try to find the one in the same folder as the current note
        const file = matchingFiles.length === 1
            ? matchingFiles[0]
            : matchingFiles.find((fileItem) => {
                // Get the parent folder of the current file
                const parentPath = currentFile.parent?.path;
                return parentPath
                    ? fileItem.path.startsWith(parentPath)
                    : false;
            }) || matchingFiles[0];

        if (file instanceof TFile) {
            new Crop(this.app, file).open();
        } else {
            new Notice(t("MSG_VISUAL_LOCATE_ERROR"));
        }
    }

    /**
     * Annotate image
     * @param img - The HTMLImageElement
     */
    async annotateImage(img: HTMLImageElement) {
        try {
            // Get the active markdown view
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!activeView) {
                new Notice(t("MSG_NO_ACTIVE_VIEW"));
                return;
            }

            // Get the current file (note) being viewed
            const currentFile = activeView.file;
            if (!currentFile) {
                new Notice(t("MSG_NO_CURRENT_FILE"));
                return;
            }

            // Get the filename from the src attribute
            const srcAttribute = img.getAttribute('src');
            if (!srcAttribute) {
                new Notice(t("MSG_NO_SOURCE_ATTR"));
                return;
            }

            // Extract just the filename
            const filename = decodeURIComponent(srcAttribute.split('?')[0].split('/').pop() || '');

            // Search for the file in the vault
            const matchingFiles = this.app.vault.getFiles().filter(file =>
                file.name === filename
            );

            if (matchingFiles.length === 0) {
                console.error('No matching files found for:', filename);
                new Notice(t("MSG_NO_MATCHING_FILES", [filename]));
                return;
            }

            // If multiple matches, try to find the one in the same folder as the current note
            const file = matchingFiles.length === 1
                ? matchingFiles[0]
                : matchingFiles.find((fileItem) => {
                    // Get the parent folder of the current file
                    const parentPath = currentFile.parent?.path;
                    return parentPath
                        ? fileItem.path.startsWith(parentPath)
                        : false;
                }) || matchingFiles[0];

            if (file instanceof TFile) {
                new ImageAnnotationModal(this.app, this.plugin, file).open();
            } else {
                new Notice(t("MSG_VISUAL_LOCATE_ERROR"));
            }
        } catch (error) {
            console.error('Image location error:', error);
            new Notice(t("MSG_RESOLVE_PATH_FAIL"));
        }
    }
}
