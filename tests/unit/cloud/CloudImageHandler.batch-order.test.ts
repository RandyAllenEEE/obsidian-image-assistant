import { describe, expect, it, vi } from 'vitest';
import { CloudImageHandler } from '../../../src/cloud/CloudImageHandler';
import { ConcurrentQueue } from '../../../src/utils/AsyncLock';
import { fakeTFile } from '../../factories/obsidian';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import { PicGoCoreUploader, PicGoUploader, UploaderManager } from '../../../src/cloud/uploader';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function makeHandler(upload: ReturnType<typeof vi.fn>) {
  const app = { vault: { adapter: {} } } as any;
  const plugin = {
    settings: { pasteHandling: { cloud: { remoteServerMode: true } } }
  } as any;
  return new CloudImageHandler(app, plugin, { upload } as any, new ConcurrentQueue(2));
}

describe('CloudImageHandler batch upload result ordering', () => {
  it('resolves the configured uploader again for each batch operation', async () => {
    const app = { vault: { adapter: {} } } as any;
    const plugin = { settings: structuredClone(DEFAULT_SETTINGS) } as any;
    const uploaderTypes: unknown[] = [];
    const uploadSpy = vi.spyOn(UploaderManager.prototype, 'upload')
      .mockImplementation(async function (this: UploaderManager) {
        uploaderTypes.push(this.uploader.constructor);
        return { success: true, result: ['https://cdn.example/image.png'], msg: '' };
      });
    const handler = new CloudImageHandler(app, plugin, null, new ConcurrentQueue(1));
    const file = fakeTFile({ path: 'images/a.png' });

    try {
      plugin.settings.pasteHandling.cloud.uploader = 'PicGo';
      await handler.batchUpload([file]);
      plugin.settings.pasteHandling.cloud.uploader = 'PicGo-Core';
      await handler.batchUpload([file]);
    } finally {
      uploadSpy.mockRestore();
    }

    expect(uploaderTypes).toEqual([PicGoUploader, PicGoCoreUploader]);
  });

  it('keeps successful results in input order even when uploads finish out of order', async () => {
    const first = deferred<any>();
    const a = fakeTFile({ path: 'images/a.png' });
    const b = fakeTFile({ path: 'images/b.png' });
    const upload = vi.fn((images: Array<{ path: string }>) => images[0].path === a.path
      ? first.promise
      : Promise.resolve({ success: true, result: ['https://cdn.example/b.png'] }));
    const pending = makeHandler(upload).batchUpload([a, b]);
    await vi.waitFor(() => expect(upload).toHaveBeenCalledTimes(2));

    first.resolve({ success: true, result: ['https://cdn.example/a.png'] });
    const result = await pending;

    expect(result.successful.map(item => item.item)).toEqual([a, b]);
    expect(result.successful.map(item => item.output)).toEqual([
      'https://cdn.example/a.png',
      'https://cdn.example/b.png'
    ]);
    expect(upload).toHaveBeenCalledWith([expect.objectContaining({ path: a.path, file: a })]);
    expect(upload).toHaveBeenCalledWith([expect.objectContaining({ path: b.path, file: b })]);
  });

  it('treats a nominally successful upload with no URL as failed', async () => {
    const file = fakeTFile({ path: 'images/a.png' });
    const upload = vi.fn(async () => ({ success: true, result: [] }));

    const result = await makeHandler(upload).batchUpload([file]);

    expect(result.successful).toEqual([]);
    expect(result.failed).toEqual([
      expect.objectContaining({ item: file, error: 'Upload returned no URL' })
    ]);
  });
});
