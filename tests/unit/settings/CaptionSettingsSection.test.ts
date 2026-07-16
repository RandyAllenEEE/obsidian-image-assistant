import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderCaptionSettingsSection } from '../../../src/settings/sections/CaptionSettingsSection';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';

function makePlugin(overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      captions: {
        ...structuredClone(DEFAULT_SETTINGS.captions),
        ...overrides
      }
    },
    saveSettings: vi.fn().mockResolvedValue(undefined),
    imageCaption: {
      refresh: vi.fn(),
      updateStyles: vi.fn(),
      applyCaptionClass: vi.fn(),
      refreshAllViews: vi.fn()
    },
    imageStateManager: {
      refreshAllImages: vi.fn()
    }
  } as any;
}

function renderSection(plugin = makePlugin()) {
  const container = document.createElement('div');
  const refreshDisplay = vi.fn();

  renderCaptionSettingsSection(
    container,
    plugin,
    { imageCaptionSectionCollapsed: false } as any,
    refreshDisplay
  );

  return { container, refreshDisplay };
}

function getSetting(container: HTMLElement, name: string): HTMLElement {
  const setting = Array.from(container.querySelectorAll<HTMLElement>('[data-setting-name]'))
    .find((el) => el.getAttribute('data-setting-name') === name);

  if (!setting) {
    throw new Error(`Setting not found: ${name}`);
  }

  return setting;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('CaptionSettingsSection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  it('renders controls for every existing caption setting', () => {
    const { container } = renderSection();

    [
      'Image Captions',
      'Show in Reading Mode',
      'Show in Live Preview',
      'Inline Images',
      'Caption Width',
      'Maximum Lines',
      'Skip Caption for Extensions',
      'Caption Preview',
      'Caption Alignment',
      'Font Size',
      'Font Style',
      'Font Weight',
      'Text Color',
      'Opacity',
      'Text Transform',
      'Letter Spacing',
      'Background Color',
      'Margin Top',
      'Padding',
      'Border Style',
      'Border Radius',
      'Reset Caption Style'
    ].forEach((name) => {
      expect(getSetting(container, name)).toBeTruthy();
    });

    expect(container.querySelectorAll('input[type="text"]')).toHaveLength(10);
    expect(container.querySelectorAll('select')).toHaveLength(5);
    expect(container.querySelectorAll('input[type="range"]')).toHaveLength(2);
  });

  it('writes style text settings and refreshes caption styles', async () => {
    const plugin = makePlugin();
    const { container } = renderSection(plugin);

    const changes: Array<[string, string, string]> = [
      ['Font Weight', 'fontWeight', '600'],
      ['Background Color', 'backgroundColor', 'rgba(0,0,0,0.08)'],
      ['Padding', 'padding', '4px 8px'],
      ['Border Radius', 'borderRadius', '6px'],
      ['Letter Spacing', 'letterSpacing', '0.02em'],
      ['Border Style', 'border', '1px solid var(--background-modifier-border)'],
      ['Margin Top', 'marginTop', '8px']
    ];

    for (const [settingName, key, value] of changes) {
      const input = getSetting(container, settingName).querySelector('input[type="text"]') as HTMLInputElement;
      input.value = value;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      await flushPromises();

      expect(plugin.settings.captions[key]).toBe(value);
    }

    expect(plugin.imageCaption.updateStyles).toHaveBeenCalledTimes(changes.length);
  });

  it('writes dropdown and opacity settings as style-only changes', async () => {
    const plugin = makePlugin();
    const { container } = renderSection(plugin);

    const fontStyle = getSetting(container, 'Font Style').querySelector('select') as HTMLSelectElement;
    fontStyle.value = 'normal';
    fontStyle.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    const textTransform = getSetting(container, 'Text Transform').querySelector('select') as HTMLSelectElement;
    textTransform.value = 'uppercase';
    textTransform.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    const opacity = getSetting(container, 'Opacity').querySelector('input[type="range"]') as HTMLInputElement;
    opacity.value = '0.55';
    opacity.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    expect(plugin.settings.captions.fontStyle).toBe('normal');
    expect(plugin.settings.captions.textTransform).toBe('uppercase');
    expect(plugin.settings.captions.opacity).toBe('0.55');
    expect(plugin.imageCaption.updateStyles).toHaveBeenCalledTimes(3);
  });

  it('refreshes rendered captions when behavior settings change', async () => {
    const plugin = makePlugin();
    const { container, refreshDisplay } = renderSection(plugin);

    const skipExtensions = getSetting(container, 'Skip Caption for Extensions').querySelector('input[type="text"]') as HTMLInputElement;
    skipExtensions.value = 'svg,pdf,png';
    skipExtensions.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    expect(plugin.settings.captions.skipExtensions).toBe('svg,pdf,png');
    expect(plugin.imageCaption.applyCaptionClass).toHaveBeenCalledTimes(1);
    expect(plugin.imageCaption.refreshAllViews).toHaveBeenCalledTimes(1);

    const alignment = getSetting(container, 'Caption Alignment').querySelector('select') as HTMLSelectElement;
    alignment.value = 'right';
    alignment.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();
    expect(plugin.settings.captions.alignment).toBe('right');
    expect(plugin.imageCaption.refreshAllViews).toHaveBeenCalledTimes(2);

    const enabled = getSetting(container, 'Image Captions').querySelector('input[type="checkbox"]') as HTMLInputElement;
    enabled.checked = false;
    enabled.dispatchEvent(new Event('change', { bubbles: true }));
    await flushPromises();

    expect(plugin.settings.captions.enabled).toBe(false);
    expect(plugin.imageCaption.applyCaptionClass).toHaveBeenCalledTimes(3);
    expect(plugin.imageCaption.refreshAllViews).toHaveBeenCalledTimes(3);
    expect(refreshDisplay).toHaveBeenCalledTimes(1);
  });

  it('saves mode, inline, width, and line-limit behavior controls', async () => {
    const plugin = makePlugin();
    const { container } = renderSection(plugin);

    const reading = getSetting(container, 'Show in Reading Mode').querySelector('input') as HTMLInputElement;
    reading.checked = false;
    reading.dispatchEvent(new Event('change', { bubbles: true }));
    const live = getSetting(container, 'Show in Live Preview').querySelector('input') as HTMLInputElement;
    live.checked = false;
    live.dispatchEvent(new Event('change', { bubbles: true }));
    const inline = getSetting(container, 'Inline Images').querySelector('select') as HTMLSelectElement;
    inline.value = 'standalone-only';
    inline.dispatchEvent(new Event('change', { bubbles: true }));
    const width = getSetting(container, 'Caption Width').querySelector('select') as HTMLSelectElement;
    width.value = 'container';
    width.dispatchEvent(new Event('change', { bubbles: true }));
    const maxLines = getSetting(container, 'Maximum Lines').querySelector('input') as HTMLInputElement;
    maxLines.value = '3';
    maxLines.dispatchEvent(new Event('input', { bubbles: true }));
    await flushPromises();

    expect(plugin.settings.captions).toMatchObject({
      showInReadingMode: false,
      showInLivePreview: false,
      inlinePolicy: 'standalone-only',
      widthMode: 'container',
      maxLines: 3
    });
    expect(plugin.imageCaption.refreshAllViews).toHaveBeenCalledTimes(5);
    expect(getSetting(container, 'Maximum Lines').textContent).toContain('3 lines');
  });

  it('updates the preview immediately and resets only visual fields', async () => {
    const plugin = makePlugin({
      fontSize: '19px',
      color: 'red',
      showInReadingMode: false,
      inlinePolicy: 'standalone-only',
      widthMode: 'container',
      maxLines: 2
    });
    const { container, refreshDisplay } = renderSection(plugin);
    const preview = container.querySelector('.image-assistant-caption-preview-text') as HTMLElement;
    expect(preview.style.fontSize).toBe('19px');

    const fontSize = getSetting(container, 'Font Size').querySelector('input') as HTMLInputElement;
    fontSize.value = '14px';
    fontSize.dispatchEvent(new Event('change', { bubbles: true }));
    expect(preview.style.fontSize).toBe('14px');

    (getSetting(container, 'Reset Caption Style').querySelector('button') as HTMLButtonElement).click();
    await flushPromises();

    expect(plugin.settings.captions.fontSize).toBe(DEFAULT_SETTINGS.captions.fontSize);
    expect(plugin.settings.captions.color).toBe(DEFAULT_SETTINGS.captions.color);
    expect(plugin.settings.captions).toMatchObject({
      showInReadingMode: false,
      inlinePolicy: 'standalone-only',
      widthMode: 'container',
      maxLines: 2
    });
    expect(refreshDisplay).toHaveBeenCalledOnce();
  });
});
