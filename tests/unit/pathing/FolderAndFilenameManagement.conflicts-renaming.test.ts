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

  it('rejects unsafe filenames before creating a vault binary', async () => {
    const { app, ffm } = makeFFM();

    await expect(ffm.createUniqueBinaryDetailed('assets', '../outside.png', new ArrayBuffer(1)))
      .rejects.toThrow('Invalid vault filename');

    expect(app.vault.createBinary).not.toHaveBeenCalled();
  });
});
