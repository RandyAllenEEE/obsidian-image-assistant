import { EditorView } from '@codemirror/view';
import * as obsidian from 'obsidian';
import { editorLivePreviewField } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createLivePreviewCaptionExtension,
  refreshLivePreviewCaptionsEffect,
  setLivePreviewCaptionModeEffect
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
    vi.restoreAllMocks();
    document.body.empty();
  });

  it('renders mixed Wiki and Markdown captions in source order', () => {
    const { parent, view } = createFixture(
      '![[image one.png|Wiki caption|right|300]] ![Markdown caption|left-wrap|640x360](https://example.com/a.webp "Title")'
    );
    views.push(view);

    const captions = [...parent.querySelectorAll('.image-assistant-live-preview-caption')];
    expect(captions.map(node => node.textContent)).toEqual(['Wiki caption', 'Markdown caption']);
    expect(captions.every(node => node.tagName === 'SPAN')).toBe(true);
    expect(captions.every(node => node.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(captions.every(node => node.getAttribute('data-image-assistant-caption-renderer') === 'codemirror')).toBe(true);
    expect((captions[0] as HTMLElement).style.getPropertyValue('--img-width')).toBe('300px');
    expect((captions[1] as HTMLElement).style.getPropertyValue('--img-width')).toBe('640px');
    expect(captions.map(node => node.getAttribute('data-image-assistant-caption-placement')))
      .toEqual(['right', 'left']);
    expect(captions.map(node => node.getAttribute('data-image-assistant-caption-text-align')))
      .toEqual(['center', 'center']);
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

  it('removes hidden editor widgets while Reading Mode owns the leaf', () => {
    const { extension, parent, view } = createFixture('![[photo.png|Caption]]');
    views.push(view);

    expect(parent.querySelector('.image-assistant-live-preview-caption')).not.toBeNull();
    view.dispatch({ effects: setLivePreviewCaptionModeEffect.of(false) });

    const readingState = view.state.field(extension);
    expect(readingState.modeEnabled).toBe(false);
    expect(readingState.decorations.size).toBe(0);
    expect(parent.querySelector('.image-assistant-live-preview-caption')).toBeNull();

    view.dispatch({ effects: setLivePreviewCaptionModeEffect.of(null) });
    expect(view.state.field(extension).modeEnabled).toBeNull();
    expect(parent.querySelector('.image-assistant-live-preview-caption')?.textContent)
      .toBe('Caption');

    view.dispatch({ effects: setEditorLivePreviewEffect.of(false) });
    expect(parent.querySelector('.image-assistant-live-preview-caption')).toBeNull();
  });

  it('restores block captions with stable height estimates after Reading Mode', () => {
    const source = [
      '![[short.png|Short caption|120]]',
      ...Array.from({ length: 200 }, (_, index) =>
        `![[image-${index}.png|${'Long caption text '.repeat(12)}${index}|120]]`)
    ].join('\n');
    const { extension, view } = createFixture(source);
    views.push(view);

    view.dispatch({ effects: setLivePreviewCaptionModeEffect.of(false) });
    view.dispatch({ effects: setLivePreviewCaptionModeEffect.of(null) });

    const widgets: Array<{ estimatedHeight: number }> = [];
    view.state.field(extension).decorations.between(
      0,
      view.state.doc.length,
      (_from, _to, decoration) => {
        widgets.push(decoration.spec.widget);
      }
    );
    expect(widgets).toHaveLength(201);
    expect(widgets.every(widget => Number.isFinite(widget.estimatedHeight)
      && widget.estimatedHeight > 0)).toBe(true);
    expect(widgets[1].estimatedHeight).toBeGreaterThan(widgets[0].estimatedHeight);
  });

  it('defers image reconciliation until after the mode-change measure cycle', () => {
    const { plugin, view } = createFixture('![[photo.png|Caption]]');
    views.push(view);
    const handleLivePreviewEditorUpdate = vi.fn();
    plugin.imageStateManager = { handleLivePreviewEditorUpdate };
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback);
      return frames.length;
    });

    view.dispatch({
      changes: { from: 0, insert: 'Text\n' },
      effects: setLivePreviewCaptionModeEffect.of(false)
    });

    expect(handleLivePreviewEditorUpdate).not.toHaveBeenCalled();
    expect(frames.length).toBeGreaterThan(0);
    [...frames].forEach(callback => callback(0));
    expect(handleLivePreviewEditorUpdate).toHaveBeenCalledOnce();
  });

  it('reconciles an effect-only Reading to Live Preview transition', () => {
    const { plugin, view } = createFixture('![[photo.png|Caption]]');
    views.push(view);
    const handleLivePreviewEditorUpdate = vi.fn();
    plugin.imageStateManager = { handleLivePreviewEditorUpdate };
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback);
      return frames.length;
    });

    view.dispatch({ effects: setLivePreviewCaptionModeEffect.of(false) });

    expect(handleLivePreviewEditorUpdate).not.toHaveBeenCalled();
    expect(frames.length).toBeGreaterThan(0);
    [...frames].forEach(callback => callback(0));
    expect(handleLivePreviewEditorUpdate).toHaveBeenCalledWith(
      view.dom,
      {
        reconcileSource: true,
        geometryChanged: true,
        modeChanged: true
      }
    );
  });

  it('does not force a whole-view image reconciliation for selection-only updates', () => {
    const source = [
      'Outside',
      '![Caption|right|233](https://example.com/diagram.png)',
      'After'
    ].join('\n');
    const { plugin, view } = createFixture(source);
    views.push(view);
    const handleLivePreviewEditorUpdate = vi.fn();
    plugin.imageStateManager = { handleLivePreviewEditorUpdate };
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => {
      frames.push(callback);
      return frames.length;
    });

    view.dispatch({ selection: { anchor: source.indexOf('![') + 2 } });
    view.dispatch({ selection: { anchor: source.lastIndexOf('After') + 1 } });

    expect(frames).toHaveLength(0);
    expect(handleLivePreviewEditorUpdate).not.toHaveBeenCalled();
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

  it('keeps caption text alignment independent from explicit and default figure placement', () => {
    const { parent, plugin, view } = createFixture([
      '![[explicit.png|Explicit caption|left]]',
      '![[default.png|Default caption]]'
    ].join('\n'));
    views.push(view);
    plugin.settings.alignment.default = 'right';
    plugin.settings.captions.alignment = 'center';
    view.dispatch({ effects: refreshLivePreviewCaptionsEffect.of(undefined) });

    const captions = [...parent.querySelectorAll<HTMLElement>('.image-assistant-live-preview-caption')];
    expect(captions.map(node => node.getAttribute('data-image-assistant-caption-placement')))
      .toEqual(['left', 'right']);
    expect(captions.map(node => node.getAttribute('data-image-assistant-caption-text-align')))
      .toEqual(['center', 'center']);

    plugin.settings.alignment.enabled = false;
    view.dispatch({ effects: refreshLivePreviewCaptionsEffect.of(undefined) });
    expect([...parent.querySelectorAll<HTMLElement>('.image-assistant-live-preview-caption')]
      .map(node => node.getAttribute('data-image-assistant-caption-placement')))
      .toEqual([null, null]);
    expect([...parent.querySelectorAll<HTMLElement>('.image-assistant-live-preview-caption')]
      .map(node => node.getAttribute('data-image-assistant-caption-text-align')))
      .toEqual(['center', 'center']);
  });

  it('only keeps Live Preview wrap when a standalone image has a reliable width', () => {
    const { parent, view } = createFixture([
      '![[sized.png|Sized caption|left-wrap|320]]',
      '![[natural.png|Natural caption|right-wrap]]'
    ].join('\n'));
    views.push(view);

    const captions = [...parent.querySelectorAll<HTMLElement>('.image-assistant-live-preview-caption')];
    expect(captions.map(node => node.getAttribute('data-image-assistant-caption-wrap')))
      .toEqual(['true', 'false']);
  });
});
