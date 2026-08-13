import type { CaptionWidthMode } from '../../settings/types';
import type { ResolvedCaptionLayout } from '../ImageLayoutResolver';
import type { ResolvedCaptionState } from './CaptionResolver';
import { isHtmlElementNode } from './CaptionDomUtils';
import {
    resolveRenderedMediaLayoutTarget,
    type RenderedMediaLayoutTarget
} from '../RenderedMediaLayoutTarget';

export interface CaptionRenderContext {
    document?: Document;
    captionKey?: string;
    sourceKey?: string;
    layout?: ResolvedCaptionLayout;
    standalone?: boolean;
    widthMode?: CaptionWidthMode;
    maxLines?: number;
}

type CaptionPlacement = 'append' | 'after';

interface CaptionTarget {
    host: HTMLElement;
    placement: CaptionPlacement;
    anchor: Element;
    preferMeasuredWidth: boolean;
}

interface CaptionWidthTracker {
    readonly document: Document;
    readonly observer: ResizeObserver;
    readonly media: Map<Element, Element>;
    readonly pendingWidths: Map<Element, number>;
    cancelScheduledFlush: (() => void) | null;
}

const DOM_CAPTION_SELECTOR = '.image-assistant-caption[data-image-assistant-caption-renderer="dom"]';

export class CaptionDomRenderer {
    private readonly captionKeys = new WeakMap<Element, string>();
    private readonly explicitWidths = new WeakMap<Element, number | undefined>();
    private readonly widthModes = new WeakMap<Element, CaptionWidthMode>();
    private readonly widthTrackers = new Map<Document, CaptionWidthTracker>();
    private readonly trackedDocuments = new WeakMap<Element, Document>();
    private readonly trackedAnchors = new WeakMap<Element, Element>();
    private readonly loadHandlers = new Map<HTMLImageElement, () => void>();

    render(
        img: HTMLImageElement,
        state: ResolvedCaptionState,
        context: CaptionRenderContext = {}
    ): HTMLElement | null {
        const media = resolveRenderedMediaLayoutTarget(img);
        return media ? this.renderTarget(media, state, context) : null;
    }

    renderTarget(
        media: RenderedMediaLayoutTarget,
        state: ResolvedCaptionState,
        context: CaptionRenderContext = {}
    ): HTMLElement | null {
        const visual = media.visual;
        const target = this.toCaptionTarget(media);
        if (!target) return null;

        const captionKey = context.captionKey ?? context.sourceKey ?? this.getCaptionKey(visual);
        const previousKey = this.captionKeys.get(visual);
        if (previousKey && previousKey !== captionKey) {
            this.findExistingCaption(target, previousKey)?.remove();
        }
        this.captionKeys.set(visual, captionKey);
        if (!state.shouldRender || !state.caption) {
            this.removeCaption(target, visual, captionKey);
            return null;
        }

        const widthMode = context.widthMode ?? 'auto';
        const maxLines = context.maxLines ?? 0;
        this.explicitWidths.set(visual, state.size?.width);
        this.widthModes.set(visual, widthMode);

        let caption = this.findExistingCaption(target, captionKey);
        if (!caption) caption = this.createCaption(visual, target, context, captionKey);
        if (!caption) return null;

        if (caption.textContent !== state.caption) caption.textContent = state.caption;
        setAttributeIfChanged(caption, 'data-image-assistant-caption-for', captionKey);
        setAttributeIfChanged(caption, 'data-image-assistant-caption-width', widthMode);
        this.applyLayoutAttributes(caption, target.host, context);
        this.applyLineClamp(caption, state.caption, maxLines);

        if (!target.host.classList.contains('image-assistant-caption-host')) {
            target.host.classList.add('image-assistant-caption-host');
        }
        setAttributeIfChanged(target.host, 'data-image-assistant-caption-owner', 'true');
        const layoutContainer = media.owner;
        if (layoutContainer && !layoutContainer.classList.contains('has-image-assistant-caption')) {
            layoutContainer.classList.add('has-image-assistant-caption');
        }

        this.syncWidthVariable(target, caption, state.size?.width, widthMode);
        this.syncCaptionGeometry(target, caption, widthMode);
        this.ensureWidthTracking(visual, target, widthMode);
        return caption;
    }

    removeImage(img: HTMLImageElement): void {
        this.removeTarget(img);
    }

    removeTarget(visual: Element): void {
        const target = this.findTarget(visual);
        if (target) this.removeCaption(target, visual, this.getCaptionKey(visual));
        else this.releaseWidthTracking(visual);
    }

    cleanup(root: ParentNode = this.getDefaultDocument()): void {
        const trackedImages = [...this.widthTrackers.values()]
            .flatMap(tracker => [...tracker.media.keys()]);
        for (const image of new Set([...trackedImages, ...this.loadHandlers.keys()])) {
            if (root === image || root.contains?.(image)) this.releaseWidthTracking(image);
        }
        root.querySelectorAll?.(DOM_CAPTION_SELECTOR).forEach(caption => caption.remove());
        root.querySelectorAll?.('[data-image-assistant-caption-owner="true"]').forEach(owner => {
            owner.removeAttribute('data-image-assistant-caption-owner');
            owner.removeAttribute('data-image-assistant-caption-placement');
            // Remove the pre-6.0.0 combined attribute as well. A plugin
            // reload can otherwise leave old CSS semantics on rendered notes.
            owner.removeAttribute('data-image-assistant-caption-align');
            owner.removeAttribute('data-image-assistant-caption-wrap');
            owner.removeAttribute('data-image-assistant-caption-standalone');
            owner.classList.remove('image-assistant-caption-host');
            if (isHtmlElementNode(owner)) owner.style.removeProperty('--img-width');
        });
        root.querySelectorAll?.('.has-image-assistant-caption').forEach(container => {
            if (!container.querySelector(DOM_CAPTION_SELECTOR)) {
                container.classList.remove('has-image-assistant-caption');
            }
        });
    }

    private findTarget(visual: Element): CaptionTarget | null {
        const media = resolveRenderedMediaLayoutTarget(visual);
        return media && media.visual === visual ? this.toCaptionTarget(media) : null;
    }

    private toCaptionTarget(media: RenderedMediaLayoutTarget): CaptionTarget {
        return {
            host: media.owner,
            placement: media.owner === media.visual ? 'after' : 'append',
            anchor: media.captionAnchor,
            preferMeasuredWidth: media.sizing === 'external-renderer'
        };
    }

    private findExistingCaption(target: CaptionTarget, captionKey: string): HTMLElement | null {
        if (target.placement === 'after') {
            const parent = target.host.parentElement;
            if (!parent) return null;
            return Array.from(parent.children).find(child =>
                isHtmlElementNode(child)
                    && child.matches(DOM_CAPTION_SELECTOR)
                    && child.getAttribute('data-image-assistant-caption-for') === captionKey
            ) as HTMLElement | undefined ?? null;
        }

        return Array.from(target.host.children).find(child =>
            isHtmlElementNode(child)
                && child.matches(DOM_CAPTION_SELECTOR)
                && child.getAttribute('data-image-assistant-caption-for') === captionKey
        ) as HTMLElement | undefined ?? null;
    }

    private createCaption(
        visual: Element,
        target: CaptionTarget,
        context: CaptionRenderContext,
        captionKey: string
    ): HTMLElement | null {
        const doc = context.document ?? visual.ownerDocument ?? this.getDefaultDocument();
        const caption = doc.createElement('span');
        caption.className = 'image-assistant-caption';
        caption.setAttribute('data-image-assistant-caption-node', 'true');
        caption.setAttribute('data-image-assistant-caption-renderer', 'dom');
        caption.setAttribute('data-image-assistant-caption-for', captionKey);
        caption.setAttribute('aria-hidden', 'true');

        if (target.placement === 'append') {
            target.host.appendChild(caption);
            return caption;
        }
        if (!target.host.parentNode) return null;
        target.host.after(caption);
        return caption;
    }

    private removeCaption(target: CaptionTarget, visual: Element, captionKey: string): void {
        this.findExistingCaption(target, captionKey)?.remove();
        this.releaseWidthTracking(visual);
        this.explicitWidths.delete(visual);
        this.widthModes.delete(visual);
        if (!target.host.querySelector(DOM_CAPTION_SELECTOR)) {
            target.host.classList.remove('image-assistant-caption-host');
            target.host.removeAttribute('data-image-assistant-caption-owner');
            target.host.removeAttribute('data-image-assistant-caption-placement');
            target.host.removeAttribute('data-image-assistant-caption-align');
            target.host.removeAttribute('data-image-assistant-caption-wrap');
            target.host.removeAttribute('data-image-assistant-caption-standalone');
            target.host.style.removeProperty('--img-width');
            const layout = resolveRenderedMediaLayoutTarget(visual)?.owner ?? target.host;
            if (layout && !layout.querySelector(DOM_CAPTION_SELECTOR)) {
                layout.classList.remove('has-image-assistant-caption');
            }
        }
    }

    private syncWidthVariable(
        target: CaptionTarget,
        caption: HTMLElement,
        explicitWidth: number | undefined,
        widthMode: CaptionWidthMode
    ): void {
        const width = widthMode === 'container'
            ? '100%'
            : this.resolveAutoWidth(
                target.anchor,
                explicitWidth,
                target.preferMeasuredWidth
            );
        this.applyWidthVariable(target, caption, width);
    }

    private applyWidthVariable(
        target: CaptionTarget,
        caption: HTMLElement,
        width: string
    ): void {
        if (target.host.style.getPropertyValue('--img-width') !== width) {
            target.host.style.setProperty('--img-width', width);
        }
        if (caption.style.getPropertyValue('--img-width') !== width) {
            caption.style.setProperty('--img-width', width);
        }
    }

    private resolveAutoWidth(
        anchor: Element,
        explicitWidth: number | undefined,
        preferMeasuredWidth = false
    ): string {
        const measuredWidth = positiveNumber(anchor.getBoundingClientRect?.().width)
            ?? this.parseNumber(anchor.getAttribute('width'))
            ?? (isHtmlImageElement(anchor) ? positiveNumber(anchor.width) : undefined);
        const width = preferMeasuredWidth
            ? measuredWidth ?? explicitWidth
            : explicitWidth ?? measuredWidth;
        return width ? `${width}px` : '100%';
    }

    private parseNumber(value: string | null): number | undefined {
        if (!value) return undefined;
        return positiveNumber(Number.parseInt(value, 10));
    }

    private getDefaultDocument(): Document {
        if (typeof activeDocument !== 'undefined') return activeDocument;
        return document;
    }

    private getCaptionKey(visual: Element): string {
        let key = this.captionKeys.get(visual);
        if (!key) {
            key = `image-caption-${Math.random().toString(36).slice(2)}`;
            this.captionKeys.set(visual, key);
        }
        return key;
    }

    private applyLayoutAttributes(
        caption: HTMLElement,
        host: HTMLElement,
        context: CaptionRenderContext
    ): void {
        const placement = context.layout?.placement ?? null;
        const textAlignment = context.layout?.textAlignment ?? 'center';
        const wrap = context.layout?.wrap === true;
        const standalone = context.standalone !== false;
        setAttributeIfChanged(
            caption,
            'data-image-assistant-caption-text-align',
            textAlignment
        );
        // Old versions used this one attribute for both placement and text.
        // Always remove it when a caption is refreshed.
        removeAttributeIfPresent(caption, 'data-image-assistant-caption-align');
        setAttributeIfChanged(caption, 'data-image-assistant-caption-wrap', wrap ? 'true' : 'false');
        setAttributeIfChanged(caption, 'data-image-assistant-caption-standalone', standalone ? 'true' : 'false');
        if (placement) {
            setAttributeIfChanged(host, 'data-image-assistant-caption-placement', placement);
        } else {
            removeAttributeIfPresent(host, 'data-image-assistant-caption-placement');
        }
        removeAttributeIfPresent(host, 'data-image-assistant-caption-align');
        setAttributeIfChanged(host, 'data-image-assistant-caption-wrap', wrap ? 'true' : 'false');
        setAttributeIfChanged(host, 'data-image-assistant-caption-standalone', standalone ? 'true' : 'false');
        if (context.sourceKey) {
            setAttributeIfChanged(caption, 'data-image-assistant-source-key', context.sourceKey);
        } else {
            caption.removeAttribute('data-image-assistant-source-key');
        }
    }

    private ensureWidthTracking(
        visual: Element,
        target: CaptionTarget,
        widthMode: CaptionWidthMode
    ): void {
        // Keep the actual rendered width/position authoritative even when the
        // Markdown supplies `|W`: themes, responsive constraints and external
        // renderers can all change the visual surface after first paint.
        if (widthMode === 'container') {
            this.releaseWidthTracking(visual);
            return;
        }

        const ownerDocument = visual.ownerDocument;
        if (this.trackedDocuments.get(visual) === ownerDocument
            && this.trackedAnchors.get(visual) === target.anchor) return;
        this.releaseWidthTracking(visual);

        const OwnerResizeObserver = ownerDocument.defaultView?.ResizeObserver
            ?? (typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver);
        if (OwnerResizeObserver) {
            const tracker = this.getOrCreateWidthTracker(
                ownerDocument,
                OwnerResizeObserver
            );
            tracker.media.set(visual, target.anchor);
            tracker.observer.observe(target.anchor);
            this.trackedDocuments.set(visual, ownerDocument);
            this.trackedAnchors.set(visual, target.anchor);
            return;
        }

        if (isHtmlImageElement(visual) && !this.loadHandlers.has(visual)) {
            const handler = () => this.refreshTrackedWidth(visual);
            visual.addEventListener('load', handler);
            this.loadHandlers.set(visual, handler);
        }
    }

    private refreshTrackedWidth(visual: Element): void {
        const target = this.findTarget(visual);
        if (!target) return;
        const caption = this.findExistingCaption(target, this.getCaptionKey(visual));
        if (!caption) return;
        this.syncWidthVariable(
            target,
            caption,
            this.explicitWidths.get(visual),
            this.widthModes.get(visual) ?? 'auto'
        );
        this.syncCaptionGeometry(target, caption, this.widthModes.get(visual) ?? 'auto');
    }

    private releaseWidthTracking(visual: Element): void {
        const ownerDocument = this.trackedDocuments.get(visual);
        const tracker = ownerDocument
            ? this.widthTrackers.get(ownerDocument)
            : undefined;
        if (tracker) {
            const anchor = tracker.media.get(visual) ?? this.trackedAnchors.get(visual);
            tracker.media.delete(visual);
            tracker.pendingWidths.delete(visual);
            if (anchor && ![...tracker.media.values()].some(candidate => candidate === anchor)) {
                tracker.observer.unobserve?.(anchor);
            }
            if (tracker.media.size === 0) {
                tracker.cancelScheduledFlush?.();
                tracker.cancelScheduledFlush = null;
                tracker.observer.disconnect();
                this.widthTrackers.delete(ownerDocument!);
            }
        }
        this.trackedDocuments.delete(visual);
        this.trackedAnchors.delete(visual);
        if (!isHtmlImageElement(visual)) return;
        const handler = this.loadHandlers.get(visual);
        if (handler) visual.removeEventListener('load', handler);
        this.loadHandlers.delete(visual);
    }

    private getOrCreateWidthTracker(
        ownerDocument: Document,
        Observer: typeof ResizeObserver
    ): CaptionWidthTracker {
        const existing = this.widthTrackers.get(ownerDocument);
        if (existing) return existing;

        const media = new Map<Element, Element>();
        const pendingWidths = new Map<Element, number>();
        const observer = new Observer(entries => {
            for (const entry of entries) {
                for (const [visual, anchor] of media) {
                    if (anchor === entry.target) {
                        pendingWidths.set(visual, entry.contentRect.width);
                    }
                }
            }
            const current = this.widthTrackers.get(ownerDocument);
            if (current) this.scheduleWidthFlush(current);
        });
        const tracker: CaptionWidthTracker = {
            document: ownerDocument,
            observer,
            media,
            pendingWidths,
            cancelScheduledFlush: null
        };
        this.widthTrackers.set(ownerDocument, tracker);
        return tracker;
    }

    private scheduleWidthFlush(tracker: CaptionWidthTracker): void {
        if (tracker.cancelScheduledFlush || tracker.pendingWidths.size === 0) return;
        const ownerWindow = tracker.document.defaultView;
        const flush = () => {
            tracker.cancelScheduledFlush = null;
            this.flushTrackedWidths(tracker);
        };
        if (ownerWindow?.requestAnimationFrame) {
            const frame = ownerWindow.requestAnimationFrame(flush);
            tracker.cancelScheduledFlush = () => ownerWindow.cancelAnimationFrame(frame);
            return;
        }

        const timer = setTimeout(flush, 16);
        tracker.cancelScheduledFlush = () => clearTimeout(timer);
    }

    private flushTrackedWidths(tracker: CaptionWidthTracker): void {
        const measurements = [...tracker.pendingWidths];
        tracker.pendingWidths.clear();
        const updates: Array<{
            target: CaptionTarget;
            caption: HTMLElement;
            width: string;
        }> = [];

        for (const [visual, observedWidth] of measurements) {
            if (!visual.isConnected || !tracker.media.has(visual)) {
                this.releaseWidthTracking(visual);
                continue;
            }
            const target = this.findTarget(visual);
            if (!target) continue;
            const caption = this.findExistingCaption(target, this.getCaptionKey(visual));
            if (!caption) continue;
            const width = positiveNumber(observedWidth)
                ? `${roundLayoutWidth(observedWidth)}px`
                : this.resolveAutoWidth(
                    target.anchor,
                    this.explicitWidths.get(visual),
                    target.preferMeasuredWidth
                );
            updates.push({ target, caption, width });
        }

        for (const update of updates) {
            this.applyWidthVariable(update.target, update.caption, update.width);
            this.syncCaptionGeometry(
                update.target,
                update.caption,
                update.caption.getAttribute('data-image-assistant-caption-width') === 'container'
                    ? 'container'
                    : 'auto'
            );
        }
    }

    /**
     * A renderer may keep its own full-line wrapper while the actual visual is
     * a centered or floated child (notably native Excalidraw SVG output).
     * Anchor only the caption box to the measured surface; never move or style
     * the external renderer itself.
     */
    private syncCaptionGeometry(
        target: CaptionTarget,
        caption: HTMLElement,
        widthMode: CaptionWidthMode
    ): void {
        if (target.placement !== 'append'
            || widthMode !== 'auto'
            || caption.getAttribute('data-image-assistant-caption-wrap') === 'true') {
            clearCaptionGeometry(caption);
            return;
        }

        const anchorRect = target.anchor.getBoundingClientRect?.();
        const captionRect = caption.getBoundingClientRect?.();
        if (!anchorRect
            || !captionRect
            || !positiveNumber(anchorRect.width)
            || !Number.isFinite(anchorRect.left)
            || !Number.isFinite(captionRect.left)) {
            clearCaptionGeometry(caption);
            return;
        }

        const previousOffset = parsePixels(
            caption.style.getPropertyValue('--image-assistant-caption-offset')
        );
        const baselineLeft = captionRect.left - previousOffset;
        const offset = anchorRect.left - baselineLeft;
        setAttributeIfChanged(caption, 'data-image-assistant-caption-positioned', 'true');
        setPropertyIfChanged(
            caption,
            '--image-assistant-caption-offset',
            toPixels(offset)
        );
    }

    private applyLineClamp(caption: HTMLElement, text: string, maxLines: number): void {
        if (maxLines > 0) {
            setAttributeIfChanged(caption, 'data-image-assistant-caption-clamped', 'true');
            setAttributeIfChanged(caption, 'title', text);
            const value = maxLines.toString();
            if (caption.style.getPropertyValue('--image-assistant-caption-max-lines') !== value) {
                caption.style.setProperty('--image-assistant-caption-max-lines', value);
            }
            return;
        }

        if (caption.hasAttribute('data-image-assistant-caption-clamped')) {
            caption.removeAttribute('data-image-assistant-caption-clamped');
        }
        if (caption.hasAttribute('title')) caption.removeAttribute('title');
        if (caption.style.getPropertyValue('--image-assistant-caption-max-lines')) {
            caption.style.removeProperty('--image-assistant-caption-max-lines');
        }
    }
}

function setAttributeIfChanged(element: Element, name: string, value: string): void {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function positiveNumber(value: number | undefined): number | undefined {
    return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function roundLayoutWidth(value: number): number {
    return Math.round(value * 2) / 2;
}

function clearCaptionGeometry(caption: HTMLElement): void {
    removeAttributeIfPresent(caption, 'data-image-assistant-caption-positioned');
    removePropertyIfPresent(caption, '--image-assistant-caption-offset');
}

function parsePixels(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function toPixels(value: number): string {
    const rounded = roundLayoutWidth(value);
    return `${Object.is(rounded, -0) ? 0 : rounded}px`;
}

function setPropertyIfChanged(element: HTMLElement, name: string, value: string): void {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}

function removeAttributeIfPresent(element: Element, name: string): void {
    if (element.hasAttribute(name)) element.removeAttribute(name);
}

function removePropertyIfPresent(element: HTMLElement, name: string): void {
    if (element.style.getPropertyValue(name)) element.style.removeProperty(name);
}

function isHtmlImageElement(value: unknown): value is HTMLImageElement {
    return isHtmlElementNode(value) && value.tagName === 'IMG';
}
