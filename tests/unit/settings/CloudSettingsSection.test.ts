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
});
