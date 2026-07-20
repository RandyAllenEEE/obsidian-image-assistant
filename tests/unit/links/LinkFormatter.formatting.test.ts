import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LinkFormatter } from '../../../src/utils/LinkFormatter';
import type { LinkFormat, PathFormat } from '../../../src/settings/LinkFormatSettings';
import type { EmbedResizeSettings } from '../../../src/settings/NonDestructiveResizeSettings';
import { fakeApp, fakeTFile, fakeVault } from '../../factories/obsidian';
import { setMockImageSize } from '../../helpers/test-setup';

type NonDestructiveResizePreset = EmbedResizeSettings & { name?: string };

function makeFormatterWithFiles(paths: string[]) {
  const files = paths.map((pathStr) => fakeTFile({ path: pathStr, name: pathStr.split('/').pop()! }));
  const app = fakeApp({
    vault: fakeVault({ files }) as any,
    workspace: { getActiveFile: vi.fn(() => null) } as any,
  }) as any;
  // Provide getResourcePath used by LinkFormatter.getImageDimensions
  (app.vault as any).getResourcePath = vi.fn((tfile: any) => `app://local/${tfile.path}`);
  return { app, files, formatter: new LinkFormatter(app) };
}

describe('LinkFormatter.formatLink', () => {
  beforeEach(() => {
    setMockImageSize(100, 100);
  });

  it('5.1 Wikilink with absolute path: ![[/{path}]]', async () => {
    const { files, formatter } = makeFormatterWithFiles(['images/pic.png']);
    const result = await formatter.formatLink(
      files[0].path,
      'wikilink' as LinkFormat,
      'absolute' as PathFormat,
      null,
      null
    );
    expect(result).toBe('![[/images/pic.png]]');
  });

  it('5.2 Markdown with absolute path encodes spaces only', async () => {
    const { files, formatter } = makeFormatterWithFiles(['folder/My Image 1.png']);
    const res = await formatter.formatLink(
      files[0].path,
      'markdown',
      'absolute',
      null,
      null
    );
    expect(res).toBe('![](/folder/My%20Image%201.png)');
  });

  it('5.3 Absolute path starts with a leading slash', async () => {
    const { formatter, files } = makeFormatterWithFiles(['a/b/photo.png']);
    const out = await formatter.formatLink(files[0].path, 'wikilink', 'absolute', null, null);
    expect(out).toBe('![[/a/b/photo.png]]');
  });

  it('5.4 Relative path with same folder uses ./filename', async () => {
    const note = fakeTFile({ path: 'a/note.md' });
    const { files, formatter } = makeFormatterWithFiles(['a/image.png']);
    const out = await formatter.formatLink(files[0].path, 'wikilink', 'relative', note, null);
    expect(out).toBe('![[./image.png]]');
  });

  it('5.4 Relative path with parent folder uses ../', async () => {
    const note = fakeTFile({ path: 'notes/n.md' });
    const { formatter, files } = makeFormatterWithFiles(['images/pic.png']);
    const out = await formatter.formatLink(files[0].path, 'markdown', 'relative', note, null);
    expect(out).toBe('![](../images/pic.png)');
  });

  it('5.5 Shortest path uses only the filename', async () => {
    const { formatter, files } = makeFormatterWithFiles(['deep/path/photo.png']);
    const out = await formatter.formatLink(files[0].path, 'wikilink', 'shortest', null, null);
    expect(out).toBe('![[photo.png]]');
  });

  it('5.6 Spaces in markdown are encoded as %20', async () => {
    const { formatter, files } = makeFormatterWithFiles(['img/My Pic.png']);
    const out = await formatter.formatLink(files[0].path, 'markdown', 'absolute', null, null);
    expect(out).toBe('![](/img/My%20Pic.png)');
  });

  it('5.7 Spaces in wikilink are preserved', async () => {
    const { formatter, files } = makeFormatterWithFiles(['img/My Pic.png']);
    const out = await formatter.formatLink(files[0].path, 'wikilink', 'absolute', null, null);
    expect(out).toBe('![[/img/My Pic.png]]');
  });

  it('5.8 Reserved Markdown destination characters are encoded', async () => {
    const { formatter, files } = makeFormatterWithFiles(['img/p#ic(1).png']);
    const out = await formatter.formatLink(files[0].path, 'markdown', 'absolute', null, null);
    expect(out).toBe('![](/img/p%23ic%281%29.png)');
  });

  it('5.9 Width-only resize in wikilink appends |W', async () => {
    const { formatter, files } = makeFormatterWithFiles(['img/pic.png']);
    const preset: NonDestructiveResizePreset = {
      name: 'Width 50',
      resizeDimension: 'width',
      width: 50,
      resizeScaleMode: 'auto',
      resizeUnits: 'pixels',
    };
    setMockImageSize(100, 100);
    const out = await formatter.formatLink(files[0].path, 'wikilink', 'absolute', null, preset);
    expect(out).toBe('![[/img/pic.png|50]]');
  });

  it('5.10 Width-only resize in markdown uses alt text equal to |W', async () => {
    const { formatter, files } = makeFormatterWithFiles(['img/pic.png']);
    const preset: NonDestructiveResizePreset = {
      name: 'Width 40',
      resizeDimension: 'width',
      width: 40,
      resizeScaleMode: 'auto',
      resizeUnits: 'pixels',
    };
    setMockImageSize(100, 100);
    const out = await formatter.formatLink(files[0].path, 'markdown', 'absolute', null, preset);
    expect(out).toBe('![|40](/img/pic.png)');
  });

  it('5.11 No resize => empty alt for markdown', async () => {
    const { formatter, files } = makeFormatterWithFiles(['img/pic.png']);
    const out = await formatter.formatLink(files[0].path, 'markdown', 'absolute', null, null);
    expect(out).toBe('![](/img/pic.png)');
  });

  it('5.12 Output paths use forward slashes', async () => {
    const { formatter, files } = makeFormatterWithFiles(['folder/sub/p.png']);
    const out = await formatter.formatLink(files[0].path, 'wikilink', 'absolute', null, null);
    expect(out.startsWith('![[/')).toBe(true);
    expect(out.includes('\\')).toBe(false);
  });

  it('uses the width and height fields written by the Both settings UI', async () => {
    const { formatter, files } = makeFormatterWithFiles(['img/pic.png']);
    const preset: NonDestructiveResizePreset = {
      resizeDimension: 'both',
      width: 40,
      height: 30,
      resizeScaleMode: 'auto',
      resizeUnits: 'pixels',
    };

    const out = await formatter.formatLink(files[0].path, 'wikilink', 'absolute', null, preset);

    expect(out).toBe('![[/img/pic.png|40x30]]');
  });

  it('implements the Original Height option exposed by the settings UI', async () => {
    const { formatter, files } = makeFormatterWithFiles(['img/pic.png']);
    setMockImageSize(120, 80);
    const preset: NonDestructiveResizePreset = {
      resizeDimension: 'original-height',
      resizeScaleMode: 'auto',
      resizeUnits: 'pixels',
    };

    const out = await formatter.formatLink(files[0].path, 'markdown', 'absolute', null, preset);

    expect(out).toBe('![|x80](/img/pic.png)');
  });

  it('measures the explicitly supplied owner view without consulting the active leaf', () => {
    const { app, formatter } = makeFormatterWithFiles(['img/pic.png']);
    const contentDOM = document.createElement('div');
    Object.defineProperty(contentDOM, 'clientWidth', { value: 520 });
    const editor = {
      getValue: vi.fn(() => ''),
      cm: {
        contentDOM,
        dispatch: vi.fn(),
        state: {
          doc: {
            toString: () => ''
          }
        }
      }
    };
    const ownerView = {
      editor,
      contentEl: document.createElement('div')
    } as any;
    (app.workspace as any).getMostRecentLeaf = vi.fn(() => {
      throw new Error('active leaf must not be read');
    });

    expect(formatter.getEditorMaxWidth({ view: ownerView })).toBe(520);
    expect((app.workspace as any).getMostRecentLeaf).not.toHaveBeenCalled();
    expect(formatter.getEditorMaxWidth()).toBe(800);
  });
});
