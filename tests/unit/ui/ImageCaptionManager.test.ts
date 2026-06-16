import { describe, expect, it, beforeEach } from 'vitest';
import { ImageCaption } from '../../../src/ui/ImageCaption';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import { fakeApp } from '../../factories/obsidian';

function makePlugin(overrides: any = {}) {
  const app = fakeApp() as any;
  app.workspace.getActiveViewOfType = () => null;
  return {
    app,
    settings: {
      ...structuredClone(DEFAULT_SETTINGS),
      captions: {
        ...structuredClone(DEFAULT_SETTINGS.captions),
        ...overrides
      }
    }
  } as any;
}

function makeEmbed(src = 'test.webp', alt = '') {
  const embed = document.createElement('div');
  embed.className = 'internal-embed image-embed';
  embed.setAttribute('src', src);
  const img = document.createElement('img');
  img.setAttribute('src', src);
  if (alt) img.setAttribute('alt', alt);
  embed.appendChild(img);
  document.body.appendChild(embed);
  return { embed, img };
}

describe('ImageCaption', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.querySelector('#image-caption-styles')?.remove();
  });

  it('adds the enabled body class and style tag when captions are enabled', () => {
    new ImageCaption(makePlugin());

    expect(document.body.classList.contains('image-captions-enabled')).toBe(true);
    expect(document.getElementById('image-caption-styles')?.textContent).toContain('content: attr(alt)');
  });

  it('sets a real caption on the embed container and image', () => {
    const { embed, img } = makeEmbed('test.webp', 'My Caption');
    const manager = new ImageCaption(makePlugin());

    manager.applyCaption(img, undefined);

    expect(embed.getAttribute('alt')).toBe('My Caption');
    expect(img.getAttribute('alt')).toBe('My Caption');
  });

  it('uses a blank caption when the alt text is only the filename', () => {
    const { embed, img } = makeEmbed('test.webp', 'test.webp');
    const manager = new ImageCaption(makePlugin());

    manager.applyCaption(img, undefined);

    expect(embed.getAttribute('alt')).toBe(' ');
  });

  it('removes caption attributes for skipped extensions', () => {
    const { embed, img } = makeEmbed('test.png', 'Skip me');
    const manager = new ImageCaption(makePlugin({ skipExtensions: 'png' }));

    manager.applyCaption(img, undefined);

    expect(embed.hasAttribute('alt')).toBe(false);
    expect(img.hasAttribute('alt')).toBe(false);
  });

  it('strips table escape slashes from captions', () => {
    const table = document.createElement('table');
    const { embed, img } = makeEmbed('test.webp', 'Caption\\');
    table.appendChild(embed);
    document.body.appendChild(table);
    const manager = new ImageCaption(makePlugin());

    manager.applyCaption(img, undefined);

    expect(embed.getAttribute('alt')).toBe('Caption');
  });
});
