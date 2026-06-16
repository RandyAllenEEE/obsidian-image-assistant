import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApp, fakeTFile, fakeVault, fakeWorkspace } from '../../../factories/obsidian';

const batchMocks = vi.hoisted(() => ({
  showBatchConfirmDialog: vi.fn(),
  computeMultiRefItems: vi.fn(),
  BatchExecutor: vi.fn().mockImplementation(() => ({
    execute: vi.fn(),
    showSummary: vi.fn()
  })),
  BatchProgressManager: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    setPhase: vi.fn(),
    complete: vi.fn(),
    cancel: vi.fn()
  }))
}));

vi.mock('../../../../src/utils/batch', () => ({
  BatchExecutor: batchMocks.BatchExecutor,
  BatchProgressManager: batchMocks.BatchProgressManager,
  showBatchConfirmDialog: batchMocks.showBatchConfirmDialog,
  computeMultiRefItems: batchMocks.computeMultiRefItems
}));

import { NoteBatchUploader } from '../../../../src/cloud/batch/NoteBatchUploader';

describe('NoteBatchUploader remote server mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('filters network images even if network uploads are enabled in saved settings', async () => {
    const note = fakeTFile({ path: 'note.md', name: 'note.md', extension: 'md' });
    const vault = fakeVault({
      files: [note],
      fileContents: new Map([
        [note.path, '![remote](https://example.com/image.png)']
      ])
    });
    const workspace = fakeWorkspace({ activeFile: note });
    const app = fakeApp({ vault, workspace }) as any;
    const plugin = {
      settings: {
        pasteHandling: {
          cloud: {
            remoteServerMode: true,
            workOnNetWork: true,
            uploadConcurrency: 3,
            newWorkBlackDomains: '',
            uploader: 'PicGo'
          }
        },
        captions: {
          enabled: false
        }
      },
      historyManager: {
        isUrlUploaded: vi.fn(() => false),
        addRecord: vi.fn()
      },
      vaultReferenceManager: {
        updateReferencesInFile: vi.fn(),
        updateReferences: vi.fn()
      },
      imageStateManager: null
    } as any;
    const uploader = new NoteBatchUploader(app, plugin);

    await uploader.uploadAllImages();

    expect(batchMocks.computeMultiRefItems).not.toHaveBeenCalled();
    expect(batchMocks.showBatchConfirmDialog).not.toHaveBeenCalled();
  });
});
