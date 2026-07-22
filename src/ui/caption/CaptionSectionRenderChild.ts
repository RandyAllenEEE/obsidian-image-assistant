import { MarkdownRenderChild } from 'obsidian';
import type { CaptionSectionBinding } from './CaptionRenderCoordinator';
import type { ReadingImageContext } from './types';
import { isElementNode, isHtmlImageElement } from './CaptionDomUtils';

/** Watches one rendered Markdown section for delayed embeds and Admonition output. */
export class CaptionSectionRenderChild extends MarkdownRenderChild {
    private observer: MutationObserver | null = null;
    private scheduled = false;
    private cancelScheduledProcess: (() => void) | null = null;
    private unloaded = false;
    private readonly processedSignatures = new WeakMap<HTMLImageElement, string>();
    private readonly knownImages = new Set<HTMLImageElement>();

    constructor(
        containerEl: HTMLElement,
        private readonly binding: CaptionSectionBinding | null,
        private readonly onImage: (image: HTMLImageElement, context: ReadingImageContext) => void,
        private readonly onRemove?: (image: HTMLImageElement) => void
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
            attributeFilter: ['src', 'data-src', 'alt']
        });
    }

    onunload(): void {
        this.unloaded = true;
        this.cancelScheduledProcess?.();
        this.cancelScheduledProcess = null;
        this.scheduled = false;
        this.observer?.disconnect();
        this.observer = null;
        for (const image of this.knownImages) this.releaseImage(image);
        this.knownImages.clear();
        super.onunload();
    }

    private hasRelevantChange(record: MutationRecord): boolean {
        if (record.type === 'attributes') {
            return isHtmlImageElement(record.target)
                || isElementNode(record.target)
                    && !!record.target.closest('.internal-embed, .external-embed, .image-wrapper');
        }

        return [...record.addedNodes, ...record.removedNodes].some(node => {
            if (isOwnedCaptionNode(node)) return false;
            if (isHtmlImageElement(node)) return true;
            return isElementNode(node) && !!node.querySelector('img');
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
        const images = Array.from(this.containerEl.querySelectorAll('img'))
            .filter(isHtmlImageElement);
        const current = new Set(images);
        for (const image of this.knownImages) {
            if (!current.has(image)) this.releaseImage(image);
        }

        const descriptors = this.binding?.resolveImages(images) ?? new Map();
        for (const image of images) {
            this.knownImages.add(image);
            const descriptor = descriptors.get(image) ?? null;
            const signature = [
                image.getAttribute('src') ?? '',
                image.getAttribute('data-src') ?? '',
                image.getAttribute('alt') ?? '',
                descriptor?.source ?? ''
            ].join('\u0000');
            if (this.processedSignatures.get(image) === signature) continue;
            this.processedSignatures.set(image, signature);
            this.onImage(image, {
                linkText: descriptor?.source ?? null,
                descriptor
            });
        }
    }

    private releaseImage(image: HTMLImageElement): void {
        this.binding?.releaseImage(image);
        this.processedSignatures.delete(image);
        this.knownImages.delete(image);
        this.onRemove?.(image);
    }
}

function isOwnedCaptionNode(node: Node): boolean {
    return isElementNode(node)
        && (node.hasAttribute('data-image-assistant-caption-renderer')
            || !!node.closest('[data-image-assistant-caption-renderer]'));
}
