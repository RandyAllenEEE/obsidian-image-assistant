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

/** Resolves an image against the Markdown leaf that actually owns its DOM. */
export class ImageViewContextResolver {
    private readonly imageUtils: RefinedImageUtils;

    constructor(private readonly app: App) {
        this.imageUtils = new RefinedImageUtils(app);
    }

    resolve(img: HTMLImageElement, preparedIndex?: ImageSourceIndex): ImageViewContext | null {
        const owner = this.resolveOwner(img);
        if (!owner) return null;

        const match = this.imageUtils.getImageLinkMatchFromEditor(
            img,
            owner.editor,
            owner.view.contentEl,
            preparedIndex
        );
        if (!match) return null;

        return Object.freeze({
            ...owner,
            match: Object.freeze({ ...match })
        });
    }

    prepareEditor(editor: Editor): ImageSourceIndex {
        return this.imageUtils.getImageSourceIndex(editor);
    }

    resolveOwner(img: HTMLImageElement): ImageViewOwnerContext | null {
        const views = collectUsableMarkdownViews(this.app);
        const activeView = this.app.workspace.getActiveViewOfType?.(MarkdownView);
        if (isUsableMarkdownView(activeView) && !views.includes(activeView)) views.push(activeView);

        const hasEnumeratedLeaves = views.length > 0 && !(views.length === 1 && views[0] === activeView
            && (this.app.workspace.getLeavesOfType?.('markdown') ?? []).length === 0);
        for (const view of views) {
            const ownsImage = view?.contentEl?.contains(img) || (!hasEnumeratedLeaves && view === activeView);
            const file = view.file ?? (!hasEnumeratedLeaves ? this.app.workspace.getActiveFile?.() : null);
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
