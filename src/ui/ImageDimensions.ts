import type { SizeData } from '../utils/PipeSyntaxParser';

export type ImageDimensionMode = 'none' | 'width' | 'height' | 'both';

export interface ResolvedImageDimensions {
    mode: ImageDimensionMode;
    width?: number;
    height?: number;
    format?: SizeData['format'];
}

export const IMAGE_DIMENSION_OWNER_ATTRIBUTE = 'data-image-assistant-dimension-owner';
export const IMAGE_DIMENSION_MODE_ATTRIBUTE = 'data-image-assistant-dimension-mode';

export function resolveImageDimensions(size?: SizeData): ResolvedImageDimensions {
    const width = positiveDimension(size?.width);
    const height = positiveDimension(size?.height);
    if (width && height) return { mode: 'both', width, height, format: size?.format };
    if (width) return { mode: 'width', width, format: size?.format };
    if (height) return { mode: 'height', height, format: size?.format };
    return { mode: 'none' };
}

/** Owns only the inline width/height written from image PipeSyntax. */
export class ImageDimensionRenderer {
    apply(img: HTMLImageElement, dimensions: ResolvedImageDimensions): void {
        if (dimensions.mode === 'none') {
            this.clearImage(img);
            return;
        }

        setAttributeIfChanged(img, IMAGE_DIMENSION_OWNER_ATTRIBUTE, 'true');
        setAttributeIfChanged(img, IMAGE_DIMENSION_MODE_ATTRIBUTE, dimensions.mode);

        switch (dimensions.mode) {
            case 'width':
                setStyleIfChanged(img, 'width', `${dimensions.width}px`);
                setStyleIfChanged(img, 'height', 'auto');
                break;
            case 'height':
                setStyleIfChanged(img, 'width', 'auto');
                setStyleIfChanged(img, 'height', `${dimensions.height}px`);
                break;
            case 'both':
                setStyleIfChanged(img, 'width', `${dimensions.width}px`);
                setStyleIfChanged(img, 'height', `${dimensions.height}px`);
                break;
        }
    }

    clearImage(img: HTMLImageElement): void {
        if (!img.hasAttribute(IMAGE_DIMENSION_OWNER_ATTRIBUTE)) return;
        img.style.removeProperty('width');
        img.style.removeProperty('height');
        img.removeAttribute(IMAGE_DIMENSION_OWNER_ATTRIBUTE);
        img.removeAttribute(IMAGE_DIMENSION_MODE_ATTRIBUTE);
    }

    cleanup(root: ParentNode = document): void {
        const images = Array.from(root.querySelectorAll?.<HTMLImageElement>(
            `img[${IMAGE_DIMENSION_OWNER_ATTRIBUTE}]`
        ) ?? []);
        if (isImage(root) && root.hasAttribute(IMAGE_DIMENSION_OWNER_ATTRIBUTE)) {
            images.unshift(root);
        }
        images.forEach(image => this.clearImage(image));
    }
}

function positiveDimension(value: number | undefined): number | undefined {
    return value !== undefined && Number.isFinite(value) && value > 0 ? value : undefined;
}

function setAttributeIfChanged(element: Element, name: string, value: string): void {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function setStyleIfChanged(element: HTMLElement, name: string, value: string): void {
    if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value);
}

function isImage(value: unknown): value is HTMLImageElement {
    return !!value && typeof value === 'object'
        && (value as Element).nodeType === 1
        && (value as Element).tagName === 'IMG';
}
