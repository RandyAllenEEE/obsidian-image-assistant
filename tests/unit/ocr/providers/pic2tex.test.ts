import { beforeEach, describe, expect, it, vi } from 'vitest';
import Pic2Tex from '../../../../src/ocr/providers/pic2tex';
import { DEFAULT_OCR_SETTINGS } from '../../../../src/ocr/OCRSettings';

global.fetch = vi.fn();

describe('Pic2Tex image payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the detected JPEG MIME and filename in FormData', async () => {
    const settings = structuredClone(DEFAULT_OCR_SETTINGS);
    settings.pix2tex.url = 'https://pic2tex.example/predict';
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ latex: 'x^2' })
    });

    const provider = new Pic2Tex(false, settings);
    await provider.getTex(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));

    const [, options] = (global.fetch as any).mock.calls[0];
    const file = (options.body as FormData).get('file') as File;
    expect(file.type).toBe('image/jpeg');
    expect(file.name).toBe('image.jpg');
  });

  it('rejects invalid bytes before making a network request', async () => {
    const provider = new Pic2Tex(false, structuredClone(DEFAULT_OCR_SETTINGS));

    await expect(provider.getTex(new Uint8Array([1, 2, 3])))
      .rejects.toThrow('not a recognized image');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('reads Basic Auth credentials from Obsidian Secret Storage', async () => {
    const settings = structuredClone(DEFAULT_OCR_SETTINGS);
    settings.pix2tex.url = 'https://pic2tex.example/predict';
    settings.pix2tex.username = 'secret-user';
    settings.pix2tex.passwordSecretId = 'image-assistant-pix2tex-password';
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      text: async () => JSON.stringify({ latex: 'x' })
    });
    const app = { secretStorage: { getSecret: vi.fn(() => 'stored-password') } } as any;

    await new Pic2Tex(false, settings, app).getTex(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]));

    const [, options] = (global.fetch as any).mock.calls[0];
    expect(atob(options.headers.Authorization.replace('Basic ', '')))
      .toBe('secret-user:stored-password');
  });
});
