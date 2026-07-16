import { describe, expect, it, vi } from 'vitest';
import {
  CAPTION_EXPLICIT_WIDTH_ATTRIBUTE,
  CAPTION_GEOMETRY_ATTRIBUTE,
  clearLivePreviewCaptionGeometry,
  syncLivePreviewCaptionGeometry,
  syncLivePreviewCaptionWidget
} from '../../../../src/ui/caption/LivePreviewCaptionGeometry';

const SOURCE_KEY = '10:80:0:https://example.com/image';

function rect(left: number, width: number): DOMRect {
  return {
    left,
    width,
    right: left + width,
    top: 0,
    bottom: 100,
    height: 100,
    x: left,
    y: 0,
    toJSON: () => ({})
  } as DOMRect;
}

function makeFixture() {
  const root = document.createElement('div');
  const image = root.appendChild(document.createElement('img'));
  image.setAttribute('data-image-assistant-source-key', SOURCE_KEY);
  const caption = root.appendChild(document.createElement('span'));
  caption.className = 'image-assistant-caption image-assistant-live-preview-caption';
  caption.setAttribute('data-image-assistant-caption-renderer', 'codemirror');
  caption.setAttribute('data-image-assistant-source-key', SOURCE_KEY);
  caption.setAttribute('data-image-assistant-caption-width', 'auto');
  caption.setAttribute(CAPTION_EXPLICIT_WIDTH_ATTRIBUTE, 'true');
  caption.setAttribute('data-image-assistant-caption-wrap', 'false');
  return { root, image, caption };
}

describe('LivePreviewCaptionGeometry', () => {
  it('binds an explicit-width caption to the matched image left edge and rendered width', () => {
    const { root, image, caption } = makeFixture();
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(rect(320, 800));
    vi.spyOn(caption, 'getBoundingClientRect').mockReturnValue(rect(120, 800));

    expect(syncLivePreviewCaptionGeometry(root, image, SOURCE_KEY)).toBe(true);
    expect(caption.getAttribute(CAPTION_GEOMETRY_ATTRIBUTE)).toBe('true');
    expect(caption.style.getPropertyValue('--image-assistant-caption-rendered-width')).toBe('800px');
    expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('200px');
  });

  it('finds the image by exact source key when the widget is created later', () => {
    const { root, image, caption } = makeFixture();
    const other = root.insertBefore(document.createElement('img'), image);
    other.setAttribute('data-image-assistant-source-key', 'other');
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(rect(400, 600));
    vi.spyOn(caption, 'getBoundingClientRect').mockReturnValue(rect(100, 600));

    expect(syncLivePreviewCaptionWidget(root, caption, SOURCE_KEY)).toBe(image);
    expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('300px');
  });

  it('uses rendered image geometry when auto width has no explicit Pipe size', () => {
    const { root, image, caption } = makeFixture();
    caption.setAttribute(CAPTION_EXPLICIT_WIDTH_ATTRIBUTE, 'false');
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(rect(260, 960));
    vi.spyOn(caption, 'getBoundingClientRect').mockReturnValue(rect(100, 1200));

    expect(syncLivePreviewCaptionGeometry(root, image, SOURCE_KEY)).toBe(true);
    expect(caption.style.getPropertyValue('--image-assistant-caption-rendered-width')).toBe('960px');
    expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('160px');
  });

  it.each([
    ['container width', 'container', 'true', 'false'],
    ['wrapping layout', 'auto', 'true', 'true']
  ])('leaves %s captions in their existing layout flow', (_name, widthMode, explicit, wrap) => {
    const { root, image, caption } = makeFixture();
    caption.setAttribute('data-image-assistant-caption-width', widthMode);
    caption.setAttribute(CAPTION_EXPLICIT_WIDTH_ATTRIBUTE, explicit);
    caption.setAttribute('data-image-assistant-caption-wrap', wrap);
    caption.setAttribute(CAPTION_GEOMETRY_ATTRIBUTE, 'true');
    caption.style.setProperty('--image-assistant-caption-offset', '50px');
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(rect(320, 800));

    expect(syncLivePreviewCaptionGeometry(root, image, SOURCE_KEY)).toBe(false);
    expect(caption.hasAttribute(CAPTION_GEOMETRY_ATTRIBUTE)).toBe(false);
    expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('');
  });

  it('recovers the baseline without drift or style mutations on repeated synchronization', () => {
    const { root, image, caption } = makeFixture();
    vi.spyOn(image, 'getBoundingClientRect').mockReturnValue(rect(320, 800));
    const captionRect = vi.spyOn(caption, 'getBoundingClientRect').mockImplementation(() => {
      const offset = Number.parseFloat(
        caption.style.getPropertyValue('--image-assistant-caption-offset')
      ) || 0;
      return rect(120 + offset, 800);
    });

    syncLivePreviewCaptionGeometry(root, image, SOURCE_KEY);
    const setProperty = vi.spyOn(caption.style, 'setProperty');
    syncLivePreviewCaptionGeometry(root, image, SOURCE_KEY);

    expect(captionRect).toHaveBeenCalledTimes(2);
    expect(setProperty).not.toHaveBeenCalled();
    expect(caption.style.getPropertyValue('--image-assistant-caption-offset')).toBe('200px');
    clearLivePreviewCaptionGeometry(root, SOURCE_KEY);
    expect(caption.hasAttribute(CAPTION_GEOMETRY_ATTRIBUTE)).toBe(false);
  });
});
