// ImageProcessor.ts
import { Notice, Platform, App, TFile, FileSystemAdapter, TFolder } from "obsidian";
import { SupportedImageFormats } from "./SupportedImageFormats";
import { ChildProcess, spawn } from 'child_process';
import { LocalExternalToolSettings, ResizeMode, EnlargeReduce, AvifEncoder } from "../settings/types";
import { ImageAssistantSettings, DEFAULT_SETTINGS } from "../settings/defaults";
import { normalizeExecutablePath } from "../utils/ffmpegPath";
import * as piexif from "piexifjs"; // Import piexif library


import * as fs from 'fs/promises'; // Import Node.js file system functions (promises version)
import * as os from 'os';          // Import Node.js os module
import * as path from 'path';    // Import Node.js path module

// Import types


interface Dimensions {
    imageWidth: number;
    imageHeight: number;
    aspectRatio: number;
}

interface AvifEncoderConfig {
    crfMin: number;
    crfMax: number;
    supportsPreset: boolean;
    useCpuUsed?: boolean;
    presetNames?: string[];
    supportsStillPicture?: boolean;
    platformHint: 'software' | 'nvidia' | 'intel' | 'amd' | 'vaapi' | 'mediafoundation';
}

export const AVIF_ENCODER_CONFIGS: Record<AvifEncoder, AvifEncoderConfig> = {
    'libaom-av1': {
        crfMin: 0,
        crfMax: 63,
        supportsPreset: true,
        useCpuUsed: true,
        presetNames: ['0', '1', '2', '3', '4', '5', '6', '7', '8'],
        supportsStillPicture: true,
        platformHint: 'software',
    },
    'libsvtav1': {
        crfMin: 0,
        crfMax: 63,
        supportsPreset: true,
        presetNames: ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'],
        platformHint: 'software',
    },
    'av1_nvenc': {
        crfMin: 0,
        crfMax: 51,
        supportsPreset: true,
        presetNames: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'],
        platformHint: 'nvidia',
    },
    'av1_qsv': { crfMin: 0, crfMax: 51, supportsPreset: false, platformHint: 'intel' },
    'av1_amf': { crfMin: 0, crfMax: 255, supportsPreset: false, platformHint: 'amd' },
    'av1_vaapi': { crfMin: 0, crfMax: 255, supportsPreset: false, platformHint: 'vaapi' },
    'av1_mf': { crfMin: 0, crfMax: 100, supportsPreset: false, platformHint: 'mediafoundation' },
};

const AVIF_ENCODER_PRIORITY: AvifEncoder[] = [
    'av1_nvenc',
    'av1_qsv',
    'av1_amf',
    'av1_mf',
    'av1_vaapi',
    'libsvtav1',
    'libaom-av1',
];

export class ImageProcessor {

    supportedImageFormats: SupportedImageFormats
    private externalTools: LocalExternalToolSettings = DEFAULT_SETTINGS.localProcessing.externalTools;
    private settings: ImageAssistantSettings;
    private app: App;
    private static avifEncoderDetectionCache: Map<string, AvifEncoder> = new Map();

    constructor(app: App, supportedImageFormats: SupportedImageFormats) {
        this.app = app;
        this.supportedImageFormats = supportedImageFormats;
    }

    public static clearAvifEncoderCache(executablePath?: string): void {
        if (!executablePath) {
            ImageProcessor.avifEncoderDetectionCache.clear();
            return;
        }
        ImageProcessor.avifEncoderDetectionCache.delete(normalizeExecutablePath(executablePath));
    }

    public async detectAvifEncoder(
        executablePath: string,
        cachedEncoder?: string,
        options: { forceProbe?: boolean } = {}
    ): Promise<AvifEncoder | null> {
        const normalizedPath = normalizeExecutablePath(executablePath);

        if (!options.forceProbe && this.isValidAvifEncoder(cachedEncoder)) {
            ImageProcessor.avifEncoderDetectionCache.set(normalizedPath, cachedEncoder);
            return cachedEncoder;
        }

        const cached = ImageProcessor.avifEncoderDetectionCache.get(normalizedPath);
        if (!options.forceProbe && cached) return cached;

        const probe = await this.runFfmpegProbe(normalizedPath, ['-encoders'], 3000);
        if (!probe.output) return null;

        const candidates = AVIF_ENCODER_PRIORITY.filter(encoder => {
            if (encoder === 'av1_mf' && !Platform.isWin) return false;
            if (encoder === 'av1_vaapi' && !Platform.isLinux) return false;
            return probe.output.includes(encoder);
        });

        for (const candidate of candidates) {
            if (await this.validateAvifEncoder(normalizedPath, candidate)) {
                ImageProcessor.avifEncoderDetectionCache.set(normalizedPath, candidate);
                return candidate;
            }
        }

        return null;
    }

    // ... imports ...
    /**
     * Main method to process an image file. This method is intended to be used directly
     * for single image processing or by other classes like BatchImageProcessor.
     * 
     * @param file - The image file as a Blob, TFile, or string (path to file).
     * @param format - The desired output format ('WEBP', 'JPEG', 'PNG').
     * @param quality - The quality setting for lossy formats (0.0 - 1.0).
     * @param colorDepth - The color depth for PNG (0.0 - 1.0, where 1 is full color).
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width for resizing.
     * @param desiredHeight - The desired height for resizing.
     * @param desiredLongestEdge - The desired longest edge for resizing.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image during resizing.
     * @param allowLargerFiles - Whether to allow output files larger than the original.
     * @returns A Promise that resolves to the processed image as an ArrayBuffer.
     */
    async processImage(
        file: Blob | TFile | string,
        format: 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL' | 'NONE' | 'PNGQUANT' | 'AVIF',
        quality: number,
        colorDepth: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        allowLargerFiles: boolean,
        externalTools?: LocalExternalToolSettings,
        settings?: ImageAssistantSettings
    ): Promise<ArrayBuffer> {
        // Process the image using the helper function
        const processedImage = await this.processImageHelper(
            file,
            format,
            quality,
            colorDepth,
            resizeMode,
            desiredWidth,
            desiredHeight,
            desiredLongestEdge,
            enlargeOrReduce,
            allowLargerFiles,
            externalTools,
            settings
        );

        if (format === "JPEG") {
            try {
                // Extract metadata from the original file
                const metadata: piexif.ExifDict | undefined = await this.extractMetadata(file);

                // Remove rotation property (Orientation tag in 0th IFD, tag 274)
                if (metadata && metadata["0th"] && metadata["0th"][piexif.ImageIFD.Orientation]) {
                    delete metadata["0th"][piexif.ImageIFD.Orientation];
                }

                const stringifiedMetadata = metadata && Object.keys(metadata).length > 0 ? piexif.dump(metadata) : "";

                // Re-apply the metadata to the processed image
                return await this.applyMetadata(processedImage, stringifiedMetadata);
            } catch (exifError) {
                console.error("JPEG EXIF handling error:", exifError);
                // Per contract 1.8: on EXIF failure, return JPEG without EXIF; no throw
                return processedImage;
            }
        }

        return processedImage
    }

    /**
     * Helper method to process an image file.
     */
    private async processImageHelper(
        file: Blob | TFile | string,
        format: 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL' | 'NONE' | 'PNGQUANT' | 'AVIF',
        quality: number,
        colorDepth: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        allowLargerFiles: boolean,
        externalTools?: LocalExternalToolSettings,
        settings?: ImageAssistantSettings
    ): Promise<ArrayBuffer> {
        this.settings = settings ?? DEFAULT_SETTINGS;
        this.externalTools = externalTools || this.settings.localProcessing?.externalTools || DEFAULT_SETTINGS.localProcessing.externalTools;

        // Resolve input to Blob and optionally Path (for zero-copy)
        let inputBlob: Blob;
        let inputPath: string | null = null;
        let filename = (file instanceof TFile) ? file.name : (typeof file === 'string' ? path.basename(file) : 'image');

        try {
            if (file instanceof Blob) {
                inputBlob = file;
            } else if (file instanceof TFile) {
                // If it's a TFile, we can get the system path if adapter allows
                if (this.externalTools.useSystemPathForBinary && this.app.vault.adapter instanceof FileSystemAdapter) {
                    inputPath = this.app.vault.adapter.getFullPath(file.path);
                }
                const data = await this.app.vault.readBinary(file);
                inputBlob = new Blob([data], { type: `image/${file.extension}` });
            } else if (typeof file === 'string') {
                // Assuming it's a file path
                inputPath = file;
                const buffer = await fs.readFile(file);
                // Determine mime type from extension or magic bytes?
                // Simple extension check for now
                const ext = path.extname(file).substring(1);
                inputBlob = new Blob([new Uint8Array(buffer)], { type: `image/${ext}` });
            } else {
                throw new Error("Invalid file input type");
            }

            // --- Handle NONE format ---
            if (format === 'NONE' && resizeMode !== 'None') {
                return await this.resizeImage(
                    inputBlob,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce,
                    quality
                );
            }
            if (format === 'NONE') {
                return inputBlob.arrayBuffer();
            }

            // --- Handle ORIGINAL format ---
            if (format === 'ORIGINAL') {
                return await this.compressOriginalImage(
                    inputBlob,
                    quality,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce
                );
            }

            const detected = await this.supportedImageFormats.getMimeTypeFromFile(inputBlob instanceof File ? inputBlob : new File([inputBlob], filename));

            if (!detected || detected === 'unknown') {
                return inputBlob.arrayBuffer();
            }
            const mimeType = detected;

            if (!this.supportedImageFormats.isSupported(mimeType, filename)) {
                return inputBlob.arrayBuffer();
            }

            switch (mimeType) {
                case 'image/tiff':
                case 'image/tif': {
                    try {
                        const tiffBlob = await this.handleTiff(await inputBlob.arrayBuffer());
                        return await this.convertAndCompress(
                            tiffBlob,
                            format,
                            quality,
                            colorDepth,
                            resizeMode,
                            desiredWidth,
                            desiredHeight,
                            desiredLongestEdge,
                            enlargeOrReduce,
                            allowLargerFiles,
                            inputPath // Pass inputPath
                        );
                    } catch (e) {
                        return inputBlob.arrayBuffer();
                    }
                }
                case 'image/heic':
                case 'image/heif': {
                    try {
                        const heicBlob = await this.handleHeic(
                            await inputBlob.arrayBuffer(),
                            format === 'JPEG' ? 'JPEG' : 'PNG',
                            format === 'JPEG' ? quality : 1
                        );
                        return await this.convertAndCompress(
                            heicBlob,
                            format,
                            quality,
                            colorDepth,
                            resizeMode,
                            desiredWidth,
                            desiredHeight,
                            desiredLongestEdge,
                            enlargeOrReduce,
                            allowLargerFiles,
                            null // HEIC intermediate is blob, lost path
                        );
                    } catch (e) {
                        return inputBlob.arrayBuffer();
                    }
                }
                default:
                    try {
                        return await this.convertAndCompress(
                            inputBlob,
                            format,
                            quality,
                            colorDepth,
                            resizeMode,
                            desiredWidth,
                            desiredHeight,
                            desiredLongestEdge,
                            enlargeOrReduce,
                            allowLargerFiles,
                            inputPath
                        );
                    } catch (unexpected) {
                        this.notifyProcessingFailure(filename, format, unexpected);
                        return inputBlob.arrayBuffer();
                    }
            }
        } catch (error) {
            console.error('Error processing image:', error);
            this.notifyProcessingFailure(filename, format, error);
            return (file instanceof Blob) ? file.arrayBuffer() : new ArrayBuffer(0); // Fallback
        }
    }

    /**
     * Checks if a command-line tool is available by checking the file path or running 'version'.
     * @param executablePath - The path to the executable.
     * @returns A Promise that resolves to true if available, false otherwise.
     */
    private async checkCommandAvailability(executablePath: string): Promise<boolean> {
        if (!executablePath) return false;

        const normalizedPath = normalizeExecutablePath(executablePath);

        // First check if file exists (if it's an absolute path)
        try {
            if (/[\\/]/.test(normalizedPath) || /^[A-Za-z]:/.test(normalizedPath)) {
                await fs.access(normalizedPath);
                return true;
            }
        } catch {
            // If access fails, it might not be a file path but a global command, fall through to spawn check
        }

        // Secondary check: try to spawn with --version or -version
        return new Promise((resolve) => {
            const process = Platform.isWin
                ? spawn(normalizedPath, ['-version'], { windowsHide: true })
                : spawn(normalizedPath, ['-version']);
            let settled = false;
            const settle = (value: boolean) => {
                if (settled) return;
                settled = true;
                resolve(value);
            };
            process.on('error', () => settle(false));
            process.on('close', (code) => settle(code === 0 || code === null));
            // Add timeout in case it hangs
            setTimeout(() => {
                try { process.kill(); } catch { }
                settle(false);
            }, 2000);
        });
    }

    private async validateAvifEncoder(executablePath: string, encoder: AvifEncoder): Promise<boolean> {
        const result = await this.runFfmpegProbe(
            executablePath,
            [
                '-hide_banner',
                '-f', 'lavfi',
                '-i', 'color=c=black:s=64x64:d=0.1:r=1',
                '-frames:v', '1',
                '-c:v', encoder,
                '-f', 'null',
                '-',
            ],
            2000
        );

        const errorOutput = result.output;
        const failed =
            result.timedOut ||
            (result.code !== 0 && result.code !== null) ||
            errorOutput.includes('Cannot load') ||
            errorOutput.includes('Could not open encoder') ||
            errorOutput.includes('could not open') ||
            errorOutput.includes('No NVENC capable devices') ||
            errorOutput.includes('nvcuda.dll') ||
            errorOutput.includes('Error');

        return !failed;
    }

    private async detectSoftwareAvifEncoder(executablePath: string): Promise<AvifEncoder | null> {
        const result = await this.runFfmpegProbe(executablePath, ['-encoders'], 3000);
        if (result.output.includes('libsvtav1') && await this.validateAvifEncoder(executablePath, 'libsvtav1')) {
            return 'libsvtav1';
        }
        if (result.output.includes('libaom-av1') && await this.validateAvifEncoder(executablePath, 'libaom-av1')) {
            return 'libaom-av1';
        }
        return null;
    }

    private runFfmpegProbe(
        executablePath: string,
        args: string[],
        timeoutMs: number
    ): Promise<{ code: number | null; output: string; timedOut: boolean }> {
        return new Promise((resolve) => {
            let ffmpeg: ChildProcess | null = null;
            let output = "";
            let settled = false;
            let timeout: ReturnType<typeof setTimeout> | null = null;

            const settle = (code: number | null, timedOut = false) => {
                if (settled) return;
                settled = true;
                if (timeout) clearTimeout(timeout);
                resolve({ code, output, timedOut });
            };

            try {
                ffmpeg = Platform.isWin
                    ? spawn(executablePath, args, { windowsHide: true })
                    : spawn(executablePath, args);
            } catch (error) {
                console.error('Failed to spawn FFmpeg probe:', error);
                settle(1);
                return;
            }

            ffmpeg.stdout?.on('data', (data: Buffer) => {
                output += data.toString();
            });
            ffmpeg.stderr?.on('data', (data: Buffer) => {
                output += data.toString();
            });
            ffmpeg.on('close', (code: number | null) => settle(code));
            ffmpeg.on('exit', (code: number | null) => settle(code));
            ffmpeg.on('error', (error: Error) => {
                console.error('FFmpeg probe error:', error);
                settle(1);
            });

            timeout = setTimeout(() => {
                try { ffmpeg?.kill?.('SIGTERM'); } catch { }
                settle(1, true);
            }, timeoutMs);
        });
    }

    private isValidAvifEncoder(encoder: string | undefined): encoder is AvifEncoder {
        return !!encoder && Object.prototype.hasOwnProperty.call(AVIF_ENCODER_CONFIGS, encoder);
    }

    private getCachedAvifEncoder(normalizedPath: string): AvifEncoder | undefined {
        const cachedEncoder = this.externalTools.ffmpegDetectedEncoder;
        const cachedPath = this.externalTools.ffmpegDetectedEncoderPath;
        if (!this.isValidAvifEncoder(cachedEncoder)) return undefined;
        if (cachedPath && normalizeExecutablePath(cachedPath) !== normalizedPath) return undefined;
        return cachedEncoder;
    }

    private rememberAvifEncoder(normalizedPath: string, encoder: AvifEncoder): void {
        ImageProcessor.avifEncoderDetectionCache.set(normalizedPath, encoder);
        this.externalTools.ffmpegDetectedEncoder = encoder;
        this.externalTools.ffmpegDetectedEncoderPath = normalizedPath;
    }

    private validateAvifCrf(crf: number, encoder: AvifEncoder): number {
        const config = AVIF_ENCODER_CONFIGS[encoder];
        return Math.max(config.crfMin, Math.min(config.crfMax, crf));
    }

    private addAvifEncoderSpecificArgs(args: string[], encoderConfig: AvifEncoderConfig, preset: string): void {
        if (encoderConfig.supportsPreset) {
            if (encoderConfig.useCpuUsed) {
                args.push('-cpu-used', this.mapAvifPresetToCpuUsed(preset));
            } else {
                args.push('-preset', this.mapEncoderPreset(preset, encoderConfig));
            }
        }
        if (encoderConfig.supportsStillPicture) {
            args.push('-still-picture', '1');
        }
    }

    private mapEncoderPreset(preset: string, encoderConfig: AvifEncoderConfig): string {
        if (!encoderConfig.presetNames?.length) return preset;
        if (encoderConfig.presetNames.includes(preset)) return preset;

        const numericMap: Record<string, string> = {
            placebo: '0',
            veryslow: '1',
            slower: '2',
            slow: '4',
            medium: encoderConfig.presetNames[Math.floor(encoderConfig.presetNames.length / 2)],
            fast: encoderConfig.presetNames[Math.max(0, encoderConfig.presetNames.length - 4)],
            faster: encoderConfig.presetNames[Math.max(0, encoderConfig.presetNames.length - 3)],
            veryfast: encoderConfig.presetNames[Math.max(0, encoderConfig.presetNames.length - 2)],
            superfast: encoderConfig.presetNames[encoderConfig.presetNames.length - 1],
            ultrafast: encoderConfig.presetNames[encoderConfig.presetNames.length - 1],
        };

        const mapped = numericMap[preset] ?? preset;
        return encoderConfig.presetNames.includes(mapped)
            ? mapped
            : encoderConfig.presetNames[Math.floor(encoderConfig.presetNames.length / 2)];
    }

    /**
     * Handles TIFF image conversion using UTIF.js.
     * @param binary - The TIFF image data as an ArrayBuffer.
     * @returns A Promise that resolves to a Blob representing the decoded image.
     */
    private async handleTiff(binary: ArrayBuffer): Promise<Blob> {
        try {
            // Dynamically import UTIF only when needed
            const UTIF = await import('../UTIF.js').then(module => module.default);

            // UTIF expects ArrayBuffer or Buffer, not Uint8Array
            // Pass the ArrayBuffer directly
            const ifds = UTIF.decode(binary);
            UTIF.decodeImage(binary, ifds[0]);
            const rgba = UTIF.toRGBA8(ifds[0]);

            // Create canvas and draw image
            const canvas = document.createElement('canvas');
            canvas.width = ifds[0].width;
            canvas.height = ifds[0].height;
            const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
            const imageData = ctx.createImageData(canvas.width, canvas.height);
            imageData.data.set(rgba);
            ctx.putImageData(imageData, 0, 0);

            // Convert canvas to Blob
            return new Promise<Blob>((resolve, reject) => {
                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve(blob);
                    } else {
                        reject(new Error('Failed to convert canvas to Blob'));
                    }
                }, 'image/png'); // Default to PNG after TIFF decoding for broader compatibility and lossless format
            });
        } catch (error) {
            console.error('Error processing TIFF image:', error);
            throw new Error('Failed to process TIFF image');
        }
    }

    /**
     * Handles HEIC/HEIF image conversion using heic-to.js.
     * @param binary - The HEIC image data as an ArrayBuffer.
     * @param format - The desired output format ('JPEG' or 'PNG').
     * @param quality - The quality setting for JPEG (0.0 - 1.0).
     * @returns A Promise that resolves to a Blob representing the converted image.
     */
    private async handleHeic(
        binary: ArrayBuffer,
        format: 'JPEG' | 'PNG',
        quality: number
    ): Promise<Blob> {
        try {
            // Import heic-to for both platforms
            const { heicTo } = await import('../heic-to.min.js');

            // Convert ArrayBuffer to Blob
            const blob = new Blob([binary], { type: 'image/heic' });

            // Determine MIME type for the conversion format
            const outputMimeType = format === 'JPEG' ? 'image/jpeg' : 'image/png';

            // Convert using heic-to
            return await heicTo({
                blob,
                type: outputMimeType,
                quality
            });
        } catch (error) {
            console.error('Error converting HEIC:', error);
            throw new Error(`Failed to convert HEIC image: ${error.message}`);
        }
    }

    /**
     * Converts and compresses an image.
     * @param file - The image file as a Blob.
     * @param format - The desired output format ('WEBP', 'JPEG', 'PNG').
     * @param quality - The quality setting for lossy formats (0.0 - 1.0).
     * @param colorDepth - The color depth for PNG (0.0 - 1.0).
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width for resizing.
     * @param desiredHeight - The desired height for resizing.
     * @param desiredLongestEdge - The desired longest edge for resizing.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image during resizing.
     * @param allowLargerFiles - Whether to allow output files larger than the original.
     * @returns A Promise that resolves to the processed image as an ArrayBuffer.
     */
    private async convertAndCompress(
        file: Blob,
        format: 'WEBP' | 'JPEG' | 'PNG' | 'PNGQUANT' | 'AVIF', // Include AVIF
        quality: number,
        colorDepth: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        allowLargerFiles: boolean,
        inputPath: string | null = null
    ): Promise<ArrayBuffer> {
        switch (format) {
            case 'WEBP':
                return this.convertToWebP(
                    file,
                    quality,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce,
                    allowLargerFiles
                );
            case 'JPEG':
                return this.convertToJPG(
                    file,
                    quality,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce,
                    allowLargerFiles
                );
            case 'PNG':
                return this.convertToPNG(
                    file,
                    colorDepth,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce,
                    allowLargerFiles
                );
            case 'PNGQUANT': {// Add case for PNGQUANT
                const pngquantExecutablePath = this.externalTools.pngquantExecutablePath;
                const pngquantQuality = this.externalTools.pngquantQuality;
                // Check if executable path is set
                if (!pngquantExecutablePath) {
                    new Notice("PNGQUANT executable path is not set. Please configure it in the plugin settings.");
                    return file.arrayBuffer(); // Return original
                }

                // Check availability
                const isAvailable = await this.checkCommandAvailability(pngquantExecutablePath);
                if (!isAvailable) {
                    new Notice(`PNGQUANT executable not found or invalid at: ${pngquantExecutablePath}`);
                    return file.arrayBuffer();
                }

                return this.processWithPngquant(
                    file,
                    pngquantExecutablePath,
                    pngquantQuality,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce,
                    inputPath
                );
            }
            case 'AVIF': {
                const ffmpegExecutablePath = normalizeExecutablePath(this.externalTools.ffmpegExecutablePath);
                const ffmpegCrf = this.externalTools.ffmpegCrf;
                const ffmpegPreset = this.externalTools.ffmpegPreset;

                // Check if executable path is set
                if (!ffmpegExecutablePath) {
                    new Notice("FFmpeg executable path is not set. Please configure it in the plugin settings.");
                    return file.arrayBuffer();  // Return original
                }

                // Check availability
                const isAvailable = await this.checkCommandAvailability(ffmpegExecutablePath);
                if (!isAvailable) {
                    new Notice(`FFmpeg executable not found or invalid at: ${ffmpegExecutablePath}`);
                    return file.arrayBuffer();
                }

                return this.processWithFFmpeg(
                    file,
                    ffmpegExecutablePath,
                    ffmpegCrf,
                    ffmpegPreset,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce,
                    inputPath
                );
            }
            default:
                return file.arrayBuffer(); // No conversion needed
        }
    }

    /**
     * Processes an image using FFmpeg for AVIF conversion.
     * @param file The image file as a Blob.
     * @param executablePath The path to the FFmpeg executable.
     * @param crf The Constant Rate Factor for AVIF encoding (lower is better quality, 0-63).
     * @param preset  The encoding preset (e.g., 'veryslow', 'slow', 'medium', 'fast').
     * @param resizeMode The resizing mode (same as your existing enum).
     * @param desiredWidth Desired width for resizing.
     * @param desiredHeight Desired height for resizing.
     * @param desiredLongestEdge Desired longest edge for resizing.
     * @param enlargeOrReduce Whether to enlarge or reduce the image during resizing.
     * @returns A Promise that resolves to the processed image as an ArrayBuffer.
     */
    private async processWithFFmpeg(
        file: Blob,
        executablePath: string,
        crf: number,
        preset: string,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        inputPath: string | null = null,
        forcedEncoder?: AvifEncoder,
        fallbackAttempted = false
    ): Promise<ArrayBuffer> {
        const normalizedExecutablePath = normalizeExecutablePath(executablePath);
        const cachedEncoder = this.getCachedAvifEncoder(normalizedExecutablePath);
        const encoder = forcedEncoder ?? await this.detectAvifEncoder(normalizedExecutablePath, cachedEncoder);

        if (!encoder) {
            const errorMessage = "No AV1 encoder found in FFmpeg. Please install FFmpeg with AV1 support.";
            new Notice(errorMessage);
            throw new Error(errorMessage);
        }

        this.rememberAvifEncoder(normalizedExecutablePath, encoder);
        const encoderConfig = AVIF_ENCODER_CONFIGS[encoder];
        const validatedCrf = this.validateAvifCrf(crf, encoder);

        let resizedBlob: Blob = file;
        let useDirectFile = false;

        if (resizeMode !== 'None') {
            const resizedBuffer = await this.resizeImage(file, resizeMode, desiredWidth, desiredHeight, desiredLongestEdge, enlargeOrReduce);
            resizedBlob = new Blob([resizedBuffer], { type: file.type });
        } else if (inputPath) {
            useDirectFile = true;
        }

        const dimensions = await this.getImageDimensions(resizedBlob);

        // Use direct file check if available, else blob
        const hasTransparency = await this.checkForTransparency(resizedBlob);

        // imageData is needed only if NOT using direct file
        const imageData = useDirectFile ? null : await resizedBlob.arrayBuffer();


        // Create a temporary file path
        const tempDir = os.tmpdir(); // Get the system's temporary directory
        const tempFileName = `obsidian_image_converter_${Date.now()}.avif`; // Unique filename
        const tempFilePath = path.join(tempDir, tempFileName);


        return new Promise((resolve, reject) => {
            const scaleFilter = this.buildScaleFilter(resizeMode, dimensions, desiredWidth, desiredHeight, desiredLongestEdge);

            let args: string[];
            const inputArg = useDirectFile && inputPath ? inputPath : 'pipe:0'; // Input path or stdin pipe

            if (hasTransparency) {
                const scaleComponent = scaleFilter ? `,${scaleFilter}` : '';
                const filterComplex = [
                    `[0:v]format=rgba${scaleComponent},split[c][t]`,
                    '[c]format=yuv444p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv[c444]',
                    '[t]alphaextract,format=gray,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=pc[a]',
                ].join(';');

                args = [
                    '-i', inputArg,
                    '-filter_complex', filterComplex,
                    '-map', '[c444]',
                    '-map', '[a]',
                    '-frames:v:0', '1',
                    '-frames:v:1', '1',
                    '-c:v', encoder,
                    '-crf', validatedCrf.toString(),
                    '-b:v', '0',
                ];
                this.addAvifEncoderSpecificArgs(args, encoderConfig, preset);
                args.push('-y', '-f', 'avif', tempFilePath);
            } else {
                // For images without transparency
                let filterChain = 'format=yuv420p';
                if (scaleFilter) {
                    filterChain += `,${scaleFilter}`;
                }

                args = [
                    '-i', inputArg,
                    '-frames:v', '1',
                    '-filter:v', filterChain,
                    '-c:v', encoder,
                    '-crf', validatedCrf.toString(),
                    '-b:v', '0',
                ];
                this.addAvifEncoderSpecificArgs(args, encoderConfig, preset);
                args.push('-pix_fmt', 'yuv420p', '-y', '-f', 'avif', tempFilePath);
            }

            let ffmpeg: ChildProcess | null = null;
            let errorData = "";
            let settled = false;
            let safetyTimeout: ReturnType<typeof setTimeout> | null = null;

            const cleanupTempFile = async () => {
                try {
                    await fs.unlink(tempFilePath);
                } catch {
                    // Temp files are best-effort cleanup.
                }
            };

            const clearSafetyTimeout = () => {
                if (safetyTimeout) {
                    clearTimeout(safetyTimeout);
                    safetyTimeout = null;
                }
            };

            const fail = async (error: Error) => {
                if (settled) return;
                settled = true;
                clearSafetyTimeout();
                await cleanupTempFile();
                reject(error);
            };

            const failOrFallback = async (error: Error) => {
                if (settled) return;
                clearSafetyTimeout();
                await cleanupTempFile();

                const isHardwareEncoder = encoderConfig.platformHint !== 'software';
                const isHardwareError =
                    errorData.includes('Cannot load') ||
                    errorData.includes('could not open') ||
                    errorData.includes('Could not open encoder') ||
                    errorData.includes('nvcuda.dll') ||
                    errorData.includes('No NVENC capable devices');

                if (isHardwareEncoder && isHardwareError && !fallbackAttempted) {
                    const softwareFallback = await this.detectSoftwareAvifEncoder(normalizedExecutablePath);
                    if (softwareFallback) {
                        this.rememberAvifEncoder(normalizedExecutablePath, softwareFallback);
                        new Notice(`Hardware encoder unavailable. Falling back to ${softwareFallback}.`);
                        try {
                            const result = await this.processWithFFmpeg(
                                file,
                                normalizedExecutablePath,
                                crf,
                                preset,
                                resizeMode,
                                desiredWidth,
                                desiredHeight,
                                desiredLongestEdge,
                                enlargeOrReduce,
                                inputPath,
                                softwareFallback,
                                true
                            );
                            if (!settled) {
                                settled = true;
                                resolve(result);
                            }
                            return;
                        } catch (fallbackError) {
                            if (!settled) {
                                settled = true;
                                reject(fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)));
                            }
                            return;
                        }
                    }
                }

                if (!settled) {
                    settled = true;
                    reject(error);
                }
            };

            const succeed = async () => {
                if (settled) return;
                settled = true;
                clearSafetyTimeout();

                try {
                    const fileBuffer = await fs.readFile(tempFilePath);
                    resolve(this.nodeBufferToArrayBuffer(fileBuffer));
                } catch (readError) {
                    console.error("Error reading temporary file:", readError);
                    reject(new Error(`Failed to read the processed image from the temporary file: ${readError}`));
                } finally {
                    await cleanupTempFile();
                }
            };

            const completeFromExitCode = (code: number | null) => {
                if (code !== null && code !== 0) {
                    const errorMessage = `FFmpeg failed with code ${code}: ${errorData}`;
                    console.error(errorMessage);
                    void failOrFallback(new Error(errorMessage));
                    return;
                }

                void succeed();
            };

            try {
                if (Platform.isWin) {
                    ffmpeg = spawn(normalizedExecutablePath, args, { windowsHide: true });
                } else {
                    ffmpeg = spawn(normalizedExecutablePath, args);
                }
            } catch (spawnError) {
                const errorMessage = `Failed to spawn FFmpeg: ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`;
                console.error(errorMessage);
                void fail(new Error(errorMessage));
                return;
            }

            if (!ffmpeg) {
                void fail(new Error("Failed to spawn FFmpeg process."));
                return;
            }

            ffmpeg.stderr?.on('data', (data: Buffer) => {
                errorData += data.toString();
            });

            ffmpeg.on('close', (code: number | null) => completeFromExitCode(code));
            ffmpeg.on('exit', (code: number | null) => completeFromExitCode(code));

            ffmpeg.on('error', (err: Error) => {
                const errorMessage = `Error with FFmpeg process: ${err.message}`;
                console.error(errorMessage);
                void fail(new Error(errorMessage));
            });

            // Safety timeout to avoid hanging tests in case mocks fail to emit expected events
            safetyTimeout = setTimeout(() => {
                try { ffmpeg?.kill?.('SIGKILL'); } catch { }
                void fail(new Error('FFmpeg process timed out'));
            }, 5000);

            // Only write to stdin if NOT using direct file
            try {
                if (!useDirectFile && imageData) {
                    ffmpeg.stdin?.write(Buffer.from(imageData));
                    ffmpeg.stdin?.end();
                } else if (useDirectFile) {
                    // If using file input, close stdin to signal we won't send anything (just in case)
                    ffmpeg.stdin?.end();
                }
            } catch (stdinError) {
                const errorMessage = `Failed to write image data to FFmpeg: ${stdinError instanceof Error ? stdinError.message : String(stdinError)}`;
                console.error(errorMessage);
                void fail(new Error(errorMessage));
            }
        });
    }

    // Add this helper method to check for transparency
    private async checkForTransparency(blob: Blob): Promise<boolean> {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    resolve(false);
                    return;
                }

                ctx.drawImage(img, 0, 0);

                // Get image data and check for non-255 alpha values
                const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const { data } = imageData;

                for (let i = 3; i < data.length; i += 4) {
                    if (data[i] < 255) {
                        resolve(true);
                        return;
                    }
                }

                resolve(false);
            };

            img.onerror = () => resolve(false);

            const reader = new FileReader();
            reader.onload = (e) => {
                img.src = e.target?.result as string;
            };
            reader.onerror = () => resolve(false);
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Helper function to get the dimensions of an image Blob.
     */
    private async getImageDimensions(blob: Blob): Promise<{ width: number, height: number }> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                resolve({ width: img.naturalWidth, height: img.naturalHeight });
            };
            img.onerror = () => {
                reject(new Error("Failed to load image to get dimensions."));
            }
            img.src = URL.createObjectURL(blob);
        });
    }


    /**
     * Builds the FFmpeg scale filter string based on resize mode and desired dimensions.
     * Returns null if no scaling is needed.
     */
    private buildScaleFilter(
        resizeMode: ResizeMode,
        dimensions: { width: number, height: number },
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number
    ): string | null {

        const { width, height } = dimensions;
        const aspectRatio = width / height;

        let targetWidth: number;
        let targetHeight: number;

        switch (resizeMode) {
            case 'None':
                return null;  // No scaling

            case 'Fit':
                if (aspectRatio > desiredWidth / desiredHeight) {
                    targetWidth = desiredWidth;
                    targetHeight = Math.round(desiredWidth / aspectRatio);
                } else {
                    targetHeight = desiredHeight;
                    targetWidth = Math.round(desiredHeight * aspectRatio);
                }
                break;

            case 'Fill':
                if (aspectRatio > desiredWidth / desiredHeight) {
                    targetHeight = desiredHeight;
                    targetWidth = Math.round(desiredHeight * aspectRatio);
                } else {
                    targetWidth = desiredWidth;
                    targetHeight = Math.round(desiredWidth / aspectRatio);
                }
                break;

            case 'LongestEdge':
                if (width > height) {
                    targetWidth = desiredLongestEdge;
                    targetHeight = Math.round(desiredLongestEdge / aspectRatio);
                } else {
                    targetHeight = desiredLongestEdge;
                    targetWidth = Math.round(desiredLongestEdge * aspectRatio);
                }
                break;

            case 'ShortestEdge':  // Corrected case
                if (width < height) {  // Corrected condition
                    targetWidth = desiredLongestEdge;
                    targetHeight = Math.round(desiredLongestEdge / aspectRatio);
                } else {
                    targetHeight = desiredLongestEdge;
                    targetWidth = Math.round(desiredLongestEdge * aspectRatio);
                }
                break;

            case 'Width':
                targetWidth = desiredWidth;
                targetHeight = Math.round(desiredWidth / aspectRatio);
                break;

            case 'Height':
                targetHeight = desiredHeight;
                targetWidth = Math.round(desiredHeight * aspectRatio);
                break;

            default:
                return null; // Should not happen, but good for completeness
        }
        return `scale=${targetWidth}:${targetHeight}`;
    }

    /**
     * Converts an image to WebP format.
     * @param file - The image file as a Blob.
     * @param quality - The quality setting (0.0 - 1.0).
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width.
     * @param desiredHeight - The desired height.
     * @param desiredLongestEdge - The desired longest edge.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image.
     * @param allowLargerFiles - Whether to allow output files larger than the original.
     * @returns A Promise that resolves to the WebP image as an ArrayBuffer.
     */
    private async convertToWebP(
        file: Blob,
        quality: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        allowLargerFiles: boolean
    ): Promise<ArrayBuffer> {
        // Early return if no processing needed
        if (quality === 1 && resizeMode === 'None') {
            return file.arrayBuffer();
        }

        // Helper function to setup canvas with image
        const setupCanvas = async (imageData: string): Promise<{
            canvas: HTMLCanvasElement;
            context: CanvasRenderingContext2D;
        }> => {
            return new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => {
                    try {
                        const { imageWidth, imageHeight } = this.calculateDesiredDimensions(
                            image,
                            resizeMode,
                            desiredWidth,
                            desiredHeight,
                            desiredLongestEdge,
                            enlargeOrReduce
                        );

                        // Enforce Reduce semantics: do not upscale beyond original dimensions
                        let outWidth = imageWidth;
                        let outHeight = imageHeight;
                        if (enlargeOrReduce === 'Reduce' && (image.naturalWidth < imageWidth || image.naturalHeight < imageHeight)) {
                            outWidth = image.naturalWidth;
                            outHeight = image.naturalHeight;
                        }

                        const canvas = document.createElement('canvas');
                        const context = canvas.getContext('2d', {
                            willReadFrequently: false
                        });

                        if (!context) {
                            reject(new Error('Failed to get canvas context'));
                            return;
                        }

                        canvas.width = outWidth;
                        canvas.height = outHeight;

                        // Calculate the source rectangle for cropping
                        let sx = 0;
                        let sy = 0;
                        let sWidth = image.naturalWidth;
                        let sHeight = image.naturalHeight;

                        if (resizeMode === 'Fill') {
                            const scale = Math.max(outWidth / image.naturalWidth, outHeight / image.naturalHeight);
                            sWidth = outWidth / scale;
                            sHeight = outHeight / scale;
                            sx = Math.floor((image.naturalWidth - sWidth) / 2);
                            sy = Math.floor((image.naturalHeight - sHeight) / 2);
                        }

                        // Draw the image, optionally with cropping
                        context.drawImage(
                            image,
                            sx, sy, sWidth, sHeight,
                            0, 0, outWidth, outHeight
                        );

                        resolve({ canvas, context });
                    } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
                };
                image.onerror = (event) => {
                    console.error("WebP conversion error:", event);
                    reject(new Error('Failed to load image'));
                };
                image.src = imageData;
            });
        };

        try {
            // Read file as data URL once
            const imageData = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = (e) => resolve(e.target?.result as string);
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });

            // Setup canvas
            const { canvas } = await setupCanvas(imageData);

            // Try both conversion methods in parallel
            const [blobResult, dataUrlResult] = await Promise.all([
                // Method 1: toBlob approach
                new Promise<ArrayBuffer>((resolve) => {
                    canvas.toBlob(
                        async (blob) => {
                            resolve(await this.blobToArrayBufferOrEmpty(blob, 'WebP toBlob'));
                        },
                        'image/webp',
                        quality
                    );
                }),

                // Method 2: toDataURL approach
                new Promise<ArrayBuffer>((resolve) => {
                    const webpData = canvas.toDataURL('image/webp', quality);
                    resolve(this.base64ToArrayBuffer(webpData));
                })
            ]);

            // Get original format compression as well
            // We're working with the original blob at the beginning,but the crucial 
            // part is HOW we're creating the new compressed version. The path we take
            // to create the compressed version (toDataURL vs toBlob) can result in 
            // different compression algorithms being used internally by the browser.
            const originalCompressed = await this.compressOriginalImage(
                file,
                quality,
                resizeMode,
                desiredWidth,
                desiredHeight,
                desiredLongestEdge,
                enlargeOrReduce
            );

            // Compare all results and choose the smallest one
            const results = [
                { type: 'blob', data: blobResult, size: blobResult.byteLength },
                { type: 'dataUrl', data: dataUrlResult, size: dataUrlResult.byteLength },
                { type: 'original', data: originalCompressed, size: originalCompressed.byteLength }
            ].filter(result => result.size > 0);

            // Sort by size
            results.sort((left, right) => left.size - right.size);

            // If we don't allow larger files, filter out results larger than original
            // if (!allowLargerFiles) {
            //     const validResults = results.filter(result => result.size <= file.size);
            //     if (validResults.length > 0) {
            //         return validResults[0].data;
            //     }
            //     // If no valid results, return original file
            //     return file.arrayBuffer();
            // }

            // Return the smallest result
            return results[0].data;

        } catch (error) {
            console.error('WebP conversion error:', error);
            // Fallback to original file
            return file.arrayBuffer();
        }
    }

    /**
     * Converts an image to JPEG format.
     * @param file - The image file as a Blob.
     * @param quality - The quality setting (0.0 - 1.0).
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width.
     * @param desiredHeight - The desired height.
     * @param desiredLongestEdge - The desired longest edge.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image.
     * @param allowLargerFiles - Whether to allow output files larger than the original.
     * @returns A Promise that resolves to the JPEG image as an ArrayBuffer.
     */
    private async convertToJPG(
        file: Blob,
        quality: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        allowLargerFiles: boolean
    ): Promise<ArrayBuffer> {
        // Early return if no processing needed
        if (quality === 1 && resizeMode === 'None') {
            return file.arrayBuffer();
        }

        // Helper function to setup canvas with image
        const setupCanvas = async (imageData: string): Promise<{
            canvas: HTMLCanvasElement;
            context: CanvasRenderingContext2D;
        }> => {
            return new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => {
                    try {
                        const { imageWidth, imageHeight } = this.calculateDesiredDimensions(
                            image,
                            resizeMode,
                            desiredWidth,
                            desiredHeight,
                            desiredLongestEdge,
                            enlargeOrReduce
                        );

                        // Enforce Reduce semantics: do not upscale beyond original dimensions
                        let outWidth = imageWidth;
                        let outHeight = imageHeight;
                        if (enlargeOrReduce === 'Reduce' && (image.naturalWidth < imageWidth || image.naturalHeight < imageHeight)) {
                            outWidth = image.naturalWidth;
                            outHeight = image.naturalHeight;
                        }

                        const canvas = document.createElement('canvas');
                        // For JPG, we definitely want to disable alpha
                        const context = canvas.getContext('2d', {
                            willReadFrequently: false,
                            alpha: false // JPG doesn't support alpha, so we can disable it
                        });

                        if (!context) {
                            reject(new Error('Failed to get canvas context'));
                            return;
                        }

                        canvas.width = outWidth;
                        canvas.height = outHeight;

                        // Calculate the source rectangle for cropping
                        let sx = 0;
                        let sy = 0;
                        let sWidth = image.naturalWidth;
                        let sHeight = image.naturalHeight;

                        if (resizeMode === 'Fill') {
                            const scale = Math.max(outWidth / image.naturalWidth, outHeight / image.naturalHeight);
                            sWidth = outWidth / scale;
                            sHeight = outHeight / scale;
                            sx = Math.floor((image.naturalWidth - sWidth) / 2);
                            sy = Math.floor((image.naturalHeight - sHeight) / 2);
                        }

                        // Draw the image, optionally with cropping
                        context.drawImage(
                            image,
                            sx, sy, sWidth, sHeight,
                            0, 0, outWidth, outHeight
                        );

                        resolve({ canvas, context });
                    } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
                };
                image.onerror = (event) => {
                    console.error("JPEG conversion error:", event);
                    reject(new Error('Failed to load image'));
                };
                image.src = imageData;
            });
        };

        try {
            // Read file as data URL once
            const imageData = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = (e) => resolve(e.target?.result as string);
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });

            // Setup canvas
            const { canvas } = await setupCanvas(imageData);

            // Try both conversion methods in parallel
            const [blobResult, dataUrlResult] = await Promise.all([
                // Method 1: toBlob approach
                new Promise<ArrayBuffer>((resolve) => {
                    canvas.toBlob(
                        async (blob) => {
                            if (!blob) {
                                resolve(new ArrayBuffer(0));
                                return;
                            }
                            resolve(await blob.arrayBuffer());
                        },
                        'image/jpeg',
                        quality
                    );
                }),

                // Method 2: toDataURL approach
                new Promise<ArrayBuffer>((resolve) => {
                    const jpegData = canvas.toDataURL('image/jpeg', quality);
                    resolve(this.base64ToArrayBuffer(jpegData));
                })
            ]);

            // Compare all results and choose the smallest one
            const results: { type: string; data: ArrayBuffer; size: number }[] = [
                { type: 'blob', data: blobResult, size: blobResult.byteLength },
                { type: 'dataUrl', data: dataUrlResult, size: dataUrlResult.byteLength }
            ];
            // Include original format compression only when input is not already JPEG
            if (file.type !== 'image/jpeg') {
                const originalCompressed = await this.compressOriginalImage(
                    file,
                    quality,
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce
                );
                results.push({ type: 'original', data: originalCompressed, size: originalCompressed.byteLength });
            }

            const filtered = results.filter(result => result.size > 0);

            // Sort by size
            filtered.sort((left, right) => left.size - right.size);

            // If we don't allow larger files, filter out results larger than original
            // if (!allowLargerFiles) {
            //     const validResults = filtered.filter(result => result.size <= file.size);
            //     if (validResults.length > 0) {
            //         return validResults[0].data;
            //     }
            //     // If no valid results, return original file
            //     return file.arrayBuffer();
            // }

            // Return the smallest result
            return filtered[0].data;

        } catch (error) {
            console.error('JPEG conversion error:', error);
            // Fallback to original file
            return file.arrayBuffer();
        }
    }

    /**
     * Converts an image to PNG format.
     * @param file - The image file as a Blob.
     * @param colorDepth - The color depth (0.0 - 1.0).
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width.
     * @param desiredHeight - The desired height.
     * @param desiredLongestEdge - The desired longest edge.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image.
     * @param allowLargerFiles - Whether to allow output files larger than the original.
     * @returns A Promise that resolves to the PNG image as an ArrayBuffer.
     */
    private async convertToPNG(
        file: Blob,
        colorDepth: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        allowLargerFiles: boolean
    ): Promise<ArrayBuffer> {
        // Early return if no processing needed
        if (colorDepth === 1 && resizeMode === 'None') {
            return file.arrayBuffer();
        }

        // Helper function to setup canvas with image
        const setupCanvas = async (imageData: string): Promise<{
            canvas: HTMLCanvasElement;
            context: CanvasRenderingContext2D;
        }> => {
            return new Promise((resolve, reject) => {
                const image = new Image();
                image.onload = () => {
                    try {
                        const { imageWidth, imageHeight } = this.calculateDesiredDimensions(
                            image,
                            resizeMode,
                            desiredWidth,
                            desiredHeight,
                            desiredLongestEdge,
                            enlargeOrReduce
                        );

                        // Enforce Reduce semantics: do not upscale beyond original dimensions
                        let outWidth = imageWidth;
                        let outHeight = imageHeight;
                        if (enlargeOrReduce === 'Reduce' && (image.naturalWidth < imageWidth || image.naturalHeight < imageHeight)) {
                            outWidth = image.naturalWidth;
                            outHeight = image.naturalHeight;
                        }

                        const canvas = document.createElement('canvas');
                        // For PNG, we want to keep alpha channel
                        const context = canvas.getContext('2d', {
                            willReadFrequently: colorDepth < 1, // Only if we need color reduction
                            alpha: true
                        });

                        if (!context) {
                            reject(new Error('Failed to get canvas context'));
                            return;
                        }

                        canvas.width = outWidth;
                        canvas.height = outHeight;

                        // Calculate the source rectangle for cropping
                        let sx = 0;
                        let sy = 0;
                        let sWidth = image.naturalWidth;
                        let sHeight = image.naturalHeight;

                        if (resizeMode === 'Fill') {
                            const scale = Math.max(outWidth / image.naturalWidth, outHeight / image.naturalHeight);
                            sWidth = outWidth / scale;
                            sHeight = outHeight / scale;
                            sx = (image.naturalWidth - sWidth) / 2;
                            sy = (image.naturalHeight - sHeight) / 2;
                        }

                        // Draw the image, optionally with cropping
                        context.drawImage(
                            image,
                            sx, sy, sWidth, sHeight,
                            0, 0, outWidth, outHeight
                        );

                        // Apply color depth reduction if needed
                        if (colorDepth < 1) {
                            const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
                            const reducedImageData = this.reduceColorDepth(imageData, colorDepth);
                            context.putImageData(reducedImageData, 0, 0);
                        }

                        resolve({ canvas, context });
                    } catch (e) { reject(e instanceof Error ? e : new Error(String(e))); }
                };
                image.onerror = (event) => {
                    console.error("PNG conversion error:", event);
                    reject(new Error('Failed to load image'));
                };
                image.src = imageData;
            });
        };

        try {
            // Read file as data URL once
            const imageData = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = (e) => resolve(e.target?.result as string);
                reader.onerror = () => reject(new Error('Failed to read file'));
                reader.readAsDataURL(file);
            });

            // Setup canvas
            const { canvas } = await setupCanvas(imageData);

            // Try both conversion methods in parallel
            const [blobResult, dataUrlResult] = await Promise.all([
                // Method 1: toBlob approach
                new Promise<ArrayBuffer>((resolve) => {
                    canvas.toBlob(
                        async (blob) => {
                            resolve(await this.blobToArrayBufferOrEmpty(blob, 'PNG toBlob'));
                        },
                        'image/png'
                    );
                }),

                // Method 2: toDataURL approach
                new Promise<ArrayBuffer>((resolve) => {
                    const pngData = canvas.toDataURL('image/png');
                    resolve(this.base64ToArrayBuffer(pngData));
                })
            ]);

            // For PNG, we might want to try additional optimization methods
            const results = [
                { type: 'blob', data: blobResult, size: blobResult.byteLength },
                { type: 'dataUrl', data: dataUrlResult, size: dataUrlResult.byteLength }
            ];

            // If input wasn't PNG, add original format as comparison
            if (file.type !== 'image/png') {
                const originalCompressed = await this.compressOriginalImage(
                    file,
                    1, // PNG doesn't use quality parameter
                    resizeMode,
                    desiredWidth,
                    desiredHeight,
                    desiredLongestEdge,
                    enlargeOrReduce
                );
                results.push({
                    type: 'original',
                    data: originalCompressed,
                    size: originalCompressed.byteLength
                });
            }

            // Filter out empty results and sort by size
            const validResults = results
                .filter(result => result.size > 0)
                .sort((left, right) => left.size - right.size);

            // If we don't allow larger files, filter out results larger than original
            // if (!allowLargerFiles) {
            //     const smallerResults = validResults.filter(result => result.size <= file.size);
            //     if (smallerResults.length > 0) {
            //         return smallerResults[0].data;
            //     }
            //     // If no valid results, return original file
            //     return file.arrayBuffer();
            // }

            // Return the smallest result
            return validResults[0].data;

        } catch (error) {
            console.error('PNG conversion error:', error);
            // Fallback to original file
            return file.arrayBuffer();
        }
    }

    /**
     * Processes an image using PNGQUANT.
     * @param file The image file as a Blob.
     * @param executablePath The path to the PNGQUANT executable.
     * @param quality The quality setting for PNGQUANT (e.g., "65-80").
     * @param resizeMode The resizing mode (same as your existing enum).
     * @param desiredWidth Desired width for resizing.
     * @param desiredHeight Desired height for resizing.
     * @param desiredLongestEdge Desired longest edge for resizing.
     * @param enlargeOrReduce Whether to enlarge or reduce the image during resizing.
     * @returns A Promise that resolves to the processed image as an ArrayBuffer.
     */
    // Inside ImageProcessor.ts

    private async processWithPngquant(
        file: Blob,
        executablePath: string,
        quality: string,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        inputPath: string | null = null
    ): Promise<ArrayBuffer> {

        let resizedBlob: Blob = file;

        if (resizeMode !== 'None') {
            const resizedBuffer = await this.resizeImage(file, resizeMode, desiredWidth, desiredHeight, desiredLongestEdge, enlargeOrReduce);
            resizedBlob = new Blob([resizedBuffer], { type: file.type });
        }

        // Keep pngquant on stdin/stdout to avoid source-file side effects.
        const imageData = await resizedBlob.arrayBuffer();

        return new Promise((resolve, reject) => {
            const args = ['--quality', quality, '-'];

            let pngquant: ChildProcess | null = null;

            try {
                if (Platform.isWin) {
                    pngquant = spawn(executablePath, args, { windowsHide: true });
                } else {
                    pngquant = spawn(executablePath, args);
                }
            } catch (spawnError) {
                const errorMessage = `Failed to spawn pngquant: ${spawnError instanceof Error ? spawnError.message : String(spawnError)}`;
                console.error(errorMessage);
                reject(new Error(errorMessage));
                return;
            }

            if (!pngquant) {
                reject(new Error("Failed to spawn pngquant process."));
                return;
            }

            const outputData: Buffer[] = [];
            let errorData = "";

            pngquant.stdout?.on('data', (data: Buffer) => {
                outputData.push(data);
            });

            pngquant.stderr?.on('data', (data: Buffer) => {
                errorData += data.toString();
            });

            let settled = false;

            const complete = (code: number | null) => {
                if (settled) return;
                settled = true;

                if (code !== 0) {
                    const errorMessage = `pngquant failed with code ${code}: ${errorData}`;
                    console.error(errorMessage);
                    reject(new Error(errorMessage));
                    return;
                }

                const resultBuffer = Buffer.concat(outputData);
                resolve(this.nodeBufferToArrayBuffer(resultBuffer));
            };

            pngquant.on('close', (code: number | null) => complete(code));
            pngquant.on('exit', (code: number | null) => complete(code));

            pngquant.on('error', (err: Error) => {
                if (settled) return;
                settled = true;
                const errorMessage = `Error with pngquant process: ${err.message}`;
                console.error(errorMessage);
                reject(new Error(errorMessage));
            });

            try {
                pngquant.stdin?.write(Buffer.from(imageData));
                pngquant.stdin?.end();
            } catch (stdinError) {
                if (settled) return;
                settled = true;
                const errorMessage = `Failed to write image data to pngquant: ${stdinError instanceof Error ? stdinError.message : String(stdinError)}`;
                console.error(errorMessage);
                reject(new Error(errorMessage));
            }

        });
    }

    /**
     * Compresses an image using its original format.
     * @param file - The image file as a Blob.
     * @param quality - The quality setting for lossy formats (0.0 - 1.0).
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width.
     * @param desiredHeight - The desired height.
     * @param desiredLongestEdge - The desired longest edge.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image.
     * @returns A Promise that resolves to the compressed image as an ArrayBuffer.
     */
    async compressOriginalImage(
        file: Blob,
        quality: number,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce
    ): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const reader = new FileReader();

            reader.onload = (e) => {
                img.onload = () => {
                    const { imageWidth, imageHeight } = this.calculateDesiredDimensions(
                        img,
                        resizeMode,
                        desiredWidth,
                        desiredHeight,
                        desiredLongestEdge,
                        enlargeOrReduce
                    );

                    const canvas = document.createElement('canvas');
                    canvas.width = imageWidth;
                    canvas.height = imageHeight;

                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('Failed to get canvas context'));
                        return;
                    }

                    // Calculate source x, y, width, and height for cropping (if needed)
                    let sx = 0;
                    let sy = 0;
                    let sWidth = img.naturalWidth;
                    let sHeight = img.naturalHeight;

                    if (resizeMode === 'Fill') {
                        // Scale factor to fill the canvas
                        const scale = Math.max(imageWidth / img.naturalWidth, imageHeight / img.naturalHeight);
                        sWidth = imageWidth / scale;
                        sHeight = imageHeight / scale;
                        sx = Math.floor((img.naturalWidth - sWidth) / 2);
                        sy = Math.floor((img.naturalHeight - sHeight) / 2);
                    }

                    // Draw the (potentially cropped) image onto the canvas
                    ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, imageWidth, imageHeight);

                    const blobType = file.type || 'image/jpeg';

                    // Use original format instead of hardcoding JPEG
                    canvas.toBlob(
                        (blob) => {
                            if (!blob) {
                                reject(new Error('Failed to create blob'));
                                return;
                            }
                            blob.arrayBuffer().then(resolve).catch(reject);
                        },
                        blobType,
                        quality
                    );
                };

                img.onerror = (event) => {
                    console.error("Original Compression error:", event);
                    reject(new Error('Failed to load image'));
                };
                img.src = e.target?.result as string;
            };

            reader.onerror = () => reject(new Error('Failed to read file'));
            reader.readAsDataURL(file);
        });
    }

    /**
     * Resizes an image without changing its format or applying compression.
     * @param file - The image file as a Blob.
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width.
     * @param desiredHeight - The desired height.
     * @param desiredLongestEdge - The desired longest edge.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image.
     * @returns A Promise that resolves to the resized image as an ArrayBuffer.
     */
    async resizeImage(
        file: Blob,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce,
        quality: number = 1
    ): Promise<ArrayBuffer> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const reader = new FileReader();

            reader.onload = (e) => {
                img.onload = () => {
                    const { imageWidth, imageHeight } = this.calculateDesiredDimensions(
                        img,
                        resizeMode,
                        desiredWidth,
                        desiredHeight,
                        desiredLongestEdge,
                        enlargeOrReduce
                    );

                    const canvas = document.createElement('canvas');
                    canvas.width = imageWidth;
                    canvas.height = imageHeight;

                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('Failed to get canvas context'));
                        return;
                    }

                    // Draw the image onto the canvas with the new dimensions
                    ctx.drawImage(img, 0, 0, imageWidth, imageHeight);

                    canvas.toBlob(
                        (blob) => {
                            if (!blob) {
                                reject(new Error('Failed to create blob'));
                                return;
                            }
                            blob.arrayBuffer().then(resolve).catch(reject);
                        },
                        file.type, // Use the original file's MIME type
                        quality
                    );
                };

                img.onerror = (event) => {
                    console.error("Image resizing error:", event);
                    reject(new Error('Failed to load image for resizing'));
                };
                img.src = e.target?.result as string;
            };

            reader.onerror = () => reject(new Error('Failed to read file for resizing'));
            reader.readAsDataURL(file);
        });
    }

    /**
     * Calculates the desired dimensions for resizing an image.
     * @param image - The image element.
     * @param resizeMode - The resizing mode.
     * @param desiredWidth - The desired width.
     * @param desiredHeight - The desired height.
     * @param desiredLongestEdge - The desired longest edge.
     * @param enlargeOrReduce - Whether to enlarge or reduce the image.
     * @returns An object containing the calculated dimensions and aspect ratio.
     */
    private calculateDesiredDimensions(
        image: HTMLImageElement,
        resizeMode: ResizeMode,
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: EnlargeReduce
    ): Dimensions {
        let imageWidth = image.naturalWidth;
        let imageHeight = image.naturalHeight;
        const aspectRatio = imageWidth / imageHeight;

        switch (resizeMode) {
            case 'None':
                // No resizing needed
                break;
            case 'Fit':
                if (aspectRatio > desiredWidth / desiredHeight) {
                    imageWidth = desiredWidth;
                    imageHeight = imageWidth / aspectRatio;
                } else {
                    imageHeight = desiredHeight;
                    imageWidth = imageHeight * aspectRatio;
                }
                break;
            case 'Fill':
                // Destination should exactly match target bounds; source rect will be center-cropped
                imageWidth = desiredWidth;
                imageHeight = desiredHeight;
                break;
            case 'LongestEdge':
                if (imageWidth > imageHeight) {
                    imageWidth = desiredLongestEdge;
                    imageHeight = imageWidth / aspectRatio;
                } else {
                    imageHeight = desiredLongestEdge;
                    imageWidth = imageHeight * aspectRatio;
                }
                break;
            case 'ShortestEdge':
                if (imageWidth < imageHeight) {
                    imageWidth = desiredLongestEdge;
                    imageHeight = imageWidth / aspectRatio;
                } else {
                    imageHeight = desiredLongestEdge;
                    imageWidth = imageHeight * aspectRatio;
                }
                break;
            case 'Width':
                imageWidth = desiredWidth;
                imageHeight = imageWidth / aspectRatio;
                break;
            case 'Height':
                imageHeight = desiredHeight;
                imageWidth = imageHeight * aspectRatio;
                break;
        }

        // Enlarge or reduce based on the enlargeOrReduce setting
        switch (enlargeOrReduce) {
            case 'Auto':
                // No specific action needed here. 
                // 'Auto' means resize to the exact dimensions specified by resizeMode
                break;
            case 'Reduce':
                // Only reduce if the image is larger than the desired dimensions
                if (image.naturalWidth > imageWidth || image.naturalHeight > imageHeight) {
                    // Do nothing, the desired dimensions are already calculated
                } else {
                    // Image is smaller, so use original dimensions
                    imageWidth = image.naturalWidth;
                    imageHeight = image.naturalHeight;
                }
                break;
            case 'Enlarge':
                // Only enlarge if the image is smaller than the desired dimensions
                if (image.naturalWidth < imageWidth && image.naturalHeight < imageHeight) {
                    // Do nothing, the desired dimensions are already calculated
                } else {
                    // Image is larger, so use original dimensions
                    imageWidth = image.naturalWidth;
                    imageHeight = image.naturalHeight;
                }
                break;
        }

        return { imageWidth, imageHeight, aspectRatio };
    }

    /**
     * Reduces the color depth of an image.
     * @param imageData - The image data.
     * @param colorDepth - The color depth (0.0 - 1.0).
     * @returns The image data with reduced color depth.
     */
    private reduceColorDepth(imageData: ImageData, colorDepth: number): ImageData {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Failed to get canvas context');
        }
        canvas.width = imageData.width;
        canvas.height = imageData.height;
        ctx.putImageData(imageData, 0, 0);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const numColors = Math.pow(256, colorDepth);
        const reducedData = new Uint8ClampedArray(data.length);
        for (let i = 0; i < data.length; i += 4) {
            const red = data[i];
            const green = data[i + 1];
            const blue = data[i + 2];
            const reducedR = Math.round(red / (256 / numColors)) * (256 / numColors);
            const reducedG = Math.round(green / (256 / numColors)) * (256 / numColors);
            const reducedB = Math.round(blue / (256 / numColors)) * (256 / numColors);
            reducedData[i] = reducedR;
            reducedData[i + 1] = reducedG;
            reducedData[i + 2] = reducedB;
            reducedData[i + 3] = data[i + 3];
        }
        const reducedImageData = new ImageData(reducedData, imageData.width, imageData.height);
        return reducedImageData;
    }

    private nodeBufferToArrayBuffer(buffer: Buffer): ArrayBuffer {
        const arrayBuffer = new ArrayBuffer(buffer.byteLength);
        new Uint8Array(arrayBuffer).set(buffer);
        return arrayBuffer;
    }

    private async blobToArrayBufferOrEmpty(blob: Blob | null, context: string): Promise<ArrayBuffer> {
        if (!blob) {
            return new ArrayBuffer(0);
        }

        try {
            return await blob.arrayBuffer();
        } catch (error) {
            console.error(`${context} failed:`, error);
            return new ArrayBuffer(0);
        }
    }

    private mapAvifPresetToCpuUsed(preset: string): string {
        const numeric = Number(preset);
        if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 8) {
            return String(numeric);
        }

        const presetMap: Record<string, number> = {
            placebo: 0,
            veryslow: 0,
            slower: 1,
            slow: 2,
            medium: 4,
            fast: 5,
            faster: 6,
            veryfast: 7,
            superfast: 8,
            ultrafast: 8,
        };

        return String(presetMap[preset] ?? 4);
    }

    private notifyProcessingFailure(filename: string, format: string, error: unknown): void {
        const reason = error instanceof Error ? error.message : String(error);
        new Notice(`Failed to process ${filename} as ${format}: ${reason}`);
    }

    /**
     * Converts a base64 string to an ArrayBuffer.
     * @param base64 - The base64 string.
     * @returns The ArrayBuffer.
     */
    private base64ToArrayBuffer(base64: string): ArrayBuffer {
        const binary = atob(base64.split(',')[1]);
        const { length } = binary;
        const buffer = new ArrayBuffer(length);
        const view = new Uint8Array(buffer);

        for (let i = 0; i < length; i++) {
            view[i] = binary.charCodeAt(i);
        }

        return buffer;
    }

    /**
     * Extracts metadata from an image file.
     * @param file - The image file as a Blob, TFile, or string path.
     * @returns A Promise that resolves to the extracted metadata.
     */
    private async extractMetadata(file: Blob | TFile | string): Promise<piexif.ExifDict | undefined> {
        let blob: Blob;

        // Normalize input to Blob
        if (file instanceof Blob) {
            blob = file;
        } else if (file instanceof TFile) {
            const data = await this.app.vault.readBinary(file);
            blob = new Blob([new Uint8Array(data)]);
        } else if (typeof file === 'string') {
            const buffer = await fs.readFile(file);
            blob = new Blob([new Uint8Array(buffer)]);
        } else {
            return undefined;
        }

        const reader = new FileReader();
        const fileDataUrl = await new Promise<string>((resolve, reject) => {
            reader.onload = (e) => resolve(e.target?.result as string);
            reader.onerror = () => reject(new Error("Failed to read file for metadata"));
            reader.readAsDataURL(blob);
        });

        try {
            return piexif.load(fileDataUrl);
        } catch {
            return;
        }
    }

    private async applyMetadata(
        buffer: ArrayBuffer,
        metadata: string
    ): Promise<ArrayBuffer> {
        try {
            // Convert ArrayBuffer to Base64 string in chunks
            const uint8Array = new Uint8Array(buffer);
            let binaryString = '';
            const chunkSize = 8192; // Process in chunks to avoid stack overflow
            for (let i = 0; i < uint8Array.length; i += chunkSize) {
                binaryString += String.fromCharCode.apply(
                    null,
                    uint8Array.subarray(i, i + chunkSize)
                );
            }
            const base64Data = `data:image/jpeg;base64,${btoa(binaryString)}`;

            // Insert EXIF metadata using piexif
            const updatedBase64 = piexif.insert(metadata, base64Data);

            // Convert the updated Base64 string back to an ArrayBuffer
            const updatedBinaryString = atob(updatedBase64.split(',')[1]);
            const updatedBuffer = new ArrayBuffer(updatedBinaryString.length);
            const updatedUint8Array = new Uint8Array(updatedBuffer);
            for (let i = 0; i < updatedBinaryString.length; i++) {
                updatedUint8Array[i] = updatedBinaryString.charCodeAt(i);
            }

            return updatedBuffer;
        } catch (error) {
            console.error("Error applying metadata:", error);
            return buffer; // Return original if metadata application fails
        }
    }
}
