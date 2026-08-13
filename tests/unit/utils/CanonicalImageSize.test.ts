import { describe, expect, it } from 'vitest';

import {
  resolveCanonicalImageSize,
  resolveElementIntrinsicDimensions
} from '../../../src/utils/CanonicalImageSize';

describe('CanonicalImageSize', () => {
  it('emits only the canonical W and WxH forms', () => {
    expect(resolveCanonicalImageSize({ width: 300 })).toEqual({
      width: 300,
      format: 'W'
    });
    expect(resolveCanonicalImageSize({ width: 300, height: 200 })).toEqual({
      width: 300,
      height: 200,
      format: 'WxH'
    });
  });

  it('converts a height-only intent to W using intrinsic dimensions', () => {
    expect(resolveCanonicalImageSize({
      height: 200,
      intrinsic: { width: 1200, height: 800 }
    })).toEqual({ width: 300, format: 'W' });
  });

  it('omits an unresolvable height-only intent and rejects invalid values', () => {
    expect(resolveCanonicalImageSize({ height: 200 })).toBeUndefined();
    expect(resolveCanonicalImageSize({ width: 0, height: -1 })).toBeUndefined();
    expect(resolveCanonicalImageSize({ width: Number.POSITIVE_INFINITY })).toBeUndefined();
  });

  it('prefers an image intrinsic size without reading rendered layout', () => {
    const image = document.createElement('img');
    Object.defineProperties(image, {
      naturalWidth: { value: 1600 },
      naturalHeight: { value: 900 }
    });

    expect(resolveElementIntrinsicDimensions(image)).toEqual({
      width: 1600,
      height: 900
    });
  });

  it('falls back to SVG viewBox dimensions for external renderers', () => {
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<svg viewBox="0 0 640 360"></svg>';

    expect(resolveElementIntrinsicDimensions(wrapper)).toEqual({
      width: 640,
      height: 360
    });
  });
});
