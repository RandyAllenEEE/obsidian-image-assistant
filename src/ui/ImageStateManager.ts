
import { App, editorLivePreviewField, MarkdownView } from 'obsidian';
import ImageConverterPlugin from '../main';
import { ImageAlignment } from './ImageAlignment';
import { ImageResizer } from './ImageResizer';
import { ImageCaption } from './ImageCaption';
import { pipeSyntaxParser, AlignType, PipeSyntaxData } from '../utils/PipeSyntaxParser';
import type { ReadingImageContext } from './caption/types';
import { isElementNode, isHtmlImageElement } from './caption/CaptionDomUtils';
import {
    ImageViewContextResolver,
    type ImageViewContext
} from './contextMenu/utils/ImageViewContextResolver';
import { resolveImageLayout } from './ImageLayoutResolver';
import {
    IMAGE_LAYOUT_KEY_ATTRIBUTE,
    IMAGE_SOURCE_KEY_ATTRIBUTE,
    type ImageSourceIndex
} from '../utils/RefinedImageUtils';
import {
    getImageLayoutKey,
    getImageSourceKey
} from '../utils/MarkdownSourceContext';
import { collectUsableMarkdownViews, getMarkdownViewMode } from './MarkdownViewRegistry';
import {
    LivePreviewImageLayoutCoordinator,
    type LivePreviewLayoutScope
} from './caption/LivePreviewImageLayoutCoordinator';
import {
    ImageDimensionRenderer,
    resolveImageDimensions
} from './ImageDimensions';
import {
    EditorRangeMutationTransaction,
    type EditorRangeMutationResult
} from '../utils/EditorRangeMutationTransaction';
import { t } from '../lang/helpers';

export interface ImageState {
    align: 'left' | 'center' | 'right' | 'left-wrap' | 'right-wrap' | 'none';
    wrap: boolean;
    pipeAlignment?: AlignType;
    standalone?: boolean;
    sourceKey?: string;
    layoutKey?: string;
    layoutScope?: LivePreviewLayoutScope;
    width?: number | null;
    height?: number | null;
    size?: PipeSyntaxData['size'];
    caption?: string;
}

export type ImageStateMutationStatus =
    | 'saved'
    | 'unchanged'
    | 'stale'
    | 'rolledBack'
    | 'uncertain'
    | 'failed';

export interface ImageStateMutationResult {
    readonly status: ImageStateMutationStatus;
    readonly complete: boolean;
    readonly error?: string;
}

type WorkspaceWithLayoutState = App['workspace'] & {
    layoutReady?: boolean;
};

export class ImageStateManager {
    private readonly observers = new Map<MarkdownView, MutationObserver>();
    private readonly layoutCoordinators = new Map<MarkdownView, LivePreviewImageLayoutCoordinator>();
    private readonly pendingImages = new Map<MarkdownView, Set<HTMLImageElement>>();
    private readonly scheduledViews = new Set<MarkdownView>();
    private viewContextResolver: ImageViewContextResolver;
    private readonly pendingTimers = new Set<ReturnType<typeof setTimeout>>();
    private unloaded = false;
    private initialized = false;
    private started = false;
    private readingLinkTexts = new WeakMap<HTMLImageElement, string>();
    private readingContexts = new WeakMap<HTMLImageElement, ReadingImageContext>();
    private pendingResolutionAttempts = new WeakMap<HTMLImageElement, number>();
    private readonly dimensions = new ImageDimensionRenderer();
    private readonly editorTransaction = new EditorRangeMutationTransaction();

    // Delegates
    public alignment: ImageAlignment;
    public resizer: ImageResizer | null;
    public caption: ImageCaption;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
    ) {
        this.viewContextResolver = new ImageViewContextResolver(this.app);

        // Initialize delegates
        // Dependencies are injected via initialize() to avoid circular references during plugin load.
    }

    public initialize(alignment: ImageAlignment, resizer: ImageResizer | null, caption: ImageCaption) {
        this.unloaded = false;
        this.alignment = alignment;
        this.resizer = resizer;
        this.caption = caption;
        this.initialized = true;
    }

    public start() {
        if (!this.initialized || this.started || this.unloaded) return;
        this.started = true;
        this.setupObserver();
    }

    private processingImages = new Set<HTMLImageElement>();

    private setupObserver() {
        this.syncObservers();

        this.plugin.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                const workspace = this.app.workspace as WorkspaceWithLayoutState;
                if (!workspace.layoutReady) return;

                this.syncObservers();
                this.refreshAllImages();
                this.scheduleAllLayouts(3);
            })
        );
        this.plugin.registerEvent(
            this.app.workspace.on('layout-change', () => {
                this.syncObservers();
                this.scheduleAllLayouts(2);
            })
        );
        this.plugin.registerEvent(
            this.app.workspace.on('window-open' as never, () => {
                this.syncObservers();
                this.scheduleAllLayouts(2);
            })
        );
        this.plugin.registerEvent(
            this.app.workspace.on('window-close' as never, () => {
                this.syncObservers();
                this.scheduleAllLayouts(2);
            })
        );
    }

    public handleLivePreviewEditorUpdate(
        editorDom: HTMLElement,
        update: { reconcileSource: boolean; geometryChanged: boolean }
    ): void {
        if (this.unloaded) return;
        const entry = [...this.layoutCoordinators.entries()].find(([view]) =>
            view.contentEl.contains(editorDom)
        );
        if (!entry) return;
        const [view, coordinator] = entry;
        if (update.geometryChanged) coordinator.schedule(3);
        if (!update.reconcileSource) return;

        const sourceIndex = this.viewContextResolver.prepareEditor(view.editor);
        coordinator.reconcileSourceKeys(new Set(
            sourceIndex.descriptors.map(getImageLayoutKey)
        ));

        this.queueImages(
            view,
            Array.from(view.contentEl.querySelectorAll('img')).filter(isHtmlImageElement)
        );
    }

    private syncObservers(): void {
        if (this.unloaded) return;

        const views = collectUsableMarkdownViews(this.app);
        const currentViews = new Set(views);

        for (const [view, observer] of this.observers) {
            if (!currentViews.has(view) || !this.isLivePreview(view)) {
                observer.disconnect();
                this.observers.delete(view);
                this.layoutCoordinators.get(view)?.destroy();
                this.layoutCoordinators.delete(view);
                this.pendingImages.delete(view);
                this.scheduledViews.delete(view);
                if (getMarkdownViewMode(view) !== 'preview') {
                    this.alignment?.cleanup(view.contentEl);
                    this.dimensions.cleanup(view.contentEl);
                    view.contentEl.querySelectorAll(`[${IMAGE_SOURCE_KEY_ATTRIBUTE}]`)
                        .forEach(element => element.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE));
                    view.contentEl.querySelectorAll(`[${IMAGE_LAYOUT_KEY_ATTRIBUTE}]`)
                        .forEach(element => element.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE));
                }
            }
        }

        for (const view of views) {
            if (!this.isLivePreview(view)) {
                if (getMarkdownViewMode(view) !== 'preview') {
                    this.alignment?.cleanup(view.contentEl);
                    this.dimensions.cleanup(view.contentEl);
                    view.contentEl.querySelectorAll(`[${IMAGE_SOURCE_KEY_ATTRIBUTE}]`)
                        .forEach(element => element.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE));
                    view.contentEl.querySelectorAll(`[${IMAGE_LAYOUT_KEY_ATTRIBUTE}]`)
                        .forEach(element => element.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE));
                }
                continue;
            }
            if (!this.observers.has(view)) {
                const Observer = view.contentEl.ownerDocument.defaultView?.MutationObserver
                    ?? MutationObserver;
                const observer = new Observer(mutations => this.collectMutatedImages(view, mutations));
                observer.observe(view.contentEl, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['src', 'alt']
                });
                this.observers.set(view, observer);

                // The editor can finish rendering before the manager starts or a
                // newly opened leaf is observed. Process that first DOM snapshot
                // through the same batched path used for later mutations.
                this.queueImages(
                    view,
                    Array.from(view.contentEl.querySelectorAll('img')).filter(isHtmlImageElement)
                );
            }
            if (!this.layoutCoordinators.has(view)) {
                this.layoutCoordinators.set(
                    view,
                    new LivePreviewImageLayoutCoordinator(view.contentEl)
                );
            }
        }
    }

    private collectMutatedImages(view: MarkdownView, mutations: MutationRecord[]): void {
        if (!this.isLivePreview(view)) return;
        const images = new Set<HTMLImageElement>();

        const addImage = (img: HTMLImageElement): void => {
            if (!this.processingImages.has(img) && !img.hasClass('is-resizing')) images.add(img);
        };

        for (const mutation of mutations) {
            if (isElementNode(mutation.target)
                && mutation.target.closest('[data-image-assistant-caption-renderer]')) {
                continue;
            }
            if (mutation.type === 'attributes' && isHtmlImageElement(mutation.target)) {
                addImage(mutation.target);
                continue;
            }
            if (mutation.type !== 'childList') continue;

            mutation.addedNodes.forEach(node => {
                if (isHtmlImageElement(node)) {
                    addImage(node);
                } else if (isElementNode(node)
                    && !node.hasAttribute('data-image-assistant-caption-renderer')) {
                    node.querySelectorAll('img').forEach(img => {
                        if (isHtmlImageElement(img)) addImage(img);
                    });
                }
            });
            mutation.removedNodes.forEach(node => {
                if (isHtmlImageElement(node)) {
                    this.layoutCoordinators.get(view)?.detachImage(node);
                } else if (isElementNode(node)) {
                    node.querySelectorAll('img').forEach(image => {
                        if (isHtmlImageElement(image)) {
                            this.layoutCoordinators.get(view)?.detachImage(image);
                        }
                    });
                }
            });
        }

        this.queueImages(view, images);
    }

    private queueImages(view: MarkdownView, candidates: Iterable<HTMLImageElement>): void {
        if (!this.isLivePreview(view) || this.unloaded) return;

        let images = this.pendingImages.get(view);
        if (!images) {
            images = new Set<HTMLImageElement>();
            this.pendingImages.set(view, images);
        }
        for (const image of candidates) {
            if (view.contentEl.contains(image)
                && !this.processingImages.has(image)
                && !image.hasClass('is-resizing')) {
                images.add(image);
            }
        }

        if (images.size === 0) {
            this.pendingImages.delete(view);
            return;
        }
        if (this.scheduledViews.has(view)) return;
        this.scheduledViews.add(view);
        queueMicrotask(() => {
            this.scheduledViews.delete(view);
            const queued = this.pendingImages.get(view);
            this.pendingImages.delete(view);
            if (!queued || !this.isLivePreview(view) || this.unloaded) return;
            const sourceIndex = this.viewContextResolver.prepareEditor(view.editor);
            queued.forEach(img => {
                if (view.contentEl.contains(img)) this.processImage(img, sourceIndex);
            });
        });
    }

    private isLivePreview(view: MarkdownView): boolean {
        if (getMarkdownViewMode(view) !== 'source') return false;
        const editorView = (view.editor as unknown as {
            cm?: { state?: { field(field: unknown, require?: boolean): unknown } };
        })?.cm;
        try {
            return editorView?.state?.field(editorLivePreviewField, false) === true;
        } catch {
            return false;
        }
    }

    public refreshAllImages = (): void => {
        if (this.unloaded) return;
        this.performRefreshAllImages();
    };

    private performRefreshAllImages(): void {
        // Extra safety check for layout readiness
        const workspace = this.app.workspace as WorkspaceWithLayoutState;
        if (workspace.layoutReady === false) return;

        const views = collectUsableMarkdownViews(this.app);

        for (const markdownView of views) {
            const mode = getMarkdownViewMode(markdownView);
            if (!mode) continue;
            const sourceIndex = mode !== 'preview' && this.isLivePreview(markdownView)
                ? this.viewContextResolver.prepareEditor(markdownView.editor)
                : undefined;
            const images = markdownView.contentEl?.findAll?.('img')
                ?? Array.from(markdownView.contentEl?.querySelectorAll?.('img') ?? []);
            images.forEach((img) => {
                if (isHtmlImageElement(img)) {
                    if (mode === 'preview') {
                        this.processReadingModeImage(img);
                    } else if (this.isLivePreview(markdownView)) {
                        this.processImage(img, sourceIndex);
                    } else {
                        this.alignment.clearImage(img);
                        this.dimensions.clearImage(img);
                        img.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE);
                        img.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE);
                        this.caption.removeImage?.(img);
                    }
                }
            });
        }
        this.syncObservers();
    }

    /**
     * Coordinator method: Gets state from markdown and calls delegates to apply it.
     */
    public processImage(img: HTMLImageElement, sourceIndex?: ImageSourceIndex) {
        if (!this.initialized) return;
        if (this.processingImages.has(img)) return;

        // 1. Check for conflicts
        if (img.hasClass('is-resizing')) return;

        try {
            this.processingImages.add(img);

            // 2. Get State
            const resolution = this.resolveImageState(img, sourceIndex);
            if (resolution.status === 'pending') {
                const owner = this.viewContextResolver.resolveOwner(img);
                if (owner) {
                    this.layoutCoordinators.get(owner.view)?.schedule(3);
                    const attempts = this.pendingResolutionAttempts.get(img) ?? 0;
                    if (attempts < 3) {
                        this.pendingResolutionAttempts.set(img, attempts + 1);
                        this.schedule(() => this.queueImages(owner.view, [img]), 16);
                    }
                }
                return;
            }
            this.pendingResolutionAttempts.delete(img);
            if (resolution.status === 'absent') {
                this.unregisterLivePreviewLayout(img);
                this.alignment.clearImage(img);
                this.dimensions.clearImage(img);
                img.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE);
                img.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE);
                this.caption.removeImage?.(img);
                return;
            }
            const state = resolution.state;

            const layout = resolveImageLayout(
                state.pipeAlignment ?? this.toPipeAlignment(state.align),
                this.plugin.settings.alignment,
                state.standalone ?? true
            );
            this.alignment.applyLayout(img, layout);
            this.dimensions.apply(img, resolveImageDimensions(state.size));

            if (state.layoutKey) {
                const owner = this.viewContextResolver.resolveOwner(img);
                if (owner) {
                    this.layoutCoordinators.get(owner.view)?.registerImage(img, state.layoutKey, {
                        standalone: state.standalone ?? true,
                        scope: state.layoutScope ?? 'root'
                    });
                }
            }

            // Live Preview captions are owned by the CodeMirror StateField.
            // Never write caption DOM into an editor managed by CodeMirror.
            this.caption.removeImage?.(img);
        } finally {
            // Short timeout to allow DOM updates to settle before re-enabling observer
            // This prevents immediate re-trigger by the very changes we just made
            this.schedule(() => {
                this.processingImages.delete(img);
            }, 0);
        }
    }

    /**
     * Specialized processor for Reading Mode (MarkdownPostProcessor).
     * Reads directly from parsed DOM attributes (alt text) instead of Editor lookup.
     */
    public processReadingModeImage(
        img: HTMLImageElement,
        context: ReadingImageContext = {}
    ) {
        if (!this.initialized) return;
        // 1. Check for conflicts
        if (img.hasClass('is-resizing')) return;

        const hasLinkText = Object.prototype.hasOwnProperty.call(context, 'linkText');
        const hasDescriptor = Object.prototype.hasOwnProperty.call(context, 'descriptor');
        if (hasLinkText) {
            if (context.linkText) this.readingLinkTexts.set(img, context.linkText);
            else this.readingLinkTexts.delete(img);
        }
        if (hasLinkText || hasDescriptor) {
            this.readingContexts.set(img, context);
        }
        const retainedContext = this.readingContexts.get(img) ?? {};
        const linkText = hasLinkText
            ? context.linkText ?? null
            : retainedContext.linkText ?? this.readingLinkTexts.get(img) ?? null;
        const descriptor = hasDescriptor
            ? context.descriptor ?? null
            : retainedContext.descriptor ?? null;
        if (descriptor) {
            img.setAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE, getImageSourceKey(descriptor));
            img.setAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE, getImageLayoutKey(descriptor));
        }

        // Reading Mode DOM attributes can lose Wiki pipe fields. Prefer the
        // exact source link supplied by CaptionRenderCoordinator, then retain
        // the old alt-based fallback for raw HTML and transclusions.
        const parsed = descriptor?.pipeData ?? (linkText
            ? pipeSyntaxParser.parsePipeSyntax(linkText, { attributeMode: 'display' })
            : null)
            ?? pipeSyntaxParser.parsePipeAttributes(img.getAttribute('alt') || '', true, 'display');
        if (!parsed) {
            this.alignment.clearImage(img);
            this.dimensions.clearImage(img);
            this.caption.removeImage?.(img);
            return;
        }

        const standalone = descriptor?.standalone ?? this.isStandaloneDomImage(img);
        const state = this.mapPipeDataToState(parsed, standalone);
        const layout = resolveImageLayout(
            state.pipeAlignment,
            this.plugin.settings.alignment,
            standalone
        );
        this.alignment.applyLayout(img, layout);
        this.dimensions.apply(img, resolveImageDimensions(state.size));

        this.caption.renderImage(img, linkText
            ? { linkText, ...(descriptor ? { descriptor } : {}) }
            : { captionText: state.caption ?? '', ...(descriptor ? { descriptor } : {}) });
    }

    /**
     * Helper to map raw PipeSyntaxData to ImageState
     */
    private mapPipeDataToState(
        parsed: Pick<PipeSyntaxData, 'align' | 'size' | 'alt'>,
        standalone = true
    ): ImageState {
        let align: ImageState['align'] = 'none';
        let wrap = false;

        if (parsed.align) {
            const baseAlign = parsed.align.includes('left') ? 'left'
                : parsed.align.includes('right') ? 'right'
                    : parsed.align.includes('center') ? 'center'
                        : 'none';

            wrap = parsed.align.includes('wrap');

            // Combine base and wrap into single align value for UI
            if (baseAlign !== 'none' && baseAlign !== 'center' && wrap) {
                align = `${baseAlign}-wrap` as ImageState['align'];
            } else {
                align = baseAlign;
            }
        }

        return {
            align,
            wrap,
            pipeAlignment: parsed.align ?? null,
            standalone,
            width: parsed.size?.width,
            height: parsed.size?.height,
            size: parsed.size ? { ...parsed.size } : undefined,
            caption: parsed.alt ? parsed.alt.replace(/\\\|/g, '|') : undefined
        };
    }

    /**
     * Reads the current state of the image from the Markdown source.
     */
    public getImageState(img: HTMLImageElement, sourceIndex?: ImageSourceIndex): ImageState | null {
        const resolution = this.resolveImageState(img, sourceIndex);
        return resolution.status === 'resolved' ? resolution.state : null;
    }

    private resolveImageState(
        img: HTMLImageElement,
        sourceIndex?: ImageSourceIndex
    ): { status: 'resolved'; state: ImageState } | { status: 'pending' } | { status: 'absent' } {
        const resolution = this.viewContextResolver.resolveDetailed(img, sourceIndex);
        if (resolution.status !== 'resolved') return resolution;
        const context = resolution.context;
        const linkText = context.match.linkText;

        const parsed = context.match.descriptor.pipeData
            ?? pipeSyntaxParser.parsePipeSyntax(linkText, { attributeMode: 'display' });
        if (!parsed) return { status: 'absent' };

        if (img.getAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE) !== context.match.sourceKey) {
            img.setAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE, context.match.sourceKey);
        }
        if (img.getAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE) !== context.match.layoutKey) {
            img.setAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE, context.match.layoutKey);
        }
        return { status: 'resolved', state: {
            ...this.mapPipeDataToState(parsed, context.match.descriptor.standalone),
            sourceKey: context.match.sourceKey,
            layoutKey: context.match.layoutKey,
            layoutScope: context.match.descriptor.layoutScope
        } };
    }

    /**
     * The Central Writer. Updates the markdown file with new state.
     */
    public async updateState(
        img: HTMLImageElement,
        changes: Partial<ImageState>,
        expectedContext?: Pick<ImageViewContext, 'view' | 'file' | 'editor'> & {
            readonly sourceKey?: string | null;
        }
    ): Promise<ImageStateMutationResult> {
        const context = this.viewContextResolver.resolve(img);
        if (!context || !this.matchesExpectedContext(context, expectedContext)) {
            return mutationResult('stale');
        }
        const { match: linkMatch } = context;
        const linkText = linkMatch.linkText;
        const hasSizeChanges = changes.width !== undefined || changes.height !== undefined;
        const hasNonSizeChanges = changes.align !== undefined
            || changes.wrap !== undefined
            || changes.caption !== undefined;

        // Resize and size-only property edits must preserve the user's exact
        // PipeSyntax order, escaping, title, and extension-owned attributes.
        // Rebuilding the complete link is only safe when another property is
        // deliberately being edited as part of the same transaction.
        if (hasSizeChanges && !hasNonSizeChanges) {
            const sizePatch = pipeSyntaxParser.updateSizePreservingSyntax(linkText, {
                ...(changes.width === undefined ? {} : { width: changes.width }),
                ...(changes.height === undefined ? {} : { height: changes.height })
            });
            if (sizePatch.status === 'ambiguous') {
                return mutationResult(
                    'failed',
                    t('MSG_RESIZE_PIPE_AMBIGUOUS')
                );
            }
            if (sizePatch.status === 'invalid') {
                return mutationResult(
                    'failed',
                    t('MSG_RESIZE_PIPE_INVALID')
                );
            }
            return this.writeUpdatedLinkText(context, img, expectedContext, sizePatch.linkText);
        }

        const parsed = pipeSyntaxParser.parsePipeSyntax(linkText);
        if (!parsed) return mutationResult('failed', 'Image link could not be parsed');

        // Merge Changes
        // 1. Align & Wrap
        if (changes.align !== undefined || changes.wrap !== undefined) {
            let newAlignStr = changes.align ?? 'none';

            // If align is 'none', no alignment attribute needed
            if (newAlignStr === 'none') {
                parsed.align = null;
            } else {
                // For combined values like 'left-wrap', use directly
                // For simple values like 'left', check if wrap should be appended
                if (!newAlignStr.includes('wrap') && changes.wrap === true) {
                    newAlignStr = `${newAlignStr}-wrap` as typeof newAlignStr;
                }
                parsed.align = newAlignStr as AlignType;
            }
        }

        // 2. Size
        if (changes.width !== undefined || changes.height !== undefined) {
            const width = changes.width !== undefined
                ? (changes.width === null ? undefined : changes.width)
                : parsed.size?.width;
            const height = changes.height !== undefined
                ? (changes.height === null ? undefined : changes.height)
                : parsed.size?.height;

            if (width || height) {
                parsed.size = {
                    width,
                    height,
                    format: width && height ? 'WxH' : width ? 'W' : 'xH'
                };
            } else {
                parsed.size = undefined;
            }
        }

        // 3. Caption
        if (changes.caption !== undefined) {
            // Escape pipes to prevent breaking the pipe syntax
            parsed.alt = changes.caption.replace(/\|/g, '\\|');
        }

        // Rebuild and write deliberate multi-property edits.
        const newLinkText = pipeSyntaxParser.buildPipeSyntax(parsed);

        return this.writeUpdatedLinkText(context, img, expectedContext, newLinkText);
    }

    private async writeUpdatedLinkText(
        context: ImageViewContext,
        img: HTMLImageElement,
        expectedContext: (Pick<ImageViewContext, 'view' | 'file' | 'editor'> & {
            readonly sourceKey?: string | null;
        }) | undefined,
        newLinkText: string
    ): Promise<ImageStateMutationResult> {
        const { view, editor, match: linkMatch } = context;
        const linkText = linkMatch.linkText;
        if (linkText === newLinkText) return mutationResult('unchanged');
        if (this.unloaded
            || !view.contentEl.contains(img)
            || !this.matchesExpectedContext(context, expectedContext)) {
            return mutationResult('stale');
        }

        const result = await this.editorTransaction.run(
            {
                view,
                editor,
                file: context.file
            },
            {
                line: linkMatch.line,
                start: linkMatch.start,
                end: linkMatch.end,
                expectedText: linkText,
                replacement: newLinkText
            }
        );
        return mapEditorMutationResult(result);
    }

    private matchesExpectedContext(
        context: ImageViewContext,
        expected?: Pick<ImageViewContext, 'view' | 'file' | 'editor'> & {
            readonly sourceKey?: string | null;
        }
    ): boolean {
        if (!expected) return true;
        return expected.view === context.view
            && expected.editor === context.editor
            && expected.file.path === context.file.path
            && (!expected.sourceKey
                || expected.sourceKey === context.match.sourceKey);
    }

    public onunload() {
        this.unloaded = true;
        this.initialized = false;
        this.started = false;
        for (const [view, observer] of this.observers) {
            observer.disconnect();
            this.alignment?.cleanup(view.contentEl);
            this.dimensions.cleanup(view.contentEl);
            view.contentEl.querySelectorAll(`[${IMAGE_SOURCE_KEY_ATTRIBUTE}]`)
                .forEach(element => element.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE));
            view.contentEl.querySelectorAll(`[${IMAGE_LAYOUT_KEY_ATTRIBUTE}]`)
                .forEach(element => element.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE));
        }
        for (const leaf of this.app.workspace?.getLeavesOfType?.('markdown') ?? []) {
            const contentEl = (leaf.view as MarkdownView)?.contentEl;
            if (!contentEl) continue;
            this.alignment?.cleanup(contentEl);
            this.dimensions.cleanup(contentEl);
            contentEl.querySelectorAll(`[${IMAGE_SOURCE_KEY_ATTRIBUTE}]`)
                .forEach(element => element.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE));
            contentEl.querySelectorAll(`[${IMAGE_LAYOUT_KEY_ATTRIBUTE}]`)
                .forEach(element => element.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE));
        }
        this.observers.clear();
        this.layoutCoordinators.forEach(coordinator => coordinator.destroy());
        this.layoutCoordinators.clear();
        this.pendingImages.clear();
        this.scheduledViews.clear();
        for (const timer of this.pendingTimers) clearTimeout(timer);
        this.pendingTimers.clear();
        this.processingImages.clear();
        this.readingLinkTexts = new WeakMap<HTMLImageElement, string>();
        this.readingContexts = new WeakMap<HTMLImageElement, ReadingImageContext>();
        this.pendingResolutionAttempts = new WeakMap<HTMLImageElement, number>();
    }

    private toPipeAlignment(align: ImageState['align']): AlignType {
        return align === 'none' ? null : align;
    }

    private isStandaloneDomImage(img: HTMLImageElement): boolean {
        const host = img.closest('.image-wrapper, .image-embed, .external-embed') ?? img;
        const parent = host.parentElement;
        if (!parent) return true;
        return Array.from(parent.childNodes).every(node =>
            node === host
            || node.nodeType === 3 && !node.textContent?.trim()
            || isElementNode(node)
                && node.getAttribute('data-image-assistant-caption-renderer') === 'dom'
        );
    }

    private unregisterLivePreviewLayout(img: HTMLImageElement): void {
        const owner = this.viewContextResolver.resolveOwner(img);
        if (owner) this.layoutCoordinators.get(owner.view)?.unregisterImage(img);
    }

    private scheduleAllLayouts(settleFrames: number): void {
        this.layoutCoordinators.forEach(coordinator => coordinator.schedule(settleFrames));
    }

    private schedule(callback: () => void, delay: number): void {
        const timer = setTimeout(() => {
            this.pendingTimers.delete(timer);
            callback();
        }, delay);
        this.pendingTimers.add(timer);
    }
}

function mapEditorMutationResult(
    result: EditorRangeMutationResult
): ImageStateMutationResult {
    if (result.saved) return mutationResult('saved');
    if (result.stale) return mutationResult('stale', result.error);
    if (result.uncertain) return mutationResult('uncertain', result.error);
    if (result.rolledBack && result.rollbackSaved) {
        return mutationResult('rolledBack', result.error);
    }
    return mutationResult('failed', result.error);
}

function mutationResult(
    status: ImageStateMutationStatus,
    error?: string
): ImageStateMutationResult {
    return Object.freeze({
        status,
        complete: status === 'saved' || status === 'unchanged',
        ...(error ? { error } : {})
    });
}
