import { IMAGE_LAYOUT_KEY_ATTRIBUTE } from '../../utils/RefinedImageUtils';
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

export interface LivePreviewGeometrySnapshot {
    imageLeft: number;
    imageWidth: number;
}

export const CAPTION_GEOMETRY_ATTRIBUTE = 'data-image-assistant-caption-positioned';

const LAYOUT_POSITIONED_ATTRIBUTE = 'data-image-assistant-layout-positioned';
const LAYOUT_OFFSET_PROPERTY = '--image-assistant-layout-offset';
const CAPTION_OFFSET_PROPERTY = '--image-assistant-caption-offset';
const CAPTION_WIDTH_PROPERTY = '--image-assistant-caption-rendered-width';
const REQUIRED_STABLE_FRAMES = 3;
const MAX_SETTLE_FRAMES = 12;

interface TrackedImage extends LivePreviewTrackedImageOptions {
    image: HTMLImageElement;
    layoutKey: string;
}

interface GeometryMeasurement {
    tracked: TrackedImage;
    owner: HTMLElement | null;
    ownerEligible: boolean;
    ownerOffset: number | null;
    caption: HTMLElement | null;
    captionEligible: boolean;
    captionOffset: number | null;
    imageWidth: number | null;
    signature: string;
}

type WindowWithDomConstructors = Window & {
    ResizeObserver?: typeof ResizeObserver;
    MutationObserver?: typeof MutationObserver;
};

/** Keeps CodeMirror-owned image and Caption geometry in one coordinate space. */
export class LivePreviewImageLayoutCoordinator {
    private readonly tracked = new Map<string, TrackedImage>();
    private readonly lastValidGeometry = new Map<string, LivePreviewGeometrySnapshot>();
    private readonly captionElements = new Map<string, HTMLElement>();
    private readonly observedElements = new Set<Element>();
    private readonly resizeObserver: ResizeObserver | null;
    private readonly mutationObserver: MutationObserver;
    private readonly ownerWindow: WindowWithDomConstructors;
    private readonly ownerDocument: Document;
    private animationFrame: number | null = null;
    private frameCount = 0;
    private stableFrames = 0;
    private requiredStableFrames = REQUIRED_STABLE_FRAMES;
    private previousSignature = '';
    private destroyed = false;

    private readonly onWindowResize = (): void => this.schedule();
    private readonly onPointerMove = (event: PointerEvent | MouseEvent): void => {
        if (event.buttons !== 0) this.schedule();
    };
    private readonly onGeometryEvent = (): void => this.schedule();
    private readonly onVisibilityChange = (): void => {
        if (this.ownerDocument.visibilityState !== 'hidden') this.schedule();
    };
    private readonly onImageLoad = (event: Event): void => {
        if (isImage(event.target)) this.schedule();
    };

    constructor(private readonly root: HTMLElement) {
        this.ownerDocument = root.ownerDocument;
        this.ownerWindow = (this.ownerDocument.defaultView ?? window) as WindowWithDomConstructors;
        const ResizeObserverConstructor = this.ownerWindow.ResizeObserver
            ?? (typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver);
        this.resizeObserver = ResizeObserverConstructor
            ? new ResizeObserverConstructor(() => this.schedule())
            : null;
        const MutationObserverConstructor = this.ownerWindow.MutationObserver ?? MutationObserver;
        this.mutationObserver = new MutationObserverConstructor((mutations: MutationRecord[]) => {
            if (mutations.some(mutation => mutation.type === 'childList')) this.schedule();
        });
        this.mutationObserver.observe(root, { childList: true, subtree: true });
        this.observeGeometryRoots();
        this.ownerWindow.addEventListener('resize', this.onWindowResize, { passive: true });
        this.ownerWindow.addEventListener('focus', this.onGeometryEvent, { passive: true });
        this.ownerWindow.addEventListener('pointermove', this.onPointerMove, { passive: true });
        this.ownerWindow.addEventListener('mousemove', this.onPointerMove, { passive: true });
        this.ownerDocument.addEventListener('scroll', this.onGeometryEvent, { capture: true, passive: true });
        this.ownerDocument.addEventListener('transitionrun', this.onGeometryEvent, { capture: true, passive: true });
        this.ownerDocument.addEventListener('transitionend', this.onGeometryEvent, { capture: true, passive: true });
        this.ownerDocument.addEventListener('visibilitychange', this.onVisibilityChange);
        root.addEventListener('load', this.onImageLoad, true);
    }

    registerImage(
        image: HTMLImageElement,
        layoutKey: string,
        options: LivePreviewTrackedImageOptions
    ): void {
        if (this.destroyed || !this.root.contains(image)) return;
        for (const [trackedKey, previous] of this.tracked) {
            if (trackedKey === layoutKey && previous.image !== image) {
                this.releaseTrackedImage(previous, false);
                this.tracked.delete(trackedKey);
            } else if (trackedKey !== layoutKey && previous.image === image) {
                const snapshot = this.lastValidGeometry.get(trackedKey);
                if (snapshot) this.lastValidGeometry.set(layoutKey, snapshot);
                this.clearCaptionForKey(trackedKey);
                this.lastValidGeometry.delete(trackedKey);
                this.tracked.delete(trackedKey);
            }
        }
        this.tracked.set(layoutKey, { image, layoutKey, ...options });
        setAttributeIfChanged(image, IMAGE_LAYOUT_KEY_ATTRIBUTE, layoutKey);
        this.observe(image);
        const owner = findLayoutOwner(image);
        if (owner) this.observe(owner);
        this.observeGeometryRoots();
        this.schedule();
    }

    unregisterImage(image: HTMLImageElement): void {
        for (const [layoutKey, tracked] of this.tracked) {
            if (tracked.image !== image) continue;
            this.tracked.delete(layoutKey);
            this.lastValidGeometry.delete(layoutKey);
            this.clearCaptionForKey(layoutKey);
            this.releaseTrackedImage(tracked, true);
        }
        clearLayoutPosition(findLayoutOwner(image));
        image.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE);
    }

    /** Releases a virtualized DOM node while retaining geometry for its replacement. */
    detachImage(image: HTMLImageElement): void {
        for (const [layoutKey, tracked] of this.tracked) {
            if (tracked.image !== image) continue;
            this.tracked.delete(layoutKey);
            this.releaseTrackedImage(tracked, true);
        }
        image.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE);
    }

    /** Drops retained geometry only after the source index confirms the link is gone. */
    reconcileSourceKeys(sourceKeys: ReadonlySet<string>): void {
        for (const [layoutKey, tracked] of [...this.tracked]) {
            if (sourceKeys.has(layoutKey)) continue;
            this.tracked.delete(layoutKey);
            this.releaseTrackedImage(tracked, true);
        }
        for (const layoutKey of [...this.lastValidGeometry.keys()]) {
            if (sourceKeys.has(layoutKey)) continue;
            this.lastValidGeometry.delete(layoutKey);
            this.clearCaptionForKey(layoutKey);
        }
    }

    schedule(settleFrames = REQUIRED_STABLE_FRAMES): void {
        if (this.destroyed || this.tracked.size === 0) return;
        this.requiredStableFrames = Math.max(
            1,
            Math.min(MAX_SETTLE_FRAMES, Math.round(settleFrames))
        );
        this.frameCount = 0;
        this.stableFrames = 0;
        this.requestNextFrame();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.animationFrame !== null) this.cancelFrame(this.animationFrame);
        this.animationFrame = null;
        this.resizeObserver?.disconnect();
        this.mutationObserver.disconnect();
        this.ownerWindow.removeEventListener('resize', this.onWindowResize);
        this.ownerWindow.removeEventListener('focus', this.onGeometryEvent);
        this.ownerWindow.removeEventListener('pointermove', this.onPointerMove);
        this.ownerWindow.removeEventListener('mousemove', this.onPointerMove);
        this.ownerDocument.removeEventListener('scroll', this.onGeometryEvent, true);
        this.ownerDocument.removeEventListener('transitionrun', this.onGeometryEvent, true);
        this.ownerDocument.removeEventListener('transitionend', this.onGeometryEvent, true);
        this.ownerDocument.removeEventListener('visibilitychange', this.onVisibilityChange);
        this.root.removeEventListener('load', this.onImageLoad, true);
        this.root.querySelectorAll<HTMLElement>(`[${LAYOUT_POSITIONED_ATTRIBUTE}]`)
            .forEach(clearLayoutPosition);
        this.root.querySelectorAll<HTMLElement>(`[${CAPTION_GEOMETRY_ATTRIBUTE}]`)
            .forEach(clearCaptionPosition);
        this.root.querySelectorAll(`[${IMAGE_LAYOUT_KEY_ATTRIBUTE}]`)
            .forEach(element => element.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE));
        this.tracked.clear();
        this.lastValidGeometry.clear();
        this.captionElements.clear();
        this.observedElements.clear();
    }

    private requestNextFrame(): void {
        if (this.animationFrame !== null || this.destroyed) return;
        this.animationFrame = this.requestFrame(() => {
            this.animationFrame = null;
            this.flush();
        });
    }

    private flush(): void {
        if (this.destroyed) return;
        const measurements: GeometryMeasurement[] = [];
        const captionIndex = buildCaptionIndex(this.root);
        for (const [layoutKey, tracked] of [...this.tracked]) {
            if (!tracked.image.isConnected || !this.root.contains(tracked.image)) {
                this.tracked.delete(layoutKey);
                this.releaseTrackedImage(tracked, true);
                continue;
            }
            measurements.push(this.measure(tracked, captionIndex));
        }

        let changed = false;
        for (const measurement of measurements) {
            changed = this.applyOwnerMeasurement(measurement) || changed;
        }
        for (const measurement of measurements) {
            changed = this.applyCaptionMeasurement(measurement) || changed;
        }
        this.pruneObservedElements();

        const signature = measurements.map(measurement => measurement.signature).join('|');
        if (!changed && signature === this.previousSignature) this.stableFrames++;
        else this.stableFrames = 0;
        this.previousSignature = signature;
        this.frameCount++;

        if (this.tracked.size > 0
            && this.stableFrames < this.requiredStableFrames
            && this.frameCount < MAX_SETTLE_FRAMES) {
            this.requestNextFrame();
        }
    }

    private measure(
        tracked: TrackedImage,
        captionIndex: ReadonlyMap<string, HTMLElement>
    ): GeometryMeasurement {
        const imageRect = tracked.image.getBoundingClientRect();
        const imageValid = isPositiveFinite(imageRect.width) && Number.isFinite(imageRect.left);
        if (imageValid) {
            this.lastValidGeometry.set(tracked.layoutKey, {
                imageLeft: imageRect.left,
                imageWidth: imageRect.width
            });
        }
        const geometry = imageValid
            ? { imageLeft: imageRect.left, imageWidth: imageRect.width }
            : this.lastValidGeometry.get(tracked.layoutKey);

        const owner = findLayoutOwner(tracked.image);
        if (owner) this.observe(owner);
        const alignment = owner?.getAttribute(IMAGE_LAYOUT_ALIGN_ATTRIBUTE) ?? null;
        const wraps = owner?.getAttribute(IMAGE_LAYOUT_WRAP_ATTRIBUTE) === 'true';
        const ownerEligible = !!owner && tracked.standalone && !wraps && isAlignment(alignment);
        const ownerOffset = ownerEligible && imageValid
            ? this.measureOwnerOffset(owner, tracked, imageRect.width, alignment)
            : null;

        const caption = captionIndex.get(tracked.layoutKey) ?? null;
        this.trackCaptionElement(tracked.layoutKey, caption);
        const captionEligible = !!caption
            && caption.getAttribute('data-image-assistant-caption-width') === 'auto'
            && caption.getAttribute('data-image-assistant-caption-wrap') !== 'true';
        const captionOffset = captionEligible && geometry
            ? this.measureCaptionOffset(caption, geometry.imageLeft)
            : null;

        return {
            tracked,
            owner,
            ownerEligible,
            ownerOffset,
            caption,
            captionEligible,
            captionOffset,
            imageWidth: geometry?.imageWidth ?? null,
            signature: [
                tracked.layoutKey,
                imageValid ? imageRect.left : 'pending',
                imageValid ? imageRect.width : 'pending',
                ownerOffset ?? 'unchanged',
                captionOffset ?? 'unchanged'
            ].join(':')
        };
    }

    private measureOwnerOffset(
        owner: HTMLElement,
        tracked: TrackedImage,
        imageWidth: number,
        alignment: 'left' | 'center' | 'right'
    ): number | null {
        const ownerRect = owner.getBoundingClientRect();
        const scopeBox = this.getScopeBox(tracked);
        if (!scopeBox || !isPositiveFinite(ownerRect.width) || !isPositiveFinite(scopeBox.width)) return null;
        const visualWidth = Math.min(ownerRect.width, imageWidth);
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
        const captionRect = caption.getBoundingClientRect();
        const previousOffset = parsePixels(caption.style.getPropertyValue(CAPTION_OFFSET_PROPERTY));
        const baselineLeft = captionRect.left - previousOffset;
        return Number.isFinite(baselineLeft) ? imageLeft - baselineLeft : null;
    }

    private applyOwnerMeasurement(measurement: GeometryMeasurement): boolean {
        const { owner, ownerEligible, ownerOffset } = measurement;
        if (!owner) return false;
        if (!ownerEligible) return clearLayoutPosition(owner);
        if (ownerOffset === null) return false;
        let changed = setAttributeIfChanged(owner, LAYOUT_POSITIONED_ATTRIBUTE, 'true');
        changed = setPropertyIfChanged(owner, LAYOUT_OFFSET_PROPERTY, toPixels(ownerOffset)) || changed;
        return changed;
    }

    private applyCaptionMeasurement(measurement: GeometryMeasurement): boolean {
        const { caption, captionEligible, captionOffset, imageWidth } = measurement;
        if (!caption) return false;
        if (!captionEligible) return clearCaptionPosition(caption);
        if (captionOffset === null || imageWidth === null || !isPositiveFinite(imageWidth)) return false;
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
        if (!isElement(scope)) return null;
        this.observe(scope);
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
        const leaf = this.root.closest('.workspace-leaf-content, .view-content, .markdown-source-view');
        if (leaf) this.observe(leaf);
        this.root.querySelectorAll(
            '.cm-editor, .cm-scroller, .cm-sizer, .cm-contentContainer, .cm-content'
        ).forEach(element => this.observe(element));
    }

    private observe(element: Element): void {
        if (!this.resizeObserver || this.observedElements.has(element)) return;
        this.resizeObserver.observe(element);
        this.observedElements.add(element);
    }

    private trackCaptionElement(layoutKey: string, caption: HTMLElement | null): void {
        const previous = this.captionElements.get(layoutKey);
        if (previous && previous !== caption) {
            clearCaptionPosition(previous);
            this.resizeObserver?.unobserve(previous);
            this.observedElements.delete(previous);
            this.captionElements.delete(layoutKey);
        }
        if (!caption) return;
        this.captionElements.set(layoutKey, caption);
        this.observe(caption);
    }

    private clearCaptionForKey(layoutKey: string): void {
        const caption = this.captionElements.get(layoutKey)
            ?? findCaption(this.root, layoutKey);
        if (caption) {
            clearCaptionPosition(caption);
            this.resizeObserver?.unobserve(caption);
            this.observedElements.delete(caption);
        }
        this.captionElements.delete(layoutKey);
    }

    private releaseTrackedImage(tracked: TrackedImage, clearOwner: boolean): void {
        const owner = findLayoutOwner(tracked.image);
        if (clearOwner) clearLayoutPosition(owner);
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

    private pruneObservedElements(): void {
        for (const element of [...this.observedElements]) {
            if (element === this.root || element.isConnected) continue;
            this.resizeObserver?.unobserve(element);
            this.observedElements.delete(element);
        }
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
    return image.closest<HTMLElement>(`[${IMAGE_LAYOUT_OWNER_ATTRIBUTE}]`) ?? image;
}

function findCaption(root: ParentNode, layoutKey: string): HTMLElement | null {
    return buildCaptionIndex(root).get(layoutKey) ?? null;
}

function buildCaptionIndex(root: ParentNode): Map<string, HTMLElement> {
    const index = new Map<string, HTMLElement>();
    root.querySelectorAll<HTMLElement>(
        '.image-assistant-live-preview-caption[data-image-assistant-caption-renderer="codemirror"]'
    ).forEach(caption => {
        const layoutKey = caption.getAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE);
        if (layoutKey && !index.has(layoutKey)) index.set(layoutKey, caption);
    });
    return index;
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

function clearCaptionPosition(caption: HTMLElement): boolean {
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

function isElement(value: unknown): value is Element {
    return !!value && typeof value === 'object' && (value as Node).nodeType === 1;
}

function isImage(value: unknown): value is HTMLImageElement {
    return isElement(value) && value.tagName === 'IMG';
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
