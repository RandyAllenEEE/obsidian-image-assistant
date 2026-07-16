import { describe, expect, it, vi } from 'vitest';
import { UploadMode } from '../../../../../../src/ui/modals/batch/modes/UploadMode';
import { CloudImageDeleter } from '../../../../../../src/cloud/CloudImageDeleter';
import { Modal } from 'obsidian';
import { DEFAULT_SETTINGS } from '../../../../../../src/settings/defaults';
import { fakeApp, fakeMetadataCache, fakeTFile, fakeTFolder, fakeVault } from '../../../../../factories/obsidian';

function makePlugin(overrides: Record<string, unknown> = {}) {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    commandOpenSettingsTab: vi.fn(),
    historyManager: {
      isLocalPathUploaded: vi.fn(() => false)
    },
    supportedImageFormats: {
      isSupported: vi.fn((_extension?: string, name?: string) => /\.(png|jpe?g|webp|gif)$/i.test(name || ''))
    },
    vaultReferenceManager: {
      getFilesReferencingImage: vi.fn(),
      getFilesReferencingUrl: vi.fn(async () => []),
      scanReferencesDetailed: vi.fn(async () => ({ locations: [], complete: true, uncertainFiles: [] })),
      updateReferenceLocationsDetailed: vi.fn(async () => ({
        found: 0, replaced: 0, complete: true, files: [], failedFiles: [], uncertainFiles: []
      }))
    },
    ...overrides
  } as any;
}

describe('UploadMode', () => {
  it('renders settings and opens the plugin settings command', () => {
    const plugin = makePlugin();
    const mode = new UploadMode(fakeApp() as any, plugin, null, 'vault');
    const container = document.createElement('div');

    mode.renderSettings(container);
    container.querySelector('button')?.click();

    expect(container.textContent).toContain('Upload Configuration');
    expect(plugin.commandOpenSettingsTab).toHaveBeenCalledOnce();
  });

  it('recursively discovers images in folders and scans the whole vault', async () => {
    const first = fakeTFile({ path: 'root/a.png', extension: 'png' });
    const second = fakeTFile({ path: 'root/nested/b.webp', extension: 'webp' });
    const ignored = fakeTFile({ path: 'root/nested/readme.md', extension: 'md' });
    const nested = fakeTFolder({ path: 'root/nested', children: [second, ignored] });
    const root = fakeTFolder({ path: 'root', children: [first, nested] });
    const app = fakeApp({ vault: fakeVault({ files: [first, second, ignored], folders: [root, nested] }) }) as any;
    const plugin = makePlugin();

    const folderTasks = await new UploadMode(app, plugin, root, 'folder').loadTasks();
    const vaultTasks = await new UploadMode(app, plugin, null, 'vault').loadTasks();

    expect(folderTasks.tasks.map(task => task.path).sort()).toEqual([first.path, second.path].sort());
    expect(vaultTasks.tasks.map(task => task.path).sort()).toEqual([first.path, second.path].sort());
  });

  it('rejects a task whose source is not a vault file', async () => {
    const uploadFileHeadless = vi.fn();
    const mode = new UploadMode(fakeApp() as any, makePlugin({
      cloudImageHandler: { uploadFileHeadless }
    }), null, 'vault');

    const result = await mode.processTask({
      id: 'bad', name: 'bad', path: 'bad', source: { path: 'bad' },
      selected: true, status: 'pending'
    });

    expect(result).toMatchObject({ status: 'failed', success: false });
    expect(uploadFileHeadless).not.toHaveBeenCalled();
  });

  it('uses the direct headless worker when it is available', async () => {
    const image = fakeTFile({ path: 'images/a.png', extension: 'png' });
    const success = { status: 'success', success: true, item: image, output: 'https://cdn.example.com/a.png' } as const;
    const uploadFileHeadless = vi.fn(async () => success);
    const mode = new UploadMode(fakeApp() as any, makePlugin({
      cloudImageHandler: { uploadFileHeadless, batchUpload: vi.fn() }
    }), null, 'vault');

    await expect(mode.processTask({
      id: image.path, name: image.name, path: image.path, source: image,
      selected: true, status: 'pending'
    })).resolves.toBe(success);
    expect(uploadFileHeadless).toHaveBeenCalledWith(image);
  });

  it('returns a failed item when the headless upload worker throws', async () => {
    const image = fakeTFile({ path: 'images/a.png', extension: 'png' });
    const mode = new UploadMode(fakeApp() as any, makePlugin({
      cloudImageHandler: { uploadFileHeadless: vi.fn(async () => { throw new Error('upload worker crashed'); }) }
    }), null, 'vault');

    await expect(mode.processTask({
      id: image.path, name: image.name, path: image.path, source: image,
      selected: true, status: 'pending'
    })).resolves.toMatchObject({ status: 'failed', error: 'upload worker crashed' });
  });

  it('returns an explicit failure when the legacy upload worker returns no item result', async () => {
    const image = fakeTFile({ path: 'images/a.png', extension: 'png' });
    const mode = new UploadMode(fakeApp() as any, makePlugin({
      cloudImageHandler: {
        batchUpload: vi.fn(async () => ({ successful: [], failed: [], skipped: [], cancelled: false }))
      }
    }), null, 'vault');

    await expect(mode.processTask({
      id: image.path, name: image.name, path: image.path, source: image,
      selected: true, status: 'pending'
    })).resolves.toMatchObject({ status: 'failed', success: false });
  });

  it('preserves a skipped headless upload result', async () => {
    const image = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const app = fakeApp() as any;
    const skipped = {
      status: 'skipped',
      success: false,
      skipped: true,
      item: image,
      error: 'Already uploaded'
    } as const;
    const plugin = makePlugin({
      cloudImageHandler: {
        batchUpload: vi.fn(async () => ({
          successful: [], failed: [], skipped: [skipped], cancelled: false
        }))
      }
    });
    const mode = new UploadMode(app, plugin, null, 'vault');

    await expect(mode.processTask({
      id: image.path,
      name: image.name,
      path: image.path,
      source: image,
      selected: true,
      status: 'pending'
    })).resolves.toBe(skipped);
  });

  it('only exposes undo upload when the uploader supports cloud deletion', () => {
    const app = fakeApp() as any;
    const plugin = makePlugin();
    plugin.settings.pasteHandling.cloud.uploader = 'PicGo';

    const picGoMode = new UploadMode(app, plugin, null, 'vault');
    expect(picGoMode.getReviewActions().map(action => action.id)).toEqual(['replace_only', 'replace_delete']);

    plugin.settings.pasteHandling.cloud.uploader = 'PicList';
    const picListMode = new UploadMode(app, plugin, null, 'vault');
    expect(picListMode.getReviewActions().map(action => action.id)).toEqual(['replace_only', 'replace_delete', 'undo']);
  });

  it('does not ask for a fake undo confirmation when uploader cannot delete cloud files', async () => {
    const app = fakeApp() as any;
    const plugin = makePlugin();
    plugin.settings.pasteHandling.cloud.uploader = 'PicGo';
    const confirmSpy = vi.spyOn(window, 'confirm');
    const mode = new UploadMode(app, plugin, null, 'vault');

    await mode.handleReviewAction('undo', {
      successful: [{ status: 'success', success: true, item: 'images/a.png' as any, output: 'https://cdn.example.com/a.png' }],
      failed: [],
      skipped: [],
      cancelled: false
    });

    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('blocks undo when discovery was incomplete', async () => {
    const plugin = makePlugin();
    plugin.settings.pasteHandling.cloud.uploader = 'PicList';
    const mode = new UploadMode(fakeApp() as any, plugin, null, 'vault');

    await expect(mode.handleReviewAction('undo', {
      successful: [], failed: [], skipped: [], cancelled: false,
      discovery: { complete: false, failedFiles: ['locked.md'], uncertainFiles: ['locked.md'] }
    })).resolves.toBe(false);
  });

  it('reports missing upload URLs and completes a safe undo deletion', async () => {
    const image = fakeTFile({ path: 'images/a.png', extension: 'png' });
    const plugin = makePlugin();
    plugin.settings.pasteHandling.cloud.uploader = 'PicList';
    const deleteSpy = vi.spyOn(CloudImageDeleter.prototype, 'deleteImageDetailed')
      .mockResolvedValue({ success: true } as any);
    const mode = new UploadMode(fakeApp() as any, plugin, null, 'vault');

    await expect(mode.handleReviewAction('undo', {
      successful: [{ status: 'success', success: true, item: image, output: '' }],
      failed: [], skipped: [], cancelled: false
    })).resolves.toBe(false);

    await expect(mode.handleReviewAction('undo', {
      successful: [{ status: 'success', success: true, item: image, output: 'https://cdn.example.com/a.png' }],
      failed: [], skipped: [], cancelled: false
    })).resolves.toBe(true);
    expect(deleteSpy).toHaveBeenCalledWith({ url: 'https://cdn.example.com/a.png' });
  });

  it('keeps an uploaded cloud object when undo finds a new Markdown reference', async () => {
    const note = fakeTFile({ path: 'notes/current.md', name: 'current.md', extension: 'md' });
    const app = fakeApp({ vault: fakeVault({ files: [note] }) }) as any;
    const plugin = makePlugin();
    plugin.settings.pasteHandling.cloud.uploader = 'PicList';
    const url = 'https://cdn.example.com/a.png';
    plugin.vaultReferenceManager.scanReferencesDetailed.mockResolvedValue({
      locations: [{ file: note, start: 0, end: 1, original: `![](${url})`, link: url, line: 0 }],
      complete: true,
      uncertainFiles: []
    });
    const deleteSpy = vi.spyOn(CloudImageDeleter.prototype, 'deleteImageDetailed');
    const mode = new UploadMode(app, plugin, null, 'vault');

    const completed = await mode.handleReviewAction('undo', {
      successful: [{ status: 'success', success: true, item: 'images/a.png' as any, output: url }],
      failed: [], skipped: [], cancelled: false
    });

    expect(completed).toBe(false);
    expect(deleteSpy).not.toHaveBeenCalled();
  });

  it('loads current canvas note image tasks through metadataCache-resolved file links', async () => {
    const canvas = fakeTFile({ path: 'boards/board.canvas', name: 'board.canvas', extension: 'canvas' });
    const image = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const vault = fakeVault({
      files: [canvas, image],
      fileContents: new Map([[canvas.path, JSON.stringify({ nodes: [{ type: 'file', file: 'a.png' }] })]])
    });
    const metadataCache = fakeMetadataCache();
    metadataCache.getFirstLinkpathDest = vi.fn((link: string) => link === 'a.png' ? image : null) as any;
    const app = fakeApp({ vault, metadataCache }) as any;
    const plugin = makePlugin();
    const mode = new UploadMode(app, plugin, canvas, 'note');

    const { tasks } = await mode.loadTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      id: image.path,
      name: image.name,
      path: image.path,
      source: image,
      selected: true,
      status: 'pending'
    });
  });

  it('discovers local images in callouts and ad-* fences even when ordinary code indexing is disabled', async () => {
    const note = fakeTFile({ path: 'notes/current.md', name: 'current.md', extension: 'md' });
    const callout = fakeTFile({ path: 'images/callout.png', name: 'callout.png', extension: 'png' });
    const legacy = fakeTFile({ path: 'images/legacy.webp', name: 'legacy.webp', extension: 'webp' });
    const code = fakeTFile({ path: 'images/code.png', name: 'code.png', extension: 'png' });
    const vault = fakeVault({
      files: [note, callout, legacy, code],
      fileContents: new Map([[note.path, [
        '> [!note]',
        '> ![[images/callout.png|Callout]]',
        '```ad-note',
        '![[images/legacy.webp|Legacy]]',
        '```',
        '```markdown',
        '![[images/code.png|Code]]',
        '```'
      ].join('\n')]])
    });
    const metadataCache = fakeMetadataCache();
    metadataCache.getFirstLinkpathDest = vi.fn((link: string) => ({
      'images/callout.png': callout,
      'images/legacy.webp': legacy,
      'images/code.png': code
    }[link] ?? null)) as any;
    const app = fakeApp({ vault, metadataCache }) as any;
    const plugin = makePlugin();
    plugin.settings.global.codeBlockImageLinkIndexing = false;

    const { tasks } = await new UploadMode(app, plugin, note, 'note').loadTasks();

    expect(tasks.map(task => task.path).sort()).toEqual([callout.path, legacy.path].sort());
  });

  it('returns discovery diagnostics when the current note cannot be read', async () => {
    const note = fakeTFile({ path: 'notes/locked.md', extension: 'md' });
    const vault = fakeVault({ files: [note] });
    vault.read = vi.fn(async () => { throw new Error('permission denied'); });
    const app = fakeApp({ vault, metadataCache: fakeMetadataCache() }) as any;

    const discovery = await new UploadMode(app, makePlugin(), note, 'note').loadTasks();

    expect(discovery.tasks).toEqual([]);
    expect(discovery.complete).toBe(false);
    expect(discovery.failedFiles).toEqual([expect.stringContaining('notes/locked.md: permission denied')]);
    expect(discovery.uncertainFiles).toEqual([note.path]);
  });

  it('skips already uploaded canvas image tasks', async () => {
    const canvas = fakeTFile({ path: 'boards/board.canvas', name: 'board.canvas', extension: 'canvas' });
    const image = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const vault = fakeVault({
      files: [canvas, image],
      fileContents: new Map([[canvas.path, JSON.stringify({ nodes: [{ type: 'file', file: image.path }] })]])
    });
    const app = fakeApp({ vault }) as any;
    const plugin = makePlugin();
    plugin.vaultReferenceManager.getFilesReferencingImage.mockResolvedValue([]);
    plugin.historyManager.isLocalPathUploaded.mockImplementation((path: string) => path === image.path);
    const mode = new UploadMode(app, plugin, canvas, 'note');

    const { tasks } = await mode.loadTasks();

    expect(tasks).toEqual([]);
  });

  it('loads local images referenced from Canvas text nodes', async () => {
    const canvas = fakeTFile({ path: 'boards/board.canvas', name: 'board.canvas', extension: 'canvas' });
    const image = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const vault = fakeVault({
      files: [canvas, image],
      fileContents: new Map([[canvas.path, JSON.stringify({
        nodes: [{ type: 'text', text: `[[${image.path}|Open image]]` }]
      })]])
    });
    const app = fakeApp({ vault, metadataCache: fakeMetadataCache() }) as any;
    const plugin = makePlugin();
    const mode = new UploadMode(app, plugin, canvas, 'note');

    const { tasks } = await mode.loadTasks();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ id: image.path, source: image });
  });

  it('replaces native and text Canvas references after upload', async () => {
    const canvas = fakeTFile({ path: 'boards/board.canvas', name: 'board.canvas', extension: 'canvas' });
    const image = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const url = 'https://cdn.example.com/a.png';
    const contents = new Map([[canvas.path, JSON.stringify({
      nodes: [
        { id: 'native', type: 'file', file: image.path },
        { id: 'text', type: 'text', text: `![[${image.path}|300]]` }
      ]
    })]]);
    const app = fakeApp({
      vault: fakeVault({ files: [canvas, image], fileContents: contents }),
      metadataCache: fakeMetadataCache()
    }) as any;
    const plugin = makePlugin();
    const mode = new UploadMode(app, plugin, canvas, 'note');

    const completed = await mode.handleReviewAction('replace_only', {
      successful: [{ status: 'success', success: true, item: image, output: url }],
      failed: [], skipped: [], cancelled: false
    });
    const updated = JSON.parse(contents.get(canvas.path) ?? '{}');

    expect(completed).toBe(true);
    expect(updated.nodes[0]).toMatchObject({ id: 'native', type: 'link', url });
    expect(updated.nodes[0]).not.toHaveProperty('file');
    expect(updated.nodes[1].text).toBe(`![[${url}|300]]`);
  });

  it('does not delete local files when replace_delete replaces no references', async () => {
    const canvas = fakeTFile({ path: 'boards/board.canvas', name: 'board.canvas', extension: 'canvas' });
    const image = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const vault = fakeVault({ files: [canvas, image] });
    const app = fakeApp({ vault }) as any;
    const plugin = makePlugin();
    plugin.vaultReferenceManager.getFilesReferencingImage.mockResolvedValue([]);
    const mode = new UploadMode(app, plugin, canvas, 'note');

    const completed = await mode.handleReviewAction('replace_delete', {
      successful: [{ status: 'success', success: true, item: image, output: 'https://cdn.example.com/a.png' }],
      failed: [],
      skipped: [],
      cancelled: false
    });

    expect(plugin.vaultReferenceManager.updateReferenceLocationsDetailed).toHaveBeenCalledWith([], expect.any(Function));
    expect(app.vault.trash).not.toHaveBeenCalled();
  });

  it('keeps the review open when zero-reference deletion is cancelled', async () => {
    const image = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const vault = fakeVault({ files: [image] });
    const app = fakeApp({ vault }) as any;
    const plugin = makePlugin();
    plugin.vaultReferenceManager.getFilesReferencingImage.mockResolvedValue([]);
    const mode = new UploadMode(app, plugin, null, 'vault');
    vi.spyOn(mode as any, 'confirmZeroReferenceDeletion').mockResolvedValue(false);

    const completed = await mode.handleReviewAction('replace_delete', {
      successful: [{ status: 'success', success: true, item: image, output: 'https://cdn.example.com/a.png' }],
      failed: [],
      skipped: [],
      cancelled: false
    });

    expect(completed).toBe(false);
    expect(app.vault.trash).not.toHaveBeenCalled();
  });

  it('keeps local files when replace_delete sees references outside the selected scope', async () => {
    const note = fakeTFile({ path: 'notes/current.md', name: 'current.md', extension: 'md' });
    const otherNote = fakeTFile({ path: 'notes/other.md', name: 'other.md', extension: 'md' });
    const image = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const vault = fakeVault({ files: [note, otherNote, image] });
    const app = fakeApp({ vault }) as any;
    const plugin = makePlugin();
    const locations = [
      { file: note, start: 0, end: 17, original: '![[images/a.png]]', link: 'images/a.png', line: 0 },
      { file: otherNote, start: 0, end: 17, original: '![[images/a.png]]', link: 'images/a.png', line: 0 }
    ];
    plugin.vaultReferenceManager.scanReferencesDetailed.mockResolvedValue({ locations, complete: true, uncertainFiles: [] });
    plugin.vaultReferenceManager.updateReferenceLocationsDetailed.mockResolvedValue({
      found: 1, replaced: 1, complete: true, files: [], failedFiles: [], uncertainFiles: []
    });
    const mode = new UploadMode(app, plugin, note, 'note');

    const completed = await mode.handleReviewAction('replace_delete', {
      successful: [{ status: 'success', success: true, item: image, output: 'https://cdn.example.com/a.png' }],
      failed: [],
      skipped: [],
      cancelled: false
    });

    expect(app.vault.trash).not.toHaveBeenCalled();
  });

  it('blocks local deletion when task discovery was incomplete', async () => {
    const note = fakeTFile({ path: 'notes/current.md', extension: 'md' });
    const image = fakeTFile({ path: 'images/a.png', extension: 'png' });
    const app = fakeApp({ vault: fakeVault({ files: [note, image] }) }) as any;
    const plugin = makePlugin();
    plugin.vaultReferenceManager.scanReferencesDetailed.mockResolvedValue({
      locations: [], complete: true, uncertainFiles: []
    });
    const mode = new UploadMode(app, plugin, note, 'note');

    const completed = await mode.handleReviewAction('replace_delete', {
      successful: [{ status: 'success', success: true, item: image, output: 'https://cdn.example.com/a.png' }],
      failed: [], skipped: [], cancelled: false,
      discovery: { complete: false, failedFiles: ['notes/locked.md'], uncertainFiles: ['notes/locked.md'] }
    });

    expect(completed).toBe(false);
    expect(app.vault.trash).not.toHaveBeenCalled();
  });

  it('keeps local files when a canvas file still references the image after markdown replacement', async () => {
    const note = fakeTFile({ path: 'notes/current.md', name: 'current.md', extension: 'md' });
    const canvas = fakeTFile({ path: 'boards/board.canvas', name: 'board.canvas', extension: 'canvas' });
    const image = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const vault = fakeVault({
      files: [note, canvas, image],
      fileContents: new Map([[canvas.path, JSON.stringify({ nodes: [{ type: 'file', file: 'a.png' }] })]])
    });
    const metadataCache = fakeMetadataCache();
    metadataCache.getFirstLinkpathDest = vi.fn((link: string) => link === 'a.png' ? image : null) as any;
    const app = fakeApp({ vault, metadataCache }) as any;
    const plugin = makePlugin();
    const locations = [
      { file: note, start: 0, end: 17, original: '![[images/a.png]]', link: 'images/a.png', line: 0 }
    ];
    plugin.vaultReferenceManager.scanReferencesDetailed.mockResolvedValue({ locations, complete: true, uncertainFiles: [] });
    plugin.vaultReferenceManager.updateReferenceLocationsDetailed.mockResolvedValue({
      found: 1, replaced: 1, complete: true, files: [], failedFiles: [], uncertainFiles: []
    });
    const mode = new UploadMode(app, plugin, note, 'note');

    const completed = await mode.handleReviewAction('replace_delete', {
      successful: [{ status: 'success', success: true, item: image, output: 'https://cdn.example.com/a.png' }],
      failed: [],
      skipped: [],
      cancelled: false
    });

    expect(app.vault.trash).not.toHaveBeenCalled();
  });

  it('deletes local files after replace_delete replaces in-scope references with no outside references', async () => {
    const note = fakeTFile({ path: 'notes/current.md', name: 'current.md', extension: 'md' });
    const image = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const vault = fakeVault({ files: [note, image] });
    const app = fakeApp({ vault }) as any;
    const plugin = makePlugin();
    plugin.vaultReferenceManager.getFilesReferencingImage.mockResolvedValue([]);
    const location = { file: note, start: 0, end: 17, original: '![[images/a.png]]', link: 'images/a.png', line: 0 };
    plugin.vaultReferenceManager.scanReferencesDetailed
      .mockResolvedValueOnce({ locations: [location], complete: true, uncertainFiles: [] })
      .mockResolvedValue({ locations: [], complete: true, uncertainFiles: [] });
    plugin.vaultReferenceManager.getFilesReferencingImage.mockResolvedValue([]);
    plugin.vaultReferenceManager.updateReferenceLocationsDetailed.mockResolvedValue({
      found: 1, replaced: 1, complete: true,
      files: [{ filePath: note.path, found: 1, replaced: 1 }],
      failedFiles: [], uncertainFiles: []
    });
    const mode = new UploadMode(app, plugin, note, 'note');

    const completed = await mode.handleReviewAction('replace_delete', {
      successful: [{ status: 'success', success: true, item: image, output: 'https://cdn.example.com/a.png' }],
      failed: [],
      skipped: [],
      cancelled: false
    });

    expect(completed).toBe(true);
    expect(app.vault.trash).toHaveBeenCalledWith(image, true);
  });

  it('records a local trash failure without aborting the review action', async () => {
    const note = fakeTFile({ path: 'notes/current.md', name: 'current.md', extension: 'md' });
    const image = fakeTFile({ path: 'images/a.png', name: 'a.png', extension: 'png' });
    const vault = fakeVault({ files: [note, image] });
    const app = fakeApp({ vault }) as any;
    app.vault.trash.mockRejectedValue(new Error('trash unavailable'));
    const plugin = makePlugin();
    plugin.vaultReferenceManager.getFilesReferencingImage.mockResolvedValue([]);
    const location = { file: note, start: 0, end: 17, original: '![[images/a.png]]', link: 'images/a.png', line: 0 };
    plugin.vaultReferenceManager.scanReferencesDetailed
      .mockResolvedValueOnce({ locations: [location], complete: true, uncertainFiles: [] })
      .mockResolvedValue({ locations: [], complete: true, uncertainFiles: [] });
    plugin.vaultReferenceManager.updateReferenceLocationsDetailed.mockResolvedValue({
      found: 1, replaced: 1, complete: true, files: [], failedFiles: [], uncertainFiles: []
    });
    const mode = new UploadMode(app, plugin, note, 'note');

    await expect(mode.handleReviewAction('replace_delete', {
      successful: [{ status: 'success', success: true, item: image, output: 'https://cdn.example.com/a.png' }],
      failed: [], skipped: [], cancelled: false
    })).resolves.toBe(false);
    expect(app.vault.trash).toHaveBeenCalledWith(image, true);
  });

  it('reports replace_only as incomplete when a known reference could not be updated', async () => {
    const note = fakeTFile({ path: 'notes/current.md', extension: 'md' });
    const image = fakeTFile({ path: 'images/a.png', extension: 'png' });
    const app = fakeApp({ vault: fakeVault({ files: [note, image] }) }) as any;
    const plugin = makePlugin();
    plugin.vaultReferenceManager.scanReferencesDetailed.mockResolvedValue({
      locations: [{ file: note, start: 0, end: 1, original: '![[images/a.png]]', link: image.path, line: 0 }],
      complete: true,
      uncertainFiles: []
    });
    plugin.vaultReferenceManager.updateReferenceLocationsDetailed.mockResolvedValue({
      found: 1, replaced: 0, complete: false, files: [], failedFiles: [note.path], uncertainFiles: []
    });
    const mode = new UploadMode(app, plugin, note, 'note');

    const completed = await mode.handleReviewAction('replace_only', {
      successful: [{ status: 'success', success: true, item: image, output: 'https://cdn.example.com/a.png' }],
      failed: [], skipped: [], cancelled: false
    });

    expect(completed).toBe(false);
  });

  it('settles the zero-reference deletion dialog and summarizes long file lists', async () => {
    const files = Array.from({ length: 11 }, (_, index) =>
      fakeTFile({ path: `images/${index}.png`, extension: 'png' }));
    const mode = new UploadMode(fakeApp() as any, makePlugin(), null, 'vault');
    const open = vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
      (this as any).onOpen();
    });

    const confirmation = (mode as any).confirmZeroReferenceDeletion(files);
    const dialog = open.mock.instances[0] as unknown as Modal;
    expect(dialog.contentEl.textContent).toContain('images/0.png');
    dialog.contentEl.querySelectorAll<HTMLButtonElement>('button')[0].click();

    await expect(confirmation).resolves.toBe(false);
  });
});
