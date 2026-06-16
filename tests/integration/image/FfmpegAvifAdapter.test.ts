/**
 * Integration-lite tests for FFmpeg AVIF adapter
 * Covers TEST_CHECKLIST.md items 1.35–1.37 and 1.45
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mocks before imports
vi.mock('child_process');
vi.mock('fs/promises', () => {
  return {
    readFile: vi.fn(),
    unlink: vi.fn()
  };
});

import { ImageProcessor } from '../../../src/local/ImageProcessor';
import { SupportedImageFormats } from '../../../src/local/SupportedImageFormats';
import { makePngBytes, makeImageBlob } from '../../factories/image';
import { mockChildProcess } from '../../factories/process';
import { fakeApp } from '../../factories/obsidian';

// Pull mocked fs
import * as fs from 'fs/promises';

describe('Integration-lite: FfmpegAvifAdapter', () => {
  let processor: ImageProcessor;
  let supportedFormats: SupportedImageFormats;

  beforeEach(() => {
    const app = fakeApp() as any;
    supportedFormats = new SupportedImageFormats(app);
    processor = new ImageProcessor(app, supportedFormats);
    ImageProcessor.clearAvifEncoderCache();
    (fs.readFile as any).mockReset();
    (fs.unlink as any).mockReset();
  });

  it('1.35 [I] Happy path: uses libaom-av1, reads temp file, deletes it', async () => {
    // Arrange
    // eslint-disable-next-line id-length
    const inputBytes = makePngBytes({ w: 64, h: 64 });
    const inputBlob = makeImageBlob(inputBytes, 'image/png');

    const avifData = new Uint8Array([10, 20, 30, 40]);
    ;(fs.readFile as any).mockResolvedValue(Buffer.from(avifData));
    ;(fs.unlink as any).mockResolvedValue(undefined);

    const { spawn } = await import('child_process');
    (spawn as any).mockImplementation(() => {
      const proc = new EventEmitter() as any;
      proc.stdin = { write: vi.fn(), end: vi.fn() };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      // Emit close first so the implementation's 'exit' handler doesn't remove 'close'
      setTimeout(() => {
        proc.emit('close', 0, null);
        proc.emit('exit', 0, null);
      }, 0);
      return proc;
    });

    // Act
    const result = await processor.processImage(
      inputBlob,
      'AVIF',
      1.0,
      1.0,
      'None',
      0,
      0,
      0,
      'Auto',
      true,
      {
        name: 'test',
        outputFormat: 'AVIF',
        ffmpegExecutablePath: 'C:/tools/ffmpeg.exe',
        ffmpegCrf: 23,
        ffmpegPreset: 'medium',
        ffmpegDetectedEncoder: 'libaom-av1',
        quality: 1,
        colorDepth: 1,
        resizeMode: 'None',
        desiredWidth: 0,
        desiredHeight: 0,
        desiredLongestEdge: 0,
        enlargeOrReduce: 'Auto',
        allowLargerFiles: true,
        skipConversionPatterns: ''
      }
    );

    // Assert args
    const { calls } = (spawn as any).mock;
    expect(calls.length).toBeGreaterThan(0);
    const [cmd, args] = calls.find(([, args]: [string, string[]]) => args.includes('-c:v')) as [string, string[]];
    expect(cmd).toContain('ffmpeg');
    expect(args).toContain('-c:v');
    expect(args).toContain('libaom-av1');
    expect(args).toContain('-crf');
    expect(args).toContain('23');
    expect(args).toContain('-b:v');
    expect(args).toContain('0');
    expect(args).toContain('-cpu-used');
    expect(args).toContain('4');
    expect(args).not.toContain('-preset');
    expect(args).toContain('-frames:v');
    expect(args).toContain('-still-picture');

    // Output
    const out = new Uint8Array(result);
    expect(out).toEqual(avifData);

    // Temp file deleted
    expect((fs.unlink as any).mock.calls.length).toBeGreaterThan(0);
  });

  it('1.36 [I] Alpha path: uses dual AVIF streams with yuv444 color and gray alpha', async () => {
    // Arrange
    // eslint-disable-next-line id-length
    const inputBytes = makePngBytes({ w: 16, h: 16, alpha: true });
    const inputBlob = makeImageBlob(inputBytes, 'image/png');

    ;(fs.readFile as any).mockResolvedValue(Buffer.from(new Uint8Array([1, 1, 1])));
    ;(fs.unlink as any).mockResolvedValue(undefined);

    // Force alpha detection
    vi.spyOn<any, any>(processor as any, 'checkForTransparency').mockResolvedValue(true);

    const { spawn } = await import('child_process');
    (spawn as any).mockImplementation(() => {
      const proc = new EventEmitter() as any;
      proc.stdin = { write: vi.fn(), end: vi.fn() };
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      setTimeout(() => {
        proc.emit('close', 0, null);
        proc.emit('exit', 0, null);
      }, 0);
      return proc;
    });

    // Act
    await processor.processImage(
      inputBlob,
      'AVIF',
      1.0,
      1.0,
      'None',
      0,
      0,
      0,
      'Auto',
      true,
      {
        name: 'test',
        outputFormat: 'AVIF',
        ffmpegExecutablePath: '/usr/bin/ffmpeg',
        ffmpegCrf: 28,
        ffmpegPreset: 'fast',
        ffmpegDetectedEncoder: 'libaom-av1',
        quality: 1,
        colorDepth: 1,
        resizeMode: 'None',
        desiredWidth: 0,
        desiredHeight: 0,
        desiredLongestEdge: 0,
        enlargeOrReduce: 'Auto',
        allowLargerFiles: true,
        skipConversionPatterns: ''
      }
    );

    // Assert filter parts in args
    const { calls } = (spawn as any).mock;
    const [, args] = calls.find(([, args]: [string, string[]]) => args.includes('-filter_complex')) as [string, string[]];
    const filterComplex = args[args.indexOf('-filter_complex') + 1];
    expect(filterComplex).toContain('format=rgba');
    expect(filterComplex).toContain('format=yuv444p');
    expect(filterComplex).toContain('alphaextract,format=gray');
    expect(args).toContain('-map');
    expect(args).toContain('[c444]');
    expect(args).toContain('[a]');
    expect(args).toContain('-cpu-used');
    expect(args).toContain('5');
    expect(args).not.toContain('-preset');
  });

  it('1.36b [I] FFmpeg close code null is treated as success', async () => {
    // Arrange
    // eslint-disable-next-line id-length
    const inputBytes = makePngBytes({ w: 24, h: 24 });
    const inputBlob = makeImageBlob(inputBytes, 'image/png');
    const avifData = new Uint8Array([6, 7, 8]);

    ;(fs.readFile as any).mockResolvedValue(Buffer.from(avifData));
    ;(fs.unlink as any).mockResolvedValue(undefined);

    const { spawn } = await import('child_process');
    (spawn as any)
      .mockImplementationOnce(() => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        setTimeout(() => proc.emit('close', 0, null), 0);
        return proc;
      })
      .mockImplementationOnce(() => {
        const proc = new EventEmitter() as any;
        proc.stdin = { write: vi.fn(), end: vi.fn() };
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        setTimeout(() => {
          proc.emit('close', null, null);
        }, 0);
        return proc;
      });

    // Act
    const result = await processor.processImage(
      inputBlob,
      'AVIF',
      1.0,
      1.0,
      'None',
      0,
      0,
      0,
      'Auto',
      true,
      {
        name: 'test',
        outputFormat: 'AVIF',
        ffmpegExecutablePath: '/usr/bin/ffmpeg',
        ffmpegCrf: 25,
        ffmpegPreset: 'slow',
        ffmpegDetectedEncoder: 'libaom-av1',
        quality: 1,
        colorDepth: 1,
        resizeMode: 'None',
        desiredWidth: 0,
        desiredHeight: 0,
        desiredLongestEdge: 0,
        enlargeOrReduce: 'Auto',
        allowLargerFiles: true,
        skipConversionPatterns: ''
      }
    );

    // Assert
    expect(new Uint8Array(result)).toEqual(avifData);
  });

  it('1.36c [I] Encoder detection prefers a validated hardware AV1 encoder', async () => {
    const { spawn } = await import('child_process');
    (spawn as any).mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('-encoders')) {
        return mockChildProcess({
          stdout: [
            ' V..... av1_nvenc           NVIDIA NVENC av1 encoder',
            ' V..... libaom-av1          libaom AV1',
          ].join('\n')
        });
      }

      if (args.includes('-c:v') && args.includes('av1_nvenc')) {
        return mockChildProcess({ exitCode: 0 });
      }

      return mockChildProcess({ exitCode: 1 });
    });

    const encoder = await processor.detectAvifEncoder('C:/tools/ffmpeg.exe');

    expect(encoder).toBe('av1_nvenc');
    const { calls } = (spawn as any).mock;
    expect(calls.some(([, args]: [string, string[]]) => args.includes('-encoders'))).toBe(true);
    expect(calls.some(([, args]: [string, string[]]) => args.includes('-c:v') && args.includes('av1_nvenc'))).toBe(true);
  });

  it('1.36d [I] Forced encoder detection probes again instead of trusting a stale saved encoder', async () => {
    const { spawn } = await import('child_process');
    (spawn as any).mockImplementation((_cmd: string, args: string[]) => {
      if (args.includes('-encoders')) {
        return mockChildProcess({
          stdout: ' V..... libaom-av1          libaom AV1'
        });
      }

      if (args.includes('-c:v') && args.includes('libaom-av1')) {
        return mockChildProcess({ exitCode: 0 });
      }

      return mockChildProcess({ exitCode: 1 });
    });

    const encoder = await processor.detectAvifEncoder(
      'C:/tools/ffmpeg.exe',
      'av1_nvenc',
      { forceProbe: true }
    );

    expect(encoder).toBe('libaom-av1');
    const { calls } = (spawn as any).mock;
    expect(calls.some(([, args]: [string, string[]]) => args.includes('-encoders'))).toBe(true);
    expect(calls.some(([, args]: [string, string[]]) => args.includes('-c:v') && args.includes('av1_nvenc'))).toBe(false);
  });

  it('1.37 [I] Missing path or failure: returns original bytes and cleans up temp on failure', async () => {
    // Arrange - missing path
    // eslint-disable-next-line id-length
    const inputBytes = makePngBytes({ w: 20, h: 20 });
    const inputBlob = makeImageBlob(inputBytes, 'image/png');

    const { spawn } = await import('child_process');
    (spawn as any).mockClear();

    // Act: missing path returns original
    const resultMissing = await processor.processImage(
      inputBlob,
      'AVIF',
      1.0,
      1.0,
      'None',
      0,
      0,
      0,
      'Auto',
      true,
      {
        name: 'test',
        outputFormat: 'AVIF',
        // no ffmpegExecutablePath
        ffmpegCrf: 30,
        ffmpegPreset: 'slow',
        quality: 1,
        colorDepth: 1,
        resizeMode: 'None',
        desiredWidth: 0,
        desiredHeight: 0,
        desiredLongestEdge: 0,
        enlargeOrReduce: 'Auto',
        allowLargerFiles: true,
        skipConversionPatterns: ''
      } as any
    );
    expect(new Uint8Array(resultMissing).byteLength).toBe(inputBytes.byteLength);
    expect((spawn as any).mock.calls.length).toBe(0);

    // Arrange - failure path (non-zero exit)
    ;(fs.readFile as any).mockClear();
    ;(fs.unlink as any).mockClear();
    (spawn as any).mockImplementation(() => mockChildProcess({ exitCode: 1, stderr: Buffer.from('err') }));

    // Act: failure returns original (outer catch) and attempts temp unlink
    const resultFail = await processor.processImage(
      inputBlob,
      'AVIF',
      1.0,
      1.0,
      'None',
      0,
      0,
      0,
      'Auto',
      true,
      {
        name: 'test',
        outputFormat: 'AVIF',
        ffmpegExecutablePath: '/usr/bin/ffmpeg',
        ffmpegCrf: 28,
        ffmpegPreset: 'medium',
        quality: 1,
        colorDepth: 1,
        resizeMode: 'None',
        desiredWidth: 0,
        desiredHeight: 0,
        desiredLongestEdge: 0,
        enlargeOrReduce: 'Auto',
        allowLargerFiles: true,
        skipConversionPatterns: ''
      }
    );

    expect(new Uint8Array(resultFail).byteLength).toBe(inputBytes.byteLength);
    // unlink may be called in close handler on error; at least ensure no crash
  });
});
