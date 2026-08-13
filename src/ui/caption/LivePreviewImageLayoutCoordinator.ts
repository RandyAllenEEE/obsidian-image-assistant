import { IMAGE_LAYOUT_KEY_ATTRIBUTE } from '../../utils/RefinedImageUtils';
import type { HorizontalImageAlignment } from '../ImageLayoutResolver';
import {
    type RenderedMediaLayoutTarget
} from '../RenderedMediaLayoutTarget';

export type LivePreviewLayoutScope = 'root' | 'semantic';

/** Complete semantic layout state used by the primary target-based API. */
export interface LivePreviewTrackedTargetOptions {
    standalone: boolean;
    scope: LivePreviewLayoutScope | Element;
    alignment: HorizontalImageAlignment | null;
    wrap: boolean;
}

export interface LivePreviewGeometrySnapshot {
    /** Last validated visual edge, not a reusable CSS offset. */
    imageLeft: number;
    imageWidth: number;
    scopeLeft: number;
    scopeWidth: number;
    alignment: HorizontalImageAlignment;
}

export const LAYOUT_POSITIONED_ATTRIBUTE = 'data-image-assistant-layout-positioned';
export const CAPTION_GEOMETRY_ATTRIBUTE = 'data-image-assistant-caption-positioned';

const LAYOUT_OFFSET_PROPERTY = '--image-assistant-layout-offset';
const CAPTION_OFFSET_PROPERTY = '--image-assistant-caption-offset';
const CAPTION_WIDTH_PROPERTY = '--image-assistant-caption-rendered-width';
const CAPTION_SELECTOR =
    '.image-assistant-live-preview-caption[data-image-assistant-caption-renderer="codemirror"]';
const CODE_MIRROR_LAYOUT_CONTAINER_SELECTOR = '.cm-line, .cm-embed-block, .cm-content';
const REQUIRED_STABLE_FRAMES = 3;
const MAX_SETTLE_FRAMES = 12;
const SEMANTIC_SCOPE_SELECTOR = [
    '.callout-content',
    '.admonition-content',
    'li',
    'blockquote',
    '.HyperMD-list-line',
    '.HyperMD-quote'
].join(', ');

interface TrackedTarget {
    readonly target: RenderedMediaLayoutTarget;
    readonly placement: HTMLElement;
    readonly layoutKey: string;
    readonly options: LivePreviewTrackedTargetOptions;
}

interface GeometryMeasurement {
    readonly tracked: TrackedTarget;
    readonly caption: HTMLElement | null;
    readonly previousCaption: HTMLElement | null;
    readonly eligible: boolean;
    readonly placementOffset: number | null;
    readonly captionOffset: number | null;
    readonly imageWidth: number | null;
    readonly snapshot: LivePreviewGeometrySnapshot | null;
    readonly signature: string;
}

interface ScopeBox {
    readonly element: Element;
    readonly left: number;
    readonly width: number;
}

type WindowWithDomConstructors = Window & {
    ResizeObserver?: typeof ResizeObserver;
    MutationObserver?: typeof MutationObserver;
};

/**
 * Owns Live Preview placement geometry for both the rendered media and its
 * detached CodeMirror Caption widget.
 *
 * ImageAlignment supplies semantic state; this coordinator is the only layer
 * that turns that state into a Live Preview offset. A single read derives one
 * desired visual left edge, then a single write applies both media and Caption
 * geometry. This keeps CodeMirror widget replacement from switching between
 * unrelated CSS and DOM coordinate systems.
 */
export class LivePreviewImageLayoutCoordinator {
    private readonly tracked = new Map<string, TrackedTarget>();
    private readonly lastValidGeometry = new Map<string, LivePreviewGeometrySnapshot>();
    private readonly captionElements = new Map<string, HTMLElement>();
    private readonly observedElements = new Set<Element>();
    private readonly resizeObserver: ResizeObserver | null;
    private readonly mutationObserver: MutationObserver | null;
    private readonly ownerWindow: WindowWithDomConstructors;
    private animationFrame: number | null = null;
    private frameCount = 0;
    private stableFrames = 0;
    private requiredStableFrames = REQUIRED_STABLE_FRAMES;
    private previousSignature = '';
    private settling = false;
    private destroyed = false;

    private readonly onMediaLoad = (event: Event): void => {
        const loaded = event.target;
        if (!isElement(loaded)) return;
        const belongsToTrackedTarget = [...this.tracked.values()].some(({ target }) =>
            target.captionAnchor === loaded || target.captionAnchor.contains(loaded)
        );
        if (belongsToTrackedTarget) this.schedule();
    };

    constructor(private readonly root: HTMLElement) {
        const ownerDocument = root.ownerDocument;
        this.ownerWindow = (ownerDocument.defaultView ?? window) as WindowWithDomConstructors;

        const ResizeObserverConstructor = this.ownerWindow.ResizeObserver
            ?? (typeof ResizeObserver === 'undefined' ? undefined : ResizeObserver);
        this.resizeObserver = ResizeObserverConstructor
            ? new ResizeObserverConstructor(() => this.schedule())
            : null;

        const MutationObserverConstructor = this.ownerWindow.MutationObserver
            ?? (typeof MutationObserver === 'undefined' ? undefined : MutationObserver);
        this.mutationObserver = MutationObserverConstructor
            ? new MutationObserverConstructor(records => this.handleCaptionMutations(records))
            : null;

        this.observe(root);
        this.mutationObserver?.observe(root, { childList: true, subtree: true });
        root.addEventListener('load', this.onMediaLoad, true);
    }

    /** Primary API: registers one stable renderer target and its semantic state. */
    registerTarget(
        target: RenderedMediaLayoutTarget,
        layoutKey: string,
        options: LivePreviewTrackedTargetOptions
    ): void {
        const placement = target.placement;
        if (this.destroyed
            || !layoutKey
            || isCodeMirrorLayoutContainer(target.owner)
            || isCodeMirrorLayoutContainer(placement)
            || !this.root.contains(placement)
            || !this.root.contains(target.captionAnchor)) return;

        for (const [trackedKey, previous] of [...this.tracked]) {
            if (trackedKey === layoutKey) {
                if (!hasSameGeometryTarget(previous, target)) {
                    this.releaseTrackedTarget(previous, true);
                    this.tracked.delete(trackedKey);
                }
                continue;
            }
            if (!targetsOverlap(previous, target)) continue;
            this.tracked.delete(trackedKey);
            this.lastValidGeometry.delete(trackedKey);
            this.clearCaptionForKey(trackedKey);
            this.releaseTrackedTarget(previous, true);
        }

        const previousForKey = this.tracked.get(layoutKey) ?? null;
        const sameGeometryTarget = previousForKey
            ? hasSameGeometryTarget(previousForKey, target)
            : false;
        const tracked: TrackedTarget = { target, placement, layoutKey, options };
        this.tracked.set(layoutKey, tracked);
        // Layout identity belongs to the safe HTML placement boundary. The
        // renderer-owned visual and measurement anchor are strictly read-only;
        // for Excalidraw either one can be an upstream SVG/IMG.
        setAttributeIfChanged(placement, IMAGE_LAYOUT_KEY_ATTRIBUTE, layoutKey);
        this.observe(placement);
        this.observe(target.captionAnchor);
        this.observeScopeCandidates(tracked);

        const caption = this.getConnectedCaption(layoutKey) ?? findCaption(this.root, layoutKey);
        this.bindCaption(layoutKey, caption);
        this.prepareTrackedGeometry(tracked, caption, sameGeometryTarget);
        this.schedule();
    }

    /**
     * Releases every renderer boundary removed by one DOM mutation while
     * retaining its source-key geometry and Caption for the replacement
     * widget. Permanent source removal is handled only by reconcileSourceKeys.
     */
    detachSubtree(removedRoot: Element): void {
        if (this.destroyed) return;
        for (const [layoutKey, tracked] of [...this.tracked]) {
            if (!subtreeContainsTrackedBoundary(removedRoot, tracked)) continue;
            this.tracked.delete(layoutKey);
            this.releaseTrackedTarget(tracked, true);
        }
    }

    unregisterImage(image: HTMLImageElement): void {
        this.releaseMatchingImage(image);
    }

    reconcileSourceKeys(sourceKeys: ReadonlySet<string>): void {
        for (const [layoutKey, tracked] of [...this.tracked]) {
            if (sourceKeys.has(layoutKey)) continue;
            this.tracked.delete(layoutKey);
            this.releaseTrackedTarget(tracked, true);
        }
        for (const layoutKey of [...this.lastValidGeometry.keys()]) {
            if (sourceKeys.has(layoutKey)) continue;
            this.lastValidGeometry.delete(layoutKey);
            this.clearCaptionForKey(layoutKey);
        }
        for (const layoutKey of [...this.captionElements.keys()]) {
            if (!sourceKeys.has(layoutKey)) this.clearCaptionForKey(layoutKey);
        }
    }

    /** Coalesces geometry signals into a bounded sequence of stable frames. */
    schedule(settleFrames = REQUIRED_STABLE_FRAMES): void {
        if (this.destroyed || this.tracked.size === 0) return;
        const requestedFrames = Math.max(
            1,
            Math.min(MAX_SETTLE_FRAMES, Math.round(settleFrames))
        );
        if (this.settling) {
            this.requiredStableFrames = Math.max(this.requiredStableFrames, requestedFrames);
            this.requestNextFrame();
            return;
        }

        this.settling = true;
        this.frameCount = 0;
        this.stableFrames = 0;
        this.requiredStableFrames = requestedFrames;
        this.previousSignature = '';
        this.requestNextFrame();
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        if (this.animationFrame !== null) this.cancelFrame(this.animationFrame);
        this.animationFrame = null;
        this.settling = false;
        this.resizeObserver?.disconnect();
        this.mutationObserver?.disconnect();
        this.root.removeEventListener('load', this.onMediaLoad, true);

        for (const tracked of this.tracked.values()) {
            clearLayoutPosition(tracked.placement);
            removeTrackedLayoutKey(tracked);
        }
        for (const caption of this.captionElements.values()) clearCaptionPosition(caption);

        this.tracked.clear();
        this.lastValidGeometry.clear();
        this.captionElements.clear();
        this.observedElements.clear();
    }

    private flush(): void {
        if (this.destroyed) return;
        const measurements: GeometryMeasurement[] = [];
        for (const [layoutKey, tracked] of [...this.tracked]) {
            if (!tracked.placement.isConnected
                || !tracked.target.captionAnchor.isConnected
                || !this.root.contains(tracked.placement)
                || !this.root.contains(tracked.target.captionAnchor)) {
                this.tracked.delete(layoutKey);
                this.releaseTrackedTarget(tracked, true);
                continue;
            }
            measurements.push(this.measure(tracked));
        }

        // No geometry reads occur below this line. Media and Caption therefore
        // move in the same write phase and always share one desired left edge.
        let changed = false;
        for (const measurement of measurements) {
            changed = this.applyMeasurement(measurement) || changed;
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
            return;
        }
        this.settling = false;
    }

    private measure(tracked: TrackedTarget): GeometryMeasurement {
        const caption = this.getConnectedCaption(tracked.layoutKey)
            ?? findCaption(this.root, tracked.layoutKey);
        const previousCaption = this.captionElements.get(tracked.layoutKey) ?? null;
        const eligible = isManagedLayout(tracked.options);
        if (!eligible) {
            return {
                tracked,
                caption,
                previousCaption,
                eligible: false,
                placementOffset: null,
                captionOffset: null,
                imageWidth: null,
                snapshot: null,
                signature: `${tracked.layoutKey}:unmanaged`
            };
        }

        const scopeBox = this.getScopeBox(tracked);
        const visualRect = tracked.target.captionAnchor.getBoundingClientRect();
        if (!isPositiveFinite(visualRect.width)
            || !Number.isFinite(visualRect.left)) {
            return {
                tracked,
                caption,
                previousCaption,
                eligible: true,
                placementOffset: null,
                captionOffset: null,
                imageWidth: null,
                snapshot: null,
                signature: `${tracked.layoutKey}:pending`
            };
        }

        const previousPlacementOffset = parsePixels(
            tracked.placement.style.getPropertyValue(LAYOUT_OFFSET_PROPERTY)
        );
        const baselineVisualLeft = visualRect.left - previousPlacementOffset;
        // During initial CodeMirror mount the content container can briefly
        // report a zero box. Keep the renderer's current position (and still
        // align its Caption) until the root/visual ResizeObserver provides a
        // usable semantic scope. This avoids clearing or guessing geometry.
        const desiredLeft = scopeBox
            ? getDesiredLeft(
                scopeBox.left,
                scopeBox.width,
                visualRect.width,
                tracked.options.alignment!
            )
            : visualRect.left;
        const placementOffset = Number.isFinite(baselineVisualLeft)
            ? desiredLeft - baselineVisualLeft
            : null;

        const captionEligible = isCaptionEligible(caption);
        let captionOffset: number | null = null;
        if (captionEligible && caption) {
            const captionRect = caption.getBoundingClientRect();
            const previousCaptionOffset = parsePixels(
                caption.style.getPropertyValue(CAPTION_OFFSET_PROPERTY)
            );
            const baselineCaptionLeft = captionRect.left - previousCaptionOffset;
            if (Number.isFinite(baselineCaptionLeft)) {
                captionOffset = desiredLeft - baselineCaptionLeft;
            }
        }

        const snapshot = placementOffset === null || !scopeBox
            ? null
            : {
                imageLeft: roundGeometry(desiredLeft),
                imageWidth: roundGeometry(visualRect.width),
                scopeLeft: roundGeometry(scopeBox.left),
                scopeWidth: roundGeometry(scopeBox.width),
                alignment: tracked.options.alignment!
            };
        return {
            tracked,
            caption,
            previousCaption,
            eligible: true,
            placementOffset,
            captionOffset,
            imageWidth: visualRect.width,
            snapshot,
            signature: [
                tracked.layoutKey,
                tracked.options.alignment,
                roundGeometry(scopeBox?.left ?? Number.NaN),
                roundGeometry(scopeBox?.width ?? Number.NaN),
                roundGeometry(baselineVisualLeft),
                roundGeometry(visualRect.width),
                roundGeometry(desiredLeft),
                roundGeometry(placementOffset ?? Number.NaN),
                roundGeometry(captionOffset ?? Number.NaN)
            ].join(':')
        };
    }

    private applyMeasurement(measurement: GeometryMeasurement): boolean {
        const {
            tracked,
            caption,
            previousCaption,
            eligible,
            placementOffset,
            captionOffset,
            imageWidth,
            snapshot
        } = measurement;

        let changed = false;
        if (previousCaption && previousCaption !== caption) {
            changed = clearCaptionPosition(previousCaption) || changed;
        }
        if (caption) this.captionElements.set(tracked.layoutKey, caption);
        else this.captionElements.delete(tracked.layoutKey);

        if (!eligible) {
            changed = clearLayoutPosition(tracked.placement) || changed;
            if (caption) changed = clearCaptionPosition(caption) || changed;
            return changed;
        }

        if (placementOffset !== null) {
            changed = setAttributeIfChanged(
                tracked.placement,
                LAYOUT_POSITIONED_ATTRIBUTE,
                'true'
            ) || changed;
            changed = setPropertyIfChanged(
                tracked.placement,
                LAYOUT_OFFSET_PROPERTY,
                toPixels(placementOffset)
            ) || changed;
        }

        if (caption && isCaptionEligible(caption)) {
            if (captionOffset !== null && imageWidth !== null && isPositiveFinite(imageWidth)) {
                changed = setAttributeIfChanged(
                    caption,
                    CAPTION_GEOMETRY_ATTRIBUTE,
                    'true'
                ) || changed;
                changed = setPropertyIfChanged(
                    caption,
                    CAPTION_WIDTH_PROPERTY,
                    toPixels(imageWidth)
                ) || changed;
                changed = setPropertyIfChanged(
                    caption,
                    CAPTION_OFFSET_PROPERTY,
                    toPixels(captionOffset)
                ) || changed;
            }
        } else if (caption) {
            changed = clearCaptionPosition(caption) || changed;
        }

        if (snapshot) this.lastValidGeometry.set(tracked.layoutKey, snapshot);
        return changed;
    }

    private prepareTrackedGeometry(
        tracked: TrackedTarget,
        caption: HTMLElement | null,
        sameGeometryTarget: boolean
    ): void {
        if (!isManagedLayout(tracked.options)) {
            clearLayoutPosition(tracked.placement);
            if (caption) clearCaptionPosition(caption);
            return;
        }

        // A CSS offset is tied to the old node's static-position baseline. Keep
        // an already tracked node in place, but never copy that raw offset to a
        // replacement. The next read recomputes both offsets from the cached
        // logical alignment and the replacement's own baseline.
        if (!sameGeometryTarget) clearLayoutPosition(tracked.placement);

        const snapshot = this.lastValidGeometry.get(tracked.layoutKey);
        if (caption && snapshot?.alignment !== tracked.options.alignment) {
            clearCaptionPosition(caption);
        }
    }

    private getScopeBox(tracked: TrackedTarget): ScopeBox | null {
        for (const candidate of this.getScopeCandidates(tracked)) {
            if (candidate !== this.root && !this.root.contains(candidate)) continue;
            const box = getContentBox(candidate, this.ownerWindow);
            if (box) {
                this.observe(candidate);
                return { element: candidate, ...box };
            }
        }
        return null;
    }

    private getScopeCandidates(tracked: TrackedTarget): Element[] {
        const candidates: Element[] = [];
        if (isElement(tracked.options.scope)) {
            candidates.push(tracked.options.scope);
            return candidates;
        }
        if (tracked.options.scope === 'semantic') {
            const semantic = tracked.placement.closest(SEMANTIC_SCOPE_SELECTOR);
            if (semantic) candidates.push(semantic);
        }
        const contentContainer = tracked.placement.closest('.cm-contentContainer')
            ?? tracked.placement.closest('.cm-editor')?.querySelector('.cm-contentContainer')
            ?? this.root.querySelector('.cm-contentContainer');
        if (contentContainer) candidates.push(contentContainer);
        candidates.push(this.root);
        return candidates;
    }

    private observeScopeCandidates(tracked: TrackedTarget): void {
        for (const candidate of this.getScopeCandidates(tracked)) {
            if (candidate === this.root || this.root.contains(candidate)) this.observe(candidate);
        }
    }

    private handleCaptionMutations(records: MutationRecord[]): void {
        if (this.destroyed || this.tracked.size === 0) return;
        let changed = false;

        // Process removals first so a CodeMirror replacement added in the same
        // batch can immediately inherit the retained geometry for its key.
        for (const record of records) {
            for (const node of record.removedNodes) {
                if (!isElement(node)) continue;
                for (const [layoutKey, caption] of [...this.captionElements]) {
                    if (node !== caption && !node.contains(caption)) continue;
                    this.captionElements.delete(layoutKey);
                    changed = true;
                }
            }
        }

        for (const record of records) {
            for (const node of record.addedNodes) {
                if (!isElement(node)) continue;
                for (const caption of collectCaptions(node)) {
                    const layoutKey = caption.getAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE);
                    const tracked = layoutKey ? this.tracked.get(layoutKey) : null;
                    if (!layoutKey || !tracked) continue;
                    this.bindCaption(layoutKey, caption);
                    // A Caption widget replacement does not replace the media
                    // placement; keep its validated position until the shared
                    // measurement updates both nodes.
                    this.prepareTrackedGeometry(tracked, caption, true);
                    changed = true;
                }
            }
        }
        if (changed) this.schedule();
    }

    private bindCaption(layoutKey: string, caption: HTMLElement | null): void {
        const previous = this.captionElements.get(layoutKey);
        if (previous && previous !== caption) clearCaptionPosition(previous);
        if (caption) this.captionElements.set(layoutKey, caption);
        else this.captionElements.delete(layoutKey);
    }

    private getConnectedCaption(layoutKey: string): HTMLElement | null {
        const caption = this.captionElements.get(layoutKey) ?? null;
        if (caption?.isConnected && this.root.contains(caption)) return caption;
        if (caption) this.captionElements.delete(layoutKey);
        return null;
    }

    private clearCaptionForKey(layoutKey: string): void {
        const caption = this.captionElements.get(layoutKey) ?? findCaption(this.root, layoutKey);
        if (caption) clearCaptionPosition(caption);
        this.captionElements.delete(layoutKey);
    }

    private releaseMatchingImage(image: HTMLImageElement): void {
        for (const [layoutKey, tracked] of [...this.tracked]) {
            if (tracked.target.captionAnchor !== image
                && tracked.target.visual !== image
                && tracked.placement !== image
                && tracked.target.owner !== image) continue;
            this.tracked.delete(layoutKey);
            this.releaseTrackedTarget(tracked, true);
            this.lastValidGeometry.delete(layoutKey);
            this.clearCaptionForKey(layoutKey);
        }
    }

    private releaseTrackedTarget(tracked: TrackedTarget, clearPlacement: boolean): void {
        if (clearPlacement) clearLayoutPosition(tracked.placement);
        const stillObserved = [...this.tracked.values()].some(candidate =>
            candidate !== tracked && candidate.target.captionAnchor === tracked.target.captionAnchor
        );
        if (!stillObserved) {
            this.unobserve(tracked.target.captionAnchor);
            removeTrackedLayoutKey(tracked);
        }
    }

    private observe(element: Element): void {
        if (!this.resizeObserver || this.observedElements.has(element)) return;
        this.resizeObserver.observe(element);
        this.observedElements.add(element);
    }

    private unobserve(element: Element): void {
        if (!this.observedElements.has(element) || element === this.root) return;
        this.resizeObserver?.unobserve(element);
        this.observedElements.delete(element);
    }

    private pruneObservedElements(): void {
        for (const element of [...this.observedElements]) {
            if (element === this.root || element.isConnected) continue;
            this.unobserve(element);
        }
    }

    private requestNextFrame(): void {
        if (this.animationFrame !== null || this.destroyed) return;
        this.animationFrame = this.requestFrame(() => {
            this.animationFrame = null;
            this.flush();
        });
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

function targetsOverlap(
    tracked: TrackedTarget,
    target: RenderedMediaLayoutTarget
): boolean {
    return tracked.target.captionAnchor === target.captionAnchor
        || tracked.target.visual === target.visual
        || tracked.placement === target.placement;
}

function subtreeContainsTrackedBoundary(
    removedRoot: Element,
    tracked: TrackedTarget
): boolean {
    return elementContains(removedRoot, tracked.target.owner)
        || elementContains(removedRoot, tracked.placement)
        || elementContains(removedRoot, tracked.target.visual)
        || elementContains(removedRoot, tracked.target.captionAnchor);
}

function elementContains(root: Element, candidate: Element): boolean {
    return root === candidate || root.contains(candidate);
}

function hasSameGeometryTarget(
    tracked: TrackedTarget,
    target: RenderedMediaLayoutTarget
): boolean {
    return tracked.placement === target.placement
        && tracked.target.visual === target.visual
        && tracked.target.captionAnchor === target.captionAnchor;
}

function removeTrackedLayoutKey(tracked: TrackedTarget): void {
    if (tracked.placement.getAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE) === tracked.layoutKey) {
        tracked.placement.removeAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE);
    }
}

function isManagedLayout(options: LivePreviewTrackedTargetOptions): boolean {
    return options.standalone && !options.wrap && options.alignment !== null;
}

function isCodeMirrorLayoutContainer(element: Element): boolean {
    return element.matches(CODE_MIRROR_LAYOUT_CONTAINER_SELECTOR);
}

function getDesiredLeft(
    scopeLeft: number,
    scopeWidth: number,
    visualWidth: number,
    alignment: HorizontalImageAlignment
): number {
    const remaining = Math.max(0, scopeWidth - visualWidth);
    if (alignment === 'right') return scopeLeft + remaining;
    if (alignment === 'center') return scopeLeft + remaining / 2;
    return scopeLeft;
}

function getContentBox(
    element: Element,
    ownerWindow: Window
): { left: number; width: number } | null {
    const rect = element.getBoundingClientRect();
    if (!isPositiveFinite(rect.width) || !Number.isFinite(rect.left)) return null;
    const style = ownerWindow.getComputedStyle(element);
    const paddingLeft = parsePixels(style.paddingLeft);
    const paddingRight = parsePixels(style.paddingRight);
    const width = rect.width - paddingLeft - paddingRight;
    if (!isPositiveFinite(width)) return null;
    return { left: rect.left + paddingLeft, width };
}

function findCaption(root: ParentNode, layoutKey: string): HTMLElement | null {
    for (const caption of root.querySelectorAll<HTMLElement>(CAPTION_SELECTOR)) {
        if (caption.getAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE) === layoutKey) return caption;
    }
    return null;
}

function collectCaptions(root: Element): HTMLElement[] {
    const captions: HTMLElement[] = [];
    if (isHTMLElement(root) && root.matches(CAPTION_SELECTOR)) captions.push(root);
    root.querySelectorAll<HTMLElement>(CAPTION_SELECTOR).forEach(caption => captions.push(caption));
    return captions;
}

function isCaptionEligible(caption: HTMLElement | null): caption is HTMLElement {
    return !!caption
        && caption.getAttribute('data-image-assistant-caption-width') === 'auto'
        && caption.getAttribute('data-image-assistant-caption-wrap') !== 'true';
}

function clearLayoutPosition(placement: HTMLElement): boolean {
    let changed = false;
    if (placement.hasAttribute(LAYOUT_POSITIONED_ATTRIBUTE)) {
        placement.removeAttribute(LAYOUT_POSITIONED_ATTRIBUTE);
        changed = true;
    }
    if (placement.style.getPropertyValue(LAYOUT_OFFSET_PROPERTY)) {
        placement.style.removeProperty(LAYOUT_OFFSET_PROPERTY);
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

function isPositiveFinite(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}

function isHTMLElement(value: unknown): value is HTMLElement {
    return isElement(value) && value.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

function isElement(value: unknown): value is Element {
    return !!value && typeof value === 'object' && (value as Node).nodeType === 1;
}

function parsePixels(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function toPixels(value: number): string {
    const rounded = roundGeometry(value);
    return `${Object.is(rounded, -0) ? 0 : rounded}px`;
}

function roundGeometry(value: number): number {
    return Math.round(value * 2) / 2;
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
