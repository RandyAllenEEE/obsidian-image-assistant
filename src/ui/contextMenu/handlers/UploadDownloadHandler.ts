import { App, Notice, TFile } from 'obsidian';
import { t } from '../../../lang/helpers';
import ImageConverterPlugin from '../../../main';
import { FolderAndFilenameManagement } from '../../../local/FolderAndFilenameManagement';
import { getErrorMessage } from '../../../utils/ErrorUtils';
import { ImageViewContextResolver } from '../utils/ImageViewContextResolver';
import { ImageReferenceReplacer } from '../../../utils/ImageReferenceReplacer';
import { getAllImageLinks } from '../../../utils/RegexPatterns';
import {
    inferLocalReferenceSyntax,
    LocalImageTargetResolver
} from '../../../utils/LocalImageTargetResolver';
import { isHttpUrl } from '../../../utils/NetworkPolicy';

/**
 * Handles upload and download operations for images
 */
export class UploadDownloadHandler {
    private readonly viewContextResolver: ImageViewContextResolver;
    private readonly localTargetResolver: LocalImageTargetResolver;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        _folderManagement: FolderAndFilenameManagement,
        viewContextResolver?: ImageViewContextResolver
    ) {
        this.viewContextResolver = viewContextResolver ?? new ImageViewContextResolver(app);
        this.localTargetResolver = new LocalImageTargetResolver(app);
    }

    /**
     * Upload a local image to cloud storage
     * 上传本地图片到图床
     * @param img - The HTMLImageElement
     */
    async uploadImageToCloud(img: HTMLImageElement) {
        try {
            const context = this.viewContextResolver.resolve(img);
            if (!context) {
                new Notice(t("MSG_IMAGE_CONTEXT_UNRESOLVED"));
                return;
            }
            const imagePath = context.match.descriptor?.path
                ?? getAllImageLinks(context.match.linkText)[0]?.path
                ?? "";
            const resolution = this.localTargetResolver.resolve(imagePath, context.file, {
                syntax: inferLocalReferenceSyntax(context.match.linkText)
            });
            const file = resolution.file;
            if (resolution.status !== "resolved" || !(file instanceof TFile)) {
                new Notice(t("MSG_FILE_NOT_FOUND"));
                console.warn('[Upload] File not found:', imagePath);
                return;
            }

            await this.plugin.cloudImageHandler.uploadSingleFile(file);
        } catch (error) {
            console.error('[Upload] Error uploading image:', error);
            new Notice(t("MSG_UPLOAD_FAILED", [getErrorMessage(error)]));
        }
    }

    /**
     * Download a network image to local storage
     * 下载网络图片到本地
     * @param img - The HTMLImageElement
     */
    async downloadNetworkImage(img: HTMLImageElement) {
        try {
            const context = this.viewContextResolver.resolve(img);
            if (!context) {
                new Notice(t("MSG_IMAGE_CONTEXT_UNRESOLVED"));
                return;
            }
            const descriptorUrl = context.match.descriptor?.path
                ?? getAllImageLinks(context.match.linkText)[0]?.path;
            const src = isHttpUrl(descriptorUrl ?? "")
                ? descriptorUrl!
                : img.getAttribute('src');
            if (!src || !isHttpUrl(src)) {
                new Notice(t("MSG_RESOLVE_PATH_FAIL"));
                return;
            }

            const result = await this.plugin.cloudImageHandler.downloadSingleImageFile(src, context.file);
            try {
                if (!result.success || !result.vaultPath) {
                    new Notice(t("MSG_DOWNLOAD_FAILED", [result.error ?? "Unknown error"]));
                    return;
                }

                const currentLine = context.editor.getLine(context.match.line);
                if (currentLine.slice(context.match.start, context.match.end) !== context.match.linkText) {
                    new Notice(t("MSG_DOWNLOAD_REFERENCE_CHANGED", [result.vaultPath]));
                    return;
                }
                const replacement = new ImageReferenceReplacer(
                    this.app,
                    this.plugin.vaultReferenceManager,
                    () => this.plugin.settings.localProcessing.link
                ).serializeReference(context.match.linkText, result.vaultPath, context.file);
                if (replacement === context.match.linkText) {
                    new Notice(t("MSG_DOWNLOAD_REFERENCE_CHANGED", [result.vaultPath]));
                    return;
                }

                context.editor.replaceRange(
                    replacement,
                    { line: context.match.line, ch: context.match.start },
                    { line: context.match.line, ch: context.match.end }
                );
                await context.view.save();
                this.plugin.imageStateManager?.refreshAllImages();
                this.plugin.imageCaption?.refreshAllViews();
                new Notice(t("MSG_DOWNLOAD_SUCCESS"));
            } finally {
                this.plugin.cloudImageHandler.discardDownloadUndo(result);
            }
        } catch (error) {
            console.error('[Download] Error downloading network image:', error);
            new Notice(t("MSG_DOWNLOAD_FAILED", [getErrorMessage(error)]));
        }
    }
}
