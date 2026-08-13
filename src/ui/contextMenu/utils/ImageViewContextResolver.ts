import type {
    App,
    Editor,
    MarkdownView,
    TFile,
    WorkspaceLeaf
} from 'obsidian';
import {
    type ImageLinkMatch,
    type ImageSourceIndex,
    RefinedImageUtils
} from '../../../utils/RefinedImageUtils';
import {
    getImageLayoutKey,
    getImageSourceKey
} from '../../../utils/MarkdownSourceContext';
import { isHttpUrl, isSameHttpUrl } from '../../../utils/NetworkPolicy';
import { collectUsableMarkdownViews } from '../../MarkdownViewRegistry';
import { imageSourceBindingRegistry } from '../../ImageSourceBindingRegistry';

export interface ImageViewContext {
    readonly view: MarkdownView;
    readonly file: TFile;
    readonly editor: Editor;
    readonly leaf?: WorkspaceLeaf;
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
        this.imageUtils = new RefinedImageUtils();
    }

    resolve(img: HTMLImageElement, preparedIndex?: ImageSourceIndex): ImageViewContext | null {
        const result = this.resolveDetailed(img, preparedIndex);
        return result.status === 'resolved' ? result.context : null;
    }

    resolveDetailed(
        img: HTMLImageElement,
        preparedIndex?: ImageSourceIndex,
        preparedOwner?: ImageViewOwnerContext | null
    ): ImageViewContextResolution {
        const owner = preparedOwner === undefined
            ? this.resolveOwner(img)
            : preparedOwner;
        if (!owner) return img.isConnected ? { status: 'pending' } : { status: 'absent' };

        const readingBinding = imageSourceBindingRegistry.getReading(img);
        if (readingBinding && readingBinding.sourcePath === owner.file.path) {
            let line: string;
            try {
                if (readingBinding.line < 0
                    || readingBinding.line >= owner.editor.lineCount()) {
                    return { status: 'pending' };
                }
                line = owner.editor.getLine(readingBinding.line);
            } catch {
                return { status: 'pending' };
            }
            if (line.slice(readingBinding.start, readingBinding.end)
                === readingBinding.descriptor.source) {
                return {
                    status: 'resolved',
                    context: Object.freeze({
                        ...owner,
                        match: Object.freeze({
                            linkText: readingBinding.descriptor.source,
                            line: readingBinding.line,
                            start: readingBinding.start,
                            end: readingBinding.end,
                            score: 4,
                            descriptor: readingBinding.descriptor,
                            sourceKey: readingBinding.sourceKey,
                            layoutKey: readingBinding.layoutKey
                        })
                    })
                };
            }
            return { status: 'pending' };
        }

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

    resolveWithUrlHint(
        img: HTMLImageElement,
        url: string,
        preparedOwner?: ImageViewOwnerContext | null
    ): ImageViewContextResolution {
        const owner = preparedOwner === undefined
            ? this.resolveOwner(img)
            : preparedOwner;
        const initial = this.resolveDetailed(img, undefined, owner);
        if (initial.status === 'resolved') return initial;
        if (!owner || !isHttpUrl(url)) return initial;

        const sourceIndex = this.prepareEditor(owner.editor);
        const matches = sourceIndex.descriptors.filter(descriptor =>
            isHttpUrl(descriptor.path) && isSameHttpUrl(descriptor.path, url)
        );
        if (matches.length !== 1) return { status: 'pending' };

        const descriptor = matches[0];
        const line = getLineForOffset(sourceIndex.lineStarts, descriptor.index);
        const start = descriptor.index - sourceIndex.lineStarts[line];
        const match: ImageLinkMatch = Object.freeze({
            linkText: descriptor.source,
            line,
            start,
            end: start + descriptor.source.length,
            score: 4,
            descriptor,
            sourceKey: getImageSourceKey(descriptor),
            layoutKey: getImageLayoutKey(descriptor)
        });
        img.setAttribute('data-image-assistant-source-key', match.sourceKey);
        return {
            status: 'resolved',
            context: Object.freeze({ ...owner, match })
        };
    }

    isContextCurrent(
        img: HTMLImageElement,
        context: ImageViewContext
    ): boolean {
        const { view, file, editor, match } = context;
        if (!img.isConnected
            || !view.contentEl.contains(img)
            || view.file?.path !== file.path
            || view.editor !== editor
            || typeof editor.lineCount !== 'function'
            || typeof editor.getLine !== 'function'
            || match.line < 0
            || match.line >= editor.lineCount()) {
            return false;
        }
        try {
            return editor.getLine(match.line).slice(match.start, match.end)
                === match.linkText;
        } catch {
            return false;
        }
    }

    resolveOwner(img: HTMLImageElement): ImageViewOwnerContext | null {
        const workspace = this.app?.workspace;
        if (!workspace) return null;
        const views = collectUsableMarkdownViews(this.app);

        const directOwner = views.find(view => view.contentEl.contains(img));
        if (directOwner) return this.toOwnerContext(directOwner);

        const readingBinding = imageSourceBindingRegistry.getReading(img);
        if (!readingBinding) return null;
        const boundViews = views.filter(view => view.file?.path === readingBinding.sourcePath);
        if (boundViews.length === 1) return this.toOwnerContext(boundViews[0]);

        return null;
    }

    /** Resolves non-image rendered media that remains inside a Markdown leaf. */
    resolveElementOwner(element: Element): ImageViewOwnerContext | null {
        if (!this.app?.workspace || !element.isConnected) return null;
        const view = collectUsableMarkdownViews(this.app)
            .find(candidate => candidate.contentEl.contains(element));
        return view ? this.toOwnerContext(view) : null;
    }

    private toOwnerContext(view: MarkdownView): ImageViewOwnerContext | null {
        const file = view.file;
        if (!file) return null;
        const leaf = (this.app.workspace.getLeavesOfType?.('markdown') ?? [])
            .find(candidate => candidate?.view === view);
        return Object.freeze({
            view,
            file,
            editor: view.editor,
            ...(leaf ? { leaf } : {})
        });
    }
}

function getLineForOffset(lineStarts: readonly number[], offset: number): number {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
        const middle = Math.floor((low + high) / 2);
        if (lineStarts[middle] <= offset) {
            low = middle + 1;
        } else {
            high = middle - 1;
        }
    }
    return Math.max(0, high);
}
