import { describe, expect, it } from 'vitest';
import { getLastImage } from '../../../src/utils';

describe('getLastImage', () => {
  it('returns the last valid HTTP image without mutating the input list', () => {
    const lines = [
      'log output',
      'https://cdn.example/first.png',
      ' HTTPS://cdn.example/last.webp ',
      'finished'
    ];
    const snapshot = [...lines];

    expect(getLastImage(lines)).toBe('HTTPS://cdn.example/last.webp');
    expect(lines).toEqual(snapshot);
  });

  it('ignores non-HTTP output', () => {
    expect(getLastImage(['file:///tmp/image.png', 'not a URL'])).toBeUndefined();
  });
});
