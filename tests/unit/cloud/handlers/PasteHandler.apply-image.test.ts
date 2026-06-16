import { describe, expect, it, vi } from 'vitest';
import { PasteHandler } from '../../../../src/cloud/handlers/PasteHandler';
import { fakeTFile } from '../../../factories/obsidian';

function makePlugin(applyImage: boolean, overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      pasteHandling: {
        neverProcessFilenames: '',
        cloud: {
          applyImage,
          remoteServerMode: false,
          workOnNetWork: false,
          newWorkBlackDomains: '',
          ...overrides
        }
      }
    },
    supportedImageFormats: {
      isSupported: vi.fn(() => true)
    },
    folderAndFilenameManagement: {
      matchesPatterns: vi.fn(() => false)
    }
  } as any;
}

function makeClipboardEvent(text: string) {
  const file = new File(['image'], 'image.png', { type: 'image/png' });
  return {
    clipboardData: {
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => file
        }
      ],
      getData: vi.fn((type: string) => {
        if (type === 'text/plain' || type === 'text') return text;
        return '';
      })
    },
    preventDefault: vi.fn()
  } as any as ClipboardEvent;
}

describe('Cloud PasteHandler applyImage behavior', () => {
  it('ignores paste events already handled by another plugin', async () => {
    const handler = new PasteHandler({} as any, makePlugin(true));
    const processFiles = vi.spyOn(handler, 'processFiles').mockResolvedValue(undefined);
    const evt = {
      ...makeClipboardEvent('plain text next to image'),
      defaultPrevented: true
    } as any as ClipboardEvent;

    await handler.handlePaste(evt, {} as any);

    expect(evt.preventDefault).not.toHaveBeenCalled();
    expect(processFiles).not.toHaveBeenCalled();
  });

  it('does not intercept mixed text and image clipboard content when applyImage is disabled', async () => {
    const handler = new PasteHandler({} as any, makePlugin(false));
    const processFiles = vi.spyOn(handler, 'processFiles').mockResolvedValue(undefined);
    const evt = makeClipboardEvent('plain text next to image');

    await handler.handlePaste(evt, {} as any);

    expect(evt.preventDefault).not.toHaveBeenCalled();
    expect(processFiles).not.toHaveBeenCalled();
  });

  it('uploads mixed text and image clipboard content when applyImage is enabled', async () => {
    const handler = new PasteHandler({} as any, makePlugin(true));
    const processFiles = vi.spyOn(handler, 'processFiles').mockResolvedValue(undefined);
    const evt = makeClipboardEvent('plain text next to image');

    await handler.handlePaste(evt, {} as any);

    expect(evt.preventDefault).toHaveBeenCalledTimes(1);
    expect(processFiles).toHaveBeenCalledTimes(1);
  });

  it('does not upload network image links while remote server mode is enabled', async () => {
    const handler = new PasteHandler({} as any, makePlugin(true, {
      remoteServerMode: true,
      workOnNetWork: true
    }));
    const evt = { preventDefault: vi.fn() } as any as ClipboardEvent;
    const editor = { replaceRange: vi.fn() } as any;

    await handler.handlePasteText('![remote](https://example.com/image.png)', editor, { line: 0, ch: 0 }, evt);

    expect(evt.preventDefault).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('returns without throwing when there is an active file but no Markdown view', async () => {
    const app = {
      workspace: {
        getActiveFile: vi.fn(() => fakeTFile({ path: 'note.md', name: 'note.md' })),
        getActiveViewOfType: vi.fn(() => null)
      }
    } as any;
    const handler = new PasteHandler(app, makePlugin(true));
    const file = new File(['image'], 'image.png', { type: 'image/png' });

    await expect(handler.processFiles([file], {} as any)).resolves.toBeUndefined();
    expect(app.workspace.getActiveViewOfType).toHaveBeenCalled();
  });
});
