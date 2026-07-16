import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RenameHandler } from '../../../../src/ui/contextMenu/handlers/RenameHandler';
import { fakeApp, fakeTFile, fakeVault, fakeWorkspace } from '../../../factories/obsidian';

function input(value: string): HTMLInputElement {
  const el = document.createElement('input');
  el.value = value;
  return el;
}

describe('RenameHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeHandler(options: {
    imagePath?: string;
    imageName?: string;
  } = {}) {
    const imageFile = fakeTFile({
      path: options.imagePath ?? 'assets/pic.png',
      name: options.imageName ?? 'pic.png',
      extension: (options.imageName ?? 'pic.png').split('.').pop() ?? 'png'
    });
    const activeFile = fakeTFile({ path: 'notes/current.md', name: 'current.md', extension: 'md' });
    const vault = fakeVault({ files: [imageFile, activeFile] }) as any;
    vault.getResourcePath = vi.fn((file: any) => `app://local/${file.path}`);
    const app = fakeApp({
      vault,
      workspace: fakeWorkspace({ activeFile })
    }) as any;
    const plugin = {
      imageStateManager: {
        updateState: vi.fn().mockResolvedValue(undefined),
        refreshAllImages: vi.fn()
      }
    } as any;
    const folderManagement = {
      ensureFolderExists: vi.fn().mockResolvedValue(undefined),
      safeRenameFile: vi.fn().mockResolvedValue(true),
      sanitizeFilename: vi.fn((value: string) => value.trim())
    };
    const handler = new RenameHandler(
      app,
      plugin,
      folderManagement as any,
      {
        processTemplate: vi.fn(async (value: string) => value)
      } as any
    );
    const menu = {
      hide: vi.fn()
    } as any;
    const img = document.createElement('img') as HTMLImageElement;

    return { app, folderManagement, handler, imageFile, img, menu, plugin, activeFile };
  }

  it('passes null dimensions when width and height inputs are cleared', async () => {
    const { handler, img, menu, plugin, activeFile } = makeHandler();

    await handler.handleDimensionsAndCaptionUpdate(
      menu,
      input('Caption'),
      input(''),
      input(''),
      'center',
      img,
      activeFile,
      true
    );

    expect(plugin.imageStateManager.updateState).toHaveBeenCalledWith(img, {
      caption: 'Caption',
      width: null,
      height: null,
      align: 'center'
    });
    expect(menu.hide).toHaveBeenCalled();
  });

  it('does not update state when dimensions are not positive integers', async () => {
    const { handler, img, menu, plugin, activeFile } = makeHandler();

    await handler.handleDimensionsAndCaptionUpdate(
      menu,
      input('Caption'),
      input('12.5'),
      input(''),
      'center',
      img,
      activeFile,
      true
    );

    expect(plugin.imageStateManager.updateState).not.toHaveBeenCalled();
    expect(menu.hide).not.toHaveBeenCalled();
  });

  it('renames and moves an image with a single fileManager operation', async () => {
    const { app, folderManagement, handler, imageFile, img, menu, activeFile } = makeHandler();

    await handler.handleRenameAndMove(
      menu,
      input('renamed'),
      input('images'),
      img,
      true,
      'pic',
      '.png',
      'assets/pic.png',
      imageFile,
      activeFile
    );

    expect(folderManagement.ensureFolderExists).toHaveBeenCalledWith('images');
    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(1);
    expect(app.fileManager.renameFile).toHaveBeenCalledWith(imageFile, 'images/renamed.png');
    expect(app.vault.getAbstractFileByPath('assets/pic.png')).toBeNull();
    expect(imageFile.path).toBe('images/renamed.png');
    expect(img.src).toContain('images/renamed.png');
    expect(menu.hide).toHaveBeenCalled();
  });

  it('moves an image without renaming when only the folder changes', async () => {
    const { app, handler, imageFile, img, menu, activeFile } = makeHandler();

    await handler.handleRenameAndMove(
      menu,
      input('pic'),
      input('images'),
      img,
      true,
      'pic',
      '.png',
      'assets/pic.png',
      imageFile,
      activeFile
    );

    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(1);
    expect(app.fileManager.renameFile).toHaveBeenCalledWith(imageFile, 'images/pic.png');
  });

  it('writes root targets without a leading slash', async () => {
    const { app, folderManagement, handler, imageFile, img, menu, activeFile } = makeHandler();

    await handler.handleRenameAndMove(
      menu,
      input('root-name'),
      input('/'),
      img,
      true,
      'pic',
      '.png',
      'assets/pic.png',
      imageFile,
      activeFile
    );

    expect(folderManagement.ensureFolderExists).not.toHaveBeenCalled();
    expect(app.fileManager.renameFile).toHaveBeenCalledWith(imageFile, 'root-name.png');
  });

  it('uses safeRenameFile for case-only path changes', async () => {
    const { app, folderManagement, handler, imageFile, img, menu, activeFile } = makeHandler({
      imagePath: 'assets/pic.png',
      imageName: 'pic.png'
    });

    await handler.handleRenameAndMove(
      menu,
      input('Pic'),
      input('assets'),
      img,
      true,
      'pic',
      '.png',
      'assets/pic.png',
      imageFile,
      activeFile
    );

    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    expect(folderManagement.safeRenameFile).toHaveBeenCalledWith(imageFile, 'assets/Pic.png');
  });

  it('does not rename when sanitization leaves an empty filename', async () => {
    const { app, folderManagement, handler, imageFile, img, menu, activeFile } = makeHandler();
    folderManagement.sanitizeFilename.mockReturnValue('');

    await handler.handleRenameAndMove(
      menu,
      input('...'),
      input('images'),
      img,
      true,
      'pic',
      '.png',
      'assets/pic.png',
      imageFile,
      activeFile
    );

    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    expect(folderManagement.ensureFolderExists).not.toHaveBeenCalled();
    expect(menu.hide).not.toHaveBeenCalled();
  });

  it('rejects a target directory that traverses outside the vault', async () => {
    const { app, folderManagement, handler, imageFile, img, menu, activeFile } = makeHandler();

    await handler.handleRenameAndMove(
      menu,
      input('renamed'),
      input('../outside'),
      img,
      true,
      'pic',
      '.png',
      imageFile.path,
      imageFile,
      activeFile
    );

    expect(folderManagement.ensureFolderExists).not.toHaveBeenCalled();
    expect(app.fileManager.renameFile).not.toHaveBeenCalled();
  });

  it('does not report a completed rename as failed when view refresh needs recovery', async () => {
    const { app, handler, imageFile, img, menu, plugin, activeFile } = makeHandler();
    const currentState = { type: 'markdown', state: { file: activeFile.path } };
    const leaf = {
      getViewState: vi.fn(() => currentState),
      setViewState: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('refresh failed'))
        .mockResolvedValueOnce(undefined)
    };
    app.workspace.getMostRecentLeaf = vi.fn(() => leaf);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await handler.handleRenameAndMove(
      menu,
      input('renamed'),
      input('images'),
      img,
      true,
      'pic',
      '.png',
      imageFile.path,
      imageFile,
      activeFile
    );

    expect(app.fileManager.renameFile).toHaveBeenCalledWith(imageFile, 'images/renamed.png');
    expect(leaf.setViewState.mock.calls).toEqual([
      [{ type: 'empty', state: {} }],
      [currentState],
      [currentState]
    ]);
    expect(menu.hide).toHaveBeenCalledOnce();
    expect(plugin.imageStateManager.refreshAllImages).toHaveBeenCalledOnce();
  });
});
