import { describe, expect, it, vi } from 'vitest';
import { EditorLinkRemover } from '../../../../src/ui/contextMenu/utils/EditorLinkRemover';

describe('EditorLinkRemover', () => {
  it('removes the exact indexed occurrence when a line contains repeated identical image links', async () => {
    const remover = new EditorLinkRemover();
    const editor = {
      replaceRange: vi.fn()
    } as any;
    const fullMatch = '![alt](imgs/a.png)';
    const line = `${fullMatch} and ${fullMatch}`;
    const secondIndex = line.lastIndexOf(fullMatch);

    await remover.removeImageLink(editor, 4, line, fullMatch, false, secondIndex);

    expect(editor.replaceRange).toHaveBeenCalledWith(
      '',
      { line: 4, ch: secondIndex },
      { line: 4, ch: secondIndex + fullMatch.length }
    );
  });

  it('does not edit when the provided match cannot be found and no index is available', async () => {
    const remover = new EditorLinkRemover();
    const editor = {
      replaceRange: vi.fn()
    } as any;

    await remover.removeImageLink(editor, 1, 'plain text', '![missing](a.png)', false);

    expect(editor.replaceRange).not.toHaveBeenCalled();
  });
});
