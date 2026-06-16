import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TFile } from 'obsidian';
import { LocalProcessMode } from '../../../src/ui/modals/batch/modes/LocalProcessMode';
import { ImageFileCollector } from '../../../src/utils/batch/ImageFileCollector';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import { fakeApp, fakeTFile, fakeTFolder, fakeVault } from '../../factories/obsidian';

function makePlugin() {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    supportedImageFormats: {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpe?g|webp|gif)$/i.test(name || ''))
    },
    batchImageProcessor: {
      batchProcess: vi.fn(async (files: TFile[]) => ({
        successful: files.map(file => ({ success: true, item: file })),
        failed: [],
        cancelled: false
      }))
    }
  } as any;
}

describe('Folder batch processing with current LocalProcessMode', () => {
  let folder: any;
  let sub: any;
  let files: TFile[];
  let app: any;
  let plugin: any;

  beforeEach(() => {
    folder = fakeTFolder({ path: 'images', name: 'images' });
    sub = fakeTFolder({ path: 'images/sub', name: 'sub', parent: folder });
    files = [
      fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' }),
      fakeTFile({ path: 'images/b.jpg', name: 'b.jpg', extension: 'jpg' }),
      fakeTFile({ path: 'images/d.webp', name: 'd.webp', extension: 'webp' }),
      fakeTFile({ path: 'images/sub/e.png', name: 'e.png', extension: 'png' })
    ];
    const vault = fakeVault({ files, folders: [folder, sub] });
    app = fakeApp({ vault }) as any;
    plugin = makePlugin();
  });

  it('collects recursive folder image tasks for the selected folder', async () => {
    const mode = new LocalProcessMode(app, plugin, folder, 'folder');

    const tasks = await mode.loadTasks();

    expect(tasks.map(task => task.path).sort()).toEqual(files.map(file => file.path).sort());
  });

  it('ImageFileCollector can distinguish direct vs recursive folder scans', () => {
    const collector = new ImageFileCollector(app, plugin);

    expect(collector.getImageFilesInFolder(folder, false).map(file => file.path).sort()).toEqual([
      'images/a.png',
      'images/b.jpg',
      'images/d.webp'
    ]);
    expect(collector.getImageFilesInFolder(folder, true).map(file => file.path).sort()).toEqual(files.map(file => file.path).sort());
  });

  it('processTask delegates a single selected file to batchProcess', async () => {
    const mode = new LocalProcessMode(app, plugin, folder, 'folder');
    const tasks = await mode.loadTasks();

    const result = await mode.processTask(tasks[0]);

    expect(plugin.batchImageProcessor.batchProcess).toHaveBeenCalledWith([tasks[0].source]);
    expect(result.success).toBe(true);
  });
});
