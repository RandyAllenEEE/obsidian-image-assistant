import { describe, expect, it, vi } from 'vitest';
import { LocalProcessMode } from '../../../src/ui/modals/batch/modes/LocalProcessMode';
import { UnifiedBatchProcessModal } from '../../../src/ui/modals/UnifiedBatchProcessModal';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';

function makePlugin() {
  return {
    settings: structuredClone(DEFAULT_SETTINGS),
    saveSettings: vi.fn().mockResolvedValue(undefined),
    supportedImageFormats: {
      isSupported: vi.fn((_mime?: string, name?: string) => /\.(png|jpe?g|webp)$/i.test(name || ''))
    },
    batchImageProcessor: {
      batchProcess: vi.fn(async (files: any[]) => ({
        successful: files.map(file => ({ success: true, item: file })),
        failed: [],
        cancelled: false
      }))
    },
    cloudImageHandler: {},
  } as any;
}

describe('Vault-scope batch modal/current mode behavior', () => {
  it('LocalProcessMode loads all supported vault image tasks', async () => {
    const files = [
      fakeTFile({ path: 'a.png', name: 'a.png', extension: 'png' }),
      fakeTFile({ path: 'b.md', name: 'b.md', extension: 'md' }),
      fakeTFile({ path: 'c.webp', name: 'c.webp', extension: 'webp' })
    ];
    const app = fakeApp({ vault: fakeVault({ files }) }) as any;
    const mode = new LocalProcessMode(app, makePlugin(), null, 'vault');

    const tasks = await mode.loadTasks();

    expect(tasks.map(task => task.path)).toEqual(['a.png', 'c.webp']);
  });

  it('UnifiedBatchProcessModal renders vault scope and local processing controls', async () => {
    const app = fakeApp({ vault: fakeVault({ files: [] }) }) as any;
    const plugin = makePlugin();
    const modal = new UnifiedBatchProcessModal(app, plugin, 'vault', null, 'local_process');

    modal.onOpen();
    await Promise.resolve();

    expect(modal.contentEl.querySelector('.batch-modal-header')?.textContent?.toLowerCase()).toContain('vault');
    expect(modal.contentEl.querySelector('.batch-settings-container')).toBeTruthy();
    expect(modal.contentEl.querySelector('.batch-task-list')).toBeTruthy();
  });
});
