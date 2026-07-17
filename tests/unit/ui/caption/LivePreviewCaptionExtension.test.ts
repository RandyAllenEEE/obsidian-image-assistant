import { EditorView } from '@codemirror/view';
import * as obsidian from 'obsidian';
import { editorLivePreviewField } from 'obsidian';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createLivePreviewCaptionExtension,
  refreshLivePreviewCaptionsEffect
} from '../../../../src/ui/caption/LivePreviewCaptionExtension';
import { DEFAULT_SETTINGS } from '../../../../src/settings/defaults';

const setEditorLivePreviewEffect = (obsidian as any).setEditorLivePreviewEffect;

function createFixture(doc: string, includeLivePreviewField = true) {
  const parent = document.createElement('div');
  parent.className = 'markdown-source-view mod-cm6 is-live-preview';
  document.body.appendChild(parent);
  const plugin = {
    settings: {
      captions: {
        ...structuredClone(DEFAULT_SETTINGS.captions)
      },
      alignment: {
        ...structuredClone(DEFAULT_SETTINGS.alignment)
      }
    }
  } as any;
  const extension = createLivePreviewCaptionExtension(plugin);
  const view = new EditorView({
    doc,
    extensions: includeLivePreviewField
      ? [editorLivePreviewField, extension]
      : [extension],
    parent
  });

  return { extension, parent, plugin, view };
}

describe('LivePreviewCaptionExtension', () => {
  const views: EditorView[] = [];

  afterEach(() => {
    views.splice(0).forEach(view => view.destroy());
    document.body.empty();
  });

  it('renders mixed Wiki and Markdown captions in source order', () => {
    const { parent, view } = createFixture(
      '![[image one.png|right|300|Wiki caption]] ![left-wrap|640x360|Markdown caption](https://example.com/a.webp "Title")'
    );
    views.push(view);

    const captions = [...parent.querySelectorAll('.image-assistant-live-preview-caption')];
    expect(captions.map(node => node.textContent)).toEqual(['Wiki caption', 'Markdown caption']);
    expect(captions.every(node => node.tagName === 'SPAN')).toBe(true);
    expect(captions.every(node => node.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(captions.every(node => node.getAttribute('data-image-assistant-caption-renderer') === 'codemirror')).toBe(true);
    expect((captions[0] as HTMLElement).style.getPropertyValue('--img-width')).toBe('300px');
    expect((captions[1] as HTMLElement).style.getPropertyValue('--img-width')).toBe('640px');
    expect(captions[0].getAttribute('data-image-assistant-caption-align')).toBe('right');
    expect(captions[1].getAttribute('data-image-assistant-caption-align')).toBe('left');
    expect(captions[1].getAttribute('data-image-assistant-caption-wrap')).toBe('false');
    expect(captions.every(node => !!node.getAttribute('data-image-assistant-source-key'))).toBe(true);
    expect(captions.every(node => !!node.getAttribute('data-image-assistant-layout-key'))).toBe(true);
  });

  it('keeps the layout binding stable when a caption widget is rebuilt', () => {
    const source = '![[photo.png|Old caption|center|500]]';
    const { parent, view } = createFixture(source);
    views.push(view);
    const before = parent.querySelector<HTMLElement>('.image-assistant-live-preview-caption')!;
    const layoutKey = before.getAttribute('data-image-assistant-layout-key');
    const sourceKey = before.getAttribute('data-image-assistant-source-key');
    const from = source.indexOf('Old caption');

    view.dispatch({ changes: { from, to: from + 'Old caption'.length, insert: 'Updated caption' } });

    const after = parent.querySelector<HTMLElement>('.image-assistant-live-preview-caption')!;
    expect(after.textContent).toBe('Updated caption');
    expect(after.getAttribute('data-image-assistant-layout-key')).toBe(layoutKey);
    expect(after.getAttribute('data-image-assistant-source-key')).not.toBe(sourceKey);
  });

  it('honors skipped extensions and refreshes when caption settings change', () => {
    const { parent, plugin, view } = createFixture(
      '![[diagram.svg|Diagram caption]] ![[photo.avif|Photo caption]]'
    );
    views.push(view);

    expect([...parent.querySelectorAll('.image-assistant-live-preview-caption')]
      .map(node => node.textContent)).toEqual(['Photo caption']);

    plugin.settings.captions.enabled = false;
    view.dispatch({ effects: refreshLivePreviewCaptionsEffect.of(undefined) });
    expect(parent.querySelector('.image-assistant-live-preview-caption')).toBeNull();

    plugin.settings.captions.enabled = true;
    view.dispatch({ effects: refreshLivePreviewCaptionsEffect.of(undefined) });
    expect(parent.querySelector('.image-assistant-live-preview-caption')?.textContent)
      .toBe('Photo caption');
  });

  it('renders Admonition content but excludes source-only Markdown contexts', () => {
    const { parent, view } = createFixture([
      '---',
      'cover: ![[frontmatter.png|Frontmatter]]',
      '---',
      '`![[inline.png|Inline]]`',
      '<!-- ![[comment.png|Comment]] -->',
      '```markdown',
      '![[code.png|Code]]',
      '```',
      '> [!note]',
      '> ![[callout.png|Callout caption]]',
      '```ad-note',
      '![[legacy.png|Legacy caption]]',
      '```'
    ].join('\n'));
    views.push(view);

    expect([...parent.querySelectorAll('.image-assistant-live-preview-caption')]
      .map(node => node.textContent)).toEqual(['Callout caption', 'Legacy caption']);
  });

  it('does not create caption widgets in Source Mode', () => {
    const { parent, view } = createFixture('![[photo.png|Caption]]');
    views.push(view);

    view.dispatch({ effects: setEditorLivePreviewEffect.of(false) });

    expect(parent.querySelector('.image-assistant-live-preview-caption')).toBeNull();
  });

  it('stays empty when the Obsidian Live Preview field is absent', () => {
    const { parent, view } = createFixture('![[photo.png|Caption]]', false);
    views.push(view);

    expect(parent.querySelector('.image-assistant-live-preview-caption')).toBeNull();
  });

  it('updates a stable line incrementally and preserves later captions', () => {
    const source = '![[first.png|Old]]\n![[second.png|Second]]';
    const { extension, parent, view } = createFixture(source);
    views.push(view);
    const from = source.indexOf('Old');

    view.dispatch({ changes: { from, to: from + 3, insert: 'Updated' } });

    const field = view.state.field(extension);
    expect(field.incremental).toBe(true);
    expect(field.scan.scannedLineCount).toBe(1);
    expect([...parent.querySelectorAll('.image-assistant-live-preview-caption')]
      .map(node => node.textContent)).toEqual(['Updated', 'Second']);
  });

  it('performs a full rebuild when an ordinary fence becomes an Admonition', () => {
    const source = '```markdown\n![[photo.png|Caption]]\n```';
    const { extension, parent, view } = createFixture(source);
    views.push(view);
    const to = '```markdown'.length;

    view.dispatch({ changes: { from: 0, to, insert: '```ad-note' } });

    const field = view.state.field(extension);
    expect(field.incremental).toBe(false);
    expect(field.scan.fullScan).toBe(true);
    expect(parent.querySelector('.image-assistant-live-preview-caption')?.textContent)
      .toBe('Caption');
  });

  it('applies standalone, container-width, and line-clamp behavior', () => {
    const { parent, plugin, view } = createFixture([
      'Text ![[inline.png|Inline caption]]',
      '![[standalone.png|A long standalone caption]]'
    ].join('\n'));
    views.push(view);
    plugin.settings.captions.inlinePolicy = 'standalone-only';
    plugin.settings.captions.widthMode = 'container';
    plugin.settings.captions.maxLines = 2;
    view.dispatch({ effects: refreshLivePreviewCaptionsEffect.of(undefined) });

    const captions = [...parent.querySelectorAll<HTMLElement>('.image-assistant-live-preview-caption')];
    expect(captions.map(node => node.textContent)).toEqual(['A long standalone caption']);
    expect(captions[0].getAttribute('data-image-assistant-caption-width')).toBe('container');
    expect(captions[0].getAttribute('data-image-assistant-caption-clamped')).toBe('true');
    expect(captions[0].title).toBe('A long standalone caption');
  });

  it('follows explicit and default image alignment before caption fallback', () => {
    const { parent, plugin, view } = createFixture([
      '![[explicit.png|left|Explicit caption]]',
      '![[default.png|Default caption]]'
    ].join('\n'));
    views.push(view);
    plugin.settings.alignment.default = 'right';
    plugin.settings.captions.alignment = 'center';
    view.dispatch({ effects: refreshLivePreviewCaptionsEffect.of(undefined) });

    const captions = [...parent.querySelectorAll<HTMLElement>('.image-assistant-live-preview-caption')];
    expect(captions.map(node => node.getAttribute('data-image-assistant-caption-align')))
      .toEqual(['left', 'right']);

    plugin.settings.alignment.enabled = false;
    view.dispatch({ effects: refreshLivePreviewCaptionsEffect.of(undefined) });
    expect([...parent.querySelectorAll<HTMLElement>('.image-assistant-live-preview-caption')]
      .map(node => node.getAttribute('data-image-assistant-caption-align')))
      .toEqual(['center', 'center']);
  });

  it('only keeps Live Preview wrap when a standalone image has a reliable width', () => {
    const { parent, view } = createFixture([
      '![[sized.png|left-wrap|320|Sized caption]]',
      '![[natural.png|right-wrap|Natural caption]]'
    ].join('\n'));
    views.push(view);

    const captions = [...parent.querySelectorAll<HTMLElement>('.image-assistant-live-preview-caption')];
    expect(captions.map(node => node.getAttribute('data-image-assistant-caption-wrap')))
      .toEqual(['true', 'false']);
  });
});
