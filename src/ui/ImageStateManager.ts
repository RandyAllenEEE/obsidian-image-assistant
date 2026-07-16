
import { App, debounce, editorLivePreviewField, MarkdownView } from 'obsidian';
import ImageConverterPlugin from '../main';
import { ImageAlignment } from './ImageAlignment';
import { ImageResizer } from './ImageResizer';
import { ImageCaption } from './ImageCaption';
import { pipeSyntaxParser, AlignType, PipeSyntaxData } from '../utils/PipeSyntaxParser';
import type { ReadingImageContext } from './caption/types';
import { isElementNode, isHtmlImageElement } from './caption/CaptionDomUtils';
import { ImageViewContextResolver } from './contextMenu/utils/ImageViewContextResolver';
import { resolveImageLayout } from './ImageLayoutResolver';
import {
    IMAGE_SOURCE_KEY_ATTRIBUTE,
    type ImageSourceIndex
} from '../utils/RefinedImageUtils';
import {
    clearLivePreviewCaptionGeometry,
    syncLivePreviewCaptionGeometry
} from './caption/LivePreviewCaptionGeometry';
import { collectUsableMarkdownViews, getMarkdownViewMode } from './MarkdownViewRegistry';
import {
    LivePreviewImageLayoutCoordinator,
    type LivePreviewLayoutScope
} from './caption/LivePreviewImageLayoutCoordinator';


export interface ImageState {
    align: 'left' | 'center' | 'right' | 'left-wrap' | 'right-wrap' | 'none';
    wrap: boolean;
    pipeAlignment?: AlignType;
    standalone?: boolean;
    sourceKey?: string;
    layoutScope?: LivePreviewLayoutScope;
    width?: number | null;
    height?: number | null;
    caption?: string;
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

                this.schedule(() => {
                    this.syncObservers();
                    this.refreshAllImages();
                }, 200);
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
                    view.contentEl.querySelectorAll(`[${IMAGE_SOURCE_KEY_ATTRIBUTE}]`)
                        .forEach(element => element.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE));
                }
            }
        }

        for (const view of views) {
            if (!this.isLivePreview(view)) {
                if (getMarkdownViewMode(view) !== 'preview') {
                    this.alignment?.cleanup(view.contentEl);
                    view.contentEl.querySelectorAll(`[${IMAGE_SOURCE_KEY_ATTRIBUTE}]`)
                        .forEach(element => element.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE));
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
                    this.layoutCoordinators.get(view)?.unregisterImage(node);
                } else if (isElementNode(node)) {
                    node.querySelectorAll('img').forEach(image => {
                        if (isHtmlImageElement(image)) {
                            this.layoutCoordinators.get(view)?.unregisterImage(image);
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

    public refreshAllImages = debounce(() => {
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
                        img.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE);
                        this.caption.removeImage?.(img);
                    }
                }
            });
        }
        this.syncObservers();
    }, 300, true);

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
            const state = this.getImageState(img, sourceIndex);
            if (!state) {
                this.clearCaptionGeometryForImage(img);
                this.unregisterLivePreviewLayout(img);
                this.alignment.clearImage(img);
                img.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE);
                this.caption.removeImage?.(img);
                return;
            }

            const layout = resolveImageLayout(
                state.pipeAlignment ?? this.toPipeAlignment(state.align),
                this.plugin.settings.alignment,
                state.standalone ?? true
            );
            this.alignment.applyLayout(img, layout, {
                width: state.width?.toString(),
                height: state.height?.toString()
            });

            // 4. Delegate: Size
            if ((state.width || state.height) && this.resizer) {
                this.resizer.applySize(img, state.width ?? undefined, state.height ?? undefined);
            }

            if (state.sourceKey) {
                const owner = this.viewContextResolver.resolveOwner(img);
                if (owner) {
                    syncLivePreviewCaptionGeometry(owner.view.contentEl, img, state.sourceKey);
                    this.layoutCoordinators.get(owner.view)?.registerImage(img, state.sourceKey, {
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

        // Reading Mode DOM attributes can lose Wiki pipe fields. Prefer the
        // exact source link supplied by CaptionRenderCoordinator, then retain
        // the old alt-based fallback for raw HTML and transclusions.
        const parsed = descriptor?.pipeData ?? (linkText
            ? pipeSyntaxParser.parsePipeSyntax(linkText, { attributeMode: 'display' })
            : null)
            ?? pipeSyntaxParser.parsePipeAttributes(img.getAttribute('alt') || '', true, 'display');
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
        this.alignment.applyLayout(img, layout, {
            width: state.width?.toString(),
            height: state.height?.toString()
        });

        // 5. Delegate: Size
        if ((state.width || state.height) && this.resizer) {
            this.resizer.applySize(img, state.width ?? undefined, state.height ?? undefined);
        }

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
            caption: parsed.alt ? parsed.alt.replace(/\\\|/g, '|') : undefined
        };
    }

    /**
     * Reads the current state of the image from the Markdown source.
     */
    public getImageState(img: HTMLImageElement, sourceIndex?: ImageSourceIndex): ImageState | null {
        const context = this.viewContextResolver.resolve(img, sourceIndex);
        const linkText = context?.match.linkText;
        if (!linkText) return null;

        const parsed = context.match.descriptor.pipeData
            ?? pipeSyntaxParser.parsePipeSyntax(linkText, { attributeMode: 'display' });
        if (!parsed) return null;

        if (img.getAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE) !== context.match.sourceKey) {
            img.setAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE, context.match.sourceKey);
        }
        return {
            ...this.mapPipeDataToState(parsed, context.match.descriptor.standalone),
            sourceKey: context.match.sourceKey,
            layoutScope: context.match.descriptor.layoutScope
        };
    }

    /**
     * The Central Writer. Updates the markdown file with new state.
     */
    public async updateState(img: HTMLImageElement, changes: Partial<ImageState>) {
        const context = this.viewContextResolver.resolve(img);
        if (!context) return;
        const { view, editor, match: linkMatch } = context;
        const linkText = linkMatch.linkText;

        const parsed = pipeSyntaxParser.parsePipeSyntax(linkText);
        if (!parsed) return;

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

        // Rebuild and Write
        // Rebuild and Write
        const newLinkText = pipeSyntaxParser.buildPipeSyntax(parsed);

        // Check if content actually changed to avoid unnecessary writes
        if (linkText !== newLinkText) {
            this.app.workspace.onLayoutReady(() => {
                if (this.unloaded) return;
                if (view.contentEl && !view.contentEl.contains(img)) return;
                if (linkMatch.line < 0 || linkMatch.line >= editor.lineCount()) return;

                const currentLine = editor.getLine(linkMatch.line);
                if (linkMatch.start < 0 || linkMatch.end > currentLine.length || linkMatch.start > linkMatch.end) return;
                if (currentLine.slice(linkMatch.start, linkMatch.end) !== linkText) return;

                editor.replaceRange(
                    newLinkText,
                    { line: linkMatch.line, ch: linkMatch.start },
                    { line: linkMatch.line, ch: linkMatch.end }
                );
            });
        }

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
        }
        for (const leaf of this.app.workspace?.getLeavesOfType?.('markdown') ?? []) {
            const contentEl = (leaf.view as MarkdownView)?.contentEl;
            if (!contentEl) continue;
            this.alignment?.cleanup(contentEl);
            contentEl.querySelectorAll(`[${IMAGE_SOURCE_KEY_ATTRIBUTE}]`)
                .forEach(element => element.removeAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE));
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
        (this.refreshAllImages as typeof this.refreshAllImages & { cancel?: () => void }).cancel?.();
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

    private clearCaptionGeometryForImage(img: HTMLImageElement): void {
        const sourceKey = img.getAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE);
        if (!sourceKey) return;
        const owner = this.viewContextResolver.resolveOwner(img);
        if (owner) clearLivePreviewCaptionGeometry(owner.view.contentEl, sourceKey);
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
