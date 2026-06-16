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
});
