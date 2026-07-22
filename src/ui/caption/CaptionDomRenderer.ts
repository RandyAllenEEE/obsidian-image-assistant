import type { CaptionWidthMode } from '../../settings/types';
import type { ResolvedCaptionLayout } from '../ImageLayoutResolver';
import type { ResolvedCaptionState } from './CaptionResolver';
import { isHtmlElementNode, isTextNode } from './CaptionDomUtils';

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
}

interface CaptionWidthTracker {
    readonly document: Document;
    readonly observer: ResizeObserver;
    readonly images: Set<HTMLImageElement>;
    readonly pendingWidths: Map<HTMLImageElement, number>;
    cancelScheduledFlush: (() => void) | null;
}

const DOM_CAPTION_SELECTOR = '.image-assistant-caption[data-image-assistant-caption-renderer="dom"]';

export class CaptionDomRenderer {
    private readonly captionKeys = new WeakMap<HTMLImageElement, string>();
    private readonly explicitWidths = new WeakMap<HTMLImageElement, number | undefined>();
    private readonly widthModes = new WeakMap<HTMLImageElement, CaptionWidthMode>();
    private readonly widthTrackers = new Map<Document, CaptionWidthTracker>();
    private readonly trackedDocuments = new WeakMap<HTMLImageElement, Document>();
    private readonly loadHandlers = new Map<HTMLImageElement, () => void>();

    render(
        img: HTMLImageElement,
        state: ResolvedCaptionState,
        context: CaptionRenderContext = {}
    ): HTMLElement | null {
        const target = this.findTarget(img);
        if (!target) return null;

        const captionKey = context.captionKey ?? context.sourceKey ?? this.getCaptionKey(img);
        const previousKey = this.captionKeys.get(img);
        if (previousKey && previousKey !== captionKey) {
            this.findExistingCaption(target, previousKey)?.remove();
        }
        this.captionKeys.set(img, captionKey);
        if (!state.shouldRender || !state.caption) {
            this.removeCaption(target, img, captionKey);
            return null;
        }

        const widthMode = context.widthMode ?? 'auto';
        const maxLines = context.maxLines ?? 0;
        this.explicitWidths.set(img, state.size?.width);
        this.widthModes.set(img, widthMode);

        let caption = this.findExistingCaption(target, captionKey);
        if (!caption) caption = this.createCaption(img, target, context, captionKey);
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
        const layoutContainer = this.findLayoutContainer(img, target.host);
        if (layoutContainer && !layoutContainer.classList.contains('has-image-assistant-caption')) {
            layoutContainer.classList.add('has-image-assistant-caption');
        }

        this.syncWidthVariable(target, img, caption, state.size?.width, widthMode);
        this.ensureWidthTracking(img);
        return caption;
    }

    removeImage(img: HTMLImageElement): void {
        const target = this.findTarget(img);
        if (target) this.removeCaption(target, img, this.getCaptionKey(img));
        else this.releaseWidthTracking(img);
    }

    cleanup(root: ParentNode = this.getDefaultDocument()): void {
        const trackedImages = [...this.widthTrackers.values()]
            .flatMap(tracker => [...tracker.images]);
        for (const image of new Set([...trackedImages, ...this.loadHandlers.keys()])) {
            if (root === image || root.contains?.(image)) this.releaseWidthTracking(image);
        }
        root.querySelectorAll?.(DOM_CAPTION_SELECTOR).forEach(caption => caption.remove());
        root.querySelectorAll?.('[data-image-assistant-caption-owner="true"]').forEach(owner => {
            owner.removeAttribute('data-image-assistant-caption-owner');
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

    private findTarget(img: HTMLImageElement): CaptionTarget | null {
        const targetSelectors: Array<{ selector: string; placement: CaptionPlacement }> = [
            { selector: '.image-resize-container', placement: 'append' },
            { selector: '.image-wrapper', placement: 'after' },
            { selector: '.internal-embed.image-embed', placement: 'append' },
            { selector: '.external-embed', placement: 'append' },
            { selector: '.cm-embed-block', placement: 'append' }
        ];

        for (const target of targetSelectors) {
            const host = img.closest(target.selector);
            if (isHtmlElementNode(host)) return { host, placement: target.placement };
        }

        const paragraph = img.parentElement;
        if (paragraph?.tagName === 'P' && this.isStandaloneImageParagraph(paragraph, img)) {
            return { host: paragraph, placement: 'append' };
        }

        return { host: img, placement: 'after' };
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
        img: HTMLImageElement,
        target: CaptionTarget,
        context: CaptionRenderContext,
        captionKey: string
    ): HTMLElement | null {
        const doc = context.document ?? img.ownerDocument ?? this.getDefaultDocument();
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

    private removeCaption(target: CaptionTarget, img: HTMLImageElement, captionKey: string): void {
        this.findExistingCaption(target, captionKey)?.remove();
        this.releaseWidthTracking(img);
        this.explicitWidths.delete(img);
        this.widthModes.delete(img);
        if (!target.host.querySelector(DOM_CAPTION_SELECTOR)) {
            target.host.classList.remove('image-assistant-caption-host');
            target.host.removeAttribute('data-image-assistant-caption-owner');
            target.host.removeAttribute('data-image-assistant-caption-align');
            target.host.removeAttribute('data-image-assistant-caption-wrap');
            target.host.removeAttribute('data-image-assistant-caption-standalone');
            target.host.style.removeProperty('--img-width');
            const layout = this.findLayoutContainer(img, target.host);
            if (layout && !layout.querySelector(DOM_CAPTION_SELECTOR)) {
                layout.classList.remove('has-image-assistant-caption');
            }
        }
    }

    private syncWidthVariable(
        target: CaptionTarget,
        img: HTMLImageElement,
        caption: HTMLElement,
        explicitWidth: number | undefined,
        widthMode: CaptionWidthMode
    ): void {
        const width = widthMode === 'container'
            ? '100%'
            : this.resolveAutoWidth(img, explicitWidth);
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

    private resolveAutoWidth(img: HTMLImageElement, explicitWidth: number | undefined): string {
        const width = explicitWidth
            ?? this.explicitWidths.get(img)
            ?? this.parseNumber(img.getAttribute('width'))
            ?? positiveNumber(img.getBoundingClientRect?.().width)
            ?? positiveNumber(img.width);
        return width ? `${width}px` : '100%';
    }

    private findLayoutContainer(img: HTMLImageElement, host: HTMLElement): HTMLElement | null {
        const selector = '.image-embed, .external-embed, .cm-embed-block, .image-resize-container';
        if (host.matches(selector)) return host;
        const container = img.closest(selector);
        return isHtmlElementNode(container) ? container : null;
    }

    private parseNumber(value: string | null): number | undefined {
        if (!value) return undefined;
        return positiveNumber(Number.parseInt(value, 10));
    }

    private getDefaultDocument(): Document {
        if (typeof activeDocument !== 'undefined') return activeDocument;
        return document;
    }

    private getCaptionKey(img: HTMLImageElement): string {
        let key = this.captionKeys.get(img);
        if (!key) {
            key = `image-caption-${Math.random().toString(36).slice(2)}`;
            this.captionKeys.set(img, key);
        }
        return key;
    }

    private applyLayoutAttributes(
        caption: HTMLElement,
        host: HTMLElement,
        context: CaptionRenderContext
    ): void {
        const alignment = context.layout?.alignment ?? 'center';
        const wrap = context.layout?.wrap === true;
        const standalone = context.standalone !== false;
        setAttributeIfChanged(caption, 'data-image-assistant-caption-align', alignment);
        setAttributeIfChanged(caption, 'data-image-assistant-caption-wrap', wrap ? 'true' : 'false');
        setAttributeIfChanged(caption, 'data-image-assistant-caption-standalone', standalone ? 'true' : 'false');
        setAttributeIfChanged(host, 'data-image-assistant-caption-align', alignment);
        setAttributeIfChanged(host, 'data-image-assistant-caption-wrap', wrap ? 'true' : 'false');
        setAttributeIfChanged(host, 'data-image-assistant-caption-standalone', standalone ? 'true' : 'false');
        if (context.sourceKey) {
            setAttributeIfChanged(caption, 'data-image-assistant-source-key', context.sourceKey);
        } else {
            caption.removeAttribute('data-image-assistant-source-key');
        }
    }

    private isStandaloneImageParagraph(paragraph: HTMLElement, image: HTMLImageElement): boolean {
        return Array.from(paragraph.childNodes).every(node =>
            node === image
            || isTextNode(node) && !node.textContent?.trim()
            || isHtmlElementNode(node) && node.matches(DOM_CAPTION_SELECTOR)
        );
    }

    private ensureWidthTracking(img: HTMLImageElement): void {
        const explicitWidth = this.explicitWidths.get(img);
        const widthMode = this.widthModes.get(img) ?? 'auto';
        if (widthMode === 'container' || explicitWidth !== undefined) {
            this.releaseWidthTracking(img);
            return;
        }

        const ownerDocument = img.ownerDocument;
        if (this.trackedDocuments.get(img) === ownerDocument) return;
        this.releaseWidthTracking(img);

        const OwnerResizeObserver = img.ownerDocument.defaultView?.ResizeObserver
            ?? (typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver);
        if (OwnerResizeObserver) {
            const tracker = this.getOrCreateWidthTracker(
                ownerDocument,
                OwnerResizeObserver
            );
            tracker.images.add(img);
            tracker.observer.observe(img);
            this.trackedDocuments.set(img, ownerDocument);
            return;
        }

        if (!this.loadHandlers.has(img)) {
            const handler = () => this.refreshTrackedWidth(img);
            img.addEventListener('load', handler);
            this.loadHandlers.set(img, handler);
        }
    }

    private refreshTrackedWidth(img: HTMLImageElement): void {
        const target = this.findTarget(img);
        if (!target) return;
        const caption = this.findExistingCaption(target, this.getCaptionKey(img));
        if (!caption) return;
        this.syncWidthVariable(
            target,
            img,
            caption,
            this.explicitWidths.get(img),
            this.widthModes.get(img) ?? 'auto'
        );
    }

    private releaseWidthTracking(img: HTMLImageElement): void {
        const ownerDocument = this.trackedDocuments.get(img);
        const tracker = ownerDocument
            ? this.widthTrackers.get(ownerDocument)
            : undefined;
        if (tracker) {
            tracker.images.delete(img);
            tracker.pendingWidths.delete(img);
            tracker.observer.unobserve?.(img);
            if (tracker.images.size === 0) {
                tracker.cancelScheduledFlush?.();
                tracker.cancelScheduledFlush = null;
                tracker.observer.disconnect();
                this.widthTrackers.delete(ownerDocument!);
            }
        }
        this.trackedDocuments.delete(img);
        const handler = this.loadHandlers.get(img);
        if (handler) img.removeEventListener('load', handler);
        this.loadHandlers.delete(img);
    }

    private getOrCreateWidthTracker(
        ownerDocument: Document,
        Observer: typeof ResizeObserver
    ): CaptionWidthTracker {
        const existing = this.widthTrackers.get(ownerDocument);
        if (existing) return existing;

        const images = new Set<HTMLImageElement>();
        const pendingWidths = new Map<HTMLImageElement, number>();
        const observer = new Observer(entries => {
            for (const entry of entries) {
                if (!isHtmlImageElement(entry.target)
                    || !images.has(entry.target)) continue;
                pendingWidths.set(entry.target, entry.contentRect.width);
            }
            const current = this.widthTrackers.get(ownerDocument);
            if (current) this.scheduleWidthFlush(current);
        });
        const tracker: CaptionWidthTracker = {
            document: ownerDocument,
            observer,
            images,
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

        for (const [img, observedWidth] of measurements) {
            if (!img.isConnected || !tracker.images.has(img)) {
                this.releaseWidthTracking(img);
                continue;
            }
            const target = this.findTarget(img);
            if (!target) continue;
            const caption = this.findExistingCaption(target, this.getCaptionKey(img));
            if (!caption) continue;
            const width = positiveNumber(observedWidth)
                ? `${roundLayoutWidth(observedWidth)}px`
                : this.resolveAutoWidth(img, undefined);
            updates.push({ target, caption, width });
        }

        for (const update of updates) {
            this.applyWidthVariable(update.target, update.caption, update.width);
        }
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

function isHtmlImageElement(value: unknown): value is HTMLImageElement {
    return isHtmlElementNode(value) && value.tagName === 'IMG';
}
