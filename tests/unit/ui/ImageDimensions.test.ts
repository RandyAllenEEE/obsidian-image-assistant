import { describe, expect, it } from 'vitest';
import {
    ImageDimensionRenderer,
    resolveImageDimensions
} from '../../../src/ui/ImageDimensions';

describe('ImageDimensionRenderer', () => {
    it('clears a stale height when an image changes from both axes to width only', () => {
        const renderer = new ImageDimensionRenderer();
        const image = document.createElement('img');

        renderer.apply(image, resolveImageDimensions({
            width: 500,
            height: 300,
            format: 'WxH'
        }));
        expect(image.style.cssText).toContain('width: 500px');
        expect(image.style.cssText).toContain('height: 300px');

        renderer.apply(image, resolveImageDimensions({ width: 500, format: 'W' }));
        expect(image.style.width).toBe('500px');
        expect(image.style.height).toBe('auto');
        expect(image.getAttribute('data-image-assistant-dimension-mode')).toBe('width');

        renderer.apply(image, resolveImageDimensions());
        expect(image.style.width).toBe('');
        expect(image.style.height).toBe('');
        expect(image.hasAttribute('data-image-assistant-dimension-owner')).toBe(false);
    });

    it('uses the intrinsic opposite axis for height-only and width-only formats', () => {
        const renderer = new ImageDimensionRenderer();
        const image = document.createElement('img');

        renderer.apply(image, resolveImageDimensions({ height: 240, format: 'xH' }));
        expect(image.style.width).toBe('auto');
        expect(image.style.height).toBe('240px');

        renderer.apply(image, resolveImageDimensions({ width: 320, format: 'Wx' }));
        expect(image.style.width).toBe('320px');
        expect(image.style.height).toBe('auto');
    });

    it('cleans only plugin-owned dimensions', () => {
        const renderer = new ImageDimensionRenderer();
        const root = document.createElement('div');
        const nativeImage = root.appendChild(document.createElement('img'));
        nativeImage.style.width = '40%';
        const ownedImage = root.appendChild(document.createElement('img'));
        renderer.apply(ownedImage, resolveImageDimensions({ width: 500, format: 'W' }));

        renderer.cleanup(root);

        expect(nativeImage.style.width).toBe('40%');
        expect(ownedImage.style.width).toBe('');
        expect(ownedImage.style.height).toBe('');
    });
});
