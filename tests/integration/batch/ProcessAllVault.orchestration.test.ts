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
import { fakeApp, fakeVault, fakeTFile } from '../../factories/obsidian';
import {
  makeBatchPlugin,
  makeFolderAndFilenameManagement,
  makeImageProcessor,
  processedPaths
} from './helpers';

function makeVaultFixture(batchLocalOverrides: Record<string, unknown> = {}) {
  const note1 = fakeTFile({ path: 'notes/n1.md', name: 'n1.md', extension: 'md' });
  const note2 = fakeTFile({ path: 'notes/n2.md', name: 'n2.md', extension: 'md' });
  const canvas = fakeTFile({ path: 'canvas/board.canvas', name: 'board.canvas', extension: 'canvas' });
  const files = [
    note1,
    note2,
    canvas,
    fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' }),
    fakeTFile({ path: 'images/b.jpg', name: 'b.jpg', extension: 'jpg' }),
    fakeTFile({ path: 'more/b.jpg', name: 'b.jpg', extension: 'jpg' }),
    fakeTFile({ path: 'images/dup.png', name: 'dup.png', extension: 'png' })
  ];

  const fileContents = new Map<string, string>([
    [canvas.path, JSON.stringify({
      nodes: [
        { id: '1', type: 'file', file: 'images/dup.png' },
        { id: '2', type: 'file', file: 'images/a.png' }
      ]
    })]
  ]);

  const app = fakeApp({ vault: fakeVault({ files, fileContents }) }) as any;
  const plugin = makeBatchPlugin(batchLocalOverrides);
  const imageProcessor = makeImageProcessor();
  const folderAndFilenameManagement = makeFolderAndFilenameManagement(app);
  const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

  return { app, plugin, imageProcessor, folderAndFilenameManagement, bip };
}

describe('BatchImageProcessor vault-wide orchestration', () => {
  it('processes each vault image once even when canvas references repeat it', async () => {
    const { app, imageProcessor, bip } = makeVaultFixture();

    await bip.processAllVaultImages();

    expect(processedPaths(imageProcessor)).toEqual([
      'images/a.png',
      'images/b.jpg',
      'more/b.jpg',
      'images/dup.png'
    ]);
    expect(showBatchConfirmDialog).toHaveBeenCalledWith(
      app,
      expect.objectContaining({ totalCount: 4, scopePath: '/', mode: 'local' })
    );
  });

  it('normalizes jpg conversion for vault-wide processing', async () => {
    const { imageProcessor, folderAndFilenameManagement, bip } = makeVaultFixture({ convertTo: 'jpg' });

    await bip.processAllVaultImages();

    expect(imageProcessor.processImage.mock.calls[0][1]).toBe('JPEG');
    expect(folderAndFilenameManagement.createUniqueBinary).toHaveBeenCalledWith(
      'images',
      'a.jpg',
      expect.any(ArrayBuffer),
      'increment'
    );
  });

  it('skips files that are already in the target format when configured', async () => {
    const keep = fakeTFile({ path: 'images/keep.webp', name: 'keep.webp', extension: 'webp' });
    const toConvert = fakeTFile({ path: 'images/x.png', name: 'x.png', extension: 'png' });
    const app = fakeApp({ vault: fakeVault({ files: [keep, toConvert] }) }) as any;
    const plugin = makeBatchPlugin({ convertTo: 'webp', skipImagesInTargetFormat: true });
    const imageProcessor = makeImageProcessor();
    const folderAndFilenameManagement = makeFolderAndFilenameManagement(app);
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    await bip.processAllVaultImages();

    expect(processedPaths(imageProcessor)).toEqual(['images/x.png']);
  });

  it('keeps vault-wide processing order stable for fixed inputs', async () => {
    const first = makeVaultFixture();
    const second = makeVaultFixture();

    await first.bip.processAllVaultImages();
    await second.bip.processAllVaultImages();

    expect(processedPaths(second.imageProcessor)).toEqual(processedPaths(first.imageProcessor));
  });
});
