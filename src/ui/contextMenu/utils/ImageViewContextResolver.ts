import { App, Editor, MarkdownView, TFile } from 'obsidian';
import {
    ImageLinkMatch,
    type ImageSourceIndex,
    RefinedImageUtils
} from '../../../utils/RefinedImageUtils';
import { collectUsableMarkdownViews, isUsableMarkdownView } from '../../MarkdownViewRegistry';

export interface ImageViewContext {
    readonly view: MarkdownView;
    readonly file: TFile;
    readonly editor: Editor;
    readonly match: ImageLinkMatch;
}

export type ImageViewOwnerContext = Omit<ImageViewContext, 'match'>;

export type ImageViewContextResolution =
    | { status: 'resolved'; context: ImageViewContext }
    | { status: 'pending' }
    | { status: 'absent' };

/** Resolves an image against the Markdown leaf that actually owns its DOM. */
export class ImageViewContextResolver {
    private readonly imageUtils: RefinedImageUtils;

    constructor(private readonly app: App) {
        this.imageUtils = new RefinedImageUtils(app);
    }

    resolve(img: HTMLImageElement, preparedIndex?: ImageSourceIndex): ImageViewContext | null {
        const result = this.resolveDetailed(img, preparedIndex);
        return result.status === 'resolved' ? result.context : null;
    }

    resolveDetailed(
        img: HTMLImageElement,
        preparedIndex?: ImageSourceIndex
    ): ImageViewContextResolution {
        const owner = this.resolveOwner(img);
        if (!owner) return img.isConnected ? { status: 'pending' } : { status: 'absent' };

        const resolution = this.imageUtils.resolveImageLinkFromEditor(
            img,
            owner.editor,
            owner.view.contentEl,
            preparedIndex
        );
        if (resolution.status !== 'resolved') return resolution;

        return { status: 'resolved', context: Object.freeze({
            ...owner,
            match: Object.freeze({ ...resolution.match })
        }) };
    }

    prepareEditor(editor: Editor): ImageSourceIndex {
        return this.imageUtils.getImageSourceIndex(editor);
    }

    resolveOwner(img: HTMLImageElement): ImageViewOwnerContext | null {
        const workspace = this.app?.workspace;
        if (!workspace) return null;
        const views = collectUsableMarkdownViews(this.app);
        const activeView = workspace.getActiveViewOfType?.(MarkdownView);
        if (isUsableMarkdownView(activeView) && !views.includes(activeView)) views.push(activeView);

        const hasEnumeratedLeaves = views.length > 0 && !(views.length === 1 && views[0] === activeView
            && (workspace.getLeavesOfType?.('markdown') ?? []).length === 0);
        for (const view of views) {
            const ownsImage = view?.contentEl?.contains(img) || (!hasEnumeratedLeaves && view === activeView);
            const file = view.file ?? (!hasEnumeratedLeaves ? workspace.getActiveFile?.() : null);
            if (!ownsImage || !view.editor || !file) {
                continue;
            }

            return Object.freeze({
                view,
                file,
                editor: view.editor
            });
        }

        return null;
    }
}
