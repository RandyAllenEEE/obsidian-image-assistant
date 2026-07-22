import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ImageCaption } from '../../../src/ui/ImageCaption';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import { fakeApp } from '../../factories/obsidian';
import { getCaptionLinkDescriptors } from '../../../src/utils/MarkdownSourceContext';

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
    expect(document.getElementById('image-caption-styles')?.textContent).toContain('.image-assistant-caption');
  });

  it('includes advanced caption style settings in generated CSS', () => {
    new ImageCaption(makePlugin({
      fontStyle: 'normal',
      fontWeight: '600',
      backgroundColor: 'rgba(0,0,0,0.08)',
      padding: '4px 8px',
      borderRadius: '6px',
      opacity: '0.55',
      textTransform: 'uppercase',
      letterSpacing: '0.02em',
      border: '1px solid var(--background-modifier-border)',
      marginTop: '8px'
    }));

    const styles = document.getElementById('image-caption-styles')?.textContent ?? '';
    expect(styles).toContain('font-style: normal');
    expect(styles).toContain('font-weight: 600');
    expect(styles).toContain('background-color: rgba(0,0,0,0.08)');
    expect(styles).toContain('padding: 4px 8px');
    expect(styles).toContain('border-radius: 6px');
    expect(styles).toContain('opacity: 0.55');
    expect(styles).toContain('text-transform: uppercase');
    expect(styles).toContain('letter-spacing: 0.02em');
    expect(styles).toContain('border: 1px solid var(--background-modifier-border)');
    expect(styles).toContain('margin-top: 8px');
    expect(styles).toContain('[data-image-assistant-caption-align="right"]');
    expect(styles).toContain('text-align: var(--image-assistant-caption-text-align, center)');
  });

  it('renders a caption without rewriting native alt or title attributes', () => {
    const { embed, img } = makeEmbed('test.webp', 'My Caption');
    const manager = new ImageCaption(makePlugin());

    manager.applyCaption(img, undefined);

    expect(embed.getAttribute('alt')).toBeNull();
    expect(img.getAttribute('alt')).toBe('My Caption');
    expect(img.getAttribute('title')).toBeNull();
    expect(embed.querySelector('.image-assistant-caption')?.textContent).toBe('My Caption');
  });

  it('suppresses filename-only captions without rewriting alt text', () => {
    const { embed, img } = makeEmbed('test.webp', 'test.webp');
    const manager = new ImageCaption(makePlugin());

    manager.applyCaption(img, undefined);

    expect(embed.getAttribute('alt')).toBeNull();
    expect(img.getAttribute('alt')).toBe('test.webp');
    expect(embed.querySelector('.image-assistant-caption')).toBeNull();
  });

  it('skips configured extensions without removing native attributes', () => {
    const { embed, img } = makeEmbed('test.png', 'Skip me');
    const manager = new ImageCaption(makePlugin({ skipExtensions: 'png' }));

    manager.applyCaption(img, undefined);

    expect(embed.hasAttribute('alt')).toBe(false);
    expect(img.getAttribute('alt')).toBe('Skip me');
    expect(embed.querySelector('.image-assistant-caption')).toBeNull();
  });

  it('strips table escape slashes from captions', () => {
    const table = document.createElement('table');
    const { embed, img } = makeEmbed('test.webp', 'Caption\\');
    table.appendChild(embed);
    document.body.appendChild(table);
    const manager = new ImageCaption(makePlugin());

    manager.applyCaption(img, undefined);

    expect(embed.getAttribute('alt')).toBeNull();
    expect(img.getAttribute('alt')).toBe('Caption\\');
    expect(embed.querySelector('.image-assistant-caption')?.textContent).toBe('Caption');
  });

  it('renders a real caption for bare network images without wrapping the image', () => {
    const paragraph = document.createElement('p');
    const img = document.createElement('img');
    img.setAttribute('src', 'https://example.com/photo.png');
    img.setAttribute('alt', 'Network caption');
    paragraph.appendChild(img);
    document.body.appendChild(paragraph);
    const manager = new ImageCaption(makePlugin());

    manager.applyCaption(img, undefined);

    const caption = paragraph.querySelector('.image-assistant-caption');
    expect(img.parentElement).toBe(paragraph);
    expect(caption?.previousElementSibling).toBe(img);
    expect(caption?.textContent).toBe('Network caption');
  });

  it('uses image alignment first and the caption setting only as a fallback', () => {
    const plugin = makePlugin({ alignment: 'left' });
    plugin.settings.alignment.default = 'right';
    const manager = new ImageCaption(plugin);
    const { embed, img } = makeEmbed('photo.png');
    const explicit = getCaptionLinkDescriptors('![[photo.png|center|Explicit caption]]')[0];

    manager.renderImage(img, { descriptor: explicit, linkText: explicit.source });
    expect(embed.querySelector('.image-assistant-caption')
      ?.getAttribute('data-image-assistant-caption-align')).toBe('center');

    plugin.settings.alignment.enabled = false;
    manager.renderImage(img, { descriptor: explicit, linkText: explicit.source });
    expect(embed.querySelector('.image-assistant-caption')
      ?.getAttribute('data-image-assistant-caption-align')).toBe('left');
  });

  it('injects caption styles into the image owner document for popout windows', () => {
    const popoutDocument = document.implementation.createHTMLDocument('popout');
    const img = popoutDocument.createElement('img');
    img.setAttribute('src', 'https://example.com/photo.png');
    img.setAttribute('alt', 'Popout caption');
    popoutDocument.body.appendChild(img);
    const manager = new ImageCaption(makePlugin());

    manager.applyCaption(img, undefined, {
      document: popoutDocument
    });
    manager.applyCaption(img, undefined, {
      document: popoutDocument
    });

    expect(popoutDocument.body.classList.contains('image-captions-enabled')).toBe(true);
    expect(popoutDocument.getElementById('image-caption-styles')?.textContent).toContain('.image-assistant-caption');
    expect(popoutDocument.querySelector('.image-assistant-caption')?.textContent).toBe('Popout caption');
    expect(popoutDocument.querySelectorAll('.image-assistant-caption')).toHaveLength(1);

    manager.destroy();
    expect(popoutDocument.body.classList.contains('image-captions-enabled')).toBe(false);
    expect(popoutDocument.getElementById('image-caption-styles')).toBeNull();
    expect(popoutDocument.querySelector('.image-assistant-caption')).toBeNull();
  });

  it('prunes closed popout documents before applying styles', () => {
    const manager = new ImageCaption(makePlugin());
    const popoutDocument = document.implementation.createHTMLDocument('closed popout');
    Object.defineProperty(popoutDocument, 'defaultView', {
      configurable: true,
      value: { closed: true }
    });
    (manager as any).documents.add(popoutDocument);

    manager.updateStyles();

    expect((manager as any).documents.has(popoutDocument)).toBe(false);
  });

  it('cleans a popout document when it is unregistered', () => {
    const popoutDocument = document.implementation.createHTMLDocument('popout');
    const img = popoutDocument.createElement('img');
    img.setAttribute('src', 'https://example.com/photo.png');
    img.setAttribute('alt', 'Popout caption');
    popoutDocument.body.appendChild(img);
    const manager = new ImageCaption(makePlugin());

    manager.ensureDocument(popoutDocument);
    manager.applyCaption(img, undefined, { document: popoutDocument });
    manager.cleanupDocument(popoutDocument);

    expect(popoutDocument.querySelector('.image-assistant-caption')).toBeNull();
    expect(popoutDocument.body.classList.contains('image-captions-enabled')).toBe(false);
    expect(popoutDocument.getElementById('image-caption-styles')).toBeNull();
  });

  it('honors standalone-only policy from the exact source descriptor', () => {
    const plugin = makePlugin({ inlinePolicy: 'standalone-only' });
    const manager = new ImageCaption(plugin);
    const paragraph = document.createElement('p');
    paragraph.append('Text before ');
    const img = document.createElement('img');
    img.src = 'https://example.com/photo.png';
    img.alt = 'DOM fallback caption';
    paragraph.appendChild(img);
    document.body.appendChild(paragraph);
    const descriptor = getCaptionLinkDescriptors(
      'Text before ![Exact caption](https://example.com/photo.png)'
    )[0];

    manager.renderImage(img, { descriptor, linkText: descriptor.source });

    expect(paragraph.querySelector('.image-assistant-caption')).toBeNull();
    expect(img.alt).toBe('DOM fallback caption');
  });

  it('refreshes every Reading and editor leaf instead of only the active view', () => {
    const plugin = makePlugin();
    const readingContent = document.createElement('div');
    const readingImage = document.createElement('img');
    readingImage.alt = 'Reading caption';
    readingContent.appendChild(readingImage);
    const readingDispatch = vi.fn();
    const firstDispatch = vi.fn();
    const secondDispatch = vi.fn();
    const makeEditor = (dispatch: ReturnType<typeof vi.fn>) => ({
      cm: {
        dispatch,
        state: { field: () => true }
      }
    });
    plugin.app.workspace.getLeavesOfType = vi.fn(() => [
      { view: { contentEl: readingContent, getMode: () => 'preview', editor: makeEditor(readingDispatch) } },
      { view: { contentEl: document.createElement('div'), getMode: () => 'source', editor: makeEditor(firstDispatch) } },
      { view: { contentEl: document.createElement('div'), getMode: () => 'source', editor: makeEditor(secondDispatch) } }
    ]);
    plugin.imageStateManager = { processReadingModeImage: vi.fn() };
    const manager = new ImageCaption(plugin);

    manager.refreshAllViews();

    expect(plugin.imageStateManager.processReadingModeImage).toHaveBeenCalledWith(readingImage);
    expect(readingDispatch).toHaveBeenCalledOnce();
    const readingEffects = readingDispatch.mock.calls[0][0].effects;
    expect(readingEffects.value).toBe(false);
    expect(firstDispatch).toHaveBeenCalledOnce();
    expect(secondDispatch).toHaveBeenCalledOnce();
  });

  it('owns popout document setup and cleanup through Component window events', () => {
    const plugin = makePlugin();
    const manager = new ImageCaption(plugin);
    manager.onload();
    const calls = (plugin.app.workspace.on as ReturnType<typeof vi.fn>).mock.calls;
    const open = calls.find(([event]) => event === 'window-open')?.[1];
    const close = calls.find(([event]) => event === 'window-close')?.[1];
    const popoutDocument = document.implementation.createHTMLDocument('popout');
    const win = { document: popoutDocument };

    open?.({}, win);
    expect(popoutDocument.body.classList.contains('image-captions-enabled')).toBe(true);
    expect(popoutDocument.getElementById('image-caption-styles')).not.toBeNull();

    close?.({}, win);
    expect(popoutDocument.body.classList.contains('image-captions-enabled')).toBe(false);
    expect(popoutDocument.getElementById('image-caption-styles')).toBeNull();
    manager.onunload();
  });

  it('clears hidden CodeMirror captions after a leaf enters Reading Mode', async () => {
    const plugin = makePlugin();
    const dispatch = vi.fn();
    const view = {
      contentEl: document.createElement('div'),
      getMode: () => 'preview',
      editor: {
        cm: {
          dispatch,
          state: { field: () => true }
        }
      }
    };
    plugin.app.workspace.getLeavesOfType = vi.fn(() => [{ view }]);
    const manager = new ImageCaption(plugin);
    manager.onload();
    const layoutChange = (plugin.app.workspace.on as ReturnType<typeof vi.fn>).mock.calls
      .find(([event]) => event === 'layout-change')?.[1];

    layoutChange?.();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch.mock.calls[0][0].effects.value).toBe(false);
    manager.onunload();
  });
});
