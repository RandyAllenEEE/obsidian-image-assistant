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
    expect(plugin.settings.cleanerSettings).toMatchObject({
      enabled: true,
      enableDeleteContextMenu: true,
      trashMode: 'follow-obsidian'
    });
    expect(plugin.settings.ocrSettings.enabled).toBe(true);
    expect(plugin.settings.drawing).toMatchObject({
      provider: 'disabled',
      drawio: {
        embedUrl: 'https://embed.diagrams.net/',
        nextAi: { enabled: false }
      },
      excalidraw: {
        manageCreatedFileLocation: true,
        embedMode: 'source'
      }
    });

    [
      'showInReadingMode',
      'showInLivePreview',
      'inlinePolicy',
      'widthMode',
      'maxLines',
      'skipExtensions',
      'fontSize',
      'color',
      'fontStyle',
      'backgroundColor',
      'padding',
      'borderRadius',
      'opacity',
      'fontWeight',
      'textTransform',
      'letterSpacing',
      'border',
      'marginTop',
      'alignment'
    ].forEach((key) => {
      expect((plugin.settings.captions as any)[key]).toBe((DEFAULT_SETTINGS.captions as any)[key]);
    });
  });

  it('migrates the former visual validation toggle to the explicit server mode', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
      drawing: {
        drawio: {
          nextAi: { visualValidationEnabled: true }
        }
      }
    });

    await plugin.loadSettings();

    expect(plugin.settings.drawing.drawio.nextAi.visualValidationMode).toBe('next-ai-server');
    expect((plugin.settings.drawing.drawio.nextAi as any).visualValidationEnabled).toBeUndefined();
  });

  it('prefers a saved validation mode over the legacy toggle and normalizes invalid modes', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
      drawing: {
        drawio: {
          nextAi: {
            visualValidationEnabled: true,
            visualValidationMode: 'user-model'
          }
        }
      }
    });

    await plugin.loadSettings();
    expect(plugin.settings.drawing.drawio.nextAi.visualValidationMode).toBe('user-model');

    (plugin.settings.drawing.drawio.nextAi as any).visualValidationMode = 'unknown';
    await plugin.saveSettings();
    expect(plugin.settings.drawing.drawio.nextAi.visualValidationMode).toBe('disabled');
  });

  it('falls back to defaults when the settings file cannot be parsed', async () => {
    const plugin = makePlugin();
    const parseFailure = new SyntaxError('Unexpected token in JSON');
    vi.spyOn(plugin as any, 'loadData').mockRejectedValue(parseFailure);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(plugin.loadSettings()).resolves.toBeUndefined();

    expect(plugin.settings).toEqual(DEFAULT_SETTINGS);
    expect(errorSpy).toHaveBeenCalledWith(
      '[Image Assistant] Failed to read settings; using defaults:',
      parseFailure
    );
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
    expect(plugin.settings.global.batchConcurrency).toBe(7);
    expect((plugin.settings.pasteHandling.cloud as any).uploadConcurrency).toBeUndefined();
    expect(plugin.settings.pasteHandling.cloud.uploadServer).toBe(DEFAULT_SETTINGS.pasteHandling.cloud.uploadServer);
    expect(plugin.settings.global.showSpaceSavedNotification).toBe(false);
    expect(plugin.settings.captions.fontWeight).toBe(DEFAULT_SETTINGS.captions.fontWeight);
    expect(plugin.settings.captions.backgroundColor).toBe(DEFAULT_SETTINGS.captions.backgroundColor);
    expect(plugin.settings.captions.opacity).toBe(DEFAULT_SETTINGS.captions.opacity);
    expect(plugin.settings.captions.showInReadingMode).toBe(true);
    expect(plugin.settings.captions.showInLivePreview).toBe(true);
    expect(plugin.settings.captions.inlinePolicy).toBe('all');
    expect(plugin.settings.captions.widthMode).toBe('auto');
    expect(plugin.settings.captions.maxLines).toBe(0);
    expect(plugin.settings.cleanerSettings.enableDeleteContextMenu).toBe(true);
    expect(plugin.settings.cleanerSettings.trashMode).toBe('follow-obsidian');
    expect(plugin.settings.cleanerSettings.enabled).toBe(true);
    expect(plugin.settings.ocrSettings.enabled).toBe(true);
    expect(plugin.settings.drawing.provider).toBe('disabled');
  });

  it('normalizes drawing provider and Secret Storage references while retaining invalid URLs for correction', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
      drawing: {
        provider: 'unknown-provider',
        drawio: {
          embedUrl: 'not a URL',
          nextAi: {
            enabled: true,
            serviceUrl: 'also invalid',
            accessCodeSecretId: ' invalid secret ',
            apiKeySecretId: 'valid-secret-id',
            sendShortcut: 'spacebar'
          }
        }
      }
    });

    await plugin.loadSettings();

    expect(plugin.settings.drawing.provider).toBe('disabled');
    expect(plugin.settings.drawing.drawio.embedUrl).toBe('not a URL');
    expect(plugin.settings.drawing.drawio.nextAi.serviceUrl).toBe('also invalid');
    expect(plugin.settings.drawing.drawio.nextAi.enabled).toBe(true);
    expect(plugin.settings.drawing.drawio.nextAi.accessCodeSecretId).toBe('');
    expect(plugin.settings.drawing.drawio.nextAi.apiKeySecretId).toBe('valid-secret-id');
    expect(plugin.settings.drawing.drawio.nextAi.sendShortcut).toBe('mod-enter');
  });

  it('accepts Excalidraw as the default creation engine and normalizes its embed mode', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
      drawing: {
        provider: 'excalidraw',
        excalidraw: { embedMode: 'auto-export-preview' }
      }
    });

    await plugin.loadSettings();
    expect(plugin.settings.drawing.provider).toBe('excalidraw');
    expect(plugin.settings.drawing.excalidraw.embedMode).toBe('auto-export-preview');
    expect(plugin.settings.drawing.excalidraw.manageCreatedFileLocation).toBe(true);

    (plugin.settings.drawing.excalidraw as any).embedMode = 'invalid';
    (plugin.settings.drawing.excalidraw as any).manageCreatedFileLocation = 'invalid';
    await plugin.saveSettings();
    expect(plugin.settings.drawing.excalidraw.embedMode).toBe('source');
    expect(plugin.settings.drawing.excalidraw.manageCreatedFileLocation).toBe(true);
  });

  it('drops the retired hideFolders setting while retaining relative-prefix state', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
      localProcessing: {
        link: {
          linkFormat: 'markdown',
          pathFormat: 'relative',
          prependCurrentDir: true,
          hideFolders: true
        }
      }
    });

    await plugin.loadSettings();

    expect(plugin.settings.localProcessing.link).toMatchObject({
      linkFormat: 'markdown',
      pathFormat: 'relative',
      prependCurrentDir: true
    });
    expect((plugin.settings.localProcessing.link as any).hideFolders).toBeUndefined();

    const saveData = vi.spyOn(plugin as any, 'saveData').mockResolvedValue(undefined);
    await plugin.saveSettings();
    expect((saveData.mock.calls[0][0] as any).localProcessing.link.hideFolders).toBeUndefined();
  });

  it('preserves supported optional destination and embed-resize values across reloads', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
      localProcessing: {
        destination: {
          type: 'CUSTOM',
          customTemplate: 'assets/{notename}'
        },
        embedResize: {
          resizeDimension: 'both',
          width: 320,
          height: 180,
          longestEdge: 640,
          shortestEdge: 240,
          editorMaxWidthValue: 75
        }
      }
    });

    await plugin.loadSettings();

    expect(plugin.settings.localProcessing.destination.customTemplate).toBe('assets/{notename}');
    expect(plugin.settings.localProcessing.embedResize).toMatchObject({
      width: 320,
      height: 180,
      longestEdge: 640,
      shortestEdge: 240,
      editorMaxWidthValue: 75
    });
  });

  it('migrates legacy self-hosted OCR passwords into Secret Storage', async () => {
    const app = fakeApp() as any;
    app.secretStorage = { setSecret: vi.fn(), getSecret: vi.fn(), listSecrets: vi.fn(() => []) };
    const plugin = new ImageConverterPlugin(app, { id: 'obsidian-image-assistant' } as any);
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
      ocrSettings: {
        pix2tex: { username: 'pix-user', password: 'pix-password' },
        texify: { username: 'tex-user', password: 'tex-password' }
      }
    });
    const saveData = vi.spyOn(plugin as any, 'saveData').mockResolvedValue(undefined);

    await plugin.loadSettings();

    expect(app.secretStorage.setSecret).toHaveBeenCalledWith(
      'image-assistant-pix2tex-password', 'pix-password'
    );
    expect(app.secretStorage.setSecret).toHaveBeenCalledWith(
      'image-assistant-texify-password', 'tex-password'
    );
    expect(plugin.settings.ocrSettings.pix2tex.passwordSecretId)
      .toBe('image-assistant-pix2tex-password');
    expect(plugin.settings.ocrSettings.texify.passwordSecretId)
      .toBe('image-assistant-texify-password');
    expect((plugin.settings.ocrSettings.pix2tex as any).password).toBeUndefined();
    expect((plugin.settings.ocrSettings.texify as any).password).toBeUndefined();
    expect(saveData).toHaveBeenCalledWith(plugin.settings);
  });

  it('does not share nested defaults or saved arrays between settings instances', async () => {
    const savedPresets = {
      drawing: [{ color: '#fff', opacity: 1, blendMode: 'source-over', size: 4 }],
      arrow: [],
      text: []
    };
    const first = makePlugin();
    vi.spyOn(first as any, 'loadData').mockResolvedValue({ annotationPresets: savedPresets });
    await first.loadSettings();

    first.settings.localProcessing.conversion.quality = 1;
    first.settings.annotationPresets.drawing[0].color = '#000';

    const second = makePlugin();
    vi.spyOn(second as any, 'loadData').mockResolvedValue(undefined);
    await second.loadSettings();

    expect(DEFAULT_SETTINGS.localProcessing.conversion.quality).toBe(80);
    expect(second.settings.localProcessing.conversion.quality).toBe(80);
    expect(savedPresets.drawing[0].color).toBe('#fff');
  });

  it('ignores prototype-polluting keys in saved data', async () => {
    const plugin = makePlugin();
    const loaded = JSON.parse('{"__proto__":{"polluted":true},"global":{"showSpaceSavedNotification":false}}');
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(loaded);

    await plugin.loadSettings();

    expect(({} as any).polluted).toBeUndefined();
    expect(plugin.settings.global.showSpaceSavedNotification).toBe(false);
  });

  it('falls back to defaults for null and structurally invalid nested settings', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
      global: null,
      captions: [],
      pasteHandling: { cloud: 'invalid' },
      operationDefaults: { batchLocal: null },
      annotationPresets: ['invalid']
    });

    await plugin.loadSettings();

    expect(plugin.settings.global).toEqual(DEFAULT_SETTINGS.global);
    expect(plugin.settings.captions).toEqual(DEFAULT_SETTINGS.captions);
    expect(plugin.settings.pasteHandling.cloud).toEqual(DEFAULT_SETTINGS.pasteHandling.cloud);
    expect(plugin.settings.operationDefaults.batchLocal).toEqual(DEFAULT_SETTINGS.operationDefaults.batchLocal);
    expect(plugin.settings.annotationPresets).toEqual(DEFAULT_SETTINGS.annotationPresets);
  });

  it('normalizes invalid enums and numeric values from older settings', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
      pasteHandling: {
        mode: 'legacy-mode',
        cursorLocation: 'middle',
        cloud: { uploadConcurrency: 99, downloadPath: 'legacy', imageSizeWidth: true, imageSizeHeight: [480] }
      },
      localProcessing: { conversion: { quality: -5, minimumCompressionSavingsInKB: -12 } },
      operationDefaults: {
        batchLocal: { quality: 3, convertTo: 'broken', resizeMode: 'Diagonal' },
        singleImage: { outputFormat: 'BMP', desiredWidth: -1, ffmpegCrf: 1000 }
      },
      ocrSettings: {
        simpleTex: { appIdSecretId: 'Invalid Secret ID' },
        pix2tex: { passwordSecretId: '../password' },
        texify: { passwordSecretId: '-invalid-' },
        aiModel: { apiKeySecretId: 'VALID-but-uppercase' }
      },
      captions: {
        alignment: 'justify',
        fontStyle: 'oblique',
        textTransform: 'full-width',
        inlinePolicy: 'adjacent',
        widthMode: 'image-only',
        maxLines: 99
      }
    });

    await plugin.loadSettings();

    expect(plugin.settings.pasteHandling.mode).toBe(DEFAULT_SETTINGS.pasteHandling.mode);
    expect(plugin.settings.pasteHandling.cursorLocation).toBe(DEFAULT_SETTINGS.pasteHandling.cursorLocation);
    expect(plugin.settings.global.batchConcurrency).toBe(10);
    expect((plugin.settings.pasteHandling.cloud as any).uploadConcurrency).toBeUndefined();
    expect((plugin.settings.pasteHandling.cloud as any).downloadPath).toBeUndefined();
    expect(plugin.settings.pasteHandling.cloud.imageSizeWidth).toBeUndefined();
    expect(plugin.settings.pasteHandling.cloud.imageSizeHeight).toBeUndefined();
    expect(plugin.settings.localProcessing.conversion.quality).toBe(0);
    expect(plugin.settings.localProcessing.conversion.minimumCompressionSavingsInKB).toBe(0);
    expect(plugin.settings.operationDefaults.batchLocal.quality).toBe(1);
    expect(plugin.settings.operationDefaults.batchLocal.convertTo).toBe(DEFAULT_SETTINGS.operationDefaults.batchLocal.convertTo);
    expect(plugin.settings.operationDefaults.batchLocal.resizeMode).toBe(DEFAULT_SETTINGS.operationDefaults.batchLocal.resizeMode);
    expect(plugin.settings.operationDefaults.singleImage?.outputFormat).toBe(DEFAULT_SETTINGS.localProcessing.conversion.outputFormat);
    expect(plugin.settings.operationDefaults.singleImage?.desiredWidth).toBe(1);
    expect(plugin.settings.operationDefaults.singleImage?.ffmpegCrf).toBe(63);
    expect(plugin.settings.ocrSettings.simpleTex.appIdSecretId).toBe('');
    expect(plugin.settings.ocrSettings.pix2tex.passwordSecretId).toBe('');
    expect(plugin.settings.ocrSettings.texify.passwordSecretId).toBe('');
    expect(plugin.settings.ocrSettings.aiModel.apiKeySecretId).toBe('');
    expect(plugin.settings.captions.alignment).toBe(DEFAULT_SETTINGS.captions.alignment);
    expect(plugin.settings.captions.fontStyle).toBe(DEFAULT_SETTINGS.captions.fontStyle);
    expect(plugin.settings.captions.textTransform).toBe(DEFAULT_SETTINGS.captions.textTransform);
    expect(plugin.settings.captions.inlinePolicy).toBe(DEFAULT_SETTINGS.captions.inlinePolicy);
    expect(plugin.settings.captions.widthMode).toBe(DEFAULT_SETTINGS.captions.widthMode);
    expect(plugin.settings.captions.maxLines).toBe(5);
  });

  it('preserves a valid cloud height-only intent for intrinsic-ratio conversion', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
      pasteHandling: {
        cloud: {
          imageSizeSource: 'settings',
          imageSizeWidth: undefined,
          imageSizeHeight: 300
        }
      }
    });

    await plugin.loadSettings();

    expect(plugin.settings.pasteHandling.cloud.imageSizeWidth).toBeUndefined();
    expect(plugin.settings.pasteHandling.cloud.imageSizeHeight).toBe(300);
  });

  it('normalizes all runtime-sensitive settings before saving', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();
    const settings = plugin.settings as any;
    settings.pasteHandling.cloud.uploader = 'Unknown';
    settings.pasteHandling.cloud.imageSizeWidth = Number.NaN;
    settings.localProcessing.destination.type = 'SIBLING';
    settings.localProcessing.filename.conflictResolution = 'replace';
    settings.localProcessing.link.linkFormat = 'html';
    settings.localProcessing.embedResize.resizeDimension = 'diagonal';
    settings.ocrSettings.aiModel.maxTokens = -10;
    settings.annotationPresets.drawing[0].blendMode = 'invalid';
    const saveDataSpy = vi.spyOn(plugin as any, 'saveData').mockResolvedValue(undefined);

    await plugin.saveSettings();

    expect(settings.pasteHandling.cloud.uploader).toBe(DEFAULT_SETTINGS.pasteHandling.cloud.uploader);
    expect(settings.pasteHandling.cloud.imageSizeWidth).toBeUndefined();
    expect(settings.localProcessing.destination.type).toBe(DEFAULT_SETTINGS.localProcessing.destination.type);
    expect(settings.localProcessing.filename.conflictResolution).toBe(DEFAULT_SETTINGS.localProcessing.filename.conflictResolution);
    expect(settings.localProcessing.link.linkFormat).toBe(DEFAULT_SETTINGS.localProcessing.link.linkFormat);
    expect(settings.localProcessing.embedResize.resizeDimension).toBe(DEFAULT_SETTINGS.localProcessing.embedResize.resizeDimension);
    expect(settings.ocrSettings.aiModel.maxTokens).toBe(1);
    expect(settings.annotationPresets.drawing[0].blendMode).toBe(DEFAULT_SETTINGS.annotationPresets.drawing[0].blendMode);
    expect(saveDataSpy).toHaveBeenCalledWith(settings);
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

  it('drops removed interactive resize settings on load', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue({
      interactiveResize: {
        enabled: true,
        allowWheelResize: true,
        scrollModifier: 'Alt',
        sensitivity: 0.5
      },
      resizeCursorLocation: 'below'
    });

    await plugin.loadSettings();

    expect((plugin.settings as any).interactiveResize).toBeUndefined();
    expect((plugin.settings as any).resizeCursorLocation).toBeUndefined();
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

  it('serializes rapid settings writes so the latest value is persisted last', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();
    let releaseFirst!: () => void;
    const firstWrite = new Promise<void>(resolve => { releaseFirst = resolve; });
    const valuesAtWrite: string[] = [];
    const saveDataSpy = vi.spyOn(plugin as any, 'saveData')
      .mockImplementationOnce(async (settings: any) => {
        valuesAtWrite.push(settings.localProcessing.filename.customTemplate);
        await firstWrite;
      })
      .mockImplementationOnce(async (settings: any) => {
        valuesAtWrite.push(settings.localProcessing.filename.customTemplate);
      });

    plugin.settings.localProcessing.filename.customTemplate = 'first';
    const firstSave = plugin.saveSettings();
    await vi.waitFor(() => expect(saveDataSpy).toHaveBeenCalledTimes(1));
    plugin.settings.localProcessing.filename.customTemplate = 'latest';
    const latestSave = plugin.saveSettings();

    expect(saveDataSpy).toHaveBeenCalledTimes(1);
    releaseFirst();
    await Promise.all([firstSave, latestSave]);

    expect(valuesAtWrite).toEqual(['first', 'latest']);
    expect(saveDataSpy).toHaveBeenCalledTimes(2);
  });

  it('continues the settings save queue after an earlier disk failure', async () => {
    const plugin = makePlugin();
    vi.spyOn(plugin as any, 'loadData').mockResolvedValue(undefined);
    await plugin.loadSettings();
    const saveDataSpy = vi.spyOn(plugin as any, 'saveData')
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const failedSave = plugin.saveSettings();
    const nextSave = plugin.saveSettings();

    await expect(failedSave).resolves.toBeUndefined();
    await expect(nextSave).resolves.toBeUndefined();
    expect(saveDataSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith('[Image Assistant] Failed to save settings:', expect.any(Error));
  });
});
