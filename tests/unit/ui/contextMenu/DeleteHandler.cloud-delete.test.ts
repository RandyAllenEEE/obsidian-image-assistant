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
import { fakeApp, fakeWorkspace } from '../../../factories/obsidian';

function makeHandler(options: {
  uploader?: string;
  deleteServer?: string;
  historyRecord?: any;
  matches?: any[];
}) {
  const editor = {};
  const app = fakeApp({
    workspace: fakeWorkspace({
      activeView: { editor }
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
      getRecord: vi.fn(() => options.historyRecord),
      removeRecord: vi.fn().mockResolvedValue(undefined)
    }
  } as any;
  const imageMatchFinder = {
    findImageMatches: vi.fn().mockResolvedValue(options.matches ?? [
      {
        lineNumber: 0,
        line: '![remote](https://cdn.example.com/image.png)',
        fullMatch: '![remote](https://cdn.example.com/image.png)'
      }
    ])
  } as any;
  const linkRemover = {
    removeImageLink: vi.fn().mockResolvedValue(undefined)
  } as any;
  const handler = new DeleteHandler(
    app,
    plugin,
    { getImagePath: vi.fn(() => 'imgs/local.png') } as any,
    imageMatchFinder,
    linkRemover,
    new CloudImageDeleter(plugin)
  );

  return { handler, imageMatchFinder, linkRemover, plugin };
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
    obsidianMocks.requestUrl.mockResolvedValue({ json: { success: true } });
    const { handler, linkRemover, plugin } = makeHandler({ historyRecord });

    await handler.deleteImageAndLink(makeEvent());

    expect(linkRemover.removeImageLink).toHaveBeenCalledTimes(1);
    expect(obsidianMocks.requestUrl).toHaveBeenCalledWith(expect.objectContaining({
      url: 'http://127.0.0.1:36677/delete',
      method: 'POST',
      body: JSON.stringify({ list: [historyRecord] })
    }));
    expect(plugin.historyManager.removeRecord).toHaveBeenCalledWith('https://cdn.example.com/image.png');
    expect(obsidianMocks.Notice).toHaveBeenCalledWith(expect.stringContaining('Cloud image deleted'));
  });

  it('removes the link but does not call PicList delete when upload history is missing', async () => {
    const { handler, linkRemover, plugin } = makeHandler({ historyRecord: undefined });

    await handler.deleteImageAndLink(makeEvent());

    expect(linkRemover.removeImageLink).toHaveBeenCalledTimes(1);
    expect(obsidianMocks.requestUrl).not.toHaveBeenCalled();
    expect(plugin.historyManager.removeRecord).not.toHaveBeenCalled();
    expect(obsidianMocks.Notice).toHaveBeenCalledWith(expect.stringContaining('upload history'));
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
    obsidianMocks.requestUrl.mockResolvedValue({ json: null });
    const { handler, linkRemover, plugin } = makeHandler({ historyRecord });

    await handler.deleteImageAndLink(makeEvent());

    expect(linkRemover.removeImageLink).toHaveBeenCalledTimes(1);
    expect(plugin.historyManager.removeRecord).not.toHaveBeenCalled();
    expect(obsidianMocks.Notice).toHaveBeenCalledWith(expect.stringContaining('Invalid delete response'));
  });

  it('renders local multi-reference confirmation details as text, not HTML', async () => {
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

    await handler.deleteImageAndLink(makeEvent('app://vault/imgs/local.png'));

    const dialog = openSpy.mock.instances[0] as ConfirmDialog;
    expect(dialog.contentEl.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(dialog.contentEl.querySelector('img')).toBeNull();
  });
});
