import { describe, expect, it, vi } from 'vitest';
import { ImageMatchFinder } from '../../../../src/ui/contextMenu/utils/ImageMatchFinder';
import { fakeApp, fakeTFile, fakeWorkspace } from '../../../factories/obsidian';

function makeEditor(lines: string[]) {
  return {
    getDoc: () => ({
      lineCount: () => lines.length
    }),
    getLine: (line: number) => lines[line]
  } as any;
}

describe('ImageMatchFinder', () => {
  it('matches basename links only on path segment boundaries', async () => {
    const note = fakeTFile({ path: 'notes/note.md', name: 'note.md' });
    const app = fakeApp({
      workspace: fakeWorkspace({ activeFile: note }),
    }) as any;
    app.metadataCache.getFirstLinkpathDest = vi.fn(() => null);
    const finder = new ImageMatchFinder(app);
    const editor = makeEditor(['![[image.png]]']);

    await expect(finder.findImageMatches(editor, 'assets/image.png', false)).resolves.toHaveLength(1);
    await expect(finder.findImageMatches(editor, 'assets/notimage.png', false)).resolves.toHaveLength(0);
  });

  it('uses metadataCache link resolution before fallback path heuristics', async () => {
    const note = fakeTFile({ path: 'notes/note.md', name: 'note.md' });
    const resolved = fakeTFile({ path: 'assets/exact.png', name: 'exact.png', extension: 'png' });
    const app = fakeApp({
      workspace: fakeWorkspace({ activeFile: note }),
    }) as any;
    app.metadataCache.getFirstLinkpathDest = vi.fn(() => resolved);
    const finder = new ImageMatchFinder(app);
    const editor = makeEditor(['![[same-name.png]]']);

    await expect(finder.findImageMatches(editor, 'assets/exact.png', false)).resolves.toEqual([
      {
        lineNumber: 0,
        line: '![[same-name.png]]',
        fullMatch: '![[same-name.png]]',
        index: 0,
      }
    ]);
    await expect(finder.findImageMatches(editor, 'assets/same-name.png', false)).resolves.toHaveLength(0);
  });

  it('matches external image URLs when the DOM src is percent-encoded but Markdown keeps angle-wrapped spaces', async () => {
    const note = fakeTFile({ path: 'notes/note.md', name: 'note.md' });
    const app = fakeApp({
      workspace: fakeWorkspace({ activeFile: note }),
    }) as any;
    const finder = new ImageMatchFinder(app);
    const line = '![remote](<https://cdn.example.com/my photo.png?size=large>)';
    const editor = makeEditor([line]);

    await expect(
      finder.findImageMatches(editor, 'https://cdn.example.com/my%20photo.png?size=large', true)
    ).resolves.toEqual([
      {
        lineNumber: 0,
        line,
        fullMatch: line,
        index: 0,
      }
    ]);
  });

  it('does not collapse external image URLs with different query strings', async () => {
    const note = fakeTFile({ path: 'notes/note.md', name: 'note.md' });
    const app = fakeApp({
      workspace: fakeWorkspace({ activeFile: note }),
    }) as any;
    const finder = new ImageMatchFinder(app);
    const editor = makeEditor(['![remote](https://cdn.example.com/photo.png?version=1)']);

    await expect(
      finder.findImageMatches(editor, 'https://cdn.example.com/photo.png?version=2', true)
    ).resolves.toHaveLength(0);
  });

  it('matches rendered Admonition links but ignores an identical code sample', async () => {
    const note = fakeTFile({ path: 'notes/note.md', name: 'note.md' });
    const app = fakeApp({ workspace: fakeWorkspace({ activeFile: note }) }) as any;
    const finder = new ImageMatchFinder(app);
    const url = 'https://cdn.example.com/photo.png';
    const editor = makeEditor([
      '```markdown',
      `![Code](${url})`,
      '```',
      '```ad-note',
      `![Admonition](${url})`,
      '```'
    ]);

    await expect(finder.findImageMatches(editor, url, true)).resolves.toEqual([
      {
        lineNumber: 4,
        line: `![Admonition](${url})`,
        fullMatch: `![Admonition](${url})`,
        index: 0
      }
    ]);
  });

  it('processes base64 img tags when src is not the first attribute and uses single quotes', async () => {
    const note = fakeTFile({ path: 'notes/note.md', name: 'note.md' });
    const app = fakeApp({
      workspace: fakeWorkspace({ activeFile: note }),
    }) as any;
    const finder = new ImageMatchFinder(app);
    const src = 'data:image/png;base64,abc123';
    const line = `before <img alt="demo" class="embedded" src='${src}' /> after`;
    const editor = makeEditor([line]);
    const processor = vi.fn().mockResolvedValue(undefined);

    const found = await finder.processBase64Image(editor, src, processor);

    expect(found).toBe(true);
    expect(processor).toHaveBeenCalledWith(
      editor,
      0,
      line,
      `<img alt="demo" class="embedded" src='${src}' />`
    );
  });

  it('does not process a base64 img tag with a different src', async () => {
    const note = fakeTFile({ path: 'notes/note.md', name: 'note.md' });
    const app = fakeApp({
      workspace: fakeWorkspace({ activeFile: note }),
    }) as any;
    const finder = new ImageMatchFinder(app);
    const editor = makeEditor(['<img src="data:image/png;base64,other" />']);
    const processor = vi.fn().mockResolvedValue(undefined);

    const found = await finder.processBase64Image(editor, 'data:image/png;base64,target', processor);

    expect(found).toBe(false);
    expect(processor).not.toHaveBeenCalled();
  });
});
