import { describe, expect, it } from "vitest";
import { detectImageBinaryType } from "../../../src/utils/ImageBinaryType";

function bytes(...values: number[]): ArrayBuffer {
    return new Uint8Array(values).buffer;
}

function ascii(value: string): number[] {
    return Array.from(value, character => character.charCodeAt(0));
}

function makeFtyp(majorBrand: string, ...compatibleBrands: string[]): ArrayBuffer {
    const size = 16 + compatibleBrands.length * 4;
    return bytes(
        0, 0, 0, size,
        ...ascii("ftyp"),
        ...ascii(majorBrand),
        0, 0, 0, 0,
        ...compatibleBrands.flatMap(ascii)
    );
}

describe("detectImageBinaryType", () => {
    it("detects raster images from magic bytes and rejects empty data", async () => {
        const pngBytes = Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
            "base64"
        );
        const png = pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength);

        await expect(detectImageBinaryType(png)).resolves.toMatchObject({ ext: "png", mime: "image/png" });
        await expect(detectImageBinaryType(new ArrayBuffer(0))).resolves.toBeNull();
    });

    it("accepts valid SVG XML and rejects arbitrary XML", async () => {
        const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>').buffer;
        const xml = new TextEncoder().encode("<html><body>not svg</body></html>").buffer;

        await expect(detectImageBinaryType(svg)).resolves.toEqual({ ext: "svg", mime: "image/svg+xml" });
        await expect(detectImageBinaryType(xml)).resolves.toBeNull();
    });

    it.each([
        ["JPEG", bytes(0xff, 0xd8, 0xff, 0xe0), { ext: "jpg", mime: "image/jpeg" }],
        ["GIF87a", bytes(...ascii("GIF87a")), { ext: "gif", mime: "image/gif" }],
        ["GIF89a", bytes(...ascii("GIF89a")), { ext: "gif", mime: "image/gif" }],
        ["BMP", bytes(...ascii("BM"), 0, 0), { ext: "bmp", mime: "image/bmp" }],
        ["ICO", bytes(0x00, 0x00, 0x01, 0x00, 0x01, 0x00), { ext: "ico", mime: "image/x-icon" }],
        ["little-endian TIFF", bytes(0x49, 0x49, 0x2a, 0x00), { ext: "tiff", mime: "image/tiff" }],
        ["big-endian TIFF", bytes(0x4d, 0x4d, 0x00, 0x2a), { ext: "tiff", mime: "image/tiff" }],
        ["little-endian BigTIFF", bytes(0x49, 0x49, 0x2b, 0x00), { ext: "tiff", mime: "image/tiff" }],
        ["WebP", bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WEBP")), { ext: "webp", mime: "image/webp" }],
        ["AVIF", makeFtyp("avif"), { ext: "avif", mime: "image/avif" }],
        ["HEIC", makeFtyp("heic"), { ext: "heic", mime: "image/heic" }],
        ["HEIF", makeFtyp("mif1"), { ext: "heif", mime: "image/heif" }],
    ])("detects supported %s signatures", async (_name, data, expected) => {
        await expect(detectImageBinaryType(data as ArrayBuffer)).resolves.toEqual(expected);
    });

    it("prefers a specific compatible AVIF brand over the generic HEIF major brand", async () => {
        await expect(detectImageBinaryType(makeFtyp("mif1", "avif"))).resolves.toEqual({
            ext: "avif",
            mime: "image/avif",
        });
    });

    it("does not accept incomplete or lookalike signatures", async () => {
        await expect(detectImageBinaryType(bytes(0x49, 0x49, 0, 0))).resolves.toBeNull();
        await expect(detectImageBinaryType(bytes(...ascii("RIFF"), 0, 0, 0, 0, ...ascii("WAVE")))).resolves.toBeNull();
        await expect(detectImageBinaryType(makeFtyp("mp42"))).resolves.toBeNull();
    });
});
