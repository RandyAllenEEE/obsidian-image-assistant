import { describe, it, expect } from 'vitest';
import { FolderAndFilenameManagement } from '../../../src/local/FolderAndFilenameManagement';
import { VariableProcessor } from '../../../src/local/VariableProcessor';
import { SupportedImageFormats } from '../../../src/local/SupportedImageFormats';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import type { LocalConversionSettings, LocalFilenameSettings } from '../../../src/settings/types';
import { fakeApp, fakeVault } from '../../factories/obsidian';

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
});
