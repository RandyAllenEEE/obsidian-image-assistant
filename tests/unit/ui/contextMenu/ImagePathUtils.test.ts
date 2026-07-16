import { describe, expect, it } from 'vitest';
import { ImagePathUtils } from '../../../../src/ui/contextMenu/utils/ImagePathUtils';

describe('ImagePathUtils', () => {
  it('normalizes malformed percent escapes without throwing', () => {
    expect(() => ImagePathUtils.normalizeImagePath('assets/bad%image.png')).not.toThrow();
    expect(ImagePathUtils.normalizeImagePath('assets/bad%image.png')).toBe('/assets/bad%image.png');
  });
});
