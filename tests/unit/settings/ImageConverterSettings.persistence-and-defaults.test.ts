import { describe, expect, it, vi } from 'vitest';
import ImageConverterPlugin from '../../../src/main';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import { fakeApp } from '../../factories/obsidian';

function makePlugin() {
  const app = fakeApp() as any;
  const plugin = new ImageConverterPlugin(app, { id: 'obsidian-image-assistant' } as any);
  return plugin;
}

describe('ImageAssistantSettings defaults and persistence', () => {
  it('loads full current defaults when no data is saved', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);

    await plugin.loadSettings();

    expect(plugin.settings.localProcessing.conversion.outputFormat).toBe(DEFAULT_SETTINGS.localProcessing.conversion.outputFormat);
    expect(plugin.settings.localProcessing.destination.type).toBe(DEFAULT_SETTINGS.localProcessing.destination.type);
    expect(plugin.settings.pasteHandling.mode).toBe(DEFAULT_SETTINGS.pasteHandling.mode);
    expect(plugin.settings.operationDefaults.batchLocal.convertTo).toBe(DEFAULT_SETTINGS.operationDefaults.batchLocal.convertTo);
    expect(plugin.settings.captions.enabled).toBe(DEFAULT_SETTINGS.captions.enabled);
  });

  it('deep-merges partial saved data without dropping new default sections', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
      localProcessing: {
        conversion: {
          outputFormat: 'PNG',
          quality: 66
        }
      },
      pasteHandling: {
        mode: 'cloud',
        cloud: {
          uploadConcurrency: 7
        }
      },
      global: {
        showSpaceSavedNotification: false
      }
    });

    await plugin.loadSettings();

    expect(plugin.settings.localProcessing.conversion.outputFormat).toBe('PNG');
    expect(plugin.settings.localProcessing.conversion.quality).toBe(66);
    expect(plugin.settings.localProcessing.conversion.resizeMode).toBe(DEFAULT_SETTINGS.localProcessing.conversion.resizeMode);
    expect(plugin.settings.localProcessing.externalTools.ffmpegPreset).toBe(DEFAULT_SETTINGS.localProcessing.externalTools.ffmpegPreset);
    expect(plugin.settings.pasteHandling.mode).toBe('cloud');
    expect(plugin.settings.pasteHandling.cloud.uploadConcurrency).toBe(7);
    expect(plugin.settings.pasteHandling.cloud.uploadServer).toBe(DEFAULT_SETTINGS.pasteHandling.cloud.uploadServer);
    expect(plugin.settings.global.showSpaceSavedNotification).toBe(false);
  });

  it('drops legacy Image Converter multi-preset settings on load', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
      conversionPresets: [{ name: 'old conversion' }],
      folderPresets: [{ name: 'old folder' }],
      filenamePresets: [{ name: 'old filename' }],
      localProcessing: {
        conversion: {
          outputFormat: 'PNG'
        },
        globalPresets: [{ name: 'nested old preset' }],
        selectedConversionPreset: 'old conversion'
      },
      annotationPresets: DEFAULT_SETTINGS.annotationPresets
    });

    await plugin.loadSettings();

    const settings = plugin.settings as any;
    expect(settings.conversionPresets).toBeUndefined();
    expect(settings.folderPresets).toBeUndefined();
    expect(settings.filenamePresets).toBeUndefined();
    expect(settings.localProcessing.globalPresets).toBeUndefined();
    expect(settings.localProcessing.selectedConversionPreset).toBeUndefined();
    expect(settings.localProcessing.conversion.outputFormat).toBe('PNG');
    expect(settings.annotationPresets).toBeDefined();
    expect(settings.localProcessing.externalTools.ffmpegPreset).toBe(DEFAULT_SETTINGS.localProcessing.externalTools.ffmpegPreset);
  });

  it('persists the current settings object through saveData', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();

    plugin.settings.localProcessing.filename.customTemplate = '{notename}-{timestamp}';
    plugin.settings.operationDefaults.batchLocal.skipFormats = 'gif,svg';
    (plugin.settings as any).conversionPresets = [{ name: 'old' }];

    const saveDataSpy = vi.spyOn(plugin as any, 'saveData').mockResolvedValue(undefined);
    await plugin.saveSettings();

    expect(saveDataSpy).toHaveBeenCalledWith(plugin.settings);
    expect((saveDataSpy.mock.calls[0][0] as any).conversionPresets).toBeUndefined();
  });
});
