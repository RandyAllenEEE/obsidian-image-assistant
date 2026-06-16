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
  return {
    settings: makeBatchSettings(batchLocalOverrides),
    supportedImageFormats: {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpe?g|webp)$/i.test(name || ''))
    },
    addStatusBarItem: vi.fn(() => ({ setText: vi.fn(), remove: vi.fn() })),
    vaultReferenceManager: {
      updateReferences: vi.fn(async () => 0),
      updateReferencesInFile: vi.fn(async () => 0)
    },
    ...pluginOverrides
  } as any;
}

export function makeImageProcessor() {
  return {
    processImage: vi.fn(async () => new ArrayBuffer(4))
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
  return imageProcessor.processImage.mock.calls.map((callArgs: any[]) => callArgs[0].path);
}
