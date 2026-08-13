import type { CaptionInlinePolicy, CaptionSettings, CaptionWidthMode } from '../../settings/types';
import type { ImageSourceDescriptor } from '../../utils/MarkdownSourceContext';

export type CaptionRenderMode = 'reading' | 'live-preview' | 'source';
export type { CaptionInlinePolicy, CaptionWidthMode };

export interface CaptionRenderPolicyInput {
    settings: CaptionSettings;
    mode: CaptionRenderMode;
    standalone: boolean;
}

export interface ReadingImageContext {
    linkText?: string | null;
    descriptor?: ImageSourceDescriptor | null;
}
