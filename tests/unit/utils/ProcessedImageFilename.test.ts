import { describe, expect, it } from "vitest";
import type { ProcessedImageResult } from "../../../src/local/ImageProcessor";
import { resolveProcessedImageFilename } from "../../../src/utils/ProcessedImageFilename";
import { fakeTFile } from "../../factories/obsidian";

function result(mimeType: string, extension: string): ProcessedImageResult {
    return {
        data: new ArrayBuffer(1),
        mimeType,
        extension,
        outcome: "converted",
    };
}

describe("resolveProcessedImageFilename", () => {
    it("preserves a JPEG source extension alias for JPEG output", async () => {
        const source = fakeTFile({ name: "photo.jpeg", basename: "photo", extension: "jpeg" });
        const sourceData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;

        await expect(resolveProcessedImageFilename(source, sourceData, result("image/jpeg", "jpg")))
            .resolves.toBe("photo.jpeg");
    });

    it("preserves a TIFF source extension alias for TIFF output", async () => {
        const source = fakeTFile({ name: "scan.tif", basename: "scan", extension: "tif" });
        const sourceData = new Uint8Array([0x49, 0x49, 0x2a, 0x00]).buffer;

        await expect(resolveProcessedImageFilename(source, sourceData, result("image/tiff", "tiff")))
            .resolves.toBe("scan.tif");
    });

    it("uses the actual output extension when ORIGINAL encoding changes format", async () => {
        const source = fakeTFile({ name: "photo.heic", basename: "photo", extension: "heic" });
        const sourceData = new Uint8Array([
            0x00, 0x00, 0x00, 0x18,
            0x66, 0x74, 0x79, 0x70,
            0x68, 0x65, 0x69, 0x63,
            0x00, 0x00, 0x00, 0x00,
            0x6d, 0x69, 0x66, 0x31,
        ]).buffer;

        await expect(resolveProcessedImageFilename(source, sourceData, result("image/png", "png")))
            .resolves.toBe("photo.png");
    });

    it("fails closed to the verified output extension for unknown source bytes", async () => {
        const source = fakeTFile({ name: "photo.jpeg", basename: "photo", extension: "jpeg" });

        await expect(resolveProcessedImageFilename(source, new Uint8Array([1, 2, 3]).buffer, result("image/jpeg", "jpg")))
            .resolves.toBe("photo.jpg");
    });
});
