import type { CaptionRenderPolicyInput } from './types';

export class CaptionRenderPolicy {
    shouldRender(input: CaptionRenderPolicyInput): boolean {
        const { settings, mode, standalone } = input;
        if (!settings.enabled || mode === 'source') return false;
        if (mode === 'reading' && settings.showInReadingMode === false) return false;
        if (mode === 'live-preview' && settings.showInLivePreview === false) return false;
        return (settings.inlinePolicy ?? 'all') === 'all' || standalone;
    }
}

export function shouldRenderCaption(input: CaptionRenderPolicyInput): boolean {
    return new CaptionRenderPolicy().shouldRender(input);
}
