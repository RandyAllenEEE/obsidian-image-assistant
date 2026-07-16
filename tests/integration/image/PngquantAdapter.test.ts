/**
 * Integration-lite tests for PNGQUANT adapter
 * Covers TEST_CHECKLIST.md items 1.32–1.34
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mocks must be declared before imports
vi.mock('child_process');

import { ImageProcessor } from '../../../src/local/ImageProcessor';
import { SupportedImageFormats } from '../../../src/local/SupportedImageFormats';
import { makePngBytes, makeImageBlob } from '../../factories/image';
import { mockChildProcess } from '../../factories/process';
import { fakeApp } from '../../factories/obsidian';

describe('Integration-lite: PngquantAdapter', () => {
  let processor: ImageProcessor;
  let supportedFormats: SupportedImageFormats;

  beforeEach(() => {
    const app = fakeApp() as any;
    supportedFormats = new SupportedImageFormats(app);
    processor = new ImageProcessor(app, supportedFormats);
  });

  it('1.32 [I] Happy path: pipes stdin, uses --quality, stdout used as output', async () => {
    // Arrange
    // eslint-disable-next-line id-length
    const inputBytes = makePngBytes({ w: 64, h: 64 });
    const inputBlob = makeImageBlob(inputBytes, 'image/png');

    const processed = new Uint8Array([1, 2, 3, 4]);

    const { spawn } = await import('child_process');
    (spawn as any).mockImplementation(() => mockChildProcess({ stdout: Buffer.from(processed), exitCode: 0 }));

    // Act
    const result = await processor.processImage(
      inputBlob,
      'PNGQUANT',
      1.0,
      1.0,
      'None',
      0,
      0,
      0,
      'Auto',
      true,
      {
        outputFormat: 'PNGQUANT',
        pngquantExecutablePath: 'C:/tools/pngquant.exe',
        pngquantQuality: '65-80',
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

    // Assert
    const { calls } = (spawn as any).mock;
    expect(calls.length).toBeGreaterThan(0);
    const [cmd, args] = calls.find(([, args]: [string, string[]]) => args.includes('--quality')) as [string, string[]];
    expect(cmd).toContain('pngquant');
    expect(args).toEqual(['--quality', '65-80', '-']);

    const out = new Uint8Array(result);
    expect(out).toEqual(processed);
  });

  it('1.33 [I] Missing path: shows Notice and returns original bytes (spawn not called)', async () => {
    // Arrange
    // eslint-disable-next-line id-length
    const inputBytes = makePngBytes({ w: 32, h: 32 });
    const inputBlob = makeImageBlob(inputBytes, 'image/png');

    const { spawn } = await import('child_process');
    (spawn as any).mockClear();

    // Act
    const result = await processor.processImage(
      inputBlob,
      'PNGQUANT',
      1.0,
      1.0,
      'None',
      0,
      0,
      0,
      'Auto',
      true,
      {
        outputFormat: 'PNGQUANT',
        // No executable path provided
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

    // Assert
    const out = new Uint8Array(result);
    expect(out.byteLength).toBe(inputBytes.byteLength);
    expect((spawn as any).mock.calls.length).toBe(0);
  });

  it('1.34 [I] Failure: non-zero exit or spawn error -> returns original bytes', async () => {
    // Arrange
    // eslint-disable-next-line id-length
    const inputBytes = makePngBytes({ w: 40, h: 40 });
    const inputBlob = makeImageBlob(inputBytes, 'image/png');

    const { spawn } = await import('child_process');
    (spawn as any).mockImplementation(() => mockChildProcess({ exitCode: 1, stderr: Buffer.from('error') }));

    // Act
    const result = await processor.processImage(
      inputBlob,
      'PNGQUANT',
      1.0,
      1.0,
      'None',
      0,
      0,
      0,
      'Auto',
      true,
      {
        outputFormat: 'PNGQUANT',
        pngquantExecutablePath: '/usr/bin/pngquant',
        pngquantQuality: '60-70',
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

    // Assert (outer catch returns original bytes)
    expect(new Uint8Array(result).byteLength).toBe(inputBytes.byteLength);
  });

  it('1.34b [I] Spawn error after availability check returns original bytes', async () => {
    // Arrange
    // eslint-disable-next-line id-length
    const inputBytes = makePngBytes({ w: 48, h: 48 });
    const inputBlob = makeImageBlob(inputBytes, 'image/png');

    const { spawn } = await import('child_process');
    (spawn as any)
      .mockImplementationOnce(() => {
        const proc = new EventEmitter() as any;
        proc.stdout = new EventEmitter();
        proc.stderr = new EventEmitter();
        setTimeout(() => proc.emit('close', 0), 0);
        return proc;
      })
      .mockImplementationOnce(() => {
        throw new Error('spawn pngquant ENOENT');
      });

    // Act
    const result = await processor.processImage(
      inputBlob,
      'PNGQUANT',
      1.0,
      1.0,
      'None',
      0,
      0,
      0,
      'Auto',
      true,
      {
        outputFormat: 'PNGQUANT',
        pngquantExecutablePath: '/usr/bin/pngquant',
        pngquantQuality: '65-80',
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

    // Assert
    expect(new Uint8Array(result).byteLength).toBe(inputBytes.byteLength);
  });
});
