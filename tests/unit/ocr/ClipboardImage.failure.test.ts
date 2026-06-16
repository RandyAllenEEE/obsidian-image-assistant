import { describe, expect, it, vi } from 'vitest';
import { fakeApp } from '../../factories/obsidian';

const obsidianMocks = vi.hoisted(() => ({
  Notice: vi.fn()
}));

vi.mock('obsidian', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    Notice: obsidianMocks.Notice
  };
});

import ImageAssistantPlugin from '../../../src/main';

describe('OCR clipboard image reading', () => {
  it('returns null and shows an error notice when clipboard access fails', async () => {
    const read = vi.fn().mockRejectedValue(new Error('clipboard denied'));
    Object.defineProperty(navigator, 'clipboard', {
      value: { read },
      configurable: true
    });
    const plugin = new ImageAssistantPlugin(fakeApp() as any, { id: 'obsidian-image-assistant' } as any);

    await expect((plugin as any).getClipboardImage()).resolves.toBeNull();

    expect(read).toHaveBeenCalledTimes(1);
    expect(obsidianMocks.Notice).toHaveBeenCalledTimes(1);
  });
});
