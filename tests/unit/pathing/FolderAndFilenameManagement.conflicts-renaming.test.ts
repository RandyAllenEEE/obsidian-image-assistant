import { describe, it, expect, vi } from 'vitest';
import { FolderAndFilenameManagement } from '../../../src/local/FolderAndFilenameManagement';
import { VariableProcessor } from '../../../src/local/VariableProcessor';
import { SupportedImageFormats } from '../../../src/local/SupportedImageFormats';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import type { LocalConversionSettings, LocalFilenameSettings } from '../../../src/settings/types';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';

describe('FolderAndFilenameManagement conflicts and rename/convert skip rules', () => {
  function makeFFM() {
    const app = fakeApp({ vault: fakeVault() }) as any;
    const supported = new SupportedImageFormats(app);
    const vp = new VariableProcessor(app, { ...DEFAULT_SETTINGS } as any);
    const ffm = new FolderAndFilenameManagement(app, { ...DEFAULT_SETTINGS } as any, supported, vp);
    return { app, ffm };
  }

  it('3.13 increment conflict resolution appends numeric suffix', async () => {
    const { app, ffm } = makeFFM();
    // Simulate existing file "dir/name.png" and then ask for conflict resolution
    (app.vault.adapter.exists as any).mockResolvedValueOnce(true); // name.png exists
    ;(app.vault.adapter.exists as any)
      .mockResolvedValueOnce(true)   // name-1.png exists
      .mockResolvedValueOnce(false); // name-2.png available

    const final = await ffm.handleNameConflicts('dir', 'name.png', 'increment');
    expect(final).toBe('name-2.png');
  });

  it('3.14 reuse conflict mode returns base unchanged', async () => {
    const { ffm } = makeFFM();
    const final = await ffm.handleNameConflicts('dir', 'name.png', 'reuse');
    expect(final).toBe('name.png');
  });

  it('3.15 skip rename patterns respected', () => {
    const { ffm } = makeFFM();
    const preset: LocalFilenameSettings = { customTemplate: '{imagename}', skipRenamePatterns: '*.png,/^keep/', conflictResolution: 'increment' };
    expect(ffm.shouldSkipRename('photo.png', preset)).toBe(true);
    expect(ffm.shouldSkipRename('keep-this.jpg', preset)).toBe(true);
    expect(ffm.shouldSkipRename('other.gif', preset)).toBe(false);
  });

  it('3.16 skip conversion patterns respected', () => {
    const { ffm } = makeFFM();
    const conv: LocalConversionSettings = { ...DEFAULT_SETTINGS.localProcessing.conversion, skipConversionPatterns: 'r/\\.png$/' };
    expect(ffm.shouldSkipConversion('image.png', conv)).toBe(true);
    expect(ffm.shouldSkipConversion('image.jpg', conv)).toBe(false);
  });

  it('reports created and incremented files as created', async () => {
    const existing = fakeTFile({ path: 'dir/name.png', name: 'name.png', extension: 'png' });
    const app = fakeApp({ vault: fakeVault({ files: [existing] }) }) as any;
    const supported = new SupportedImageFormats(app);
    const ffm = new FolderAndFilenameManagement(
      app,
      structuredClone(DEFAULT_SETTINGS),
      supported,
      new VariableProcessor(app, structuredClone(DEFAULT_SETTINGS))
    );

    const result = await ffm.createUniqueBinaryDetailed('dir', 'name.png', new ArrayBuffer(2), 'increment');

    expect(result.disposition).toBe('created');
    expect(result.file?.path).toBe('dir/name-1.png');
  });

  it('advances the suffix after a create-time collision even when the vault cache is stale', async () => {
    const { app, ffm } = makeFFM();
    const created = fakeTFile({
      path: 'dir/name-1.png',
      name: 'name-1.png',
      extension: 'png'
    });
    app.vault.getAbstractFileByPath = vi.fn(() => null);
    app.vault.createBinary = vi.fn()
      .mockRejectedValueOnce(new Error('File already exists'))
      .mockResolvedValueOnce(created);

    const result = await ffm.createUniqueBinaryDetailed(
      'dir',
      'name.png',
      new ArrayBuffer(2),
      'increment'
    );

    expect(result).toEqual({ file: created, disposition: 'created' });
    expect(app.vault.createBinary).toHaveBeenNthCalledWith(
      1,
      'dir/name.png',
      expect.any(ArrayBuffer)
    );
    expect(app.vault.createBinary).toHaveBeenNthCalledWith(
      2,
      'dir/name-1.png',
      expect.any(ArrayBuffer)
    );
  });

  it('serializes overlapping increment candidates within one destination folder', async () => {
    const existing = fakeTFile({
      path: 'dir/name.png',
      name: 'name.png',
      extension: 'png'
    });
    const app = fakeApp({ vault: fakeVault({ files: [existing] }) }) as any;
    const supported = new SupportedImageFormats(app);
    const ffm = new FolderAndFilenameManagement(
      app,
      structuredClone(DEFAULT_SETTINGS),
      supported,
      new VariableProcessor(app, structuredClone(DEFAULT_SETTINGS))
    );
    const created = new Map<string, any>([[existing.path, existing]]);
    let activeCreates = 0;
    let maxActiveCreates = 0;
    app.vault.getAbstractFileByPath = vi.fn((targetPath: string) =>
      created.get(targetPath) ?? null
    );
    app.vault.createBinary = vi.fn(async (targetPath: string) => {
      activeCreates++;
      maxActiveCreates = Math.max(maxActiveCreates, activeCreates);
      await new Promise(resolve => setTimeout(resolve, 5));
      if (created.has(targetPath)) {
        activeCreates--;
        throw new Error('File already exists');
      }
      const file = fakeTFile({ path: targetPath });
      created.set(targetPath, file);
      activeCreates--;
      return file;
    });

    const [first, second] = await Promise.all([
      ffm.createUniqueBinaryDetailed(
        'dir',
        'name.png',
        new ArrayBuffer(1),
        'increment'
      ),
      ffm.createUniqueBinaryDetailed(
        'dir',
        'name-1.png',
        new ArrayBuffer(1),
        'increment'
      )
    ]);

    expect(maxActiveCreates).toBe(1);
    expect(new Set([first.file?.path, second.file?.path])).toEqual(
      new Set(['dir/name-1.png', 'dir/name-1-1.png'])
    );
  });

  it('returns the existing file without writing in reuse mode', async () => {
    const existing = fakeTFile({ path: 'dir/name.png', name: 'name.png', extension: 'png' });
    const { app, ffm } = makeFFM();
    (app.vault.getAbstractFileByPath as any).mockImplementation((path: string) => path === existing.path ? existing : null);

    const result = await ffm.createUniqueBinaryDetailed('dir', 'name.png', new ArrayBuffer(2), 'reuse');

    expect(result).toEqual({ file: existing, disposition: 'reused' });
    expect(app.vault.modifyBinary).not.toHaveBeenCalled();
    expect(app.vault.createBinary).not.toHaveBeenCalled();
  });

  it('returns skipped without writing in skip mode', async () => {
    const existing = fakeTFile({ path: 'dir/name.png', name: 'name.png', extension: 'png' });
    const { app, ffm } = makeFFM();
    (app.vault.getAbstractFileByPath as any).mockImplementation((path: string) => path === existing.path ? existing : null);

    const result = await ffm.createUniqueBinaryDetailed('dir', 'name.png', new ArrayBuffer(2), 'skip');

    expect(result).toEqual({ file: null, disposition: 'skipped' });
    expect(app.vault.modifyBinary).not.toHaveBeenCalled();
    expect(app.vault.createBinary).not.toHaveBeenCalled();
  });

  it('captures previous bytes when overwriting for undo', async () => {
    const previousData = new Uint8Array([1, 2, 3]).buffer;
    const nextData = new Uint8Array([4, 5]).buffer;
    const existing = fakeTFile({ path: 'dir/name.png', name: 'name.png', extension: 'png' });
    const app = fakeApp({ vault: fakeVault({ files: [existing], binaryContents: new Map([[existing.path, previousData]]) }) }) as any;
    const supported = new SupportedImageFormats(app);
    const ffm = new FolderAndFilenameManagement(
      app,
      structuredClone(DEFAULT_SETTINGS),
      supported,
      new VariableProcessor(app, structuredClone(DEFAULT_SETTINGS))
    );

    const result = await ffm.createUniqueBinaryDetailed(
      'dir',
      'name.png',
      nextData,
      'overwrite',
      { capturePreviousData: true }
    );

    expect(result.disposition).toBe('overwritten');
    expect(result.previousData).toEqual(previousData);
    expect(app.vault.modifyBinary).toHaveBeenCalledWith(existing, nextData);
  });

  it('rolls a case-safe rename back to the original path when the final rename fails', async () => {
    const file = fakeTFile({ path: 'assets/photo.png', name: 'photo.png', extension: 'png' });
    const { app, ffm } = makeFFM();
    let callCount = 0;
    app.fileManager.renameFile = vi.fn(async (target: any, targetPath: string) => {
      callCount++;
      target.path = targetPath;
      if (callCount === 2) throw new Error('destination busy');
    });
    app.vault.getAbstractFileByPath = vi.fn((targetPath: string) =>
      targetPath.includes('/temp-') ? file : null
    );

    const result = await ffm.safeRenameFile(file, 'assets/Photo.png');

    expect(result).toBe(false);
    expect(app.fileManager.renameFile).toHaveBeenCalledTimes(3);
    expect(app.fileManager.renameFile).toHaveBeenLastCalledWith(file, 'assets/photo.png');
    expect(file.path).toBe('assets/photo.png');
  });

  it('keeps the temporary rename component within the vault filename limit', async () => {
    const file = fakeTFile({
      path: 'assets/photo.png',
      name: 'photo.png',
      extension: 'png'
    });
    const { app, ffm } = makeFFM();
    app.fileManager.renameFile = vi.fn(async (target: any, targetPath: string) => {
      target.path = targetPath;
    });
    app.vault.getAbstractFileByPath = vi.fn(() => null);
    const longName = `${'测'.repeat(120)}.png`;

    expect(await ffm.safeRenameFile(file, `assets/${longName}`)).toBe(true);

    const temporaryPath = app.fileManager.renameFile.mock.calls[0][1] as string;
    const temporaryName = temporaryPath.slice(temporaryPath.lastIndexOf('/') + 1);
    expect(new TextEncoder().encode(temporaryName).byteLength).toBeLessThanOrEqual(240);
    expect(temporaryName.endsWith('.png')).toBe(true);
  });

  it('rejects unsafe filenames before creating a vault binary', async () => {
    const { app, ffm } = makeFFM();

    await expect(ffm.createUniqueBinaryDetailed('assets', '../outside.png', new ArrayBuffer(1)))
      .rejects.toThrow('Invalid vault filename');

    expect(app.vault.createBinary).not.toHaveBeenCalled();
  });
});
