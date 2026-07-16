import { describe, expect, it, vi } from 'vitest';
import { ImageFileCollector } from '../../../src/utils/batch/ImageFileCollector';
import { LocalProcessMode } from '../../../src/ui/modals/batch/modes/LocalProcessMode';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import { fakeApp, fakeMetadataCache, fakeTFile, fakeVault } from '../../factories/obsidian';

function makePlugin() {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    supportedImageFormats: {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpe?g|webp|gif)$/i.test(name || ''))
    }
  } as any;
}

describe('Current note image discovery with current collectors', () => {
  it('gets linked markdown images from resolvedLinks and applies skip rules', () => {
    const note = fakeTFile({ path: 'notes/n.md', name: 'n.md', extension: 'md' });
    const png = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const jpg = fakeTFile({ path: 'images/b.jpg', name: 'b.jpg', extension: 'jpg' });
    const gif = fakeTFile({ path: 'images/c.gif', name: 'c.gif', extension: 'gif' });
    const app = fakeApp({
      vault: fakeVault({ files: [note, png, jpg, gif] }),
      metadataCache: { resolvedLinks: { [note.path]: { [png.path]: 1, [jpg.path]: 1, [gif.path]: 1 } } } as any
    }) as any;
    const plugin = makePlugin();
    const collector = new ImageFileCollector(app, plugin);

    const linked = collector.getLinkedImageFiles(note);
    const skipFormats = collector.parseSkipFormats('gif');
    const processable = linked.filter(file => collector.shouldProcessImage(file, false, 'jpg', skipFormats, true));

    expect(linked.map(file => file.path).sort()).toEqual(['images/a.png', 'images/b.jpg', 'images/c.gif']);
    expect(processable.map(file => file.path)).toEqual(['images/a.png']);
  });

  it('loads note tasks from metadata embeds through LocalProcessMode', async () => {
    const note = fakeTFile({ path: 'notes/n.md', name: 'n.md', extension: 'md' });
    const png = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const app = fakeApp({ vault: fakeVault({ files: [note, png] }) }) as any;
    app.metadataCache.getFileCache = vi.fn(() => ({ embeds: [{ link: 'images/a.png' }] }));
    app.metadataCache.getFirstLinkpathDest = vi.fn(() => png);
    const plugin = makePlugin();

    const mode = new LocalProcessMode(app, plugin, note, 'note');
    const { tasks } = await mode.loadTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0].path).toBe('images/a.png');
  });

  it('loads canvas note tasks through LocalProcessMode', async () => {
    const canvas = fakeTFile({ path: 'boards/board.canvas', name: 'board.canvas', extension: 'canvas' });
    const png = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const vault = fakeVault({
      files: [canvas, png],
      fileContents: new Map([[canvas.path, JSON.stringify({ nodes: [{ type: 'file', file: 'a.png' }] })]])
    });
    const metadataCache = fakeMetadataCache();
    metadataCache.getFirstLinkpathDest = vi.fn((link: string) => link === 'a.png' ? png : null) as any;
    const app = fakeApp({ vault, metadataCache }) as any;
    const plugin = makePlugin();

    const mode = new LocalProcessMode(app, plugin, canvas, 'note');
    const { tasks } = await mode.loadTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: png.path,
      name: png.name,
      path: png.path,
      source: png,
      selected: true,
      status: 'pending'
    });
  });

  it('reads image paths from canvas JSON', async () => {
    const canvas = fakeTFile({ path: 'boards/board.canvas', name: 'board.canvas', extension: 'canvas' });
    const png = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const vault = fakeVault({
      files: [canvas, png],
      fileContents: new Map([[canvas.path, JSON.stringify({ nodes: [{ type: 'file', file: png.path }] })]])
    });
    const app = fakeApp({ vault }) as any;
    const collector = new ImageFileCollector(app, makePlugin());

    await expect(collector.getImagesFromCanvas(canvas)).resolves.toEqual([png.path]);
  });

  it('resolves short canvas file links through metadataCache', async () => {
    const canvas = fakeTFile({ path: 'boards/board.canvas', name: 'board.canvas', extension: 'canvas' });
    const png = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const vault = fakeVault({
      files: [canvas, png],
      fileContents: new Map([[canvas.path, JSON.stringify({ nodes: [{ type: 'file', file: 'a.png' }] })]])
    });
    const metadataCache = fakeMetadataCache();
    metadataCache.getFirstLinkpathDest = vi.fn((link: string) => link === 'a.png' ? png : null) as any;
    const app = fakeApp({ vault, metadataCache }) as any;
    const collector = new ImageFileCollector(app, makePlugin());

    await expect(collector.getImagesFromCanvas(canvas)).resolves.toEqual([png.path]);
  });
});
