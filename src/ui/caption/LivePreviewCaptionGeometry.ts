import { IMAGE_SOURCE_KEY_ATTRIBUTE } from '../../utils/RefinedImageUtils';

export const CAPTION_GEOMETRY_ATTRIBUTE = 'data-image-assistant-caption-positioned';
export const CAPTION_EXPLICIT_WIDTH_ATTRIBUTE = 'data-image-assistant-caption-explicit-width';

const CAPTION_SELECTOR = [
    '.image-assistant-live-preview-caption',
    '[data-image-assistant-caption-renderer="codemirror"]'
].join('');

/** Aligns a CodeMirror-owned caption box to its precisely matched rendered image. */
export function syncLivePreviewCaptionGeometry(
    root: ParentNode,
    image: HTMLImageElement,
    sourceKey: string
): boolean {
    const caption = findBySourceKey<HTMLElement>(root, CAPTION_SELECTOR, sourceKey);
    if (!caption) return false;
    return applyCaptionGeometry(caption, image);
}

/** Used when a Caption widget is created after its image has already been processed. */
export function syncLivePreviewCaptionWidget(
    root: ParentNode,
    caption: HTMLElement,
    sourceKey: string
): HTMLImageElement | null {
    const image = findBySourceKey<HTMLImageElement>(root, 'img', sourceKey);
    if (!image || !applyCaptionGeometry(caption, image)) return null;
    return image;
}

export function clearLivePreviewCaptionGeometry(root: ParentNode, sourceKey: string): void {
    const caption = findBySourceKey<HTMLElement>(root, CAPTION_SELECTOR, sourceKey);
    if (caption) clearCaptionGeometry(caption);
}

function applyCaptionGeometry(caption: HTMLElement, image: HTMLImageElement): boolean {
    if (caption.getAttribute('data-image-assistant-caption-width') !== 'auto'
        || caption.getAttribute('data-image-assistant-caption-wrap') === 'true') {
        clearCaptionGeometry(caption);
        return false;
    }

    const imageRect = image.getBoundingClientRect();
    if (!isPositiveFinite(imageRect.width) || !Number.isFinite(imageRect.left)) {
        clearCaptionGeometry(caption);
        return false;
    }

    setAttributeIfChanged(caption, CAPTION_GEOMETRY_ATTRIBUTE, 'true');
    setPropertyIfChanged(caption, '--image-assistant-caption-rendered-width', toCssPixels(imageRect.width));

    // Recover the unshifted baseline from the current geometry so repeated
    // synchronization neither accumulates offsets nor emits reset mutations.
    const previousOffset = parseCssPixels(
        caption.style.getPropertyValue('--image-assistant-caption-offset')
    );
    const baselineLeft = caption.getBoundingClientRect().left - previousOffset;
    if (!Number.isFinite(baselineLeft)) {
        clearCaptionGeometry(caption);
        return false;
    }
    setPropertyIfChanged(
        caption,
        '--image-assistant-caption-offset',
        toCssPixels(imageRect.left - baselineLeft)
    );
    return true;
}

function clearCaptionGeometry(caption: HTMLElement): void {
    caption.removeAttribute(CAPTION_GEOMETRY_ATTRIBUTE);
    caption.style.removeProperty('--image-assistant-caption-rendered-width');
    caption.style.removeProperty('--image-assistant-caption-offset');
}

function findBySourceKey<T extends Element>(
    root: ParentNode,
    selector: string,
    sourceKey: string
): T | null {
    return Array.from(root.querySelectorAll<T>(selector)).find(element =>
        element.getAttribute(IMAGE_SOURCE_KEY_ATTRIBUTE) === sourceKey
    ) ?? null;
}

function setAttributeIfChanged(element: Element, name: string, value: string): void {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function setPropertyIfChanged(element: HTMLElement, name: string, value: string): void {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}

function isPositiveFinite(value: number): boolean {
    return Number.isFinite(value) && value > 0;
}

function parseCssPixels(value: string): number {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function toCssPixels(value: number): string {
    const rounded = Math.round(value * 1000) / 1000;
    return `${Object.is(rounded, -0) ? 0 : rounded}px`;
}
