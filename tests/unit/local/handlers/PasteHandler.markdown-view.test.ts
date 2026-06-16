import { describe, expect, it, vi } from 'vitest';
import { PasteHandler } from '../../../../src/local/handlers/PasteHandler';
import { fakeTFile } from '../../../factories/obsidian';

function makePlugin() {
  return {
    settings: {
      captions: { enabled: false },
      localProcessing: {}
    }
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
});
