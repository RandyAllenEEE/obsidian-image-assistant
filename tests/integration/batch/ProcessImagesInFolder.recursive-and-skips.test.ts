import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/utils/batch', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/utils/batch')>();
  return {
    ...actual,
    showBatchConfirmDialog: vi.fn(async () => 'process-only')
  };
});

import { BatchImageProcessor } from '../../../src/local/BatchImageProcessor';
import { showBatchConfirmDialog } from '../../../src/utils/batch';
import { fakeApp, fakeVault, fakeTFile, fakeTFolder } from '../../factories/obsidian';
import {
  makeBatchPlugin,
  makeFolderAndFilenameManagement,
  makeImageProcessor,
  processedPaths
} from './helpers';

function makeFolderFixture(batchLocalOverrides: Record<string, unknown> = {}) {
  const folder = fakeTFolder({ path: 'images', name: 'images' });
  const sub = fakeTFolder({ path: 'images/sub', name: 'sub', parent: folder });
  const files = [
    fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' }),
    fakeTFile({ path: 'images/b.jpg', name: 'b.jpg', extension: 'jpg' }),
    fakeTFile({ path: 'images/c.gif', name: 'c.gif', extension: 'gif' }),
    fakeTFile({ path: 'images/d.webp', name: 'd.webp', extension: 'webp' }),
    fakeTFile({ path: 'images/sub/e.png', name: 'e.png', extension: 'png' })
  ];

  const app = fakeApp({ vault: fakeVault({ files, folders: [folder, sub] }) }) as any;
  const plugin = makeBatchPlugin(batchLocalOverrides);
  const imageProcessor = makeImageProcessor();
  const folderAndFilenameManagement = makeFolderAndFilenameManagement(app);
  const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

  return { app, plugin, imageProcessor, folderAndFilenameManagement, bip };
}

describe('BatchImageProcessor folder processing', () => {
  it('applies skipFormats before processing direct folder images', async () => {
    const { app, imageProcessor, folderAndFilenameManagement, bip } = makeFolderFixture({
      skipFormats: 'webp,jpg'
    });

    await bip.processImagesInFolder('images', false);

    expect(processedPaths(imageProcessor)).toEqual(['images/a.png']);
    expect(folderAndFilenameManagement.createUniqueBinary).toHaveBeenCalledWith(
      'images',
      'a.webp',
      expect.any(ArrayBuffer),
      'increment'
    );
    expect(app.vault.modify).not.toHaveBeenCalled();
    expect(showBatchConfirmDialog).toHaveBeenCalledWith(
      app,
      expect.objectContaining({ totalCount: 1, scopePath: 'images', mode: 'local' })
    );
  });

  it('includes subfolder images only when recursive processing is enabled', async () => {
    const nonRecursive = makeFolderFixture();
    await nonRecursive.bip.processImagesInFolder('images', false);

    const recursive = makeFolderFixture();
    await recursive.bip.processImagesInFolder('images', true);

    expect(processedPaths(nonRecursive.imageProcessor)).toEqual([
      'images/a.png',
      'images/b.jpg',
      'images/d.webp'
    ]);
    expect(processedPaths(recursive.imageProcessor)).toEqual([
      'images/a.png',
      'images/b.jpg',
      'images/d.webp',
      'images/sub/e.png'
    ]);
  });
});
