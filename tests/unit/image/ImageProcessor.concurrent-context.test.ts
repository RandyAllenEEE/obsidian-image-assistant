import { describe, expect, it, vi } from "vitest";
import { ImageProcessor } from "../../../src/local/ImageProcessor";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";
import { fakeApp } from "../../factories/obsidian";

describe("ImageProcessor per-call processing context", () => {
    it("keeps interleaved FFmpeg and PNGQuant settings isolated", async () => {
        const supported = {
            getMimeTypeFromFile: vi.fn(async () => "image/png"),
            isSupported: vi.fn(() => true)
        };
        const processor = new ImageProcessor(fakeApp() as any, supported as any);
        vi.spyOn(processor as any, "checkCommandAvailability").mockResolvedValue(true);

        const ffmpegCalls: unknown[][] = [];
        vi.spyOn(processor as any, "processWithFFmpeg")
            .mockImplementation(async (...args: unknown[]) => {
                await Promise.resolve();
                ffmpegCalls.push(args);
                return new Uint8Array([1, 2, 3]).buffer;
            });
        const pngquantCalls: unknown[][] = [];
        vi.spyOn(processor as any, "processWithPngquant")
            .mockImplementation(async (...args: unknown[]) => {
                await Promise.resolve();
                pngquantCalls.push(args);
                return new Uint8Array([4, 5, 6]).buffer;
            });

        const input = new Blob([new Uint8Array([9, 8, 7])], { type: "image/png" });
        const firstSettings = structuredClone(DEFAULT_SETTINGS);
        const secondSettings = structuredClone(DEFAULT_SETTINGS);
        firstSettings.localProcessing.externalTools.ffmpegExecutablePath = "C:/tools/first-ffmpeg.exe";
        secondSettings.localProcessing.externalTools.ffmpegExecutablePath = "D:/tools/second-ffmpeg.exe";

        await Promise.all([
            processor.processImage(
                input, "AVIF", 0.8, 1, "None", 0, 0, 0, "Auto", true,
                {
                    ...firstSettings.localProcessing.externalTools,
                    ffmpegCrf: 21,
                    ffmpegPreset: "slow"
                },
                firstSettings
            ),
            processor.processImage(
                input, "AVIF", 0.8, 1, "None", 0, 0, 0, "Auto", true,
                {
                    ...secondSettings.localProcessing.externalTools,
                    ffmpegCrf: 47,
                    ffmpegPreset: "fast"
                },
                secondSettings
            ),
            processor.processImage(
                input, "PNGQUANT", 0.8, 1, "None", 0, 0, 0, "Auto", true,
                {
                    ...firstSettings.localProcessing.externalTools,
                    pngquantExecutablePath: "E:/tools/pngquant.exe",
                    pngquantQuality: "52-68"
                },
                firstSettings
            )
        ]);

        expect(ffmpegCalls).toHaveLength(2);
        expect(ffmpegCalls.map(call => call.slice(1, 4))).toEqual(expect.arrayContaining([
            ["C:\\tools\\first-ffmpeg.exe", 21, "slow"],
            ["D:\\tools\\second-ffmpeg.exe", 47, "fast"]
        ]));
        expect((ffmpegCalls[0][10] as any).externalTools)
            .not.toBe((ffmpegCalls[1][10] as any).externalTools);
        expect(pngquantCalls).toHaveLength(1);
        expect(pngquantCalls[0].slice(1, 3)).toEqual(["E:/tools/pngquant.exe", "52-68"]);
    });
});
