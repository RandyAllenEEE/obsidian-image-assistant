import { App, Notice } from 'obsidian';
import { t } from '../../../lang/helpers';
import ImageConverterPlugin from '../../../main';
import { ProcessSingleImageModal } from '../../modals/ProcessSingleImageModal';
import { Crop } from '../../Crop';
import { ImageAnnotationModal } from '../../ImageAnnotation';
import { CanvasEditCapabilityService } from '../../../utils/CanvasEditCapability';
import type { ImageContextMenuContext } from '../types';
import { isProtectedDrawingFile } from '../../../drawing/DrawingFileSemantics';

/**
 * Handles image processing operations (convert, crop, annotate)
 */
export class ProcessingHandler {
    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private readonly editCapabilities = new CanvasEditCapabilityService(plugin)
    ) { }

    canEditImage(context: ImageContextMenuContext): boolean {
        const file = context.localFile;
        return !!file && this.editCapabilities.peek(file.extension).encodable;
    }

    /**
     * Process/Convert/Compress image
     * @param img - The HTMLImageElement
     */
    async processImage(context: ImageContextMenuContext) {
        try {
            const file = context.localFile;
            if (!file) {
                new Notice(t("MSG_RESOLVE_PATH_FAIL"));
                return;
            }
            if (isProtectedDrawingFile(this.plugin, file)) {
                new Notice(t("NOTICE_DRAWING_PROTECTED"));
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
    async cropRotateFlip(context: ImageContextMenuContext) {
        const file = context.localFile;
        if (!file) {
            new Notice(t("MSG_RESOLVE_PATH_FAIL"));
            return;
        }
        if (isProtectedDrawingFile(this.plugin, file)) {
            new Notice(t("NOTICE_DRAWING_PROTECTED"));
            return;
        }
        const capability = await this.editCapabilities.get(
            file.extension,
            context.ownerDocument
        );
        if (!capability.decodable || !capability.encodable) {
            new Notice(t("MSG_IMAGE_EDITOR_FORMAT_UNSUPPORTED", [file.extension]));
            return;
        }

        new Crop(this.app, file, this.plugin, capability).open();
    }

    /**
     * Annotate image
     * @param img - The HTMLImageElement
     */
    async annotateImage(context: ImageContextMenuContext) {
        try {
            const file = context.localFile;
            if (!file) {
                new Notice(t("MSG_RESOLVE_PATH_FAIL"));
                return;
            }
            if (isProtectedDrawingFile(this.plugin, file)) {
                new Notice(t("NOTICE_DRAWING_PROTECTED"));
                return;
            }
            const capability = await this.editCapabilities.get(
                file.extension,
                context.ownerDocument
            );
            if (!capability.decodable || !capability.encodable) {
                new Notice(t("MSG_IMAGE_EDITOR_FORMAT_UNSUPPORTED", [file.extension]));
                return;
            }

            new ImageAnnotationModal(this.app, this.plugin, file, capability).open();
        } catch (error) {
            console.error('Image location error:', error);
            new Notice(t("MSG_RESOLVE_PATH_FAIL"));
        }
    }
}
