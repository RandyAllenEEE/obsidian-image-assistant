import { describe, expect, it } from 'vitest';
import {
    assertCanvasOutputMatchesExtension,
    getCanvasExportMime
} from '../../../src/utils/CanvasImageOutput';

const pngBytes = Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89
]).buffer;

describe('CanvasImageOutput', () => {
    it('maps only image formats that can be safely written back in place', () => {
        expect(getCanvasExportMime('JPG')).toBe('image/jpeg');
        expect(getCanvasExportMime('png')).toBe('image/png');
        expect(getCanvasExportMime('gif')).toBeUndefined();
    });

    it('rejects a silent PNG fallback when the source extension is AVIF', async () => {
        await expect(assertCanvasOutputMatchesExtension(pngBytes, 'avif'))
            .rejects.toThrow('produced image/png, not image/avif');
    });

    it('accepts a matching PNG output', async () => {
        await expect(assertCanvasOutputMatchesExtension(pngBytes, 'png')).resolves.toBeUndefined();
    });
});
