import { describe, expect, it } from 'vitest';
import {
  CaptionSourceScanner,
  type CaptionSourceChange
} from '../../../../src/ui/caption/CaptionSourceScanner';

function replaceChange(source: string, search: string, replacement: string): {
  source: string;
  change: CaptionSourceChange;
} {
  const from = source.indexOf(search);
  if (from < 0) throw new Error(`Missing fixture text: ${search}`);
  return {
    source: `${source.slice(0, from)}${replacement}${source.slice(from + search.length)}`,
    change: {
      fromA: from,
      toA: from + search.length,
      fromB: from,
      toB: from + replacement.length,
      inserted: replacement
    }
  };
}

describe('CaptionSourceScanner', () => {
  it('rescans only a stable prose line and remaps following descriptors', () => {
    const scanner = new CaptionSourceScanner();
    const source = [
      '![[first.png|First]]',
      '![[photo.png|Old caption]]',
      '![[last.png|Last]]'
    ].join('\n');
    const initial = scanner.scan(source);
    const edit = replaceChange(source, 'Old caption', 'A longer new caption');

    const update = scanner.update(initial, edit.source, [edit.change]);

    expect(update.incremental).toBe(true);
    expect(update.scan.fullScan).toBe(false);
    expect(update.scan.scannedLineCount).toBe(1);
    expect(update.scan.descriptors.map(descriptor => descriptor.source)).toEqual([
      '![[first.png|First]]',
      '![[photo.png|A longer new caption]]',
      '![[last.png|Last]]'
    ]);
    expect(update.scan.descriptors[2].end).toBe(edit.source.length);
  });

  it('retains Admonition context during a non-structural line update', () => {
    const scanner = new CaptionSourceScanner();
    const source = '```ad-note\n![[photo.png|Old]]\n```';
    const edit = replaceChange(source, 'Old', 'Updated');

    const update = scanner.update(scanner.scan(source), edit.source, [edit.change]);

    expect(update.incremental).toBe(true);
    expect(update.scan.descriptors[0]).toMatchObject({
      context: 'admonition',
      source: '![[photo.png|Updated]]',
      standalone: true
    });
  });

  it('falls back to a full scan for lexical-state and delimiter edits', () => {
    const scanner = new CaptionSourceScanner();
    const commentSource = '<!--\n![[hidden.png|Old]]\n-->\n![[shown.png|Shown]]';
    const commentEdit = replaceChange(commentSource, 'Old', 'Updated');
    const commentUpdate = scanner.update(
      scanner.scan(commentSource),
      commentEdit.source,
      [commentEdit.change]
    );

    expect(commentUpdate.incremental).toBe(false);
    expect(commentUpdate.scan.descriptors.map(link => link.path)).toEqual(['shown.png']);

    const fenceSource = '```markdown\n![[hidden.png]]\n```\n![[shown.png|Shown]]';
    const fenceEdit = replaceChange(fenceSource, '```markdown', '```ad-note');
    const fenceUpdate = scanner.update(
      scanner.scan(fenceSource),
      fenceEdit.source,
      [fenceEdit.change]
    );
    expect(fenceUpdate.incremental).toBe(false);
    expect(fenceUpdate.scan.descriptors.map(link => link.path)).toEqual([
      'hidden.png',
      'shown.png'
    ]);
  });

  it('does not scan all 10,000 lines for an ordinary one-line caption edit', () => {
    const scanner = new CaptionSourceScanner();
    const lines = Array.from({ length: 10_000 }, (_value, index) =>
      index === 5_000 ? '![[photo.png|Old]]' : `plain line ${index}`
    );
    const source = lines.join('\n');
    const initial = scanner.scan(source);
    const edit = replaceChange(source, 'Old', 'New');

    const update = scanner.update(initial, edit.source, [edit.change]);

    expect(initial.scannedLineCount).toBe(10_000);
    expect(update.incremental).toBe(true);
    expect(update.scan.scannedLineCount).toBe(1);
  });
});
