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
  const view = {
    contentEl,
    editor: {},
    getMode: () => 'preview'
  };
  app.workspace.getActiveViewOfType = () => view;
  app.workspace.getLeavesOfType = () => [{ view }];
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

  it('refresh renders captions for existing images without rewriting attributes', () => {
    const contentEl = makeViewWithImages('A', 'B');
    const manager = new ImageCaption(makePlugin(contentEl));

    manager.refresh();

    const embeds = Array.from(contentEl.querySelectorAll('.internal-embed'));
    expect(embeds.map(embed => embed.getAttribute('alt'))).toEqual([null, null]);
    expect(Array.from(contentEl.querySelectorAll('.image-assistant-caption')).map(node => node.textContent)).toEqual(['A', 'B']);
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

  it('disabling captions removes the body class and runtime styles', () => {
    const contentEl = makeViewWithImages('Hidden');
    const manager = new ImageCaption(makePlugin(contentEl, { enabled: false }));

    manager.refresh();

    expect(document.body.classList.contains('image-captions-enabled')).toBe(false);
    expect(document.getElementById('image-caption-styles')).toBeNull();
  });
});
