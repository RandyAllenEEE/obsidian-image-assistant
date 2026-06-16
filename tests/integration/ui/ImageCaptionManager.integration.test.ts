import { describe, expect, it, beforeEach } from 'vitest';
import { ImageCaption } from '../../../src/ui/ImageCaption';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import { fakeApp } from '../../factories/obsidian';

function makeViewWithImages(...alts: string[]) {
  const contentEl = document.createElement('div');
  contentEl.className = 'markdown-preview-view';

  for (const [index, alt] of alts.entries()) {
    const embed = document.createElement('div');
    embed.className = 'internal-embed image-embed';
    embed.setAttribute('src', `imgs/${index}.webp`);
    const img = document.createElement('img');
    img.setAttribute('src', `imgs/${index}.webp`);
    img.setAttribute('alt', alt);
    embed.appendChild(img);
    contentEl.appendChild(embed);
  }

  document.body.appendChild(contentEl);
  return contentEl;
}

function makePlugin(contentEl: HTMLElement, captionOverrides: any = {}) {
  const app = fakeApp() as any;
  app.workspace.getActiveViewOfType = () => ({ contentEl });
  return {
    app,
    settings: {
      ...structuredClone(DEFAULT_SETTINGS),
      captions: {
        ...structuredClone(DEFAULT_SETTINGS.captions),
        ...captionOverrides
      }
    }
  } as any;
}

describe('ImageCaption integration', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    document.head.querySelector('#image-caption-styles')?.remove();
  });

  it('refresh applies caption attributes to existing active-view images', () => {
    const contentEl = makeViewWithImages('A', 'B');
    const manager = new ImageCaption(makePlugin(contentEl));

    manager.refresh();

    const embeds = Array.from(contentEl.querySelectorAll('.internal-embed'));
    expect(embeds.map(embed => embed.getAttribute('alt'))).toEqual(['A', 'B']);
    expect(document.body.classList.contains('image-captions-enabled')).toBe(true);
  });

  it('updateStyles reflects caption configuration in the shared style element', () => {
    const contentEl = makeViewWithImages('Styled');
    const manager = new ImageCaption(makePlugin(contentEl, {
      fontSize: '18px',
      color: '#123456',
      alignment: 'left'
    }));

    manager.updateStyles();

    const styleText = document.getElementById('image-caption-styles')?.textContent || '';
    expect(styleText).toContain('18px');
    expect(styleText).toContain('#123456');
    expect(styleText).toContain('text-align: left');
  });

  it('disabling captions removes the body class while keeping styles safe to update', () => {
    const contentEl = makeViewWithImages('Hidden');
    const manager = new ImageCaption(makePlugin(contentEl, { enabled: false }));

    manager.refresh();

    expect(document.body.classList.contains('image-captions-enabled')).toBe(false);
    expect(document.getElementById('image-caption-styles')).toBeTruthy();
  });
});
