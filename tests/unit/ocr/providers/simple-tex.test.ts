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
    const result = await provider.getTex(new Uint8Array([1, 2, 3]));

    expect(result).toBe('x^2');
    expect(app.secretStorage.getSecret).toHaveBeenCalledWith('simpletex-token-id');
    const request = (requestUrl as any).mock.calls[0][0];
    expect(request.headers.token).toBe('simpletex-token');
    expect(request.headers.token).not.toBe('[object Promise]');
  });
});
