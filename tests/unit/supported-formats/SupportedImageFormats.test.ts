import { describe, it, expect } from 'vitest';
import { SupportedImageFormats } from '../../../src/local/SupportedImageFormats';
import { makePngBytes, makeJpegBytes, corruptedBytes, makeImageBlob } from '../../factories/image';

function makeIsoBmffFtypBytes(majorBrand: string): ArrayBuffer {
  // Create a minimal ISO BMFF buffer: [size=0x00000018][ftyp][majorBrand][...]
  const buf = new ArrayBuffer(24);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  // size 24 bytes
  view.setUint32(0, 24, false);
  // 'ftyp'
  u8[4] = 'f'.charCodeAt(0);
  u8[5] = 't'.charCodeAt(0);
  u8[6] = 'y'.charCodeAt(0);
  u8[7] = 'p'.charCodeAt(0);
  // major brand (4 chars)
  u8[8] = majorBrand.charCodeAt(0);
  u8[9] = majorBrand.charCodeAt(1);
  u8[10] = majorBrand.charCodeAt(2);
  u8[11] = majorBrand.charCodeAt(3);
  // rest zeros are fine
  return buf;
}

function makeGifHeaderBytes(): ArrayBuffer {
  // 'GIF89a' header is common, but our detector only needs 'GIF8'
  const u8 = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  return u8.buffer;
}

function makeBmpHeaderBytes(): ArrayBuffer {
  // 'BM' at start
  const u8 = new Uint8Array([0x42, 0x4D, 0, 0, 0, 0]);
  return u8.buffer;
}

function makeTiffHeaderBytes(littleEndian: boolean): ArrayBuffer {
  // TIFF byte order followed by the required 42 magic value.
  const u8 = new Uint8Array(8);
  if (littleEndian) {
    u8[0] = 0x49; u8[1] = 0x49;
    u8[2] = 0x2A; u8[3] = 0x00;
  } else {
    u8[0] = 0x4D; u8[1] = 0x4D;
    u8[2] = 0x00; u8[3] = 0x2A;
  }
  return u8.buffer;
}

function makeWebpHeaderBytes(): ArrayBuffer {
  // 'RIFF' + size + 'WEBP'
  const u8 = new Uint8Array(12);
  u8[0] = 0x52; u8[1] = 0x49; u8[2] = 0x46; u8[3] = 0x46; // RIFF
  // size (dummy)
  u8[4] = 0x00; u8[5] = 0x00; u8[6] = 0x00; u8[7] = 0x00;
  // 'WEBP'
  u8[8] = 0x57; u8[9] = 0x45; u8[10] = 0x42; u8[11] = 0x50;
  return u8.buffer;
}

function makeApp(): any {
  return {
    vault: {} as any,
    metadataCache: {
      resolvedLinks: {},
      unresolvedLinks: {},
      getFileCache: () => ({}),
      getCache: () => ({}),
      getFirstLinkpathDest: () => null,
      on: () => {},
      off: () => {},
      trigger: () => {},
      tryTrigger: () => {},
    } as any,
    workspace: {} as any,
    fileManager: {} as any,
    internalPlugins: {} as any,
    plugins: {} as any,
    loadLocalStorage: () => null,
    saveLocalStorage: () => {}
  };
}

describe('SupportedImageFormats — extension-based support (6.1–6.4, 6.10–6.11)', () => {
  const formats = new SupportedImageFormats(makeApp());

  it('Given JPEG filename .jpg/.jpeg (any case), When checked, Then isSupported returns true (6.1, 6.10)', () => {
    expect(formats.isSupported(undefined, 'photo.jpg')).toBe(true);
    expect(formats.isSupported(undefined, 'photo.JPEG')).toBe(true);
    expect(formats.isSupported(undefined, 'photo.Jpg')).toBe(true);
  });

  it('Given PNG filename .png, When checked, Then isSupported returns true (6.2)', () => {
    expect(formats.isSupported(undefined, 'img.png')).toBe(true);
  });

  it('Given WEBP filename .webp, When checked, Then isSupported returns true (6.3)', () => {
    expect(formats.isSupported(undefined, 'img.webp')).toBe(true);
  });

  it('Given GIF filename .gif, When checked, Then isSupported returns true (6.4)', () => {
    expect(formats.isSupported(undefined, 'anim.gif')).toBe(true);
  });

  it('Given ICO filename or MIME, When checked, Then isSupported returns true', () => {
    expect(formats.isSupported(undefined, 'favicon.ico')).toBe(true);
    expect(formats.isSupported('image/vnd.microsoft.icon', 'favicon.bin')).toBe(true);
  });

  it('Given invalid extension, When checked, Then isSupported returns false (6.11)', () => {
    expect(formats.isSupported(undefined, 'doc.txt')).toBe(false);
    expect(formats.isSupported(undefined, 'file.doc')).toBe(false);
  });

  it('Given conflicting MIME and extension, When MIME is supported and extension is not, Then MIME takes precedence (contract)', () => {
    expect(formats.isSupported('image/png', 'file.txt')).toBe(true);
  });

  it('normalizes MIME parameters, casing, and common browser aliases', () => {
    expect(formats.isSupported('IMAGE/JPEG; charset=binary', 'file.bin')).toBe(true);
    expect(formats.isSupported('image/pjpeg', 'file.bin')).toBe(true);
    expect(formats.isSupported('image/x-png', 'file.bin')).toBe(true);
  });

  it('does not trust an image extension when an explicit non-image MIME is present', () => {
    expect(formats.isSupported('application/pdf', 'document.png')).toBe(false);
    expect(formats.isSupported('text/plain', 'document.jpg')).toBe(false);
    expect(formats.isSupported('application/octet-stream', 'image.webp')).toBe(true);
  });

  it('keeps compatibility with Vault callers that pass a bare extension as the first argument', () => {
    expect(formats.isSupported('png', 'image.png')).toBe(true);
    expect(formats.isSupported('md', 'note.md')).toBe(false);
  });
});

describe('SupportedImageFormats — header-based MIME detection (6.5–6.9, 6.18)', () => {
  const formats = new SupportedImageFormats(makeApp());

  it('Given PNG header, When detected from Blob, Then returns image/png (6.9)', async () => {
    const blob = makeImageBlob(makePngBytes({}), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/png');
  });

  it('Given JPEG header, When detected from Blob, Then returns image/jpeg (6.9)', async () => {
    const blob = makeImageBlob(makeJpegBytes({}), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/jpeg');
  });

  it('Given GIF header, When detected from Blob, Then returns image/gif (6.9)', async () => {
    const blob = makeImageBlob(makeGifHeaderBytes(), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/gif');
  });

  it('Given BMP header, When detected from Blob, Then returns image/bmp (6.7, 6.9)', async () => {
    const blob = makeImageBlob(makeBmpHeaderBytes(), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/bmp');
  });

  it('Given TIFF header II or MM, When detected from Blob, Then returns image/tiff (6.6, 6.9)', async () => {
    const blobII = makeImageBlob(makeTiffHeaderBytes(true), 'application/octet-stream');
    const blobMM = makeImageBlob(makeTiffHeaderBytes(false), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blobII)).resolves.toBe('image/tiff');
    await expect(formats.getMimeTypeFromFile(blobMM)).resolves.toBe('image/tiff');
  });

  it('Given WEBP RIFF header with WEBP signature, When detected, Then returns image/webp (6.9)', async () => {
    const blob = makeImageBlob(makeWebpHeaderBytes(), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/webp');
  });

  it.each([
    'heic', 'heix', 'hevc', 'hevx'
  ])('Given HEIC ftyp=%s, When detected, Then returns image/heic (6.5)', async (brand) => {
    const blob = makeImageBlob(makeIsoBmffFtypBytes(brand), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/heic');
  });

  it('Given ICO header, When detected from Blob, Then returns image/x-icon', async () => {
    const blob = makeImageBlob(new Uint8Array([0, 0, 1, 0, 1, 0]).buffer, 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/x-icon');
  });

  it.each([
    'mif1', 'msf1'
  ])('Given generic HEIF ftyp=%s, When detected, Then returns image/heif (6.5)', async (brand) => {
    const blob = makeImageBlob(makeIsoBmffFtypBytes(brand), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/heif');
  });

  it.each([
    'avif', 'avis'
  ])('Given AVIF ftyp=%s, When detected, Then returns image/avif (6.18)', async (brand) => {
    const blob = makeImageBlob(makeIsoBmffFtypBytes(brand), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/avif');
  });
});

describe('SupportedImageFormats — SVG and Blob.type fallback (6.8, 6.12, 6.13)', () => {
  const formats = new SupportedImageFormats(makeApp());

  it('Given image/svg+xml type on Blob but unknown header, When detecting, Then returns image/svg+xml (6.8, 6.12)', async () => {
    const blob = makeImageBlob(new ArrayBuffer(10), 'image/svg+xml');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/svg+xml');
  });

  it('Given recognizable header, When Blob.type is generic, Then header wins (6.12)', async () => {
    const blob = makeImageBlob(makeWebpHeaderBytes(), 'application/octet-stream');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('image/webp');
  });

  it('Given unrecognized header and no Blob.type, When detecting, Then returns "unknown" (6.12)', async () => {
    const blob = makeImageBlob(corruptedBytes(24), '');
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('unknown');
  });

  it('Given very short/corrupted data and no type, When detecting, Then returns "unknown" and does not throw (6.13)', async () => {
    const blob = new Blob([new Uint8Array([0xFF])], { type: '' });
    await expect(formats.getMimeTypeFromFile(blob)).resolves.toBe('unknown');
  });

  it('Given .svg filename, When isSupported called, Then returns true (6.8)', () => {
    expect(formats.isSupported(undefined, 'vector.svg')).toBe(true);
  });

  it('detects a large SVG with a generic MIME after reading the complete XML document', async () => {
    const padding = '<!--' + 'x'.repeat(5000) + '-->';
    const svg = new File(
      [`<?xml version="1.0"?>${padding}<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>`],
      'diagram.svg',
      { type: 'application/octet-stream' }
    );

    await expect(formats.getMimeTypeFromFile(svg)).resolves.toBe('image/svg+xml');
  });
});
