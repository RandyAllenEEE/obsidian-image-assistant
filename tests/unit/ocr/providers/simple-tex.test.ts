import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import SimpleTex from '../../../../src/ocr/providers/simple-tex';
import { DEFAULT_OCR_SETTINGS, OCRSettings } from '../../../../src/ocr/OCRSettings';

function makeSettings(): OCRSettings {
  const settings = structuredClone(DEFAULT_OCR_SETTINGS);
  settings.simpleTex.tokenSecretId = 'simpletex-token-id';
  return settings;
}

describe('SimpleTex provider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('awaits SecretStorage token before sending the request', async () => {
    const app = {
      secretStorage: {
        getSecret: vi.fn().mockResolvedValue('simpletex-token')
      }
    } as any;
    (requestUrl as any).mockResolvedValue({
      status: 200,
      json: {
        status: true,
        res: {
          latex: 'x^2'
        }
      }
    });

    const provider = new SimpleTex(app, false, makeSettings());
    const result = await provider.getTex(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));

    expect(result).toBe('x^2');
    expect(app.secretStorage.getSecret).toHaveBeenCalledWith('simpletex-token-id');
    const request = (requestUrl as any).mock.calls[0][0];
    expect(request.headers.token).toBe('simpletex-token');
    expect(request.headers.token).not.toBe('[object Promise]');
    expect(new TextDecoder().decode(request.body)).toContain('filename="image.png"');
    expect(new TextDecoder().decode(request.body)).toContain('Content-Type: image/png');
    expect(new TextDecoder().decode(request.body)).toContain('--\r\n');
  });

  it('writes the detected WebP MIME and filename into the multipart body', async () => {
    const app = {
      secretStorage: {
        getSecret: vi.fn().mockResolvedValue('simpletex-token')
      }
    } as any;
    (requestUrl as any).mockResolvedValue({
      status: 200,
      json: { status: true, res: { latex: 'x' } }
    });
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

    await new SimpleTex(app, false, makeSettings()).getTex(webp);

    const request = (requestUrl as any).mock.calls[0][0];
    const body = new TextDecoder().decode(request.body);
    expect(body).toContain('filename="image.webp"');
    expect(body).toContain('Content-Type: image/webp');
    expect(body.endsWith('--\r\n')).toBe(true);
  });
});
