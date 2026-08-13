import { describe, expect, it } from 'vitest';
import { CaptionResolver } from '../../../../src/ui/caption/CaptionResolver';

describe('CaptionResolver', () => {
  const resolver = new CaptionResolver();

  it('resolves canonical Wiki URL pipe syntax', () => {
    const state = resolver.resolveFromLinkText('![[https://example.com/photo.png?size=large|Network caption|right|300]]');

    expect(state).toMatchObject({
      path: 'https://example.com/photo.png?size=large',
      caption: 'Network caption',
      align: 'right',
      size: { width: 300, format: 'W' },
      linkType: 'wiki',
      shouldRender: true
    });
  });

  it('resolves canonical Markdown pipe syntax', () => {
    const state = resolver.resolveFromLinkText('![Markdown caption|left-wrap|640x360](https://example.com/a.png "Title")');

    expect(state).toMatchObject({
      path: 'https://example.com/a.png',
      caption: 'Markdown caption',
      align: 'left-wrap',
      size: { width: 640, height: 360, format: 'WxH' },
      linkType: 'markdown',
      shouldRender: true
    });
  });

  it('does not render captions for skipped extensions', () => {
    const state = resolver.resolveFromLinkText('![Vector caption](diagram.svg)', {
      skipExtensions: 'svg,pdf'
    });

    expect(state?.caption).toBeNull();
    expect(state?.shouldRender).toBe(false);
  });

  it('does not render file names as captions by default', () => {
    const state = resolver.resolveFromLinkText('![photo.png](photo.png)');

    expect(state?.caption).toBeNull();
    expect(state?.shouldRender).toBe(false);
  });

  it('can resolve from DOM alt and src metadata', () => {
    const embed = document.createElement('span');
    embed.className = 'external-embed';
    embed.setAttribute('src', 'https://example.com/photo.png');
    const img = document.createElement('img');
    img.setAttribute('alt', 'Caption\\|with pipe|right|320');
    embed.appendChild(img);

    const state = resolver.resolveFromImage(img);

    expect(state.caption).toBe('Caption|with pipe');
    expect(state.align).toBe('right');
    expect(state.size).toEqual({ width: 320, format: 'W' });
    expect(state.shouldRender).toBe(true);
  });

  it('uses an explicit caption text when ImageStateManager already resolved the link', () => {
    const img = document.createElement('img');
    img.setAttribute('src', 'https://example.com/photo.png');
    img.setAttribute('alt', 'raw|right|300');

    const state = resolver.resolveFromImage(img, {
      captionText: 'Resolved caption'
    });

    expect(state.caption).toBe('Resolved caption');
    expect(state.align).toBeNull();
    expect(state.shouldRender).toBe(true);
  });
});
