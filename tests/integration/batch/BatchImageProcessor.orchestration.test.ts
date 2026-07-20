import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BatchImageProcessor } from '../../../src/local/BatchImageProcessor';
import { fakeApp, fakeVault, fakeTFile } from '../../factories/obsidian';
import {
  makeBatchPlugin,
  makeFolderAndFilenameManagement,
  makeImageProcessor,
  processedPaths
} from './helpers';

describe('BatchImageProcessor orchestration', () => {
  let app: any;
  let imgA: any;
  let imgB: any;
  let plugin: any;
  let imageProcessor: any;
  let folderAndFilenameManagement: any;

  beforeEach(() => {
    imgA = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    imgB = fakeTFile({ path: 'images/b.jpg', name: 'b.jpg', extension: 'jpg' });

    app = fakeApp({ vault: fakeVault({ files: [imgA, imgB] }) }) as any;
    plugin = makeBatchPlugin();
    imageProcessor = makeImageProcessor();
    folderAndFilenameManagement = makeFolderAndFilenameManagement(app);
  });

  it('creates a converted binary, updates references, trashes the source, and returns success', async () => {
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    const result = await bip.batchProcess([imgA]);

    expect(result.successful).toHaveLength(1);
    expect(result.successful[0].item).toBe(imgA);
    expect(folderAndFilenameManagement.createUniqueBinary).toHaveBeenCalledWith(
      'images',
      'a.webp',
      expect.any(ArrayBuffer),
      'increment'
    );
    expect(plugin.vaultReferenceManager.updateReferences).toHaveBeenCalledWith('images/a.png', expect.any(Function));
    expect(app.vault.trash).toHaveBeenCalledWith(imgA, true);
  });

  it('generates converted image link text relative to each referencing note', async () => {
    const noteA = fakeTFile({ path: 'notes/a.md', name: 'a.md', extension: 'md' });
    const noteB = fakeTFile({ path: 'other/b.md', name: 'b.md', extension: 'md' });
    app.metadataCache.fileToLinktext = vi.fn((file: any, sourcePath: string) => {
      if (sourcePath === noteA.path) return '../images/a.webp';
      if (sourcePath === noteB.path) return '../shared images/a.webp';
      return file.path;
    });
    plugin.vaultReferenceManager.updateReferences = vi.fn(async (_path: string, generate: (loc: any) => string) => {
      expect(generate({
        file: noteA,
        original: '![[images/a.png|Caption|300]]'
      })).toBe('![[../images/a.webp|Caption|300]]');
      expect(generate({
        file: noteB,
        original: '![Alt](../images/a.png "title")'
      })).toBe('![Alt](../shared%20images/a.webp "title")');
      return 2;
    });
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    await bip.batchProcess([imgA]);

    const newFile = await folderAndFilenameManagement.createUniqueBinary.mock.results[0].value;
    expect(app.metadataCache.fileToLinktext).toHaveBeenCalledWith(newFile, noteA.path, false);
    expect(app.metadataCache.fileToLinktext).toHaveBeenCalledWith(newFile, noteB.path, false);
  });

  it('updates canvas file nodes before deleting the converted source image', async () => {
    const canvas = fakeTFile({ path: 'boards/board.canvas', name: 'board.canvas', extension: 'canvas' });
    app = fakeApp({
      vault: fakeVault({
        files: [imgA, canvas],
        fileContents: new Map([[canvas.path, JSON.stringify({ nodes: [{ type: 'file', file: 'a.png' }] })]])
      })
    }) as any;
    app.metadataCache.getFirstLinkpathDest = vi.fn((link: string) => link === 'a.png' ? imgA : null);
    plugin = makeBatchPlugin();
    imageProcessor = makeImageProcessor();
    folderAndFilenameManagement = makeFolderAndFilenameManagement(app);
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    await bip.batchProcess([imgA]);

    const updatedCanvas = JSON.parse(await app.vault.read(canvas));
    expect(updatedCanvas.nodes[0].file).toBe('images/a.webp');
    expect(app.vault.trash).toHaveBeenCalledWith(imgA, true);
  });

  it('processes multiple files and preserves result association with the input files', async () => {
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    const result = await bip.batchProcess([imgA, imgB]);

    expect(processedPaths(imageProcessor)).toEqual(['a.png', 'b.jpg']);
    expect(result.successful.map((item: any) => item.item.path)).toEqual(['images/a.png', 'images/b.jpg']);
  });

  it('normalizes the UI jpg option to JPEG processing and .jpg output', async () => {
    plugin = makeBatchPlugin({ convertTo: 'jpg' });
    folderAndFilenameManagement = makeFolderAndFilenameManagement(app);
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    await bip.batchProcess([imgA]);

    expect(imageProcessor.processImageDetailed).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'a.png' }),
      'JPEG',
      expect.any(Number),
      expect.any(Number),
      expect.any(String),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(String),
      expect.any(Boolean)
    );
    expect(folderAndFilenameManagement.createUniqueBinary).toHaveBeenCalledWith(
      'images',
      'a.jpg',
      expect.any(ArrayBuffer),
      'increment'
    );
  });

  it('keeps the original extension when conversion is disabled', async () => {
    plugin = makeBatchPlugin({ convertTo: 'disabled' });
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    await bip.batchProcess([imgA]);

    expect(imageProcessor.processImageDetailed.mock.calls[0][1]).toBe('ORIGINAL');
    expect(app.vault.modifyBinary).toHaveBeenCalledWith(imgA, expect.any(ArrayBuffer));
    expect(folderAndFilenameManagement.createUniqueBinary).not.toHaveBeenCalled();
  });

  it('reports per-file failures without throwing away the whole batch result', async () => {
    imageProcessor.processImageDetailed.mockRejectedValueOnce(new Error('boom'));
    const bip = new BatchImageProcessor(app, plugin, imageProcessor as any, folderAndFilenameManagement as any);

    const result = await bip.batchProcess([imgA, imgB]);

    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toContain('boom');
    expect(result.successful).toHaveLength(1);
  });
});
