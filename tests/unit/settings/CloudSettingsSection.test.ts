import { describe, expect, it, vi } from 'vitest';
import { renderCloudSettingsSection } from '../../../src/settings/sections/CloudSettingsSection';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import type { ImageAssistantSettings, SettingsUIState } from '../../../src/settings/types';

function makeSettings(): ImageAssistantSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.pasteHandling.mode = 'cloud';
  settings.pasteHandling.cloud.remoteServerMode = false;
  settings.pasteHandling.cloud.workOnNetWork = true;
  return settings;
}

function makeUIState(): SettingsUIState {
  return {
    pasteHandlingSectionCollapsed: false,
    imageAlignmentSectionCollapsed: false,
    imageDragResizeSectionCollapsed: false,
    imageCaptionSectionCollapsed: false,
    cleanerSectionCollapsed: false,
    ocrSectionCollapsed: false,
    otherSectionCollapsed: false
  };
}

describe('CloudSettingsSection', () => {
  it('exposes and saves the common paste cursor and filename filters', async () => {
    const settings = makeSettings();
    settings.pasteHandling.mode = 'local';
    settings.pasteHandling.cursorLocation = 'back';
    const plugin = {
      settings,
      saveSettings: vi.fn().mockResolvedValue(undefined)
    } as any;
    const container = document.createElement('div');

    renderCloudSettingsSection(container, plugin, makeUIState(), vi.fn());

    const cursorSelect = Array.from(container.querySelectorAll('select'))
      .find(select => Array.from(select.options).some(option => option.value === 'front')) as HTMLSelectElement;
    const ignoredInput = container.querySelector('input[type="text"]') as HTMLInputElement;
    cursorSelect.value = 'front';
    cursorSelect.dispatchEvent(new Event('change', { bubbles: true }));
    ignoredInput.value = '*.svg,keep-*';
    ignoredInput.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(settings.pasteHandling.cursorLocation).toBe('front');
    expect(settings.pasteHandling.neverProcessFilenames).toBe('*.svg,keep-*');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
  });

  it('hides paste behavior controls when paste handling is disabled', () => {
    const settings = makeSettings();
    settings.pasteHandling.mode = 'disabled';
    const container = document.createElement('div');

    renderCloudSettingsSection(container, {
      settings,
      saveSettings: vi.fn().mockResolvedValue(undefined)
    } as any, makeUIState(), vi.fn());

    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(container.querySelectorAll('select')).toHaveLength(1);
  });

  it('turns off network image upload when remote server mode is enabled', async () => {
    const settings = makeSettings();
    const plugin = {
      settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      updateConcurrentQueue: vi.fn()
    } as any;
    const refreshDisplay = vi.fn();
    const container = document.createElement('div');

    renderCloudSettingsSection(container, plugin, makeUIState(), refreshDisplay);

    const remoteModeToggle = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(remoteModeToggle).toBeTruthy();

    remoteModeToggle.checked = true;
    remoteModeToggle.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(settings.pasteHandling.cloud.remoteServerMode).toBe(true);
    expect(settings.pasteHandling.cloud.workOnNetWork).toBe(false);
    expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
    expect(refreshDisplay).toHaveBeenCalledTimes(1);
  });

  it('renders only the supported automatic cloud toggles', () => {
    const plugin = {
      settings: makeSettings(),
      saveSettings: vi.fn().mockResolvedValue(undefined),
      updateConcurrentQueue: vi.fn()
    } as any;
    const container = document.createElement('div');

    renderCloudSettingsSection(container, plugin, makeUIState(), vi.fn());

    const toggles = Array.from(container.querySelectorAll('input[type="checkbox"]'));
    expect(toggles).toHaveLength(3);
  });

  it('does not write malformed or non-positive cloud image dimensions', async () => {
    const settings = makeSettings();
    settings.pasteHandling.cloud.imageSizeWidth = 640;
    settings.pasteHandling.cloud.imageSizeHeight = 480;
    const plugin = {
      settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      updateConcurrentQueue: vi.fn()
    } as any;
    const container = document.createElement('div');

    renderCloudSettingsSection(container, plugin, makeUIState(), vi.fn());

    const widthInput = Array.from(container.querySelectorAll('input[type="text"]'))
      .find(input => (input as HTMLInputElement).value === '640') as HTMLInputElement;
    const heightInput = Array.from(container.querySelectorAll('input[type="text"]'))
      .find(input => (input as HTMLInputElement).value === '480') as HTMLInputElement;
    widthInput.value = '12px';
    widthInput.dispatchEvent(new Event('change', { bubbles: true }));
    heightInput.value = '-1';
    heightInput.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(settings.pasteHandling.cloud.imageSizeWidth).toBeUndefined();
    expect(settings.pasteHandling.cloud.imageSizeHeight).toBeUndefined();
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
  });
});
