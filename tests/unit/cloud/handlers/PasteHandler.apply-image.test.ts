import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PasteHandler } from '../../../../src/cloud/handlers/PasteHandler';
import { fakeTFile } from '../../../factories/obsidian';

const uploadByClipboardMock = vi.hoisted(() => vi.fn());
const uploadMock = vi.hoisted(() => vi.fn());

vi.mock('../../../../src/cloud/uploader/index', () => ({
  UploaderManager: class {
    uploadByClipboard = uploadByClipboardMock;
    upload = uploadMock;
  }
}));

class MemoryEditor {
  value = '';
  cursor = { line: 0, ch: 0 };
  selectionFrom: { line: number; ch: number } | null = null;
  selectionTo: { line: number; ch: number } | null = null;

  getCursor(which?: "from" | "to") {
    if (which === "from" && this.selectionFrom) return { ...this.selectionFrom };
    if (which === "to" && this.selectionTo) return { ...this.selectionTo };
    return { ...this.cursor };
  }
  setCursor(position: { line: number; ch: number }) {
    this.cursor = { ...position };
    this.selectionFrom = null;
    this.selectionTo = null;
  }
  lineCount() { return this.value.split('\n').length; }
  getLine(line: number) { return this.value.split('\n')[line] ?? ''; }
  posToOffset(position: { line: number; ch: number }) {
    const lines = this.value.split('\n');
    return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
  }
  offsetToPos(offset: number) {
    const before = this.value.slice(0, offset).split('\n');
    return { line: before.length - 1, ch: before.at(-1)?.length ?? 0 };
  }
  getRange(from: { line: number; ch: number }, to: { line: number; ch: number }) {
    return this.value.slice(this.posToOffset(from), this.posToOffset(to));
  }
  replaceRange(text: string, from: { line: number; ch: number }, to = from) {
    const start = this.posToOffset(from);
    const end = this.posToOffset(to);
    this.value = `${this.value.slice(0, start)}${text}${this.value.slice(end)}`;
  }
}

function makePlugin(applyImage: boolean, overrides: Record<string, unknown> = {}) {
  return {
    settings: {
      pasteHandling: {
        neverProcessFilenames: '',
        cloud: {
          applyImage,
          remoteServerMode: false,
          workOnNetWork: false,
          newWorkBlackDomains: '',
          ...overrides
        }
      }
    },
    supportedImageFormats: {
      isSupported: vi.fn(() => true)
    },
    folderAndFilenameManagement: {
      matchesPatterns: vi.fn(() => false)
    }
  } as any;
}

function makeClipboardEvent(text: string) {
  const file = new File(['image'], 'image.png', { type: 'image/png' });
  return {
    clipboardData: {
      items: [
        {
          kind: 'file',
          type: 'image/png',
          getAsFile: () => file
        }
      ],
      getData: vi.fn((type: string) => {
        if (type === 'text/plain' || type === 'text') return text;
        return '';
      })
    },
    preventDefault: vi.fn()
  } as any as ClipboardEvent;
}

function makeWritableApp() {
  return {
    workspace: {
      getActiveFile: vi.fn(() => fakeTFile({ path: 'note.md', name: 'note.md' })),
      getActiveViewOfType: vi.fn(() => ({ editor: {} }))
    }
  } as any;
}

function makeContext(editor: unknown) {
  return {
    editor,
    file: fakeTFile({
      path: 'notes/owner.md',
      name: 'owner.md',
      extension: 'md'
    }),
    view: null,
    ownerDocument: document
  } as any;
}

describe('Cloud PasteHandler applyImage behavior', () => {
  beforeEach(() => {
    uploadByClipboardMock.mockReset();
    uploadMock.mockReset();
  });

  it('ignores paste events already handled by another plugin', async () => {
    const handler = new PasteHandler(makeWritableApp(), makePlugin(true));
    const processFiles = vi.spyOn(handler, 'processFiles').mockResolvedValue(undefined);
    const evt = {
      ...makeClipboardEvent('plain text next to image'),
      defaultPrevented: true
    } as any as ClipboardEvent;

    const editor = {} as any;
    await handler.handlePaste(evt, editor, makeContext(editor));

    expect(evt.preventDefault).not.toHaveBeenCalled();
    expect(processFiles).not.toHaveBeenCalled();
  });

  it('does not intercept mixed text and image clipboard content when applyImage is disabled', async () => {
    const handler = new PasteHandler(makeWritableApp(), makePlugin(false));
    const processFiles = vi.spyOn(handler, 'processFiles').mockResolvedValue(undefined);
    const evt = makeClipboardEvent('plain text next to image');

    await handler.handlePaste(evt, {} as any);

    expect(evt.preventDefault).not.toHaveBeenCalled();
    expect(processFiles).not.toHaveBeenCalled();
  });

  it('does not intercept mixed supported and unsupported file items', async () => {
    const plugin = makePlugin(true);
    plugin.supportedImageFormats.isSupported.mockImplementation((type: string) => type.startsWith('image/'));
    const handler = new PasteHandler(makeWritableApp(), plugin);
    const processFiles = vi.spyOn(handler, 'processFiles').mockResolvedValue(undefined);
    const evt = makeClipboardEvent('');
    (evt.clipboardData!.items as any) = [
      { kind: 'file', type: 'image/png', getAsFile: () => new File(['image'], 'image.png', { type: 'image/png' }) },
      { kind: 'file', type: 'application/pdf', getAsFile: () => new File(['pdf'], 'document.pdf', { type: 'application/pdf' }) }
    ];

    await handler.handlePaste(evt, {} as any);

    expect(evt.preventDefault).not.toHaveBeenCalled();
    expect(processFiles).not.toHaveBeenCalled();
  });

  it('uploads mixed text and image clipboard content when applyImage is enabled', async () => {
    const handler = new PasteHandler(makeWritableApp(), makePlugin(true));
    const processFiles = vi.spyOn(handler, 'processFiles').mockResolvedValue(undefined);
    const evt = makeClipboardEvent('plain text next to image');
    const editor = {} as any;

    await handler.handlePaste(evt, editor, makeContext(editor));

    expect(evt.preventDefault).toHaveBeenCalledTimes(1);
    expect(processFiles).toHaveBeenCalledTimes(1);
  });

  it('does not upload network image links while remote server mode is enabled', async () => {
    const handler = new PasteHandler({} as any, makePlugin(true, {
      remoteServerMode: true,
      workOnNetWork: true
    }));
    const evt = { preventDefault: vi.fn() } as any as ClipboardEvent;
    const editor = { replaceRange: vi.fn() } as any;

    await handler.handlePasteText('![remote](https://example.com/image.png)', editor, { line: 0, ch: 0 }, evt);

    expect(evt.preventDefault).not.toHaveBeenCalled();
    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('inserts network Markdown immediately and replaces it after upload', async () => {
    let finishUpload!: (value: unknown) => void;
    uploadMock.mockReturnValueOnce(new Promise(resolve => {
      finishUpload = resolve;
    }));
    const editor = new MemoryEditor();
    const plugin = makePlugin(true, { workOnNetWork: true });
    const handler = new PasteHandler(makeWritableApp(), plugin);
    const source = 'Before ![caption|500](https://example.com/image.png "Title") after';
    const evt = { defaultPrevented: false, preventDefault: vi.fn() } as any as ClipboardEvent;

    const pending = handler.handlePasteText(
      source,
      editor as any,
      { line: 0, ch: 0 },
      evt,
      makeContext(editor)
    );

    expect(evt.preventDefault).toHaveBeenCalledOnce();
    expect(editor.value).toBe(source);

    finishUpload({
      success: true,
      result: ['https://cdn.example.com/uploaded.webp']
    });
    await pending;

    expect(editor.value).toBe(
      'Before ![caption|500](https://cdn.example.com/uploaded.webp "Title") after'
    );
  });

  it('replaces the current selection before tracking uploaded network links', async () => {
    uploadMock.mockResolvedValueOnce({
      success: true,
      result: ['https://cdn.example.com/uploaded.webp']
    });
    const editor = new MemoryEditor();
    editor.value = 'Before remove-me after';
    editor.selectionFrom = { line: 0, ch: 7 };
    editor.selectionTo = { line: 0, ch: 16 };
    editor.cursor = { line: 0, ch: 16 };
    const plugin = makePlugin(true, { workOnNetWork: true });
    const handler = new PasteHandler(makeWritableApp(), plugin);
    const source = '![caption](https://example.com/image.png)';
    const evt = {
      defaultPrevented: false,
      preventDefault: vi.fn()
    } as any as ClipboardEvent;

    await handler.handlePasteText(
      source,
      editor as any,
      editor.getCursor(),
      evt,
      makeContext(editor)
    );

    expect(editor.value).toBe(
      'Before ![caption](https://cdn.example.com/uploaded.webp) after'
    );
  });

  it('keeps failed network links while replacing other occurrences in order', async () => {
    uploadMock
      .mockResolvedValueOnce({
        success: true,
        result: ['https://cdn.example.com/first.webp']
      })
      .mockRejectedValueOnce(new Error('second failed'));
    const editor = new MemoryEditor();
    const plugin = makePlugin(true, { workOnNetWork: true });
    const handler = new PasteHandler(makeWritableApp(), plugin);
    const first = '![first|left|320](https://example.com/same.png)';
    const second = '![second](https://example.com/same.png "Keep title")';
    const evt = { defaultPrevented: false, preventDefault: vi.fn() } as any as ClipboardEvent;

    await handler.handlePasteText(
      `${first}\n${second}`,
      editor as any,
      { line: 0, ch: 0 },
      evt,
      makeContext(editor)
    );

    expect(editor.value).toBe(
      `![first|left|320](https://cdn.example.com/first.webp)\n${second}`
    );
  });

  it('returns without throwing when there is an active file but no Markdown view', async () => {
    const app = {
      workspace: {
        getActiveFile: vi.fn(() => fakeTFile({ path: 'note.md', name: 'note.md' })),
        getActiveViewOfType: vi.fn(() => null)
      }
    } as any;
    const handler = new PasteHandler(app, makePlugin(true));
    const file = new File(['image'], 'image.png', { type: 'image/png' });

    await expect(handler.processFiles([file], {} as any)).resolves.toBeUndefined();
    expect(app.workspace.getActiveViewOfType).not.toHaveBeenCalled();
  });

  it('inserts multiple uploaded links in clipboard order without nesting placeholders', async () => {
    uploadByClipboardMock
      .mockResolvedValueOnce({ success: true, result: ['https://cdn.example/first.png'] })
      .mockResolvedValueOnce({ success: true, result: ['https://cdn.example/second.png'] });
    const editor = new MemoryEditor();
    const view = { editor };
    const app = {
      workspace: {
        getActiveFile: vi.fn(() => fakeTFile({ path: 'note.md', name: 'note.md' })),
        getActiveViewOfType: vi.fn(() => view)
      }
    } as any;
    const plugin = makePlugin(true);
    plugin.settings.captions = { enabled: false };
    plugin.settings.pasteHandling.cloud.cloudLinkFormat = 'markdown';
    const files = [
      new File(['first'], 'first.png', { type: 'image/png' }),
      new File(['second'], 'second.png', { type: 'image/png' })
    ];

    await new PasteHandler(app, plugin).processFiles(
      files,
      editor as any,
      makeContext(editor)
    );

    expect(editor.value).toBe('![ ](https://cdn.example/first.png)![ ](https://cdn.example/second.png)');
    expect(editor.cursor.ch).toBe(editor.value.length);
  });

  it('continues at the correct insertion point when an earlier upload fails', async () => {
    uploadByClipboardMock
      .mockRejectedValueOnce(new Error('first failed'))
      .mockResolvedValueOnce({ success: true, result: ['https://cdn.example/second.png'] });
    const editor = new MemoryEditor();
    const view = { editor };
    const app = {
      workspace: {
        getActiveFile: vi.fn(() => fakeTFile({ path: 'note.md', name: 'note.md' })),
        getActiveViewOfType: vi.fn(() => view)
      }
    } as any;
    const plugin = makePlugin(true);
    plugin.settings.captions = { enabled: false };
    plugin.settings.pasteHandling.cloud.cloudLinkFormat = 'markdown';

    await new PasteHandler(app, plugin).processFiles([
      new File(['first'], 'first.png', { type: 'image/png' }),
      new File(['second'], 'second.png', { type: 'image/png' })
    ], editor as any, makeContext(editor));

    expect(editor.value).toBe('![ ](https://cdn.example/second.png)');
    expect(editor.cursor.ch).toBe(editor.value.length);
  });
});
