import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Menu } from 'obsidian';
import { ContextMenu } from '../../../src/ui/ContextMenu';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import { fakeApp, fakeTFile, fakeVault, fakeWorkspace } from '../../factories/obsidian';

function setupImage(containerClass = 'markdown-preview-view') {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.className = containerClass;
  const img = document.createElement('img');
  img.src = 'app://vault/imgs/pic.jpg';
  container.appendChild(img);
  document.body.appendChild(container);
  return img;
}

function setupWrappedImage() {
  document.body.innerHTML = '';
  const container = document.createElement('div');
  container.className = 'markdown-preview-view';
  const wrapper = document.createElement('div');
  wrapper.className = 'image-wrapper';
  const img = document.createElement('img');
  img.src = 'app://vault/imgs/pic.jpg';
  wrapper.appendChild(img);
  container.appendChild(wrapper);
  document.body.appendChild(container);
  return { wrapper, img };
}

function makePlugin(overrides: Record<string, unknown> = {}) {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    supportedImageFormats: {
      isExcalidrawImage: vi.fn(() => false)
    },
    imageStateManager: {
      getImageState: vi.fn(() => null)
    },
    ...overrides
  } as any;
}

function makeContext(app: any, plugin: any) {
  const folderAndFilenameManagement = {
    getImagePath: vi.fn((img: HTMLImageElement) =>
      (img.getAttribute('src') || '').replace(/^app:\/\/vault\//, '')
    )
  };
  return new ContextMenu(app, plugin, folderAndFilenameManagement as any, {} as any);
}

describe('ContextMenu integration', () => {
  let app: any;
  let note: any;
  let plugin: any;

  beforeEach(() => {
    note = fakeTFile({ path: 'notes/n1.md', name: 'n1.md', extension: 'md' });
    const image = fakeTFile({ path: 'imgs/pic.jpg', name: 'pic.jpg', extension: 'jpg' });
    app = fakeApp({
      vault: fakeVault({ files: [note, image] }),
      workspace: fakeWorkspace({ activeFile: note })
    }) as any;
    plugin = makePlugin();
  });

  it('registers a capturing document contextmenu listener on construction', () => {
    const addSpy = vi.spyOn(document, 'addEventListener');

    const ctx = makeContext(app, plugin);

    expect(addSpy).toHaveBeenCalledWith('contextmenu', expect.any(Function), true);
    ctx.onunload();
  });

  it('shows the menu for images inside markdown views', () => {
    const img = setupImage();
    const ctx = makeContext(app, plugin);
    const createSpy = vi.spyOn(ctx, 'createContextMenuItems').mockReturnValue(true);
    const showSpy = vi.spyOn(Menu.prototype as any, 'showAtMouseEvent').mockImplementation(() => {});

    img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(createSpy).toHaveBeenCalledWith(expect.any(Menu), img, note, expect.any(MouseEvent));
    expect(showSpy).toHaveBeenCalled();
    ctx.onunload();
  });

  it('uses the image inside a supported wrapper when the wrapper receives the contextmenu event', () => {
    const { wrapper, img } = setupWrappedImage();
    const ctx = makeContext(app, plugin);
    const createSpy = vi.spyOn(ctx, 'createContextMenuItems').mockReturnValue(true);
    const showSpy = vi.spyOn(Menu.prototype as any, 'showAtMouseEvent').mockImplementation(() => {});

    wrapper.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(createSpy).toHaveBeenCalledWith(expect.any(Menu), img, note, expect.any(MouseEvent));
    expect(showSpy).toHaveBeenCalled();
    ctx.onunload();
  });

  it('does not open the menu when another handler already prevented the contextmenu event', () => {
    const img = setupImage();
    const ctx = makeContext(app, plugin);
    const createSpy = vi.spyOn(ctx, 'createContextMenuItems').mockReturnValue(true);
    const showSpy = vi.spyOn(Menu.prototype as any, 'showAtMouseEvent').mockImplementation(() => {});
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    event.preventDefault();

    img.dispatchEvent(event);

    expect(createSpy).not.toHaveBeenCalled();
    expect(showSpy).not.toHaveBeenCalled();
    ctx.onunload();
  });

  it('registers context menu listeners for popout window documents', () => {
    const listeners: Record<string, Function> = {};
    app.workspace.on = vi.fn((event: string, callback: Function) => {
      listeners[event] = callback;
      return { detach: vi.fn() };
    });

    const popoutDocument = document.implementation.createHTMLDocument('popout');
    const container = popoutDocument.createElement('div');
    container.className = 'markdown-preview-view';
    const img = popoutDocument.createElement('img');
    img.src = 'app://vault/imgs/pic.jpg';
    container.appendChild(img);
    popoutDocument.body.appendChild(container);

    const ctx = makeContext(app, plugin);
    const createSpy = vi.spyOn(ctx, 'createContextMenuItems').mockReturnValue(true);
    const showSpy = vi.spyOn(Menu.prototype as any, 'showAtMouseEvent').mockImplementation(() => {});

    listeners['window-open']?.(null, { document: popoutDocument });
    img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(createSpy).toHaveBeenCalledWith(expect.any(Menu), img, note, expect.any(MouseEvent));
    expect(showSpy).toHaveBeenCalled();

    createSpy.mockClear();
    listeners['window-close']?.(null, { document: popoutDocument });
    img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(createSpy).not.toHaveBeenCalled();
    expect((ctx as any).contextMenuDocumentScopes.has(popoutDocument)).toBe(false);
    ctx.onunload();
  });

  it('does not show the menu for unsupported targets or views', () => {
    const showSpy = vi.spyOn(Menu.prototype as any, 'showAtMouseEvent').mockImplementation(() => {});

    const plainDiv = document.createElement('div');
    document.body.appendChild(plainDiv);
    const nonImageCtx = makeContext(app, plugin);
    plainDiv.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(showSpy).not.toHaveBeenCalled();
    nonImageCtx.onunload();

    const outsideImg = setupImage('not-a-markdown-view');
    const outsideCtx = makeContext(app, plugin);
    outsideImg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(showSpy).not.toHaveBeenCalled();
    outsideCtx.onunload();

    const canvasImg = setupImage();
    app.workspace.getActiveViewOfType = vi.fn(() => ({ getViewType: () => 'canvas' }));
    const canvasCtx = makeContext(app, plugin);
    canvasImg.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(showSpy).not.toHaveBeenCalled();
    canvasCtx.onunload();
  });

  it('skips Excalidraw images', () => {
    const img = setupImage();
    plugin.supportedImageFormats.isExcalidrawImage = vi.fn(() => true);
    const ctx = makeContext(app, plugin);
    const showSpy = vi.spyOn(Menu.prototype as any, 'showAtMouseEvent').mockImplementation(() => {});

    img.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));

    expect(showSpy).not.toHaveBeenCalled();
    ctx.onunload();
  });

  it('removes the registered document listener on unload', () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const ctx = makeContext(app, plugin);

    ctx.onunload();

    expect(removeSpy).toHaveBeenCalledWith('contextmenu', expect.any(Function), true);
  });

  it('delegates process and annotation menu items to the processing handler', () => {
    const img = setupImage();
    const ctx = makeContext(app, plugin);
    const processImage = vi.fn();
    const annotateImage = vi.fn();
    (ctx as any).processingHandler = { processImage, annotateImage, cropRotateFlip: vi.fn() };

    const menu = new Menu();
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    ctx.addProcessImageMenuItem(menu, img, event);
    ctx.addAnnotateImageMenuItem(menu, img);
    menu.showAtMouseEvent(event);

    expect(processImage).toHaveBeenCalledWith(img);
    expect(annotateImage).toHaveBeenCalledWith(img);
    ctx.onunload();
  });

  it('delegates clipboard and delete menu items with the resolved image', () => {
    const { wrapper, img } = setupWrappedImage();
    const ctx = makeContext(app, plugin);
    const cutImageAndLink = vi.fn();
    const copyImage = vi.fn();
    const copyImageAsBase64 = vi.fn();
    const deleteImageAndLink = vi.fn();
    (ctx as any).clipboardHandler = { cutImageAndLink, copyImage, copyImageAsBase64, onunload: vi.fn() };
    (ctx as any).deleteHandler = { deleteImageAndLink };

    const menu = new Menu();
    const event = { target: wrapper } as unknown as MouseEvent;
    ctx.addCutImageMenuItem(menu, img, event);
    ctx.addCopyImageMenuItem(menu, img, event);
    ctx.addCopyBase64ImageMenuItem(menu, img, event);
    ctx.addDeleteImageAndLinkMenuItem(menu, img, event);
    menu.showAtMouseEvent(event);

    expect(cutImageAndLink).toHaveBeenCalledWith(event, img);
    expect(copyImage).toHaveBeenCalledWith(event, img);
    expect(copyImageAsBase64).toHaveBeenCalledWith(event, img);
    expect(deleteImageAndLink).toHaveBeenCalledWith(event, img);
    ctx.onunload();
  });

  it('applies rename and caption changes only once while the confirmation is running', async () => {
    const img = setupImage();
    const ctx = makeContext(app, plugin);
    const confirmButton = document.createElement('button');
    const input = () => document.createElement('input');
    let finishRename!: () => void;
    const handleRenameAndMove = vi.fn(() => new Promise<void>(resolve => { finishRename = resolve; }));
    const handleDimensionsAndCaptionUpdate = vi.fn(async () => undefined);
    (ctx as any).renameHandler = { handleRenameAndMove, handleDimensionsAndCaptionUpdate };
    (ctx as any).renameInputBuilder = {
      buildInputs: vi.fn(() => ({
        confirmButton,
        isImageResolvable: true,
        nameInput: input(),
        pathInput: input(),
        captionInput: input(),
        widthInput: input(),
        heightInput: input(),
        getAlignment: () => 'center',
        fileNameWithoutExt: 'pic',
        fileExtension: '.jpg',
        obsidianVaultPathForRename: 'imgs/pic.jpg',
        file: fakeTFile({ path: 'imgs/pic.jpg', extension: 'jpg' })
      })),
      onunload: vi.fn()
    };

    ctx.createContextMenuItems(
      new Menu(),
      img,
      note,
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    );
    confirmButton.dispatchEvent(new MouseEvent('click'));
    confirmButton.dispatchEvent(new MouseEvent('click'));

    expect(handleRenameAndMove).toHaveBeenCalledOnce();
    expect(handleDimensionsAndCaptionUpdate).not.toHaveBeenCalled();
    expect(confirmButton.disabled).toBe(true);

    finishRename();
    await vi.waitFor(() => expect(handleDimensionsAndCaptionUpdate).toHaveBeenCalledOnce());
    expect(confirmButton.disabled).toBe(false);
    ctx.onunload();
  });
});
