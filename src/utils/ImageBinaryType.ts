import imageType from "image-type";

export interface DetectedImageBinaryType {
    ext: string;
    mime: string;
}

export async function detectImageBinaryType(data: ArrayBuffer): Promise<DetectedImageBinaryType | null> {
    if (data.byteLength === 0) return null;

    const bytes = new Uint8Array(data);
    const signature = detectSupportedSignature(bytes);
    if (signature) return signature;

    try {
        const detected = await imageType(bytes);
        const normalized = detected ? normalizeSupportedType(detected.mime) : null;
        if (normalized) return normalized;
    } catch {
        // Some image-type versions throw for truncated input. SVG detection can
        // still provide a deterministic result for valid XML images.
    }

    return detectSvgType(data);
}

function detectSupportedSignature(bytes: Uint8Array): DetectedImageBinaryType | null {
    if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return { ext: "png", mime: "image/png" };
    }
    if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
        return { ext: "jpg", mime: "image/jpeg" };
    }
    if (startsWithAscii(bytes, "GIF87a") || startsWithAscii(bytes, "GIF89a")) {
        return { ext: "gif", mime: "image/gif" };
    }
    if (startsWithAscii(bytes, "BM")) {
        return { ext: "bmp", mime: "image/bmp" };
    }
    if (startsWith(bytes, [0x00, 0x00, 0x01, 0x00])) {
        return { ext: "ico", mime: "image/x-icon" };
    }
    if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00])
        || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])
        || startsWith(bytes, [0x49, 0x49, 0x2b, 0x00])
        || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2b])) {
        return { ext: "tiff", mime: "image/tiff" };
    }
    if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === "RIFF" && asciiAt(bytes, 8, 4) === "WEBP") {
        return { ext: "webp", mime: "image/webp" };
    }

    return detectIsoBmffImageType(bytes);
}

function detectIsoBmffImageType(bytes: Uint8Array): DetectedImageBinaryType | null {
    if (bytes.length < 12 || asciiAt(bytes, 4, 4) !== "ftyp") return null;

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const declaredSize = view.getUint32(0, false);
    const boxEnd = declaredSize >= 16
        ? Math.min(declaredSize, bytes.length)
        : bytes.length;
    const brands = new Set<string>();
    brands.add(asciiAt(bytes, 8, 4));
    for (let offset = 16; offset + 4 <= boxEnd; offset += 4) {
        brands.add(asciiAt(bytes, offset, 4));
    }

    if (["avif", "avis"].some(brand => brands.has(brand))) {
        return { ext: "avif", mime: "image/avif" };
    }
    if (["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs"].some(brand => brands.has(brand))) {
        return { ext: "heic", mime: "image/heic" };
    }
    if (["mif1", "msf1", "heif"].some(brand => brands.has(brand))) {
        return { ext: "heif", mime: "image/heif" };
    }
    return null;
}

function normalizeSupportedType(mime: string): DetectedImageBinaryType | null {
    switch (mime.toLowerCase()) {
        case "image/png": return { ext: "png", mime: "image/png" };
        case "image/jpeg": return { ext: "jpg", mime: "image/jpeg" };
        case "image/gif": return { ext: "gif", mime: "image/gif" };
        case "image/bmp": return { ext: "bmp", mime: "image/bmp" };
        case "image/x-icon":
        case "image/vnd.microsoft.icon": return { ext: "ico", mime: "image/x-icon" };
        case "image/tiff": return { ext: "tiff", mime: "image/tiff" };
        case "image/webp": return { ext: "webp", mime: "image/webp" };
        case "image/avif": return { ext: "avif", mime: "image/avif" };
        case "image/heic": return { ext: "heic", mime: "image/heic" };
        case "image/heif": return { ext: "heif", mime: "image/heif" };
        default: return null;
    }
}

function startsWith(bytes: Uint8Array, signature: number[]): boolean {
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
}

function startsWithAscii(bytes: Uint8Array, signature: string): boolean {
    return bytes.length >= signature.length && asciiAt(bytes, 0, signature.length) === signature;
}

function asciiAt(bytes: Uint8Array, offset: number, length: number): string {
    let result = "";
    for (let index = 0; index < length && offset + index < bytes.length; index++) {
        result += String.fromCharCode(bytes[offset + index]);
    }
    return result;
}

function detectSvgType(data: ArrayBuffer): DetectedImageBinaryType | null {
    try {
        const bytes = new Uint8Array(data);
        let encoding: "utf-8" | "utf-16le" | "utf-16be" = "utf-8";
        if (bytes[0] === 0xFF && bytes[1] === 0xFE) encoding = "utf-16le";
        if (bytes[0] === 0xFE && bytes[1] === 0xFF) encoding = "utf-16be";

        const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
        const parsed = new DOMParser().parseFromString(text, "image/svg+xml");
        const root = parsed.documentElement;
        if (root.localName.toLowerCase() !== "svg") return null;
        if (root.namespaceURI && root.namespaceURI !== "http://www.w3.org/2000/svg") return null;

        return { ext: "svg", mime: "image/svg+xml" };
    } catch {
        return null;
    }
}
