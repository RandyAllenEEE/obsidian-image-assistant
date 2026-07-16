import imageType from "image-type";

const MIME_BY_EXTENSION: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    avif: "image/avif"
};

/**
 * Canvas encoders may silently fall back to PNG for formats the runtime cannot
 * encode. Never write those bytes back under the source file's extension.
 */
export function getCanvasExportMime(extension: string): string | undefined {
    return MIME_BY_EXTENSION[extension.trim().toLowerCase()];
}

export async function assertCanvasOutputMatchesExtension(
    data: ArrayBuffer,
    extension: string
): Promise<void> {
    const expectedMime = getCanvasExportMime(extension);
    if (!expectedMime) {
        throw new Error(`The image editor cannot safely overwrite .${extension} files`);
    }

    let detectedMime: string | undefined;
    try {
        const detected = await imageType(data);
        detectedMime = detected?.mime === "image/jpg" ? "image/jpeg" : detected?.mime;
    } catch {
        // The explicit error below is more useful than the parser failure.
    }

    if (!detectedMime) {
        throw new Error("The image editor produced an unrecognized image format");
    }
    if (detectedMime !== expectedMime) {
        throw new Error(`The image editor produced ${detectedMime}, not ${expectedMime}`);
    }
}
