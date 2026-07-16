import { IMAGE_SOURCE_KEY_ATTRIBUTE } from '../../utils/RefinedImageUtils';
import {
    CAPTION_GEOMETRY_ATTRIBUTE,
    clearLivePreviewCaptionGeometry
} from './LivePreviewCaptionGeometry';
import {
    IMAGE_LAYOUT_ALIGN_ATTRIBUTE,
    IMAGE_LAYOUT_OWNER_ATTRIBUTE,
    IMAGE_LAYOUT_WRAP_ATTRIBUTE
} from '../ImageAlignment';

export type LivePreviewLayoutScope = 'root' | 'semantic';

export interface LivePreviewTrackedImageOptions {
    standalone: boolean;
    scope: LivePreviewLayoutScope;
}

const LAYOUT_POSITIONED_ATTRIBUTE = 'data-image-assistant-layout-positioned';
const LAYOUT_OFFSET_PROPERTY = '--image-assistant-layout-offset';
const CAPTION_OFFSET_PROPERTY = '--image-assistant-caption-offset';
const CAPTION_WIDTH_PROPERTY = '--image-assistant-caption-rendered-width';

interface TrackedImage extends LivePreviewTrackedImageOptions {
    image: HTMLImageElement;
    sourceKey: string;
}

interface GeometryMeasurement {
    tracked: TrackedImage;
    owner: HTMLElement | null;
    ownerOffset: number | null;
    caption: HTMLElement | null;
    captionOffset: number | null;
    imageWidth: number;
}

type WindowWithDomConstructors = Window & {
    ResizeObserver?: typeof ResizeObserver;
    MutationObserver?: typeof MutationObserver;
};

/** Keeps CodeMirror-owned image and Caption geometry in the same coordinate space. */
export class LivePreviewImageLayoutCoordinator {
    private readonly tracked = new Map<string, TrackedImage>();
    private readonly observedElements = new Set<Element>();
    private readonly resizeObserver: ResizeObserver | null;
    private readonly mutationObserver: MutationObserver;
    private readonly ownerWindow: WindowWithDomConstructors;
    private animationFrame: number | null = null;
    private settleFrames = 0;
    private destroyed = false;

    private readonly onWindowResize = (): void => this.schedule(2);
    private readonly onPointerMove = (event: PointerEvent): void => {
        if (event.buttons !== 0) this.schedule(2);
    };
    private readonly onTransition = (): void => this.schedule(2);

    constructor(private readonly root: HTMLElement) {
        this.ownerWindow = (root.ownerDocument.defaultView ?? window) as WindowWithDomConstructors;
        const ResizeObserverConstructor = this.ownerWindow.ResizeObserver
            ?? (typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver);
        this.resizeObserver = ResizeObserverConstructor
            ? new ResizeObserverConstructor(() => this.schedule(2))
            : null;
        const MutationObserverConstructor = this.ownerWindow.MutationObserver ?? MutationObserver;
        this.mutationObserver = new MutationObserverConstructor((mutations: MutationRecord[]) => {
            if (mutations.some(mutation => mutation.type === 'childList')) this.schedule(2);
        });
        this.mutationObserver.observe(root, { childList: true, subtree: true });
        this.observeGeometryRoots();
        this.ownerWindow.addEventListener('resize', this.onWindowResize, { passive: true });
        this.ownerWindow.addEventListener('pointermove', this.onPointerMove, { passive: true });
        root.addEventListener('transitionrun', this.onTransition, { passive: true });
        root.addEventListener('transitionend', this.onTransition, { passive: true });
    }

    registerImage(
        image: HTMLImageElement,
        sourceKey: string,
        options: LivePreviewTrackedImageOptions
    ): void {
        if (this.destroyed || !this.root.contains(image)) return;
        for (const [trackedKey, previous] of this.tracked) {
            if (trackedKey === sourceKey && previous.image !== image) {
                this.releaseTrackedImage(previous);
                this.tracked.delete(trackedKey);
            } else if (trackedKey !== sourceKey && previous.image === image) {
                this.tracked.delete(trackedKey);
            }
        }
        this.tracked.set(sourceKey, { image, sourceKey, ...options });
        this.observe(image);
        const owner = findLayoutOwner(image);
        if (owner) this.observe(owner);
        this.observeGeometryRoots();
        this.schedule(2);
    }

    unregisterImage(image: HTMLImageElement): void {
        for (const [sourceKey, tracked] of this.tracked) {
            if (tracked.image !== image) continue;
            this.tracked.delete(sourceKey);
            clearLivePreviewCaptionGeometry(this.root, sourceKey);
            this.releaseTrackedImage(tracked);
        }
        clearLayoutPosition(findLayoutOwner(image));
    }

    schedule(settleFrames = 1): void {
        if (this.destroyed || this.tracked.size === 0) return;
        this.settleFrames = Math.max(this.settleFrames, settleFrames);
        if (this.animationFrame !== null) return;
        this.animationFrame = this.requestFrame(() => {
            this.animationFrame = null;
            this.flush();
        });
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.animationFrame !== null) this.cancelFrame(this.animationFrame);
        this.animationFrame = null;
        this.resizeObserver?.disconnect();
        this.mutationObserver.disconnect();
        this.ownerWindow.removeEventListener('resize', this.onWindowResize);
        this.ownerWindow.removeEventListener('pointermove', this.onPointerMove);
        this.root.removeEventListener('transitionrun', this.onTransition);
        this.root.removeEventListener('transitionend', this.onTransition);
        this.root.querySelectorAll<HTMLElement>(`[${LAYOUT_POSITIONED_ATTRIBUTE}]`)
            .forEach(clearLayoutPosition);
        this.root.querySelectorAll<HTMLElement>(`[${CAPTION_GEOMETRY_ATTRIBUTE}]`)
            .forEach(clearCaptionPosition);
        this.tracked.clear();
        this.observedElements.clear();
    }

    private flush(): void {
        if (this.destroyed) return;
        const measurements: GeometryMeasurement[] = [];
        for (const [sourceKey, tracked] of this.tracked) {
            if (!tracked.image.isConnected || !this.root.contains(tracked.image)) {
                this.tracked.delete(sourceKey);
                continue;
            }
            measurements.push(this.measure(tracked));
        }

        let changed = false;
        for (const measurement of measurements) {
            changed = this.applyOwnerMeasurement(measurement) || changed;
        }
        for (const measurement of measurements) {
            changed = this.applyCaptionMeasurement(measurement) || changed;
        }

        this.settleFrames = Math.max(0, this.settleFrames - 1);
        if (this.settleFrames > 0 || changed) {
            const remaining = changed ? Math.max(this.settleFrames, 1) : this.settleFrames;
            this.schedule(remaining);
        }
    }

    private measure(tracked: TrackedImage): GeometryMeasurement {
        const imageRect = tracked.image.getBoundingClientRect();
        const owner = findLayoutOwner(tracked.image);
        const ownerOffset = owner
            ? this.measureOwnerOffset(owner, tracked, imageRect.width)
            : null;
        const caption = findCaption(this.root, tracked.sourceKey);
        if (caption) this.observe(caption);
        const captionOffset = caption
            ? this.measureCaptionOffset(caption, imageRect.left)
            : null;
        return {
            tracked,
            owner,
            ownerOffset,
            caption,
            captionOffset,
            imageWidth: imageRect.width
        };
    }

    private measureOwnerOffset(
        owner: HTMLElement,
        tracked: TrackedImage,
        imageWidth: number
    ): number | null {
        const alignment = owner.getAttribute(IMAGE_LAYOUT_ALIGN_ATTRIBUTE);
        const wraps = owner.getAttribute(IMAGE_LAYOUT_WRAP_ATTRIBUTE) === 'true';
        if (!tracked.standalone || wraps || !isAlignment(alignment)) return null;

        const ownerRect = owner.getBoundingClientRect();
        const scopeBox = this.getScopeBox(tracked);
        if (!scopeBox || !isPositiveFinite(ownerRect.width) || !isPositiveFinite(scopeBox.width)) return null;
        const visualWidth = isPositiveFinite(imageWidth) ? Math.min(ownerRect.width, imageWidth) : ownerRect.width;
        const desiredLeft = alignment === 'left'
            ? scopeBox.left
            : alignment === 'right'
                ? scopeBox.left + Math.max(0, scopeBox.width - visualWidth)
                : scopeBox.left + Math.max(0, (scopeBox.width - visualWidth) / 2);
        const previousOffset = parsePixels(owner.style.getPropertyValue(LAYOUT_OFFSET_PROPERTY));
        const baselineLeft = ownerRect.left - previousOffset;
        return Number.isFinite(baselineLeft) ? desiredLeft - baselineLeft : null;
    }

    private measureCaptionOffset(caption: HTMLElement, imageLeft: number): number | null {
        if (caption.getAttribute('data-image-assistant-caption-width') !== 'auto'
            || caption.getAttribute('data-image-assistant-caption-wrap') === 'true'
            || !Number.isFinite(imageLeft)) {
            return null;
        }
        const captionRect = caption.getBoundingClientRect();
        const previousOffset = parsePixels(caption.style.getPropertyValue(CAPTION_OFFSET_PROPERTY));
        const baselineLeft = captionRect.left - previousOffset;
        return Number.isFinite(baselineLeft) ? imageLeft - baselineLeft : null;
    }

    private applyOwnerMeasurement(measurement: GeometryMeasurement): boolean {
        const { owner, ownerOffset } = measurement;
        if (!owner || ownerOffset === null) {
            return clearLayoutPosition(owner);
        }
        let changed = setAttributeIfChanged(owner, LAYOUT_POSITIONED_ATTRIBUTE, 'true');
        changed = setPropertyIfChanged(owner, LAYOUT_OFFSET_PROPERTY, toPixels(ownerOffset)) || changed;
        return changed;
    }

    private applyCaptionMeasurement(measurement: GeometryMeasurement): boolean {
        const { caption, captionOffset, imageWidth } = measurement;
        if (!caption || captionOffset === null || !isPositiveFinite(imageWidth)) {
            return clearCaptionPosition(caption);
        }
        let changed = setAttributeIfChanged(caption, CAPTION_GEOMETRY_ATTRIBUTE, 'true');
        changed = setPropertyIfChanged(caption, CAPTION_WIDTH_PROPERTY, toPixels(imageWidth)) || changed;
        changed = setPropertyIfChanged(caption, CAPTION_OFFSET_PROPERTY, toPixels(captionOffset)) || changed;
        return changed;
    }

    private getScopeBox(tracked: TrackedImage): { left: number; width: number } | null {
        const editor = tracked.image.closest('.cm-editor');
        const semantic = tracked.scope === 'semantic'
            ? tracked.image.closest(
                '.callout-content, .admonition-content, li, blockquote, '
                + '.HyperMD-list-line, .HyperMD-quote, .cm-line'
            )
            : null;
        const scope = semantic
            ?? editor?.querySelector('.cm-content')
            ?? editor?.querySelector('.cm-contentContainer')
            ?? this.root;
        if (!scope || (scope as Node).nodeType !== 1) return null;
        const rect = scope.getBoundingClientRect();
        const style = this.ownerWindow.getComputedStyle(scope);
        const paddingLeft = parsePixels(style.paddingLeft);
        const paddingRight = parsePixels(style.paddingRight);
        return {
            left: rect.left + paddingLeft,
            width: Math.max(0, rect.width - paddingLeft - paddingRight)
        };
    }

    private observeGeometryRoots(): void {
        this.observe(this.root);
        this.root.querySelectorAll(
            '.cm-editor, .cm-scroller, .cm-sizer, .cm-contentContainer, .cm-content'
        ).forEach(element => this.observe(element));
    }

    private observe(element: Element): void {
        if (!this.resizeObserver || this.observedElements.has(element)) return;
        this.resizeObserver.observe(element);
        this.observedElements.add(element);
    }

    private releaseTrackedImage(tracked: TrackedImage): void {
        const owner = findLayoutOwner(tracked.image);
        clearLayoutPosition(owner);
        this.unobserveIfUnused(tracked.image, tracked);
        if (owner && owner !== tracked.image) this.unobserveIfUnused(owner, tracked);
    }

    private unobserveIfUnused(element: Element, released: TrackedImage): void {
        const stillUsed = [...this.tracked.values()].some(tracked => tracked !== released
            && (tracked.image === element || findLayoutOwner(tracked.image) === element));
        if (stillUsed || element === this.root) return;
        this.resizeObserver?.unobserve(element);
        this.observedElements.delete(element);
    }

    private requestFrame(callback: FrameRequestCallback): number {
        if (typeof this.ownerWindow.requestAnimationFrame === 'function') {
            return this.ownerWindow.requestAnimationFrame(callback);
        }
        return this.ownerWindow.setTimeout(() => callback(Date.now()), 16);
    }

    private cancelFrame(handle: number): void {
        if (typeof this.ownerWindow.cancelAnimationFrame === 'function') {
            this.ownerWindow.cancelAnimationFrame(handle);
        } else {
            this.ownerWindow.clearTimeout(handle);
        }
    }
}

function findLayoutOwner(image: HTMLImageElement): HTMLElement | null {
    if (image.hasAttribute(IMAGE_LAYOUT_OWNER_ATTRIBUTE)) return image;
    const owner = image.closest<HTMLElement>(`[${IMAGE_LAYOUT_OWNER_ATTRIBUTE}]`);
    return owner ?? image;
}

function findCaption(root: ParentNode, sourceKey: string): HTMLElement | null {
    return Array.from(root.querySelectorAll<HTMLElement>(
        '.image-assistant-live-preview-caption[data-image-assistant-caption-renderer="codemirror"]'
    )).find(caption => caption.getAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE) === sourceKey) ?? null;
}

function clearLayoutPosition(owner: HTMLElement | null): boolean {
    if (!owner) return false;
    let changed = false;
    if (owner.hasAttribute(LAYOUT_POSITIONED_ATTRIBUTE)) {
        owner.removeAttribute(LAYOUT_POSITIONED_ATTRIBUTE);
        changed = true;
    }
    if (owner.style.getPropertyValue(LAYOUT_OFFSET_PROPERTY)) {
        owner.style.removeProperty(LAYOUT_OFFSET_PROPERTY);
        changed = true;
    }
    return changed;
}

function clearCaptionPosition(caption: HTMLElement | null): boolean {
    if (!caption) return false;
    let changed = false;
    if (caption.hasAttribute(CAPTION_GEOMETRY_ATTRIBUTE)) {
        caption.removeAttribute(CAPTION_GEOMETRY_ATTRIBUTE);
        changed = true;
    }
    for (const property of [CAPTION_WIDTH_PROPERTY, CAPTION_OFFSET_PROPERTY]) {
        if (!caption.style.getPropertyValue(property)) continue;
        caption.style.removeProperty(property);
        changed = true;
    }
    return changed;
}

function isAlignment(value: string | null): value is 'left' | 'center' | 'right' {
    return value === 'left' || value === 'center' || value === 'right';
}

function isPositiveFinite(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}

function parsePixels(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function toPixels(value: number): string {
    const rounded = Math.round(value * 1000) / 1000;
    return `${Object.is(rounded, -0) ? 0 : rounded}px`;
}

function setAttributeIfChanged(element: Element, name: string, value: string): boolean {
    if (element.getAttribute(name) === value) return false;
    element.setAttribute(name, value);
    return true;
}

function setPropertyIfChanged(element: HTMLElement, name: string, value: string): boolean {
    if (element.style.getPropertyValue(name) === value) return false;
    element.style.setProperty(name, value);
    return true;
}
