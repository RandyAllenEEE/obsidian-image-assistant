import type { SizeData } from './PipeSyntaxParser';

export interface IntrinsicImageDimensions {
    readonly width: number;
    readonly height: number;
}

export interface CanonicalImageSizeIntent {
    readonly width?: number | null;
    readonly height?: number | null;
    readonly intrinsic?: IntrinsicImageDimensions | null;
}

/** Resolves every user-facing size intent to Obsidian's canonical W/WxH grammar. */
export function resolveCanonicalImageSize(
    intent: CanonicalImageSizeIntent
): SizeData | undefined {
    const width = toPositiveInteger(intent.width);
    const height = toPositiveInteger(intent.height);
    if (width !== undefined && height !== undefined) {
        return { width, height, format: 'WxH' };
    }
    if (width !== undefined) return { width, format: 'W' };
    if (height === undefined) return undefined;

    const intrinsic = normalizeDimensions(intent.intrinsic);
    if (!intrinsic) return undefined;
    return {
        width: Math.max(1, Math.round(height * intrinsic.width / intrinsic.height)),
        format: 'W'
    };
}

export function resolveElementIntrinsicDimensions(
    element: Element | null | undefined
): IntrinsicImageDimensions | null {
    if (!element) return null;
    if (element.tagName === 'IMG') {
        const image = element as HTMLImageElement;
        const natural = normalizeDimensions({
            width: image.naturalWidth,
            height: image.naturalHeight
        });
        if (natural) return natural;
        const attributes = normalizeDimensions({
            width: Number.parseFloat(image.getAttribute('width') ?? ''),
            height: Number.parseFloat(image.getAttribute('height') ?? '')
        });
        if (attributes) return attributes;
    }

    const svg = element.tagName.toLowerCase() === 'svg'
        ? element as SVGSVGElement
        : element.querySelector('svg');
    const svgDimensions = svg ? resolveSvgDimensions(svg) : null;
    if (svgDimensions) return svgDimensions;

    const nestedImage = element.querySelector('img');
    if (nestedImage) {
        const nested = resolveElementIntrinsicDimensions(nestedImage);
        if (nested) return nested;
    }

    const rect = element.getBoundingClientRect?.();
    return rect ? normalizeDimensions(rect) : null;
}

export async function decodeBlobIntrinsicDimensions(
    blob: Blob,
    ownerDocument: Document = document,
    timeoutMs = 10_000
): Promise<IntrinsicImageDimensions | null> {
    const ownerWindow = ownerDocument.defaultView ?? window;
    const Url = ownerWindow.URL ?? URL;
    if (typeof Url.createObjectURL !== 'function') return null;
    const ImageConstructor = ownerWindow.Image ?? Image;
    const image = new ImageConstructor();
    const objectUrl = Url.createObjectURL(blob);

    try {
        const loaded = await new Promise<boolean>(resolve => {
            let settled = false;
            const finish = (value: boolean) => {
                if (settled) return;
                settled = true;
                ownerWindow.clearTimeout(timer);
                image.onload = null;
                image.onerror = null;
                resolve(value);
            };
            const timer = ownerWindow.setTimeout(() => finish(false), timeoutMs);
            image.onload = () => finish(true);
            image.onerror = () => finish(false);
            image.src = objectUrl;
            if (image.complete) finish(image.naturalWidth > 0 && image.naturalHeight > 0);
        });
        return loaded
            ? normalizeDimensions({ width: image.naturalWidth, height: image.naturalHeight })
            : null;
    } finally {
        image.onload = null;
        image.onerror = null;
        image.src = '';
        Url.revokeObjectURL(objectUrl);
    }
}

function resolveSvgDimensions(svg: SVGSVGElement): IntrinsicImageDimensions | null {
    const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    if (viewBox?.length === 4) {
        const dimensions = normalizeDimensions({ width: viewBox[2], height: viewBox[3] });
        if (dimensions) return dimensions;
    }
    return normalizeDimensions({
        width: Number.parseFloat(svg.getAttribute('width') ?? ''),
        height: Number.parseFloat(svg.getAttribute('height') ?? '')
    });
}

function normalizeDimensions(
    value: { readonly width: number; readonly height: number } | null | undefined
): IntrinsicImageDimensions | null {
    if (!value
        || !Number.isFinite(value.width)
        || !Number.isFinite(value.height)
        || value.width <= 0
        || value.height <= 0) return null;
    return { width: value.width, height: value.height };
}

function toPositiveInteger(value: number | null | undefined): number | undefined {
    if (value === null || value === undefined || !Number.isFinite(value)) return undefined;
    const rounded = Math.round(value);
    return Number.isSafeInteger(rounded) && rounded > 0 ? rounded : undefined;
}
