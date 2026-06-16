import { describe, expect, it, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { ImageConverterSettingTab } from '../../../src/settings/ImageAssistantSettings';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import { fakeApp } from '../../factories/obsidian';

function makePlugin() {
  const app = fakeApp() as any;
  const plugin = new ImageConverterPlugin(app, { id: 'obsidian-image-assistant' } as any);
  return { app, plugin };
}

describe('ImageAssistantSettings current UI/default contracts', () => {
  it('keeps global defaults under the current global section', async () => {
    const { plugin } = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);

    await plugin.loadSettings();

    expect(plugin.settings.global.enableContextMenu).toBe(DEFAULT_SETTINGS.global.enableContextMenu);
    expect(plugin.settings.global.codeBlockImageLinkIndexing).toBe(DEFAULT_SETTINGS.global.codeBlockImageLinkIndexing);
    expect(plugin.settings.global.showSpaceSavedNotification).toBe(DEFAULT_SETTINGS.global.showSpaceSavedNotification);
  });

  it('preserves nested defaults when only one global flag is saved', async () => {
    const { plugin } = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
      global: {
        enableContextMenu: false
      }
    });

    await plugin.loadSettings();

    expect(plugin.settings.global.enableContextMenu).toBe(false);
    expect(plugin.settings.global.codeBlockImageLinkIndexing).toBe(DEFAULT_SETTINGS.global.codeBlockImageLinkIndexing);
    expect(plugin.settings.global.showSpaceSavedNotification).toBe(DEFAULT_SETTINGS.global.showSpaceSavedNotification);
  });

  it('renders the current settings tab without requiring legacy preset state', async () => {
    const { app, plugin } = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    vi.spyOn(plugin, 'saveSettings').mockResolvedValue(undefined);
    await plugin.loadSettings();

    const tab = new ImageConverterSettingTab(app, plugin);
    expect(() => tab.display()).not.toThrow();
    expect(tab.containerEl.hasClass('image-assistant-settings-tab')).toBe(true);
  });
});
