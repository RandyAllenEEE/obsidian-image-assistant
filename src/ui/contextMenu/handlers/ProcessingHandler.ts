import { App, Notice, TFile } from 'obsidian';
import { t } from '../../../lang/helpers';
import ImageConverterPlugin from '../../../main';
import { ProcessSingleImageModal } from '../../modals/ProcessSingleImageModal';
import { Crop } from '../../Crop';
import { ImageAnnotationModal } from '../../ImageAnnotation';
import { FolderAndFilenameManagement } from '../../../local/FolderAndFilenameManagement';
import { isHttpUrl } from '../../../utils/NetworkPolicy';
import { getCanvasExportMime } from '../../../utils/CanvasImageOutput';

/**
 * Handles image processing operations (convert, crop, annotate)
 */
export class ProcessingHandler {
    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private folderManagement: FolderAndFilenameManagement
    ) { }

    private resolveLocalImageFile(img: HTMLImageElement): TFile | null {
        const imagePath = this.folderManagement.getImagePath(img);
        if (!imagePath || isHttpUrl(imagePath)) {
            return null;
        }

        const file = this.app.vault.getAbstractFileByPath(imagePath);
        return file instanceof TFile ? file : null;
    }

    canEditImage(img: HTMLImageElement): boolean {
        const file = this.resolveLocalImageFile(img);
        return !!file && !!getCanvasExportMime(file.extension);
    }

    /**
     * Process/Convert/Compress image
     * @param img - The HTMLImageElement
     */
    async processImage(img: HTMLImageElement) {
        try {
            const file = this.resolveLocalImageFile(img);
            if (!file) {
                new Notice(t("MSG_RESOLVE_PATH_FAIL"));
                return;
            }

            // Process the found file
            new ProcessSingleImageModal(this.app, this.plugin, file).open();

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
        const file = this.resolveLocalImageFile(img);
        if (!file) {
            new Notice(t("MSG_RESOLVE_PATH_FAIL"));
            return;
        }
        if (!getCanvasExportMime(file.extension)) {
            new Notice(t("MSG_IMAGE_EDITOR_FORMAT_UNSUPPORTED", [file.extension]));
            return;
        }

        new Crop(this.app, file).open();
    }

    /**
     * Annotate image
     * @param img - The HTMLImageElement
     */
    async annotateImage(img: HTMLImageElement) {
        try {
            const file = this.resolveLocalImageFile(img);
            if (!file) {
                new Notice(t("MSG_RESOLVE_PATH_FAIL"));
                return;
            }
            if (!getCanvasExportMime(file.extension)) {
                new Notice(t("MSG_IMAGE_EDITOR_FORMAT_UNSUPPORTED", [file.extension]));
                return;
            }

            new ImageAnnotationModal(this.app, this.plugin, file).open();
        } catch (error) {
            console.error('Image location error:', error);
            new Notice(t("MSG_RESOLVE_PATH_FAIL"));
        }
    }
}
