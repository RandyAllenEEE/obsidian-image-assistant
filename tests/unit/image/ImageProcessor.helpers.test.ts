import { describe, expect, it } from "vitest";
import { AVIF_ENCODER_CONFIGS, ImageProcessor } from "../../../src/local/ImageProcessor";
import { fakeApp } from "../../factories/obsidian";

function processor(): any {
    return new ImageProcessor(fakeApp() as any, {} as any);
}

describe("ImageProcessor FFmpeg and format helpers", () => {
    it("builds scale filters for every resize mode and orientation", () => {
        const subject = processor();

        expect(subject.buildScaleFilter("None", { width: 400, height: 200 }, 100, 100, 100)).toBeNull();
        expect(subject.buildScaleFilter("Fit", { width: 400, height: 200 }, 100, 100, 0)).toBe("scale=100:50");
        expect(subject.buildScaleFilter("Fit", { width: 200, height: 400 }, 100, 100, 0)).toBe("scale=50:100");
        expect(subject.buildScaleFilter("Fill", { width: 400, height: 200 }, 100, 100, 0)).toBe("scale=200:100");
        expect(subject.buildScaleFilter("Fill", { width: 200, height: 400 }, 100, 100, 0)).toBe("scale=100:200");
        expect(subject.buildScaleFilter("LongestEdge", { width: 400, height: 200 }, 0, 0, 300)).toBe("scale=300:150");
        expect(subject.buildScaleFilter("LongestEdge", { width: 200, height: 400 }, 0, 0, 300)).toBe("scale=150:300");
        expect(subject.buildScaleFilter("ShortestEdge", { width: 200, height: 400 }, 0, 0, 300)).toBe("scale=300:600");
        expect(subject.buildScaleFilter("ShortestEdge", { width: 400, height: 200 }, 0, 0, 300)).toBe("scale=600:300");
        expect(subject.buildScaleFilter("Width", { width: 400, height: 200 }, 320, 0, 0)).toBe("scale=320:160");
        expect(subject.buildScaleFilter("Height", { width: 400, height: 200 }, 0, 240, 0)).toBe("scale=480:240");
        expect(subject.buildScaleFilter("Unknown", { width: 400, height: 200 }, 0, 0, 0)).toBeNull();
    });

    it("maps AVIF presets without leaking encoder-specific values", () => {
        const subject = processor();
        const args: string[] = [];

        subject.addAvifEncoderSpecificArgs(args, AVIF_ENCODER_CONFIGS["libsvtav1"], "slow");
        expect(args).toEqual(["-preset", "4"]);

        const stillArgs: string[] = [];
        subject.addAvifEncoderSpecificArgs(stillArgs, AVIF_ENCODER_CONFIGS["libaom-av1"], "veryfast");
        expect(stillArgs).toEqual(["-cpu-used", "7", "-still-picture", "1"]);
        expect(subject.mapAvifPresetToCpuUsed("8")).toBe("8");
        expect(subject.mapEncoderPreset("p3", AVIF_ENCODER_CONFIGS.av1_nvenc)).toBe("p3");
        expect(subject.mapEncoderPreset("unknown", AVIF_ENCODER_CONFIGS.av1_nvenc)).toBe("p4");
        expect(subject.mapEncoderPreset("custom", { supportsPreset: true, platformHint: "software" })).toBe("custom");
    });

    it("maps all supported filename extensions to their actual MIME types", () => {
        const subject = processor();
        const expected = {
            jpg: "image/jpeg",
            jpeg: "image/jpeg",
            png: "image/png",
            webp: "image/webp",
            gif: "image/gif",
            bmp: "image/bmp",
            ico: "image/x-icon",
            tif: "image/tiff",
            tiff: "image/tiff",
            avif: "image/avif",
            heic: "image/heic",
            heif: "image/heif",
            svg: "image/svg+xml"
        };

        for (const [extension, mime] of Object.entries(expected)) {
            expect(subject.mimeFromExtension(extension.toUpperCase())).toBe(mime);
        }
        expect(subject.mimeFromExtension("unknown")).toBeUndefined();
    });
});
