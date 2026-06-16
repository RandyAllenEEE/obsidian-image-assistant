import { describe, expect, it, beforeEach, vi } from 'vitest';
import { EditorContentInserter } from '../../../src/utils/EditorContentInserter';

describe('EditorContentInserter', () => {
  let editor: any;
  let inserter: EditorContentInserter;
  const cursor = { line: 5, ch: 10 };

  beforeEach(() => {
    editor = {
      getCursor: vi.fn().mockReturnValue(cursor),
      replaceRange: vi.fn(),
      setCursor: vi.fn(),
      lineCount: vi.fn().mockReturnValue(10),
      getLine: vi.fn().mockReturnValue('01234567890123456789')
    };
    inserter = new EditorContentInserter({ editor } as any);
  });

  it('caches the cursor at construction time', () => {
    expect(editor.getCursor).toHaveBeenCalledTimes(1);
    editor.getCursor.mockReturnValue({ line: 100, ch: 0 });

    inserter.insertLoadingText('loading...');

    expect(editor.replaceRange).toHaveBeenCalledWith('loading...', cursor);
  });

  it('inserts loading text and moves the cursor after the placeholder', () => {
    inserter.insertLoadingText('...');

    expect(editor.replaceRange).toHaveBeenCalledWith('...', cursor);
    expect(editor.setCursor).toHaveBeenCalledWith({ line: 5, ch: 13 });
  });

  it('replaces the placeholder with the final response', () => {
    inserter.insertLoadingText('...');
    inserter.insertResponseToEditor('$x^2$');

    expect(editor.replaceRange).toHaveBeenLastCalledWith('$x^2$', cursor, { line: 5, ch: 13 });
  });

  it('removes loading text using the cached placeholder range', () => {
    inserter.insertLoadingText('...');
    inserter.removeLoadingText();

    expect(editor.replaceRange).toHaveBeenLastCalledWith('', cursor, { line: 5, ch: 13 });
  });

  it('does not write if the cached cursor line no longer exists', () => {
    editor.lineCount.mockReturnValue(2);

    inserter.insertResponseToEditor('ignored');

    expect(editor.replaceRange).not.toHaveBeenCalled();
  });

  it('does not write if the cached cursor column is now out of bounds', () => {
    editor.getLine.mockReturnValue('short');

    inserter.insertResponseToEditor('ignored');

    expect(editor.replaceRange).not.toHaveBeenCalled();
  });
});
