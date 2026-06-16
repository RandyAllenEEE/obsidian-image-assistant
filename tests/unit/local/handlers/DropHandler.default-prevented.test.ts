import { describe, expect, it, vi } from 'vitest';
import { DropHandler } from '../../../../src/local/handlers/DropHandler';

describe('Local DropHandler defaultPrevented guard', () => {
  it('ignores drops already handled by another plugin', async () => {
    const handler = new DropHandler({} as any, {} as any);
    const evt = {
      defaultPrevented: true,
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
