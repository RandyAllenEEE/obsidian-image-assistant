
import { App, editorLivePreviewField, MarkdownView } from 'obsidian';
import ImageConverterPlugin from '../main';
import { ImageAlignment } from './ImageAlignment';
import { ImageCaption } from './ImageCaption';
import { pipeSyntaxParser, AlignType, PipeSyntaxData } from '../utils/PipeSyntaxParser';
import type { ReadingImageContext } from './caption/types';
import { isElementNode, isHtmlImageElement } from './caption/CaptionDomUtils';
import { ImageViewContextResolver } from './contextMenu/utils/ImageViewContextResolver';
import {
    resolveImageLayout,
    type ResolvedImageLayout
} from './ImageLayoutResolver';
import {
    IMAGE_LAYOUT_KEY_ATTRIBUTE,
    IMAGE_SOURCE_KEY_ATTRIBUTE,
    type ImageSourceIndex
} from '../utils/RefinedImageUtils';
import {
    getImageLayoutKey,
    getImageSourceKey,
    type ImageSourceDescriptor
} from '../utils/MarkdownSourceContext';
import { collectUsableMarkdownViews, getMarkdownViewMode } from './MarkdownViewRegistry';
import {
    LivePreviewImageLayoutCoordinator,
    type LivePreviewLayoutScope
} from './caption/LivePreviewImageLayoutCoordinator';
import { resolveEditorView } from '../utils/EditorViewResolver';
import {
    collectExcalidrawRenderedEmbeds,
    findExcalidrawRenderedEmbed,
    getExcalidrawRenderedAlignment,
    type ExcalidrawRenderedEmbed
} from '../drawing/excalidraw/ExcalidrawRenderedEmbed';
import {
    isStandaloneRenderedMediaTarget,
    resolveRenderedMediaLayoutTarget,
    type RenderedMediaLayoutTarget
} from './RenderedMediaLayoutTarget';

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

type ImageStateResolution =
    | { status: 'resolved'; state: ImageState }
    | { status: 'pending' }
    | { status: 'absent' };

interface MeasuredImageState {
    readonly image: HTMLImageElement;
    readonly resolution: ImageStateResolution;
}

interface ExcalidrawSourceLayout {
    readonly standalone: boolean;
    readonly alignment?: AlignType;
    /** Present only when the rendered marker maps to one unambiguous source link. */
    readonly descriptor?: ImageSourceDescriptor;
    readonly view: MarkdownView;
}

type WorkspaceWithLayoutState = App['workspace'] & {
    layoutReady?: boolean;
};

export class ImageStateManager {
    private readonly observers = new Map<MarkdownView, MutationObserver>();
    private readonly layoutCoordinators = new Map<MarkdownView, LivePreviewImageLayoutCoordinator>();
    private readonly pendingImages = new Map<MarkdownView, Set<HTMLImageElement>>();
    private readonly scheduledViews = new Set<MarkdownView>();
    private readonly measureKeys = new WeakMap<MarkdownView, object>();
    private viewContextResolver: ImageViewContextResolver;
    private readonly pendingTimers = new Set<ReturnType<typeof setTimeout>>();
    private unloaded = false;
    private initialized = false;
    private started = false;
    private readingLinkTexts = new WeakMap<HTMLImageElement, string>();
    private readingContexts = new WeakMap<HTMLImageElement, ReadingImageContext>();
    // Delegates
    public alignment: ImageAlignment;
    public caption: ImageCaption;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
    ) {
        this.viewContextResolver = new ImageViewContextResolver(this.app);

        // Initialize delegates
        // Dependencies are injected via initialize() to avoid circular references during plugin load.
    }

    public initialize(alignment: ImageAlignment, caption: ImageCaption) {
        this.unloaded = false;
        this.alignment = alignment;
        this.caption = caption;
        this.initialized = true;
    }

    public start() {
        if (!this.initialized || this.started || this.unloaded) return;
        this.started = true;
        this.setupObserver();
        // Community plugins may start after Obsidian has already rendered the
        // active Markdown leaf. Reconcile that existing DOM immediately instead
        // of waiting for a future file-open, postprocessor, or leaf change.
        // Live Preview already queues its first snapshot in syncObservers(); this
        // startup pass deliberately covers Reading Mode only to avoid duplicate
        // editor measurements.
        this.reconcileExistingReadingViews();
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
        update: {
            reconcileSource: boolean;
            geometryChanged: boolean;
            modeChanged?: boolean;
        }
    ): void {
        if (this.unloaded) return;
        let entry = [...this.layoutCoordinators.entries()].find(([view]) =>
            view.contentEl.contains(editorDom)
        );
        // A Reading <-> Live Preview transition keeps the same workspace leaf.
        // Reconcile ownership on that uncommon boundary (or when no coordinator
        // exists), while keeping ordinary CodeMirror updates on the fast path.
        if (update.modeChanged || !entry) {
            this.syncObservers();
            entry = [...this.layoutCoordinators.entries()].find(([view]) =>
                view.contentEl.contains(editorDom)
            );
        }
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
            if (!currentViews.has(view)) {
                observer.disconnect();
                this.observers.delete(view);
                this.layoutCoordinators.get(view)?.destroy();
                this.layoutCoordinators.delete(view);
                this.pendingImages.delete(view);
                this.scheduledViews.delete(view);
                this.alignment?.cleanup(view.contentEl);
                view.contentEl.querySelectorAll(`[${IMAGE_SOURCE_KEY_ATTRIBUTE}]`)
                    .forEach(element => element.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE));
                view.contentEl.querySelectorAll(`[${IMAGE_LAYOUT_KEY_ATTRIBUTE}]`)
                    .forEach(element => element.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE));
            }
        }

        for (const view of views) {
            const livePreview = this.isLivePreview(view);
            if (!livePreview) {
                this.layoutCoordinators.get(view)?.destroy();
                this.layoutCoordinators.delete(view);
                this.pendingImages.delete(view);
                this.scheduledViews.delete(view);
                if (getMarkdownViewMode(view) !== 'preview') {
                    this.alignment?.cleanup(view.contentEl);
                    view.contentEl.querySelectorAll(`[${IMAGE_SOURCE_KEY_ATTRIBUTE}]`)
                        .forEach(element => element.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE));
                    view.contentEl.querySelectorAll(`[${IMAGE_LAYOUT_KEY_ATTRIBUTE}]`)
                        .forEach(element => element.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE));
                }
            } else if (!this.layoutCoordinators.has(view)) {
                this.layoutCoordinators.set(
                    view,
                    new LivePreviewImageLayoutCoordinator(view.contentEl)
                );
            }
            if (!this.observers.has(view)) {
                const Observer = view.contentEl.ownerDocument.defaultView?.MutationObserver
                    ?? MutationObserver;
                const observer = new Observer(mutations => this.collectMutatedMedia(view, mutations));
                observer.observe(view.contentEl, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: [
                        'src', 'width', 'height',
                        'filesource', 'fileSource'
                    ]
                });
                this.observers.set(view, observer);
            }
            if (livePreview) {
                this.queueImages(
                    view,
                    Array.from(view.contentEl.querySelectorAll('img')).filter(isHtmlImageElement)
                );
            }
            this.processExcalidrawEmbeds(view.contentEl);
        }
    }

    private processExcalidrawEmbeds(root: ParentNode): void {
        for (const embed of collectExcalidrawRenderedEmbeds(root)) {
            const target = resolveRenderedMediaLayoutTarget(embed.element);
            if (!target || target.kind !== 'excalidraw-source') continue;
            const sourceLayout = this.resolveExcalidrawSourceLayout(embed);
            const standalone = sourceLayout?.standalone
                ?? isStandaloneRenderedMediaTarget(target);
            const layout = resolveImageLayout(
                getExcalidrawRenderedAlignment(embed.element)
                    ?? sourceLayout?.alignment,
                this.plugin.settings.alignment,
                standalone
            );
            this.alignment.applyLayoutTarget(target, layout);
            this.registerLivePreviewExcalidrawTarget(target, sourceLayout, layout);
        }
    }

    /**
     * CodeMirror can place a block embed directly under `.cm-content`, where
     * DOM siblings are unrelated source lines. Reuse the canonical Markdown
     * descriptors to determine whether the source link owns its line; only
     * fall back to DOM structure when a source descriptor cannot be resolved.
     */
    private resolveExcalidrawSourceLayout(
        embed: ExcalidrawRenderedEmbed
    ): ExcalidrawSourceLayout | null {
        const owner = this.viewContextResolver.resolveElementOwner(embed.element);
        if (!owner) return null;

        const renderedPath = normalizeRenderedSourcePath(embed.fileSource);
        if (!renderedPath) return null;
        const matches = this.viewContextResolver.prepareEditor(owner.editor)
            .descriptors
            .filter(descriptor => this.matchesRenderedSourcePath(
                descriptor.path,
                renderedPath,
                owner.file.path
            ));
        if (matches.length === 0) return null;

        const firstAlignment = matches[0]?.pipeData?.align ?? undefined;
        const hasUniformAlignment = matches.every(descriptor =>
            (descriptor.pipeData?.align ?? undefined) === firstAlignment
        );
        return {
            standalone: matches.every(descriptor => descriptor.standalone),
            ...(hasUniformAlignment && firstAlignment
                ? { alignment: firstAlignment }
                : {}),
            ...(matches.length === 1 ? { descriptor: matches[0] } : {}),
            view: owner.view
        };
    }

    /**
     * CodeMirror captions are separate widgets, so bind them to the actual
     * Excalidraw SVG/IMG surface only when one source link owns that marker.
     * Ambiguous repeated embeds intentionally fall back to normal widget flow
     * rather than guessing and attaching a caption to the wrong drawing.
     */
    private registerLivePreviewExcalidrawTarget(
        target: NonNullable<ReturnType<typeof resolveRenderedMediaLayoutTarget>>,
        sourceLayout: ExcalidrawSourceLayout | null,
        layout: ResolvedImageLayout
    ): void {
        const descriptor = sourceLayout?.descriptor;
        if (!descriptor || !this.isLivePreview(sourceLayout.view)) return;
        const coordinator = this.layoutCoordinators.get(sourceLayout.view);
        if (!coordinator) return;

        const layoutKey = getImageLayoutKey(descriptor);
        const sourceKey = getImageSourceKey(descriptor);
        if (!isStableLivePreviewTarget(target, {
            viewRoot: sourceLayout.view.contentEl,
            sourceKey,
            layoutKey
        })) return;
        // External renderer surfaces (SVG/IMG) remain wholly owned by
        // Excalidraw. Source identity belongs on our semantic HTML host; the
        // coordinator owns the layout key on the safe placement boundary.
        if (target.owner.getAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE) !== sourceKey) {
            target.owner.setAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE, sourceKey);
        }
        coordinator.registerTarget(target, layoutKey, {
            standalone: descriptor.standalone,
            scope: descriptor.layoutScope,
            alignment: layout.alignment,
            wrap: layout.wrap
        });
    }

    private matchesRenderedSourcePath(
        descriptorPath: string,
        renderedPath: string,
        sourcePath: string
    ): boolean {
        const normalizedDescriptor = normalizeRenderedSourcePath(descriptorPath);
        if (areEquivalentRenderedPaths(normalizedDescriptor, renderedPath)) return true;

        try {
            const resolved = this.app.metadataCache?.getFirstLinkpathDest?.(
                descriptorPath,
                sourcePath
            );
            return !!resolved && areEquivalentRenderedPaths(
                normalizeRenderedSourcePath(resolved.path),
                renderedPath
            );
        } catch {
            return false;
        }
    }

    private collectMutatedMedia(view: MarkdownView, mutations: MutationRecord[]): void {
        const livePreview = this.isLivePreview(view);
        const images = new Set<HTMLImageElement>();

        const addImage = (img: HTMLImageElement): void => {
            if (!isCodeMirrorWidgetBuffer(img)
                && !this.processingImages.has(img)) {
                images.add(img);
            }
        };

        for (const mutation of mutations) {
            if (isElementNode(mutation.target)
                && mutation.target.closest('[data-image-assistant-caption-renderer]')) {
                continue;
            }
            if (mutation.type === 'attributes' && isHtmlImageElement(mutation.target)) {
                if (livePreview) addImage(mutation.target);
                if (findExcalidrawRenderedEmbed(mutation.target)) {
                    this.processExcalidrawEmbeds(mutation.target);
                }
                continue;
            }
            if (mutation.type === 'attributes' && isElementNode(mutation.target)) {
                this.processExcalidrawEmbeds(mutation.target);
                continue;
            }
            if (mutation.type !== 'childList') continue;

            mutation.addedNodes.forEach(node => {
                if (isHtmlImageElement(node)) {
                    if (livePreview) addImage(node);
                    if (findExcalidrawRenderedEmbed(node)) this.processExcalidrawEmbeds(node);
                } else if (isElementNode(node)
                    && !node.hasAttribute('data-image-assistant-caption-renderer')) {
                    if (livePreview) {
                        node.querySelectorAll('img').forEach(img => {
                            if (isHtmlImageElement(img)) addImage(img);
                        });
                    }
                    this.processExcalidrawEmbeds(node);
                }
            });
            mutation.removedNodes.forEach(node => {
                if (isElementNode(node)) {
                    this.layoutCoordinators.get(view)?.detachSubtree(node);
                }
            });
        }

        if (livePreview) this.queueImages(view, images);
    }

    private queueImages(
        view: MarkdownView,
        candidates: Iterable<HTMLImageElement>
    ): void {
        if (!this.isLivePreview(view) || this.unloaded) return;

        let images = this.pendingImages.get(view);
        if (!images) {
            images = new Set<HTMLImageElement>();
            this.pendingImages.set(view, images);
        }
        for (const image of candidates) {
            const connected = view.contentEl.contains(image)
                && !isCodeMirrorWidgetBuffer(image)
                && !findExcalidrawRenderedEmbed(image);
            if (connected && !this.processingImages.has(image)) images.add(image);
        }

        if (images.size === 0) {
            this.pendingImages.delete(view);
            return;
        }
        if (this.scheduledViews.has(view)) return;
        this.scheduledViews.add(view);
        const editorView = resolveEditorView(view.editor, view);
        if (editorView?.requestMeasure) {
            editorView.requestMeasure<MeasuredImageState[] | null>({
                key: this.getMeasureKey(view),
                read: () => this.measureQueuedImages(view),
                write: measurements => this.applyMeasuredImages(view, measurements)
            });
            return;
        }

        const ownerWindow = view.contentEl.ownerDocument.defaultView;
        const run = () => this.applyMeasuredImages(view, this.measureQueuedImages(view));
        if (ownerWindow?.requestAnimationFrame) {
            ownerWindow.requestAnimationFrame(run);
        } else {
            this.schedule(run, 16);
        }
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

    public refreshFiles(paths: ReadonlySet<string>): void {
        if (this.unloaded || paths.size === 0) return;
        this.performRefreshAllImages(paths);
    }

    private reconcileExistingReadingViews(): void {
        const workspace = this.app?.workspace as WorkspaceWithLayoutState | undefined;
        if (workspace?.layoutReady === false) return;

        for (const view of collectUsableMarkdownViews(this.app)) {
            if (getMarkdownViewMode(view) !== 'preview') continue;
            const images = view.contentEl?.findAll?.('img')
                ?? Array.from(view.contentEl?.querySelectorAll?.('img') ?? []);
            for (const image of images) {
                if (isHtmlImageElement(image)) this.processReadingModeImage(image);
            }
        }
    }

    private performRefreshAllImages(paths?: ReadonlySet<string>): void {
        // Extra safety check for layout readiness
        const workspace = this.app.workspace as WorkspaceWithLayoutState;
        if (workspace.layoutReady === false) return;
        this.syncObservers();

        const views = collectUsableMarkdownViews(this.app)
            .filter(view => !paths || (view.file && paths.has(view.file.path)));

        for (const markdownView of views) {
            const mode = getMarkdownViewMode(markdownView);
            if (!mode) continue;
            const images = markdownView.contentEl?.findAll?.('img')
                ?? Array.from(markdownView.contentEl?.querySelectorAll?.('img') ?? []);
            images.forEach((img) => {
                if (isHtmlImageElement(img)) {
                    if (findExcalidrawRenderedEmbed(img)) {
                        if (mode === 'preview') {
                            this.processReadingModeImage(img);
                        } else {
                            this.processExcalidrawEmbeds(img);
                        }
                        return;
                    }
                    if (mode === 'preview') {
                        this.processReadingModeImage(img);
                    } else if (this.isLivePreview(markdownView)) {
                        this.queueImages(markdownView, [img]);
                    } else {
                        this.alignment.clearImage(img);
                        img.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE);
                        img.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE);
                        this.caption.removeImage?.(img);
                    }
                }
            });
            this.processExcalidrawEmbeds(markdownView.contentEl);
        }
    }

    /**
     * Coordinator method: Gets state from markdown and calls delegates to apply it.
     */
    public processImage(img: HTMLImageElement, sourceIndex?: ImageSourceIndex) {
        if (!this.initialized) return;
        if (findExcalidrawRenderedEmbed(img)) {
            this.processExcalidrawEmbeds(img);
            return;
        }
        if (this.processingImages.has(img)) return;

        try {
            this.processingImages.add(img);
            const resolution = this.resolveImageState(img, sourceIndex);
            this.applyImageResolution(img, resolution);
        } finally {
            // Plugin-owned layout attributes and styles are deliberately not
            // observed, so the guard only needs to cover this synchronous pass.
            this.processingImages.delete(img);
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
        if (findExcalidrawRenderedEmbed(img)) {
            this.processExcalidrawEmbeds(img);
            this.caption.renderImage(img, {
                ...context,
                document: img.ownerDocument
            });
            return;
        }

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
            const sourceKey = getImageSourceKey(descriptor);
            const layoutKey = getImageLayoutKey(descriptor);
            if (img.getAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE) !== sourceKey) {
                img.setAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE, sourceKey);
            }
            if (img.getAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE) !== layoutKey) {
                img.setAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE, layoutKey);
            }
        }

        // Reading Mode DOM attributes can lose Wiki pipe fields. Prefer the
        // exact source link supplied by CaptionRenderCoordinator, then retain
        // the old alt-based fallback for raw HTML and transclusions.
        const parsed = descriptor?.pipeData ?? (linkText
            ? pipeSyntaxParser.parsePipeSyntax(linkText, { attributeMode: 'display' })
            : null)
            ?? pipeSyntaxParser.parsePipeAttributes(img.getAttribute('alt') || '', 'display');
        if (!parsed) {
            this.alignment.clearImage(img);
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

        this.caption.renderImage(img, linkText
            ? { linkText, ...(descriptor ? { descriptor } : {}) }
            : { captionText: state.caption ?? '', ...(descriptor ? { descriptor } : {}) });
    }

    /**
     * Reading Mode Excalidraw embeds are not always IMG elements. Route them
     * through the same source descriptor and image-layout resolver as native
     * media before rendering their caption.
     */
    public processReadingModeExternalMedia(
        media: Element,
        context: ReadingImageContext = {}
    ): void {
        if (!this.initialized) return;
        const target = resolveRenderedMediaLayoutTarget(media);
        if (!target || target.kind !== 'excalidraw-source') return;

        const parsed = context.descriptor?.pipeData
            ?? (context.linkText
                ? pipeSyntaxParser.parsePipeSyntax(context.linkText, { attributeMode: 'display' })
                : null);
        const standalone = context.descriptor?.standalone
            ?? isStandaloneRenderedMediaTarget(target);
        const layout = resolveImageLayout(
            parsed?.align,
            this.plugin.settings.alignment,
            standalone
        );
        this.alignment.applyLayoutTarget(target, layout);
        this.caption.renderExternalMedia(media, {
            ...context,
            document: media.ownerDocument
        });
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
    ): ImageStateResolution {
        const resolution = this.viewContextResolver.resolveDetailed(img, sourceIndex);
        if (resolution.status !== 'resolved') return resolution;
        const context = resolution.context;
        const linkText = context.match.linkText;

        const parsed = context.match.descriptor.pipeData
            ?? pipeSyntaxParser.parsePipeSyntax(linkText, { attributeMode: 'display' });
        if (!parsed) return { status: 'absent' };

        return { status: 'resolved', state: {
            ...this.mapPipeDataToState(parsed, context.match.descriptor.standalone),
            sourceKey: context.match.sourceKey,
            layoutKey: context.match.layoutKey,
            layoutScope: context.match.descriptor.layoutScope
        } };
    }

    public onunload() {
        this.unloaded = true;
        this.initialized = false;
        this.started = false;
        for (const [view, observer] of this.observers) {
            observer.disconnect();
            this.alignment?.cleanup(view.contentEl);
            view.contentEl.querySelectorAll(`[${IMAGE_SOURCE_KEY_ATTRIBUTE}]`)
                .forEach(element => element.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE));
            view.contentEl.querySelectorAll(`[${IMAGE_LAYOUT_KEY_ATTRIBUTE}]`)
                .forEach(element => element.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE));
        }
        for (const leaf of this.app.workspace?.getLeavesOfType?.('markdown') ?? []) {
            const contentEl = (leaf.view as MarkdownView)?.contentEl;
            if (!contentEl) continue;
            this.alignment?.cleanup(contentEl);
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
    }

    private toPipeAlignment(align: ImageState['align']): AlignType {
        return align === 'none' ? null : align;
    }

    private isStandaloneDomImage(img: HTMLImageElement): boolean {
        const target = resolveRenderedMediaLayoutTarget(img);
        return target ? isStandaloneRenderedMediaTarget(target) : true;
    }

    private unregisterLivePreviewLayout(img: HTMLImageElement): void {
        const owner = this.viewContextResolver.resolveOwner(img);
        if (owner) this.layoutCoordinators.get(owner.view)?.unregisterImage(img);
    }

    private scheduleAllLayouts(settleFrames: number): void {
        this.layoutCoordinators.forEach(coordinator => coordinator.schedule(settleFrames));
    }

    private getMeasureKey(view: MarkdownView): object {
        let key = this.measureKeys.get(view);
        if (!key) {
            key = {};
            this.measureKeys.set(view, key);
        }
        return key;
    }

    private measureQueuedImages(view: MarkdownView): MeasuredImageState[] | null {
        this.scheduledViews.delete(view);
        const queued = this.pendingImages.get(view);
        this.pendingImages.delete(view);
        if (!queued || !this.isLivePreview(view) || this.unloaded) return null;
        const sourceIndex = this.viewContextResolver.prepareEditor(view.editor);
        return [...queued]
            .filter(image => view.contentEl.contains(image))
            .map(image => ({
                image,
                resolution: this.resolveImageState(image, sourceIndex)
            }));
    }

    private applyMeasuredImages(
        view: MarkdownView,
        measurements: readonly MeasuredImageState[] | null
    ): void {
        if (!measurements || !this.isLivePreview(view) || this.unloaded) return;
        for (const { image, resolution } of measurements) {
            if (!view.contentEl.contains(image)
                || this.processingImages.has(image)) continue;
            try {
                this.processingImages.add(image);
                this.applyImageResolution(image, resolution);
            } finally {
                this.processingImages.delete(image);
            }
        }
    }

    private applyImageResolution(
        img: HTMLImageElement,
        resolution: ImageStateResolution
    ): void {
        if (resolution.status === 'pending') {
            return;
        }
        if (resolution.status === 'absent') {
            this.unregisterLivePreviewLayout(img);
            this.alignment.clearImage(img);
            img.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE);
            img.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE);
            this.caption.removeImage?.(img);
            return;
        }

        const state = resolution.state;
        if (state.sourceKey
            && img.getAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE) !== state.sourceKey) {
            img.setAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE, state.sourceKey);
        }
        if (state.layoutKey
            && img.getAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE) !== state.layoutKey) {
            img.setAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE, state.layoutKey);
        }
        const layout = resolveImageLayout(
            state.pipeAlignment ?? this.toPipeAlignment(state.align),
            this.plugin.settings.alignment,
            state.standalone ?? true
        );
        this.alignment.applyLayout(img, layout);

        if (state.layoutKey) {
            const owner = this.viewContextResolver.resolveOwner(img);
            const target = resolveRenderedMediaLayoutTarget(img);
            if (owner && target && isStableLivePreviewTarget(target, {
                viewRoot: owner.view.contentEl,
                sourceKey: state.sourceKey ?? '',
                layoutKey: state.layoutKey
            })) {
                this.layoutCoordinators.get(owner.view)?.registerTarget(target, state.layoutKey, {
                    standalone: state.standalone ?? true,
                    scope: state.layoutScope ?? 'root',
                    alignment: layout.alignment,
                    wrap: layout.wrap
                });
            }
        }

        // Live Preview captions are owned by the CodeMirror StateField.
        // Never write caption DOM into an editor managed by CodeMirror.
        this.caption.removeImage?.(img);
    }

    private schedule(callback: () => void, delay: number): void {
        const timer = setTimeout(() => {
            this.pendingTimers.delete(timer);
            callback();
        }, delay);
        this.pendingTimers.add(timer);
    }
}

function normalizeRenderedSourcePath(value: string): string {
    let decoded = value.trim();
    try {
        decoded = decodeURIComponent(decoded);
    } catch {
        // Keep the original path when an upstream renderer preserves `%` text.
    }
    return decoded
        .replace(/\\/g, '/')
        .replace(/^\.\/+/, '')
        .replace(/^\/+/, '')
        .toLowerCase();
}

function areEquivalentRenderedPaths(left: string, right: string): boolean {
    if (!left || !right) return false;
    if (left === right) return true;
    const leftBasename = left.slice(left.lastIndexOf('/') + 1);
    const rightBasename = right.slice(right.lastIndexOf('/') + 1);
    return (!left.includes('/') || !right.includes('/'))
        && leftBasename === rightBasename;
}

/** CodeMirror's zero-width cursor buffer is not a rendered Markdown image. */
function isCodeMirrorWidgetBuffer(image: HTMLImageElement): boolean {
    return image.classList.contains('cm-widgetBuffer');
}

interface LivePreviewTargetBinding {
    readonly viewRoot: HTMLElement;
    readonly sourceKey: string;
    readonly layoutKey: string;
}

/**
 * Accepts Obsidian 1.13.4's real stable widget shapes, including
 * `.cm-content > .cm-line > .image-embed`. A `.cm-line` ancestor is not by
 * itself evidence of a transient source reveal. Stability instead comes from
 * an unambiguous Markdown binding and one outer media owner in the current
 * Live Preview view.
 */
function isStableLivePreviewTarget(
    target: RenderedMediaLayoutTarget,
    binding: LivePreviewTargetBinding
): boolean {
    if (!binding.sourceKey.trim() || !binding.layoutKey.trim()) return false;

    const { owner, placement, visual } = target;
    if (placement !== owner
        || !binding.viewRoot.contains(owner)
        || !binding.viewRoot.contains(placement)
        || !binding.viewRoot.contains(visual)
        || !owner.matches('.image-embed')
        || owner.matches('.cm-line, .cm-content')
        || owner.closest('.cm-image-reveal-tooltip, .popover, .hover-popover')) {
        return false;
    }

    const content = owner.closest<HTMLElement>('.cm-content');
    if (!content || !binding.viewRoot.contains(content)) return false;

    const parent = owner.parentElement;
    const isDirectContentChild = parent === content;
    const isDirectLineChild = parent?.matches('.cm-line') === true
        && parent.parentElement === content;
    if (!isDirectContentChild && !isDirectLineChild) return false;

    // Never bind an inner embed. Moving it can escape an outer paint
    // containment boundary (as Excalidraw does) or duplicate native layout.
    if (visual.closest('.image-embed') !== owner
        || owner.parentElement?.closest('.image-embed')) return false;

    return true;
}
