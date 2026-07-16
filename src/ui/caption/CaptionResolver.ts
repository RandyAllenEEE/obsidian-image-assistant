import {
    AlignType,
    PipeSyntaxData,
    pipeSyntaxParser,
    SizeData
} from '../../utils/PipeSyntaxParser';
import type { ImageSourceDescriptor } from '../../utils/MarkdownSourceContext';

export interface CaptionResolverOptions {
    enabled?: boolean;
    skipExtensions?: string;
}

export interface CaptionImageContext extends CaptionResolverOptions {
    linkText?: string | null;
    captionText?: string | null;
}

export interface ResolvedCaptionState {
    path: string;
    caption: string | null;
    align: AlignType;
    size?: SizeData;
    linkType: 'wiki' | 'markdown';
    shouldRender: boolean;
}

export class CaptionResolver {
    public resolveFromLinkText(linkText: string, options: CaptionResolverOptions = {}): ResolvedCaptionState | null {
        const parsed = pipeSyntaxParser.parsePipeSyntax(linkText, { attributeMode: 'display' });
        if (!parsed) {
            return null;
        }

        return this.resolveFromParsedData(parsed, options);
    }

    public resolveFromDescriptor(
        descriptor: ImageSourceDescriptor,
        options: CaptionResolverOptions = {}
    ): ResolvedCaptionState | null {
        return descriptor.pipeData
            ? this.resolveFromParsedData(descriptor.pipeData, options)
            : this.resolveFromLinkText(descriptor.source, options);
    }

    public resolveFromImage(img: HTMLImageElement, context: CaptionImageContext = {}): ResolvedCaptionState {
        if (context.linkText) {
            const fromLink = this.resolveFromLinkText(context.linkText, context);
            if (fromLink) {
                return fromLink;
            }
        }

        const container = this.findMetadataContainer(img);
        const path = this.resolvePath(img, container);
        let rawCaption = context.captionText
            ?? img.getAttribute('alt')
            ?? container?.getAttribute('alt')
            ?? '';
        if (rawCaption.endsWith('\\') && img.closest('table, .table-cell-wrapper, .cm-table-widget')) {
            rawCaption = rawCaption.slice(0, -1);
        }
        const parsed = pipeSyntaxParser.parseAltText(rawCaption, 'display');

        return this.resolveFromParsedData({
            ...parsed,
            path,
            linkType: 'markdown'
        }, context);
    }

    private resolveFromParsedData(
        data: PipeSyntaxData,
        options: CaptionResolverOptions
    ): ResolvedCaptionState {
        const enabled = options.enabled ?? true;
        const normalizedCaption = this.normalizeCaption(data.alt, data.path);
        const skipped = this.isSkippedExtension(data.path, options.skipExtensions);
        const caption = enabled && !skipped ? normalizedCaption : null;

        return {
            path: data.path,
            caption,
            align: data.align ?? null,
            size: data.size,
            linkType: data.linkType,
            shouldRender: !!caption
        };
    }

    private normalizeCaption(
        rawCaption: string | undefined,
        path: string
    ): string | null {
        const caption = (rawCaption ?? '').replace(/\\\|/g, '|').trim();

        if (!caption || caption === ' ') {
            return null;
        }

        const fileName = this.getCleanFileName(path);
        if (fileName && caption.toLowerCase() === fileName.toLowerCase()) {
            return null;
        }

        if (this.looksLikeImageFileName(caption)) {
            return null;
        }

        return caption;
    }

    private isSkippedExtension(path: string, skipExtensions?: string): boolean {
        const extension = this.getExtension(path);
        if (!extension) {
            return false;
        }

        return (skipExtensions ?? '')
            .split(',')
            .map(ext => ext.trim().toLowerCase())
            .filter(Boolean)
            .includes(extension);
    }

    private findMetadataContainer(img: HTMLImageElement): HTMLElement | null {
        return img.closest(
            '.image-resize-container, .image-wrapper, .internal-embed.image-embed, .external-embed, .cm-embed-block'
        ) as HTMLElement | null;
    }

    private resolvePath(img: HTMLImageElement, container: HTMLElement | null): string {
        return container?.getAttribute('src')
            ?? container?.getAttribute('data-src')
            ?? img.getAttribute('src')
            ?? '';
    }

    private getExtension(path: string): string {
        const cleanPath = this.stripQueryAndHash(path);
        const lastSegment = cleanPath.split(/[\\/]/).pop() ?? '';
        const dotIndex = lastSegment.lastIndexOf('.');
        return dotIndex === -1 ? '' : lastSegment.slice(dotIndex + 1).toLowerCase();
    }

    private getCleanFileName(path: string): string | null {
        if (!path) {
            return null;
        }

        const cleanPath = this.stripQueryAndHash(path);
        const fileName = cleanPath.split(/[\\/]/).pop() || cleanPath;
        try {
            return decodeURIComponent(fileName);
        } catch {
            return fileName;
        }
    }

    private stripQueryAndHash(path: string): string {
        return path.split('#')[0].split('?')[0];
    }

    private looksLikeImageFileName(text: string): boolean {
        return /\.(png|jpe?g|gif|webp|svg|bmp|tiff?|avif|heic|heif|ico)$/i.test(text);
    }
}
