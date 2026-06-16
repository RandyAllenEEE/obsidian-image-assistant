import { describe, it, expect } from 'vitest';
import { FolderAndFilenameManagement } from '../../../src/local/FolderAndFilenameManagement';
import { VariableProcessor } from '../../../src/local/VariableProcessor';
import { SupportedImageFormats } from '../../../src/local/SupportedImageFormats';
import { DEFAULT_SETTINGS } from '../../../src/settings/defaults';
import type { LocalDestinationSettings, LocalFilenameSettings } from '../../../src/settings/types';
import { fakeApp, fakeVault, fakeTFile } from '../../factories/obsidian';

describe('FolderAndFilenameManagement.validateTemplates delegates to VariableProcessor and throws on invalid', () => {
  it('3.23 throws Error and shows Notice when validation fails', async () => {
    const app = fakeApp({ vault: fakeVault() }) as any;
    const supported = new SupportedImageFormats(app);
    const settings = { ...DEFAULT_SETTINGS } as any;
    const vp = new VariableProcessor(app, settings);
    const ffm = new FolderAndFilenameManagement(app, settings, supported, vp);

    const activeRoot = fakeTFile({ path: 'Root.md', name: 'Root.md', basename: 'Root', parent: { path: '/', name: '/', parent: null, children: [] } as any });
    const file = new File([new Uint8Array([1])], 'x.png', { type: 'image/png' });
    const fname: LocalFilenameSettings = { customTemplate: '{imagename}', skipRenamePatterns: '', conflictResolution: 'increment' };
    const folder: LocalDestinationSettings = { type: 'CUSTOM', customTemplate: 'x/{grandparentfolder}' };

    await expect(ffm.determineDestination(file, activeRoot as any, settings.localProcessing.conversion, fname, folder)).rejects.toThrow(/validation failed/i);
  });
});
