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
    expect(resolveImageLayout(null, enabled, false)).toEqual({
      alignment: null,
      wrap: false,
      source: 'none'
    });
  });

  it('allows an explicit alignment to promote inline media to a block', () => {
    expect(resolveImageLayout('right', enabled, false)).toEqual({
      alignment: 'right',
      wrap: false,
      source: 'pipe'
    });
  });

  it('keeps caption text alignment independent from figure placement', () => {
    expect(resolveCaptionLayout('left', enabled, 'right', true)).toEqual({
      placement: 'left',
      textAlignment: 'right',
      wrap: false,
      source: 'pipe'
    });
    expect(resolveCaptionLayout(null, enabled, 'right', true)).toEqual({
      placement: 'center',
      textAlignment: 'right',
      wrap: false,
      source: 'image-default'
    });
    expect(resolveCaptionLayout('left', { ...enabled, enabled: false }, 'right', true)).toEqual({
      placement: null,
      textAlignment: 'right',
      wrap: false,
      source: 'caption-fallback'
    });
  });

  it('disables caption floating for inline and multi-image descriptors', () => {
    expect(resolveCaptionLayout('left-wrap', enabled, 'center', false)).toEqual({
      placement: 'left',
      textAlignment: 'center',
      wrap: false,
      source: 'pipe'
    });
    expect(resolveCaptionLayout('right-wrap', enabled, 'center', true)).toEqual({
      placement: 'right',
      textAlignment: 'center',
      wrap: true,
      source: 'pipe'
    });
    expect(resolveCaptionLayout(null, enabled, 'right', false)).toEqual({
      placement: null,
      textAlignment: 'right',
      wrap: false,
      source: 'caption-fallback'
    });
  });
});
