import { describe, expect, it } from 'vitest';
import {
  resolveCaptionLayout,
  resolveImageLayout
} from '../../../src/ui/ImageLayoutResolver';

describe('ImageLayoutResolver', () => {
  const enabled = { enabled: true, default: 'center' as const };

  it('prefers explicit pipe alignment over the image default', () => {
    expect(resolveImageLayout('right-wrap', enabled)).toEqual({
      alignment: 'right',
      wrap: true,
      source: 'pipe'
    });
  });

  it('uses the image default only while image alignment is enabled', () => {
    expect(resolveImageLayout(null, enabled)).toEqual({
      alignment: 'center',
      wrap: false,
      source: 'image-default'
    });
    expect(resolveImageLayout('right', { ...enabled, enabled: false })).toEqual({
      alignment: null,
      wrap: false,
      source: 'none'
    });
  });

  it('lets captions follow the final image alignment before their fallback', () => {
    expect(resolveCaptionLayout('left', enabled, 'right', true)).toEqual({
      alignment: 'left',
      wrap: false,
      source: 'pipe'
    });
    expect(resolveCaptionLayout(null, enabled, 'right', true)).toEqual({
      alignment: 'center',
      wrap: false,
      source: 'image-default'
    });
    expect(resolveCaptionLayout('left', { ...enabled, enabled: false }, 'right', true)).toEqual({
      alignment: 'right',
      wrap: false,
      source: 'caption-fallback'
    });
  });

  it('disables caption floating for inline and multi-image descriptors', () => {
    expect(resolveCaptionLayout('left-wrap', enabled, 'center', false)).toEqual({
      alignment: 'left',
      wrap: false,
      source: 'pipe'
    });
    expect(resolveCaptionLayout('right-wrap', enabled, 'center', true)).toEqual({
      alignment: 'right',
      wrap: true,
      source: 'pipe'
    });
  });
});
