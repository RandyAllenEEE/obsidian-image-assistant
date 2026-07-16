import { beforeEach, describe, expect, it, vi } from 'vitest';

const loadImageMock = vi.hoisted(() => vi.fn<() => Promise<void>>(async () => undefined));
vi.mock('../../../../src/utils/ImageLoadUtils', () => ({ loadImage: loadImageMock }));
import { ClipboardHandler } from '../../../../src/ui/contextMenu/handlers/ClipboardHandler';
import { fakeApp, fakeWorkspace } from '../../../factories/obsidian';

describe('ClipboardHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadImageMock.mockResolvedValue(undefined);
  });

  function makeHandler(options: {
    src?: string;
    resolvedPath?: string | null;
  } = {}) {
    const source = `![img](${options.src ?? 'assets/pic.png'})`;
    const editor = { getLine: vi.fn(() => source) };
    const file = { path: 'notes/current.md' };
    const view = { editor, file, contentEl: document.createElement('div') };
    const app = fakeApp({
      workspace: fakeWorkspace({
        activeFile: file as any,
        activeView: view as any
      })
    }) as any;
    const folderManagement = {
      getImagePath: vi.fn(() => options.resolvedPath ?? 'assets/pic.png')
    };
    const imageMatchFinder = {
      findImageMatches: vi.fn().mockResolvedValue([
        {
          lineNumber: 0,
          line: `![img](${options.src ?? 'assets/pic.png'})`,
          fullMatch: `![img](${options.src ?? 'assets/pic.png'})`,
          index: 0
        }
      ])
    };
    const linkRemover = {
      removeImageLink: vi.fn().mockResolvedValue(undefined)
    };
    const viewContextResolver = {
      resolve: vi.fn(() => ({
        view,
        file,
        editor,
        match: { line: 0, start: 0, end: source.length, linkText: source }
      })),
      resolveOwner: vi.fn(() => ({ view, file, editor }))
    };
    const handler = new ClipboardHandler(
      app,
      folderManagement as any,
      imageMatchFinder as any,
      linkRemover as any,
      viewContextResolver as any
    );

    return { editor, folderManagement, handler, imageMatchFinder, linkRemover, source, viewContextResolver };
  }

  function makeEvent(target: EventTarget): MouseEvent {
    return { target } as unknown as MouseEvent;
  }

  it('uses the network image URL when cutting a network image link', async () => {
    const src = 'https://cdn.example.com/a%20b.png?size=large';
    const img = document.createElement('img');
    img.setAttribute('src', src);
    const { editor, folderManagement, handler, imageMatchFinder, linkRemover, source } = makeHandler({ src });

    await handler.cutImageAndLink(makeEvent(img));

    expect(folderManagement.getImagePath).not.toHaveBeenCalled();
    expect(imageMatchFinder.findImageMatches).not.toHaveBeenCalled();
    expect(linkRemover.removeImageLink).toHaveBeenCalledWith(
      editor,
      0,
      source,
      source,
      true,
      0
    );
  });

  it('uses the resolved image override when the original event target is a wrapper', async () => {
    const wrapper = document.createElement('div');
    const img = document.createElement('img');
    img.setAttribute('src', 'app://local/assets/pic.png');
    const { folderManagement, handler, imageMatchFinder, viewContextResolver } = makeHandler({
      resolvedPath: 'assets/pic.png'
    });

    await handler.cutImageAndLink(makeEvent(wrapper), img);

    expect(viewContextResolver.resolve).toHaveBeenCalledWith(img);
    expect(folderManagement.getImagePath).not.toHaveBeenCalled();
    expect(imageMatchFinder.findImageMatches).not.toHaveBeenCalled();
  });

  it('waits for image loading and reports a load failure when copying', async () => {
    let rejectLoad!: (error: Error) => void;
    loadImageMock.mockReturnValueOnce(new Promise<void>((_, reject) => { rejectLoad = reject; }));
    const img = document.createElement('img');
    img.src = 'https://cdn.example.com/image.png';
    const { handler } = makeHandler();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let settled = false;

    const copying = handler.copyImage(makeEvent(img)).then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    rejectLoad(new Error('offline'));
    await copying;

    expect(loadImageMock).toHaveBeenCalledWith(expect.anything(), img.src);
    expect(errorSpy).toHaveBeenCalledWith('Failed to copy image:', expect.any(Error));
  });
});
