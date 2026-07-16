import type { CaptionAlignment } from '../settings/types';
import type { AlignType } from '../utils/PipeSyntaxParser';

export type HorizontalImageAlignment = 'left' | 'center' | 'right';
export type ImageLayoutSource = 'pipe' | 'image-default' | 'none';
export type CaptionLayoutSource = Exclude<ImageLayoutSource, 'none'> | 'caption-fallback';

export interface ImageAlignmentPolicy {
    enabled: boolean;
    default: HorizontalImageAlignment;
}

export interface ResolvedImageLayout {
    alignment: HorizontalImageAlignment | null;
    wrap: boolean;
    source: ImageLayoutSource;
}

export interface ResolvedCaptionLayout {
    alignment: CaptionAlignment;
    wrap: boolean;
    source: CaptionLayoutSource;
}

export function resolveImageLayout(
    pipeAlignment: AlignType | undefined,
    settings: ImageAlignmentPolicy,
    standalone = true
): ResolvedImageLayout {
    if (!settings.enabled) {
        return { alignment: null, wrap: false, source: 'none' };
    }

    const explicit = normalizePipeAlignment(pipeAlignment);
    if (explicit.alignment) {
        return {
            alignment: explicit.alignment,
            wrap: explicit.wrap && standalone,
            source: 'pipe'
        };
    }

    return {
        alignment: settings.default,
        wrap: false,
        source: 'image-default'
    };
}

export function resolveCaptionLayout(
    pipeAlignment: AlignType | undefined,
    imageSettings: ImageAlignmentPolicy,
    fallback: CaptionAlignment,
    standalone: boolean
): ResolvedCaptionLayout {
    const imageLayout = resolveImageLayout(pipeAlignment, imageSettings, standalone);
    if (!imageLayout.alignment) {
        return {
            alignment: fallback,
            wrap: false,
            source: 'caption-fallback'
        };
    }

    return {
        alignment: imageLayout.alignment,
        wrap: imageLayout.wrap,
        source: imageLayout.source === 'pipe' ? 'pipe' : 'image-default'
    };
}

function normalizePipeAlignment(
    alignment: AlignType | undefined
): Pick<ResolvedImageLayout, 'alignment' | 'wrap'> {
    switch (alignment) {
        case 'left-wrap':
            return { alignment: 'left', wrap: true };
        case 'right-wrap':
            return { alignment: 'right', wrap: true };
        case 'left':
        case 'center':
        case 'right':
            return { alignment, wrap: false };
        case null:
        case undefined:
            return { alignment: null, wrap: false };
    }
}
