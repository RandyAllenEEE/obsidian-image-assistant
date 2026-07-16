import { describe, expect, it, vi } from 'vitest';
import { DropHandler } from '../../../../src/cloud/handlers/DropHandler';

describe('Cloud DropHandler ctrl bypass', () => {
  it('ignores drops already handled by another plugin', async () => {
    const handler = new DropHandler({} as any, {} as any);
    const evt = {
      defaultPrevented: true,
      ctrlKey: false,
      preventDefault: vi.fn(),
      dataTransfer: {
        files: [new File(['image'], 'image.png', { type: 'image/png' })]
      }
    } as any as DragEvent;
    const editor = {
      posAtMouse: vi.fn(),
      setCursor: vi.fn()
    } as any;

    await handler.handleDrop(evt, editor);

    expect(editor.posAtMouse).not.toHaveBeenCalled();
    expect(editor.setCursor).not.toHaveBeenCalled();
    expect(evt.preventDefault).not.toHaveBeenCalled();
  });

  it('lets Obsidian handle dropped files when Ctrl is pressed', async () => {
    const handler = new DropHandler({} as any, {} as any);
    const evt = {
      ctrlKey: true,
      preventDefault: vi.fn(),
      dataTransfer: {
        files: [new File(['image'], 'image.png', { type: 'image/png' })]
      }
    } as any as DragEvent;
    const editor = {
      posAtMouse: vi.fn(),
      setCursor: vi.fn()
    } as any;

    await handler.handleDrop(evt, editor);

    expect(editor.posAtMouse).not.toHaveBeenCalled();
    expect(editor.setCursor).not.toHaveBeenCalled();
    expect(evt.preventDefault).not.toHaveBeenCalled();
  });

  it('lets Obsidian handle a mixed supported and unsupported file drop', async () => {
    const plugin = {
      supportedImageFormats: { isSupported: vi.fn((type: string) => type.startsWith('image/')) },
      folderAndFilenameManagement: { matchesPatterns: vi.fn(() => false) },
      settings: { pasteHandling: { neverProcessFilenames: '' } }
    } as any;
    const handler = new DropHandler({} as any, plugin);
    vi.spyOn((handler as any).pasteHandler, 'canProcessFiles').mockReturnValue(true);
    const processFiles = vi.spyOn((handler as any).pasteHandler, 'processFiles');
    const evt = {
      defaultPrevented: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
      dataTransfer: { files: [
        new File(['image'], 'image.png', { type: 'image/png' }),
        new File(['pdf'], 'document.pdf', { type: 'application/pdf' })
      ] }
    } as any as DragEvent;
    const editor = { posAtMouse: vi.fn(() => ({ line: 1, ch: 2 })), setCursor: vi.fn() } as any;

    await handler.handleDrop(evt, editor);

    expect(evt.preventDefault).not.toHaveBeenCalled();
    expect(editor.setCursor).not.toHaveBeenCalled();
    expect(processFiles).not.toHaveBeenCalled();
  });
});
