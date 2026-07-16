import { describe, expect, it, vi } from 'vitest';
import { LocalProcessMode } from '../../../../../../src/ui/modals/batch/modes/LocalProcessMode';
import { DEFAULT_SETTINGS } from '../../../../../../src/settings/defaults';
import { fakeApp, fakeMetadataCache, fakeTFile, fakeVault } from '../../../../../factories/obsidian';

describe('LocalProcessMode Markdown contexts', () => {
  it('discovers callout and ad-* image files without selecting source-only code samples', async () => {
    const note = fakeTFile({ path: 'notes/current.md', name: 'current.md', extension: 'md' });
    const callout = fakeTFile({ path: 'images/callout.png', name: 'callout.png', extension: 'png' });
    const legacy = fakeTFile({ path: 'images/legacy.webp', name: 'legacy.webp', extension: 'webp' });
    const code = fakeTFile({ path: 'images/code.png', name: 'code.png', extension: 'png' });
    const metadataCache = fakeMetadataCache();
    metadataCache.getFirstLinkpathDest = vi.fn((link: string) => ({
      'images/callout.png': callout,
      'images/legacy.webp': legacy,
      'images/code.png': code
    }[link] ?? null)) as any;
    const app = fakeApp({
      vault: fakeVault({
        files: [note, callout, legacy, code],
        fileContents: new Map([[note.path, [
          '> [!note]',
          '> ![[images/callout.png|Callout]]',
          '```ad-tip',
          '![[images/legacy.webp|Legacy]]',
          '```',
          '```markdown',
          '![[images/code.png|Code]]',
          '```'
        ].join('\n')]])
      }),
      metadataCache
    }) as any;
    const plugin = {
      settings: structuredClone(DEFAULT_SETTINGS),
      supportedImageFormats: {
        isSupported: vi.fn((_extension?: string, name?: string) => /\.(png|webp)$/i.test(name ?? ''))
      },
      localImageHandler: {
        processSingleFile: vi.fn()
      }
    } as any;
    plugin.settings.global.codeBlockImageLinkIndexing = false;

    const { tasks } = await new LocalProcessMode(app, plugin, note, 'note').loadTasks();

    expect(tasks.map(task => task.path).sort()).toEqual([callout.path, legacy.path].sort());
  });
});
