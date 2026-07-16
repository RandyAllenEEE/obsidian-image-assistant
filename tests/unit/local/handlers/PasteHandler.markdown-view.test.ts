import { describe, expect, it, vi } from 'vitest';
import { PasteHandler } from '../../../../src/local/handlers/PasteHandler';
import { fakeTFile } from '../../../factories/obsidian';

function makePlugin() {
  return {
    settings: {
      captions: { enabled: false },
      localProcessing: {},
      pasteHandling: { neverProcessFilenames: '' }
    },
    supportedImageFormats: { isSupported: vi.fn(() => true) },
    folderAndFilenameManagement: { matchesPatterns: vi.fn(() => false) }
  } as any;
}

describe('Local PasteHandler Markdown view guard', () => {
  it('returns without throwing when there is an active file but no Markdown view', async () => {
    const app = {
      workspace: {
        getActiveFile: vi.fn(() => fakeTFile({ path: 'note.md', name: 'note.md' })),
        getActiveViewOfType: vi.fn(() => null)
      }
    } as any;
    const handler = new PasteHandler(app, makePlugin());
    const file = new File(['image'], 'image.png', { type: 'image/png' });

    await expect(handler.processFiles([file], {} as any)).resolves.toBeUndefined();
    expect(app.workspace.getActiveViewOfType).toHaveBeenCalled();
  });

  it('does not consume native image paste without a writable Markdown view', async () => {
    const app = {
      workspace: {
        getActiveFile: vi.fn(() => fakeTFile({ path: 'note.md', name: 'note.md' })),
        getActiveViewOfType: vi.fn(() => null)
      }
    } as any;
    const handler = new PasteHandler(app, makePlugin());
    const processFiles = vi.spyOn(handler, 'processFiles').mockResolvedValue(undefined);
    const evt = {
      clipboardData: {
        items: [{ kind: 'file', type: 'image/png', getAsFile: () => new File(['image'], 'image.png', { type: 'image/png' }) }]
      },
      preventDefault: vi.fn()
    } as any as ClipboardEvent;

    await handler.handlePaste(evt, {} as any);

    expect(evt.preventDefault).not.toHaveBeenCalled();
    expect(processFiles).not.toHaveBeenCalled();
  });

  it('lets Obsidian handle a clipboard containing both supported and unsupported files', async () => {
    const app = {
      workspace: {
        getActiveFile: vi.fn(() => fakeTFile({ path: 'note.md', name: 'note.md' })),
        getActiveViewOfType: vi.fn(() => ({ editor: {} }))
      }
    } as any;
    const plugin = makePlugin();
    plugin.supportedImageFormats.isSupported.mockImplementation((type: string) => type.startsWith('image/'));
    const handler = new PasteHandler(app, plugin);
    const processFiles = vi.spyOn(handler, 'processFiles').mockResolvedValue(undefined);
    const evt = {
      clipboardData: {
        items: [
          { kind: 'file', type: 'image/png', getAsFile: () => new File(['image'], 'image.png', { type: 'image/png' }) },
          { kind: 'file', type: 'application/pdf', getAsFile: () => new File(['pdf'], 'document.pdf', { type: 'application/pdf' }) }
        ]
      },
      preventDefault: vi.fn()
    } as any as ClipboardEvent;

    await handler.handlePaste(evt, {} as any);

    expect(evt.preventDefault).not.toHaveBeenCalled();
    expect(processFiles).not.toHaveBeenCalled();
  });
});
