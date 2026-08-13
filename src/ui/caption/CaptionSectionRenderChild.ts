import { MarkdownRenderChild } from 'obsidian';
import type { CaptionSectionBinding } from './CaptionRenderCoordinator';
import type { ReadingImageContext } from './types';
import { isElementNode, isHtmlImageElement } from './CaptionDomUtils';
import { collectRenderedMediaLayoutTargets } from '../RenderedMediaLayoutTarget';
import { findExcalidrawRenderedEmbed } from '../../drawing/excalidraw/ExcalidrawRenderedEmbed';

/** Watches one rendered Markdown section for delayed embeds and Admonition output. */
export class CaptionSectionRenderChild extends MarkdownRenderChild {
    private observer: MutationObserver | null = null;
    private scheduled = false;
    private cancelScheduledProcess: (() => void) | null = null;
    private unloaded = false;
    private readonly processedSignatures = new WeakMap<Element, string>();
    private readonly knownMedia = new Set<Element>();

    constructor(
        containerEl: HTMLElement,
        private readonly binding: CaptionSectionBinding | null,
        private readonly onImage: (image: HTMLImageElement, context: ReadingImageContext) => void,
        private readonly onRemove?: (image: HTMLImageElement) => void,
        private readonly onExternalMedia?: (media: Element, context: ReadingImageContext) => void,
        private readonly onRemoveExternalMedia?: (media: Element) => void
    ) {
        super(containerEl);
    }

    onload(): void {
        this.unloaded = false;
        this.processImages();
        const Observer = this.containerEl.ownerDocument.defaultView?.MutationObserver
            ?? MutationObserver;
        this.observer = new Observer(records => {
            if (!records.some(record => this.hasRelevantChange(record))) return;
            this.scheduleProcess();
        });
        this.observer.observe(this.containerEl, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
                'src', 'data-src', 'alt', 'class', 'filesource', 'fileSource'
            ]
        });
    }

    onunload(): void {
        this.unloaded = true;
        this.cancelScheduledProcess?.();
        this.cancelScheduledProcess = null;
        this.scheduled = false;
        this.observer?.disconnect();
        this.observer = null;
        for (const media of this.knownMedia) this.releaseMedia(media);
        this.knownMedia.clear();
        super.onunload();
    }

    private hasRelevantChange(record: MutationRecord): boolean {
        if (record.type === 'attributes') {
            if (!isElementNode(record.target)) return false;
            return !!record.target.closest('.image-embed')
                || findExcalidrawRenderedEmbed(record.target) !== null;
        }

        return [...record.addedNodes, ...record.removedNodes].some(node => {
            if (isOwnedCaptionNode(node)) return false;
            if (!isElementNode(node)) return false;
            return collectRenderedMediaLayoutTargets(node).length > 0;
        });
    }

    private scheduleProcess(): void {
        if (this.scheduled) return;
        this.scheduled = true;
        const run = () => {
            this.cancelScheduledProcess = null;
            this.scheduled = false;
            if (this.unloaded) return;
            this.processImages();
        };
        const ownerWindow = this.containerEl.ownerDocument.defaultView;
        if (ownerWindow?.requestAnimationFrame) {
            const frame = ownerWindow.requestAnimationFrame(run);
            this.cancelScheduledProcess = () => ownerWindow.cancelAnimationFrame(frame);
            return;
        }
        const timer = setTimeout(run, 16);
        this.cancelScheduledProcess = () => clearTimeout(timer);
    }

    private processImages(): void {
        const media = collectRenderedMediaLayoutTargets(this.containerEl)
            .map(target => target.visual);
        const current = new Set(media);
        for (const known of this.knownMedia) {
            if (!current.has(known)) this.releaseMedia(known);
        }

        const descriptors = this.binding?.resolveMedia(media) ?? new Map();
        for (const element of media) {
            this.knownMedia.add(element);
            const descriptor = descriptors.get(element) ?? null;
            const signature = [
                element.getAttribute('src') ?? '',
                element.getAttribute('data-src') ?? '',
                element.getAttribute('alt') ?? '',
                element.getAttribute('fileSource') ?? '',
                descriptor?.source ?? ''
            ].join('\u0000');
            if (this.processedSignatures.get(element) === signature) continue;
            this.processedSignatures.set(element, signature);
            const context = {
                linkText: descriptor?.source ?? null,
                descriptor
            };
            if (isHtmlImageElement(element)) this.onImage(element, context);
            else this.onExternalMedia?.(element, context);
        }
    }

    private releaseMedia(media: Element): void {
        this.binding?.releaseMedia(media);
        this.processedSignatures.delete(media);
        this.knownMedia.delete(media);
        if (isHtmlImageElement(media)) this.onRemove?.(media);
        else this.onRemoveExternalMedia?.(media);
    }
}

function isOwnedCaptionNode(node: Node): boolean {
    return isElementNode(node)
        && (node.hasAttribute('data-image-assistant-caption-renderer')
            || !!node.closest('[data-image-assistant-caption-renderer]'));
}
