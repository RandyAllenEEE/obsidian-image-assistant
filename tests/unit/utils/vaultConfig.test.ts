import { describe, expect, it, vi } from 'vitest';
import { getVaultConfigBoolean, getVaultConfigString } from '../../../src/utils/vaultConfig';

describe('vaultConfig helpers', () => {
  it('returns defaults when vault.getConfig is unavailable', () => {
    const app = { vault: {} } as any;

    expect(getVaultConfigString(app, 'attachmentFolderPath', 'assets')).toBe('assets');
    expect(getVaultConfigBoolean(app, 'nativeMenus', true)).toBe(true);
  });

  it('returns defaults when vault.getConfig throws', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = {
      vault: {
        getConfig: vi.fn(() => {
          throw new Error('config unavailable');
        })
      }
    } as any;

    expect(getVaultConfigString(app, 'attachmentFolderPath', 'assets')).toBe('assets');
    expect(getVaultConfigBoolean(app, 'nativeMenus', false)).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('returns typed vault config values when available', () => {
    const app = {
      vault: {
        getConfig: vi.fn((key: string) => key === 'nativeMenus' ? true : 'attachments')
      }
    } as any;

    expect(getVaultConfigString(app, 'attachmentFolderPath', 'assets')).toBe('attachments');
    expect(getVaultConfigBoolean(app, 'nativeMenus', false)).toBe(true);
  });
});
