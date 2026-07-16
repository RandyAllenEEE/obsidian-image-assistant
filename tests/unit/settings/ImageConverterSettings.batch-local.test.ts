import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import ImageConverterPlugin from '../../../src/main';
import { LocalProcessMode } from '../../../src/ui/modals/batch/modes/LocalProcessMode';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import { fakeApp, fakeTFile } from '../../factories/obsidian';

function makePlugin() {
  const app = fakeApp() as any;
  const plugin = new ImageConverterPlugin(app, { id: 'obsidian-image-assistant' } as any);
  plugin.settings = structuredClone(DEFAULT_SETTINGS);
  plugin.saveSettings = vi.fn().mockResolvedValue(undefined) as any;
  plugin.supportedImageFormats = {
    isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpe?g|webp|gif)$/i.test(name || ''))
  } as any;
  return { app, plugin };
}

function changeSelect(select: HTMLSelectElement, value: string) {
  select.value = value;
  select.dispatchEvent(new Event('change'));
}

describe('Local batch settings management', () => {
  it('updates operationDefaults.batchLocal from rendered controls', () => {
    const { app, plugin } = makePlugin();
    const mode = new LocalProcessMode(app, plugin, null, 'vault');
    const container = document.createElement('div');

    mode.renderSettings(container);
    const selects = Array.from(container.querySelectorAll('select'));
    const formatSelect = selects[0] as HTMLSelectElement;
    const resizeSelect = selects[1] as HTMLSelectElement;
    const skipInput = container.querySelector('input[type="text"]') as HTMLInputElement;
    const skipTargetToggle = container.querySelector('input[type="checkbox"]') as HTMLInputElement;

    changeSelect(formatSelect, 'png');
    changeSelect(resizeSelect, 'Fit');
    skipInput.value = 'gif,svg';
    skipInput.dispatchEvent(new Event('change'));
    skipTargetToggle.checked = false;
    skipTargetToggle.dispatchEvent(new Event('change'));

    expect(plugin.settings.operationDefaults.batchLocal.convertTo).toBe('png');
    expect(plugin.settings.operationDefaults.batchLocal.resizeMode).toBe('Fit');
    expect(plugin.settings.operationDefaults.batchLocal.skipFormats).toBe('gif,svg');
    expect(plugin.settings.operationDefaults.batchLocal.skipImagesInTargetFormat).toBe(false);
    expect(plugin.saveSettings).toHaveBeenCalled();
  });

  it('loads note tasks from current metadata embeds', async () => {
    const image = fakeTFile({ path: 'Images/a.png', name: 'a.png', extension: 'png' });
    const note = fakeTFile({ path: 'Notes/note.md', name: 'note.md', extension: 'md' });
    const { app, plugin } = makePlugin();
    app.metadataCache.getFileCache = vi.fn(() => ({ embeds: [{ link: 'Images/a.png' }] }));
    app.metadataCache.getFirstLinkpathDest = vi.fn(() => image as TFile);

    const mode = new LocalProcessMode(app, plugin, note, 'note');
    const { tasks } = await mode.loadTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].path).toBe('Images/a.png');
    expect(tasks[0].selected).toBe(true);
  });
});
