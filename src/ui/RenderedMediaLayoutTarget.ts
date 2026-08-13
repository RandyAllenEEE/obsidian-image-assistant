import {
    findExcalidrawRenderedEmbed,
    type ExcalidrawRenderedEmbed
} from '../drawing/excalidraw/ExcalidrawRenderedEmbed';

export type RenderedMediaKind = 'obsidian-image' | 'excalidraw-source';
export type RenderedMediaSizing = 'obsidian-native' | 'external-renderer';

export interface RenderedMediaLayoutTarget {
    readonly kind: RenderedMediaKind;
    /** Stable semantic host. Image Assistant writes layout intent here only. */
    readonly owner: HTMLElement;
    /**
     * Stable element that may be positioned by the Live Preview coordinator.
     * It is never a CodeMirror line/content container or a renderer-owned
     * surface. Native images and Excalidraw both position their outer owner.
     */
    readonly placement: HTMLElement;
    /** Renderer-owned visual marker. Its dimensions are never rewritten. */
    readonly visual: Element;
    /**
     * Actual rendered surface used only for caption width/geometry
     * measurement. It may be a child of `visual` for external renderers.
     */
    readonly captionAnchor: Element;
    readonly image: HTMLImageElement | null;
    readonly sizing: RenderedMediaSizing;
}

const IMAGE_EMBED_SELECTOR = '.image-embed';
const EXCALIDRAW_RENDERED_SELECTOR = '[fileSource].excalidraw-embedded-img';
const CODE_MIRROR_NON_MEDIA_CONTAINER_SELECTOR = '.cm-line, .cm-content';

/**
 * Resolves the stable layout boundary for media rendered inside a Markdown view.
 *
 * Obsidian owns `.image-wrapper` and its resize controls, so Image Assistant
 * always lays out the outer `.image-embed`. Excalidraw is recognized only by
 * its public `fileSource` render marker and is otherwise left untouched.
 */
export function resolveRenderedMediaLayoutTarget(
    target: Element
): RenderedMediaLayoutTarget | null {
    const excalidraw = findExcalidrawRenderedEmbed(target);
    if (excalidraw) return resolveExcalidrawTarget(excalidraw);

    const image = resolveImageElement(target);
    if (!image || findExcalidrawRenderedEmbed(image)) return null;

    const embedCandidate = image.closest<HTMLElement>(IMAGE_EMBED_SELECTOR);
    const embed = embedCandidate?.matches(CODE_MIRROR_NON_MEDIA_CONTAINER_SELECTOR)
        ? null
        : embedCandidate;
    const owner = embed ?? resolveMediaOnlyParagraph(image) ?? image;
    return Object.freeze({
        kind: 'obsidian-image',
        owner,
        placement: owner,
        visual: image,
        captionAnchor: image,
        image,
        sizing: 'obsidian-native'
    });
}

export function collectRenderedMediaLayoutTargets(
    root: ParentNode
): readonly RenderedMediaLayoutTarget[] {
    const candidates = new Set<Element>();
    if (isElement(root) && root.matches('img, ' + EXCALIDRAW_RENDERED_SELECTOR)) {
        candidates.add(root);
    }
    root.querySelectorAll?.(`img, ${EXCALIDRAW_RENDERED_SELECTOR}`)
        .forEach(element => candidates.add(element));

    const owners = new Set<HTMLElement>();
    const targets: RenderedMediaLayoutTarget[] = [];
    for (const candidate of candidates) {
        const resolved = resolveRenderedMediaLayoutTarget(candidate);
        if (!resolved || owners.has(resolved.owner)) continue;
        owners.add(resolved.owner);
        targets.push(resolved);
    }
    return Object.freeze(targets);
}

/**
 * DOM fallback used only when no exact Markdown descriptor is available.
 * A media-only paragraph is already the semantic line boundary; otherwise
 * the stable owner must be the only meaningful child of its parent.
 */
export function isStandaloneRenderedMediaTarget(
    target: RenderedMediaLayoutTarget
): boolean {
    if (target.owner.tagName === 'P' && target.owner !== target.visual) return true;
    const parent = target.owner.parentElement;
    if (!parent) return true;
    return Array.from(parent.childNodes).every(node =>
        node === target.owner
        || node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()
        || isElement(node)
            && node.getAttribute('data-image-assistant-caption-renderer') === 'dom'
    );
}

function resolveExcalidrawTarget(
    embed: ExcalidrawRenderedEmbed
): RenderedMediaLayoutTarget | null {
    const embedOwner = resolveOutermostImageEmbed(embed.element);
    const owner = embedOwner
        ?? resolveUniqueMarkerWrapper(embed.element);
    if (!owner || !hasUniqueRenderedMarker(owner, embed.element)) return null;

    return Object.freeze({
        kind: 'excalidraw-source',
        owner,
        // Excalidraw's public marker and rendered SVG/IMG are measurement-only.
        // Position the outer host so `contain: paint` cannot clip the drawing.
        placement: owner,
        visual: embed.element,
        // The upstream marker is commonly width: 100%, while native SVG
        // output has the real diagram bounds. Measure the latter for captions
        // without ever mutating it.
        captionAnchor: embed.svg ?? embed.image ?? embed.element,
        image: embed.image,
        sizing: 'external-renderer'
    });
}

function resolveOutermostImageEmbed(marker: Element): HTMLElement | null {
    const initialOwner = marker.closest<HTMLElement>(IMAGE_EMBED_SELECTOR);
    if (!initialOwner
        || initialOwner.matches(CODE_MIRROR_NON_MEDIA_CONTAINER_SELECTOR)) return null;
    let owner: HTMLElement = initialOwner;

    const markdownView = marker.closest('.markdown-preview-view, .markdown-source-view');
    while (owner.parentElement) {
        const parentOwner: HTMLElement | null = owner.parentElement
            .closest<HTMLElement>(IMAGE_EMBED_SELECTOR);
        if (!parentOwner
            || parentOwner.matches(CODE_MIRROR_NON_MEDIA_CONTAINER_SELECTOR)
            || markdownView && !markdownView.contains(parentOwner)) break;
        owner = parentOwner;
    }
    return owner;
}

/**
 * Reading Mode Excalidraw replaces Obsidian's `.image-embed` with its own
 * wrapper. Accept that wrapper only when the public stable marker is its sole
 * meaningful child, so an arbitrary paragraph or renderer container can never
 * become a layout owner by class or filename inference.
 */
function resolveUniqueMarkerWrapper(marker: HTMLElement): HTMLElement | null {
    const parent = marker.parentElement;
    if (!parent || parent === marker
        || parent.matches(CODE_MIRROR_NON_MEDIA_CONTAINER_SELECTOR)
        || parent.matches('.cm-embed-block')) return null;
    const markerIsOnlyContent = Array.from(parent.childNodes).every(node =>
        node === marker || node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()
    );
    return markerIsOnlyContent ? parent : null;
}

function hasUniqueRenderedMarker(owner: HTMLElement, marker: HTMLElement): boolean {
    const markers = Array.from(
        owner.querySelectorAll<HTMLElement>(EXCALIDRAW_RENDERED_SELECTOR)
    );
    if (owner.matches(EXCALIDRAW_RENDERED_SELECTOR)) markers.unshift(owner);
    return markers.length === 1 && markers[0] === marker;
}

function resolveImageElement(target: Element): HTMLImageElement | null {
    if (isImage(target)) return target;
    const closest = target.closest('img');
    if (isImage(closest)) return closest;

    // A context-menu event may originate on Obsidian's native resize corner,
    // which is a sibling of the image rather than its descendant.
    const wrapper = target.closest('.image-wrapper');
    const sibling = wrapper?.querySelector(':scope > img') ?? wrapper?.querySelector('img');
    return isImage(sibling) ? sibling : null;
}

function resolveMediaOnlyParagraph(image: HTMLImageElement): HTMLElement | null {
    const paragraph = image.parentElement;
    if (!paragraph || paragraph.tagName !== 'P') return null;
    const mediaOnly = Array.from(paragraph.childNodes).every(node =>
        node === image
        || node.nodeType === Node.TEXT_NODE && !node.textContent?.trim()
        || isElement(node)
            && node.getAttribute('data-image-assistant-caption-renderer') === 'dom'
    );
    return mediaOnly ? paragraph : null;
}

function isImage(value: unknown): value is HTMLImageElement {
    return isElement(value) && value.tagName === 'IMG';
}

function isElement(value: unknown): value is Element {
    return !!value && typeof value === 'object' && (value as Node).nodeType === 1;
}
