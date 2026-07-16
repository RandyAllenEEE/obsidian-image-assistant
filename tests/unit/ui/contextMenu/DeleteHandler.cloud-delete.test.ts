import { beforeEach, describe, expect, it, vi } from 'vitest';

const obsidianMocks = vi.hoisted(() => ({
  Notice: vi.fn(),
  requestUrl: vi.fn()
}));

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    Notice: obsidianMocks.Notice,
    requestUrl: obsidianMocks.requestUrl
  };
});

import { CloudImageDeleter } from '../../../../src/cloud/CloudImageDeleter';
import { ConfirmDialog } from '../../../../src/settings/SettingsModals';
import { DeleteHandler } from '../../../../src/ui/contextMenu/handlers/DeleteHandler';
import { fakeApp, fakeTFile, fakeVault, fakeWorkspace } from '../../../factories/obsidian';
import { Modal } from 'obsidian';

function makeHandler(options: {
  uploader?: string;
  deleteServer?: string;
  historyRecord?: any;
  matches?: any[];
}) {
  const matches = options.matches ?? [
    {
      lineNumber: 0,
      line: '![remote](https://cdn.example.com/image.png)',
      fullMatch: '![remote](https://cdn.example.com/image.png)',
      index: 0
    }
  ];
  const clickedMatch = matches[0];
  const file = fakeTFile({ path: 'notes/current.md', name: 'current.md', extension: 'md' });
  const localImage = fakeTFile({ path: 'imgs/local.png', name: 'local.png', extension: 'png' });
  const editor = {
    getLine: vi.fn((lineNumber: number) =>
      matches.find(match => match.lineNumber === lineNumber)?.line ?? '')
  };
  const save = vi.fn().mockResolvedValue(undefined);
  const view = { editor, file, save, contentEl: document.createElement('div') };
  const app = fakeApp({
    vault: fakeVault({ files: [file, localImage] }),
    workspace: fakeWorkspace({
      activeFile: file,
      activeView: view
    })
  }) as any;
  const plugin = {
    settings: {
      pasteHandling: {
        cloud: {
          uploader: options.uploader ?? 'PicList',
          deleteServer: options.deleteServer ?? 'http://127.0.0.1:36677/delete'
        }
      }
    },
    historyManager: {
      isUrlUploaded: vi.fn(() => !!options.historyRecord),
      getRecord: vi.fn(() => options.historyRecord),
      removeRecord: vi.fn().mockResolvedValue(undefined)
    },
    vaultReferenceManager: {
      scanReferencesDetailed: vi.fn(async () => ({ locations: [], complete: true, uncertainFiles: [] })),
      getFilesReferencingUrl: vi.fn(async () => [])
    }
  } as any;
  const imageMatchFinder = {
    findImageMatches: vi.fn().mockResolvedValue(matches)
  } as any;
  const linkRemover = {
    removeImageLink: vi.fn().mockResolvedValue(undefined)
  } as any;
  const folderManagement = {
    getImagePath: vi.fn(() => 'imgs/local.png')
  } as any;
  const viewContextResolver = {
    resolve: vi.fn(() => ({
      view,
      file,
      editor,
      match: {
        line: clickedMatch.lineNumber,
        start: clickedMatch.index ?? 0,
        end: (clickedMatch.index ?? 0) + clickedMatch.fullMatch.length,
        linkText: clickedMatch.fullMatch
      }
    })),
    resolveOwner: vi.fn(() => ({ view, file, editor }))
  };
  const handler = new DeleteHandler(
    app,
    plugin,
    folderManagement,
    imageMatchFinder,
    linkRemover,
    new CloudImageDeleter(plugin),
    viewContextResolver as any
  );

  return { handler, imageMatchFinder, linkRemover, plugin, folderManagement, save, viewContextResolver };
}

function makeEvent(url = 'https://cdn.example.com/image.png') {
  const img = document.createElement('img');
  img.setAttribute('src', url);
  return { target: img } as unknown as MouseEvent;
}

describe('DeleteHandler cloud image deletion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes the link, deletes via PicList, and removes upload history when history exists', async () => {
    const historyRecord = { url: 'https://cdn.example.com/image.png', name: 'image.png' };
    obsidianMocks.requestUrl.mockResolvedValue({ status: 200, json: { success: true } });
    const { handler, linkRemover, plugin, save } = makeHandler({ historyRecord });

    await handler.deleteImageAndLink(makeEvent());

    expect(linkRemover.removeImageLink).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledOnce();
    expect(plugin.vaultReferenceManager.scanReferencesDetailed).toHaveBeenCalledTimes(2);
    expect(plugin.vaultReferenceManager.scanReferencesDetailed.mock.invocationCallOrder[0])
      .toBeLessThan(save.mock.invocationCallOrder[0]);
    expect(save.mock.invocationCallOrder[0])
      .toBeLessThan(plugin.vaultReferenceManager.scanReferencesDetailed.mock.invocationCallOrder[1]);
    expect(obsidianMocks.requestUrl).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://127.0.0.1:36677/delete',
      method: 'POST',
      body: JSON.stringify({ list: [historyRecord] })
    }));
    expect(plugin.historyManager.removeRecord).toHaveBeenCalledWith('https://cdn.example.com/image.png');
    expect(obsidianMocks.Notice).toHaveBeenCalledWith(expect.stringContaining('Cloud image deleted'));
  });

  it('passes the precise match index to the link remover', async () => {
    const line = 'first ![remote](https://cdn.example.com/image.png) second';
    const fullMatch = '![remote](https://cdn.example.com/image.png)';
    const matchIndex = line.indexOf(fullMatch);
    const { handler, linkRemover } = makeHandler({
      historyRecord: undefined,
      matches: [
        {
          lineNumber: 2,
          line,
          fullMatch,
          index: matchIndex
        }
      ]
    });

    await handler.deleteImageAndLink(makeEvent());

    expect(linkRemover.removeImageLink).toHaveBeenCalledWith(
      expect.anything(),
      2,
      line,
      fullMatch,
      false,
      matchIndex
    );
  });

  it('runs a multi-reference cloud deletion choice only once', async () => {
    const matches = [
      { lineNumber: 0, line: '![a](https://cdn.example.com/image.png)', fullMatch: '![a](https://cdn.example.com/image.png)', index: 0 },
      { lineNumber: 1, line: '![b](https://cdn.example.com/image.png)', fullMatch: '![b](https://cdn.example.com/image.png)', index: 0 }
    ];
    const { handler, linkRemover } = makeHandler({ historyRecord: undefined, matches });
    const openSpy = vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
      (this as any).onOpen();
    });

    await handler.deleteAllMatchingImageLinks(makeEvent());
    const modal = openSpy.mock.instances[0] as unknown as Modal;
    const deleteAll = modal.contentEl.querySelectorAll<HTMLButtonElement>('button')[1];
    deleteAll.dispatchEvent(new MouseEvent('click'));
    deleteAll.dispatchEvent(new MouseEvent('click'));

    await vi.waitFor(() => expect(linkRemover.removeImageLink).toHaveBeenCalledTimes(2));
    expect(linkRemover.removeImageLink).toHaveBeenCalledTimes(2);
  });

  it('removes the link but does not call PicList delete when upload history is missing', async () => {
    const { handler, linkRemover, plugin } = makeHandler({ historyRecord: undefined });

    await handler.deleteImageAndLink(makeEvent());

    expect(linkRemover.removeImageLink).toHaveBeenCalledTimes(1);
    expect(obsidianMocks.requestUrl).not.toHaveBeenCalled();
    expect(plugin.historyManager.removeRecord).not.toHaveBeenCalled();
    expect(obsidianMocks.Notice).toHaveBeenCalledWith(expect.stringContaining('not owned by Image Assistant'));
  });

  it('keeps the remote object when the edited note cannot be saved', async () => {
    const historyRecord = { url: 'https://cdn.example.com/image.png', name: 'image.png' };
    const { handler, linkRemover, plugin, save } = makeHandler({ historyRecord });
    save.mockRejectedValue(new Error('disk full'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await handler.deleteImageAndLink(makeEvent());

    expect(linkRemover.removeImageLink).toHaveBeenCalledOnce();
    expect(plugin.vaultReferenceManager.scanReferencesDetailed).toHaveBeenCalledOnce();
    expect(obsidianMocks.requestUrl).not.toHaveBeenCalled();
    expect(obsidianMocks.Notice).toHaveBeenCalledWith(expect.stringContaining('note could not be saved'));
  });

  it('removes the link and explains when the uploader cannot delete cloud files', async () => {
    const { handler, linkRemover, plugin } = makeHandler({
      uploader: 'PicGo',
      historyRecord: { url: 'https://cdn.example.com/image.png' }
    });

    await handler.deleteImageAndLink(makeEvent());

    expect(linkRemover.removeImageLink).toHaveBeenCalledTimes(1);
    expect(plugin.historyManager.getRecord).not.toHaveBeenCalled();
    expect(obsidianMocks.requestUrl).not.toHaveBeenCalled();
    expect(obsidianMocks.Notice).toHaveBeenCalledWith(expect.stringContaining('does not support automatic deletion'));
  });

  it('removes the link and explains when the PicList delete server is missing', async () => {
    const { handler, linkRemover, plugin } = makeHandler({
      deleteServer: '',
      historyRecord: { url: 'https://cdn.example.com/image.png' }
    });

    await handler.deleteImageAndLink(makeEvent());

    expect(linkRemover.removeImageLink).toHaveBeenCalledTimes(1);
    expect(plugin.historyManager.getRecord).not.toHaveBeenCalled();
    expect(obsidianMocks.requestUrl).not.toHaveBeenCalled();
    expect(obsidianMocks.Notice).toHaveBeenCalledWith(expect.stringContaining('delete server'));
  });

  it('reports an invalid PicList delete response without removing upload history', async () => {
    const historyRecord = { url: 'https://cdn.example.com/image.png', name: 'image.png' };
    obsidianMocks.requestUrl.mockResolvedValue({ status: 200, json: null });
    const { handler, linkRemover, plugin } = makeHandler({ historyRecord });

    await handler.deleteImageAndLink(makeEvent());

    expect(linkRemover.removeImageLink).toHaveBeenCalledTimes(1);
    expect(plugin.historyManager.removeRecord).not.toHaveBeenCalled();
    expect(obsidianMocks.Notice).toHaveBeenCalledWith(expect.stringContaining('Invalid delete response'));
  });

  it('rejects a non-2xx PicList response without removing upload history', async () => {
    const historyRecord = { url: 'https://cdn.example.com/image.png', name: 'image.png' };
    obsidianMocks.requestUrl.mockResolvedValue({ status: 503, json: { success: true } });
    const { handler, plugin } = makeHandler({ historyRecord });

    await handler.deleteImageAndLink(makeEvent());

    expect(plugin.historyManager.removeRecord).not.toHaveBeenCalled();
    expect(obsidianMocks.Notice).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
  });

  it('does not inject source lines as HTML in the local multi-reference confirmation', async () => {
    const maliciousLine = '![local](imgs/local.png) <img src=x onerror=alert(1)>';
    const { handler } = makeHandler({
      matches: [
        { lineNumber: 0, line: maliciousLine, fullMatch: '![local](imgs/local.png)' },
        { lineNumber: 4, line: 'again ![local](imgs/local.png)', fullMatch: '![local](imgs/local.png)' }
      ]
    });
    const openSpy = vi.spyOn(ConfirmDialog.prototype, 'open').mockImplementation(function (this: ConfirmDialog) {
      this.onOpen();
    });

    await handler.deleteAllMatchingImageLinks(makeEvent('app://vault/imgs/local.png'));

    const dialog = openSpy.mock.instances[0] as unknown as ConfirmDialog;
    expect(dialog.contentEl.textContent).not.toContain('<img src=x onerror=alert(1)>');
    expect(dialog.contentEl.querySelector('img')).toBeNull();
  });

  it('uses an explicit image override when the original event target is a wrapper', async () => {
    const wrapper = document.createElement('div');
    const img = document.createElement('img');
    img.setAttribute('src', 'app://local/imgs/local.png');
    const { handler, imageMatchFinder, folderManagement, viewContextResolver } = makeHandler({
      matches: [
        {
          lineNumber: 0,
          line: '![local](imgs/local.png)',
          fullMatch: '![local](imgs/local.png)',
          index: 0
        }
      ]
    });

    await handler.deleteImageAndLink({ target: wrapper } as unknown as MouseEvent, img);

    expect(viewContextResolver.resolve).toHaveBeenCalledWith(img);
    expect(folderManagement.getImagePath).not.toHaveBeenCalled();
    expect(imageMatchFinder.findImageMatches).not.toHaveBeenCalled();
  });
});
