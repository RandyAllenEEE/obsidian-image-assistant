import { describe, it, expect, vi, beforeEach } from 'vitest';

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

describe('BatchImageProcessor progress, scope, and error behavior', () => {
  let app: any;
  let note1: any;
  let note2: any;
  let imgA: any;
  let imgB: any;
  let plugin: any;
  let imageProcessor: any;
  let folderAndFilenameManagement: any;

  beforeEach(() => {
    note1 = fakeTFile({ path: 'notes/n1.md', name: 'n1.md', extension: 'md' });
    note2 = fakeTFile({ path: 'notes/n2.md', name: 'n2.md', extension: 'md' });
    imgA = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    imgB = fakeTFile({ path: 'images/b.jpg', name: 'b.jpg', extension: 'jpg' });

    app = fakeApp({
      vault: fakeVault({ files: [note1, note2, imgA, imgB] }),
      metadataCache: {
        resolvedLinks: {
          [note1.path]: { [imgA.path]: 1, [imgB.path]: 1 },
          [note2.path]: { [imgA.path]: 1 }
        }
      } as any
    }) as any;

    plugin = makeBatchPlugin();
    imageProcessor = makeImageProcessor();
    folderAndFilenameManagement = makeFolderAndFilenameManagement(app);
  });

  it('updates status text while processing and removes it after completion delay', async () => {
    vi.useFakeTimers();
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    await bip.processImagesInNote(note1);

    const status = plugin.addStatusBarItem.mock.results[0].value;
    const texts = status.setText.mock.calls.map((callArgs: any[]) => callArgs[0] as string);
    expect(texts.some((text: string) => text.includes('Processing 1/2'))).toBe(true);
    expect(texts.some((text: string) => text.startsWith('Finished processing 2 items'))).toBe(true);

    vi.advanceTimersByTime(5000);
    expect(status.remove).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('processes only images linked from the requested note', async () => {
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    await bip.processImagesInNote(note1);

    expect(processedPaths(imageProcessor)).toEqual(['images/a.png', 'images/b.jpg']);
    expect(showBatchConfirmDialog).toHaveBeenCalledWith(
      app,
      expect.objectContaining({ totalCount: 2, scopePath: 'notes/n1.md', mode: 'local' })
    );
  });

  it('cleans up progress when the confirmation dialog is cancelled', async () => {
    vi.mocked(showBatchConfirmDialog).mockResolvedValueOnce('cancel' as any);
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    await bip.processImagesInNote(note1);

    const status = plugin.addStatusBarItem.mock.results[0].value;
    expect(status.remove).toHaveBeenCalled();
    expect(imageProcessor.processImage).not.toHaveBeenCalled();
  });

  it('cleans up progress when no note images are found', async () => {
    app.metadataCache.resolvedLinks[note1.path] = {};
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    await bip.processImagesInNote(note1);

    const status = plugin.addStatusBarItem.mock.results[0].value;
    expect(status.remove).toHaveBeenCalled();
    expect(showBatchConfirmDialog).not.toHaveBeenCalled();
  });

  it('continues after a per-file processing failure and reports the successful count', async () => {
    imageProcessor.processImage.mockRejectedValueOnce(new Error('boom'));
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    await bip.processImagesInNote(note1);

    const status = plugin.addStatusBarItem.mock.results[0].value;
    const texts = status.setText.mock.calls.map((callArgs: any[]) => callArgs[0] as string);
    expect(processedPaths(imageProcessor)).toEqual(['images/a.png', 'images/b.jpg']);
    expect(texts.some((text: string) => text.startsWith('Finished processing 1 items'))).toBe(true);
  });
});
