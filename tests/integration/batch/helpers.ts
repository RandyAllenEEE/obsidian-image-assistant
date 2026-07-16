import { vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';

export function makeBatchSettings(batchLocalOverrides: Record<string, unknown> = {}) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.localProcessing.conversion.allowLargerFiles = true;
  settings.operationDefaults.batchLocal = {
    ...settings.operationDefaults.batchLocal,
    convertTo: 'webp',
    skipFormats: '',
    skipImagesInTargetFormat: false,
    ...batchLocalOverrides
  };
  return settings;
}

export function makeBatchPlugin(batchLocalOverrides: Record<string, unknown> = {}, pluginOverrides: Record<string, unknown> = {}) {
  const vaultReferenceManager: any = {
    updateReferences: vi.fn(async () => 0),
    updateReferencesInFile: vi.fn(async () => 0),
    scanReferencesDetailed: vi.fn(async () => ({ locations: [], complete: true, uncertainFiles: [] }))
  };
  vaultReferenceManager.updateReferencesDetailed = vi.fn(async (path: string, generator: (location: any) => string) => {
    const replaced = await vaultReferenceManager.updateReferences(path, generator);
    return { found: replaced, replaced, complete: true, files: [], failedFiles: [], uncertainFiles: [] };
  });

  return {
    settings: makeBatchSettings(batchLocalOverrides),
    supportedImageFormats: {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpe?g|webp)$/i.test(name || ''))
    },
    addStatusBarItem: vi.fn(() => ({ setText: vi.fn(), remove: vi.fn() })),
    vaultReferenceManager,
    ...pluginOverrides
  } as any;
}

export function makeImageProcessor() {
  return {
    processImageDetailed: vi.fn(async (file: any, format: string) => {
      const normalized = format === 'JPEG' ? 'jpg'
        : format === 'ORIGINAL' ? file.extension
          : format.toLowerCase();
      const mimeType = normalized === 'jpg' ? 'image/jpeg' : `image/${normalized}`;
      return {
        data: new ArrayBuffer(4),
        mimeType,
        extension: normalized,
        outcome: 'converted'
      };
    })
  };
}

export function makeFolderAndFilenameManagement(app: any) {
  return {
    createUniqueBinary: vi.fn(async (folder: string, name: string, data: ArrayBuffer) => {
      const path = folder ? `${folder}/${name}` : name;
      return app.vault.createBinary(path, data);
    })
  };
}

export function processedPaths(imageProcessor: any): string[] {
  return imageProcessor.processImageDetailed.mock.calls.map((callArgs: any[]) => callArgs[0].path);
}
