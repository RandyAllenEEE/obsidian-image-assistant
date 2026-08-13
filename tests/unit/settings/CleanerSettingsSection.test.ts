import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import { renderCleanerSettingsSection } from '../../../src/settings/sections/CleanerSettingsSection';
import type { SettingsUIState } from '../../../src/settings/types';

function makeUIState(): SettingsUIState {
  return {
    pasteHandlingSectionCollapsed: false,
    imageAlignmentSectionCollapsed: false,
    imageCaptionSectionCollapsed: false,
    cleanerSectionCollapsed: false,
    ocrSectionCollapsed: false,
    drawingSectionCollapsed: false,
    nextAiSectionCollapsed: false,
    otherSectionCollapsed: false
  };
}

describe('CleanerSettingsSection', () => {
  it('hides child settings when its master toggle is off', () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.cleanerSettings.enabled = false;
    const plugin = {
      settings,
      saveSettings: vi.fn().mockResolvedValue(undefined)
    } as any;
    const container = document.createElement('div');

    renderCleanerSettingsSection(container, plugin, makeUIState(), vi.fn());

    expect(container.textContent).not.toContain('File types');
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
  });

  it('exposes file types and the custom trash path and saves changes', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.cleanerSettings.trashMode = 'custom';
    const plugin = {
      settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      setContextMenuEnabled: vi.fn()
    } as any;
    const refreshDisplay = vi.fn();
    const container = document.createElement('div');

    renderCleanerSettingsSection(container, plugin, makeUIState(), refreshDisplay);

    const inputs = Array.from(container.querySelectorAll<HTMLInputElement>('input[type="text"]'));
    const fileTypes = inputs.find(input => input.value === settings.cleanerSettings.fileTypes)!;
    const customPath = inputs.find(input => input.value === settings.cleanerSettings.customTrashPath)!;
    fileTypes.value = 'png,webp,avif';
    fileTypes.dispatchEvent(new Event('change', { bubbles: true }));
    customPath.value = 'Archive/Unused';
    customPath.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(settings.cleanerSettings.fileTypes).toBe('png,webp,avif');
    expect(settings.cleanerSettings.customTrashPath).toBe('Archive/Unused');
    expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
  });

  it('refreshes after changing trash mode so the conditional path control updates', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const plugin = {
      settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      setContextMenuEnabled: vi.fn()
    } as any;
    const refreshDisplay = vi.fn();
    const container = document.createElement('div');

    renderCleanerSettingsSection(container, plugin, makeUIState(), refreshDisplay);
    const mode = container.querySelector('select') as HTMLSelectElement;
    mode.value = 'custom';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();

    expect(settings.cleanerSettings.trashMode).toBe('custom');
    expect(refreshDisplay).toHaveBeenCalledOnce();
  });

  it('shows the delete child toggle only while the context-menu master is enabled', () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const plugin = {
      settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      setContextMenuEnabled: vi.fn()
    } as any;
    const container = document.createElement('div');

    renderCleanerSettingsSection(container, plugin, makeUIState(), vi.fn());
    expect(container.textContent).toContain('Context-menu deletion');

    settings.global.enableContextMenu = false;
    container.empty();
    renderCleanerSettingsSection(container, plugin, makeUIState(), vi.fn());
    expect(container.textContent).not.toContain('Context-menu deletion');
  });

  it('saves the delete child toggle without changing the master switch', async () => {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const plugin = {
      settings,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      setContextMenuEnabled: vi.fn()
    } as any;
    const container = document.createElement('div');
    renderCleanerSettingsSection(container, plugin, makeUIState(), vi.fn());
    const toggle = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]!;

    toggle.checked = false;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    await Promise.resolve();

    expect(settings.cleanerSettings.enableDeleteContextMenu).toBe(false);
    expect(settings.global.enableContextMenu).toBe(true);
    expect(plugin.saveSettings).toHaveBeenCalledOnce();
  });
});
