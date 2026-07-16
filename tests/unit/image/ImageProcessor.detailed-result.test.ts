import { describe, expect, it, vi } from "vitest";
import { ImageProcessor } from "../../../src/local/ImageProcessor";
import { SupportedImageFormats } from "../../../src/local/SupportedImageFormats";
import { fakeApp } from "../../factories/obsidian";
import { makeImageBlob, makeJpegBytes, makePngBytes, makeWebpBytes } from "../../factories/image";

function makeProcessor() {
    const app = fakeApp() as any;
    return new ImageProcessor(app, new SupportedImageFormats(app));
}

describe("ImageProcessor structured result", () => {
    it("reports the actual target MIME and extension after conversion", async () => {
        const processor = makeProcessor();
        const input = makePngBytes();
        const output = makeWebpBytes();
        vi.spyOn(processor, "processImage").mockResolvedValue(output);

        const result = await processor.processImageDetailed(
            makeImageBlob(input, "image/png"),
            "WEBP", 0.8, 1, "None", 0, 0, 0, "Auto", true
        );

        expect(result).toMatchObject({
            data: output,
            mimeType: "image/webp",
            extension: "webp",
            outcome: "converted"
        });
    });

    it("returns unchanged source bytes as skipped instead of relabelling them", async () => {
        const processor = makeProcessor();
        const input = makePngBytes();
        vi.spyOn(processor, "processImage").mockResolvedValue(input);

        const result = await processor.processImageDetailed(
            makeImageBlob(input, "image/png"),
            "WEBP", 0.8, 1, "None", 0, 0, 0, "Auto", true
        );

        expect(result).toMatchObject({
            mimeType: "image/png",
            extension: "png",
            outcome: "skipped"
        });
    });

    it("rejects empty output", async () => {
        const processor = makeProcessor();
        const input = makePngBytes();
        vi.spyOn(processor, "processImage").mockResolvedValue(new ArrayBuffer(0));

        await expect(processor.processImageDetailed(
            makeImageBlob(input, "image/png"),
            "WEBP", 0.8, 1, "None", 0, 0, 0, "Auto", true
        )).rejects.toThrow("empty result");
    });

    it("rejects non-original output whose magic bytes do not match the target", async () => {
        const processor = makeProcessor();
        const input = makePngBytes();
        vi.spyOn(processor, "processImage").mockResolvedValue(makeJpegBytes());

        await expect(processor.processImageDetailed(
            makeImageBlob(input, "image/png"),
            "WEBP", 0.8, 1, "None", 0, 0, 0, "Auto", true
        )).rejects.toThrow("format mismatch");
    });
});
