import { TFile, CachedMetadata, App } from "obsidian";
import { detectImageBinaryType } from "../utils/ImageBinaryType";

export class SupportedImageFormats {
    // Use a Map for faster mime type lookups
    supportedMimeTypes: Map<string, boolean> = new Map([
        ["image/jpeg", true],
        ["image/png", true],
        ["image/webp", true],
        ["image/heic", true],
        ["image/heif", true],
        ["image/avif", true],
        ["image/tiff", true],
        ["image/bmp", true],
        ["image/x-icon", true],
        ["image/vnd.microsoft.icon", true],
        ["image/svg+xml", true],
        ["image/gif", true],
        // ["video/quicktime", true] // .mov files
    ]);

    // Keep extensions for fallback, use a Set for faster lookups
    supportedExtensions: Set<string> = new Set([
        "jpg",
        "jpeg",
        "png",
        "webp",
        "heic",
        "heif",
        "avif",
        "tif",
        "tiff",
        "bmp",
        "ico",
        "svg",
        "gif",
        // "mov"
    ]);

    // Reverse mapping from extensions to mime types
    extensionToMime: Map<string, string[]> = new Map([
        ["jpg", ["image/jpeg"]],
        ["jpeg", ["image/jpeg"]],
        ["png", ["image/png"]],
        ["webp", ["image/webp"]],
        ["heic", ["image/heic", "image/heif"]],
        ["heif", ["image/heic", "image/heif"]],
        ["avif", ["image/avif"]],
        ["tif", ["image/tiff"]],
        ["tiff", ["image/tiff"]],
        ["bmp", ["image/bmp"]],
        ["ico", ["image/x-icon", "image/vnd.microsoft.icon"]],
        ["svg", ["image/svg+xml"]],
        ["gif", ["image/gif"]],
        // ["mov", ["video/quicktime"]]
    ]);

    constructor(private app: App) { }

    /**
     * Checks if an HTMLImageElement is an Excalidraw image.
     * Excalidraw images should be excluded from all plugin functionality.
     *
     * @param imgElement The HTMLImageElement to check.
     * @returns True if it's an Excalidraw image, false otherwise.
     */
    isExcalidrawImage(imgElement: HTMLImageElement): boolean {
        // Check if the image element has Excalidraw-specific classes
        if (imgElement.classList.contains('excalidraw-svg') ||
            imgElement.classList.contains('excalidraw-embedded-img') ||
            imgElement.classList.contains('excalidraw-canvas-immersive')) {
            return true;
        }

        // Check if the image is contained within an Excalidraw container
        const excalidrawContainer = imgElement.closest('.excalidraw-svg');
        if (excalidrawContainer) {
            return true;
        }

        // Check if the image is within an internal-embed with Excalidraw source
        const internalEmbed = imgElement.closest('.internal-embed');
        if (internalEmbed) {
            const srcAttr = internalEmbed.getAttribute('src');
            if (srcAttr && srcAttr.includes('Excalidraw/')) {
                return true;
            }
        }

        // Check if the image has a filesource attribute pointing to an Excalidraw file
        const filesource = imgElement.getAttribute('filesource');
        if (filesource && (filesource.includes('Excalidraw/') || filesource.endsWith('.excalidraw.md'))) {
            return true;
        }

        // Check if the image src is a blob URL and has Excalidraw context
        const src = imgElement.getAttribute('src');
        if (src && src.startsWith('blob:') && 
            (imgElement.hasAttribute('filesource') || imgElement.closest('.excalidraw-svg'))) {
            return true;
        }

        return false;
    }

    /**
     * Checks if a file is a supported image format based on its mime type or extension.
     * This method does not perform any I/O and relies on the provided mime type or filename.
     *
     * @param mimeType The mime type of the file (preferred).
     * @param filename The name of the file (used for extension-based fallback).
     * @returns True if the file is a supported image, false otherwise.
     */
    isSupported(mimeType?: string, filename?: string): boolean {
        const normalizedMime = this.normalizeMimeType(mimeType);

        // 1. Mime Type Check (Preferred)
        if (normalizedMime && this.supportedMimeTypes.has(normalizedMime)) {
            return true;
        }

        // An explicit non-image MIME is stronger evidence than a misleading
        // extension. Generic binary MIME values may still rely on the name.
        if (normalizedMime.includes("/")
            && normalizedMime !== "application/octet-stream"
            && normalizedMime !== "binary/octet-stream") {
            return false;
        }

        // 2. Extension Check (Fallback)
        if (filename) {
            const extension = filename.split(".").pop()?.toLowerCase();
            if (extension && this.supportedExtensions.has(extension)) {
                // For heic/heif, double check with header if mimeType is unreliable
                if ((extension === 'heic' || extension === 'heif') && !normalizedMime) {
                    return true; // Let header check in processImage decide for HEIC/HEIF
                }
                return true;
            }
        }

        return false;
    }

    /**
     * Determines the mime type of a TFile from Obsidian's metadata cache.
     *
     * @param file The TFile to get the mime type for.
     * @returns The mime type string or undefined if not found in the cache.
     */
    getMimeTypeFromCache(file: TFile): string | undefined {
        const metadata: CachedMetadata | null =
            this.app.metadataCache.getFileCache(file);
        return metadata?.frontmatter?.mime || metadata?.frontmatter?.type;
    }

    /**
     * Gets the possible extensions associated with a given mime type.
     *
     * @param mimeType The mime type to look up.
     * @returns An array of extensions or undefined if the mime type is not found.
     */
    getExtensionsFromMimeType(mimeType: string): string[] | undefined {
        const extensions: string[] = [];
        this.extensionToMime.forEach((mimeTypes, ext) => {
            if (mimeTypes.includes(mimeType)) {
                extensions.push(ext);
            }
        });
        return extensions.length > 0 ? extensions : undefined;
    }
    
    /**
     * Reads the first few bytes of a File object to determine its mime type.
     * This is an asynchronous operation as it involves reading from a file.
     *
     * @param file The File object.
     * @returns A Promise that resolves to the mime type string.
     */
    async getMimeTypeFromFile(file: Blob): Promise<string> {
        try {
            // Raster signatures live near the start. SVG requires a complete XML
            // document, so only read the full Blob when its prefix/name/type makes
            // it a plausible SVG candidate.
            const prefix = await file.slice(0, 4096).arrayBuffer();
            let detected = await detectImageBinaryType(prefix);
            if (!detected && file.size > prefix.byteLength && this.isPossibleSvg(file, prefix)) {
                detected = await detectImageBinaryType(await file.arrayBuffer());
            }
            if (detected) return detected.mime;

            // Unrecognized header -> fall back to Blob.type if available
            if (file.type && file.type.length > 0) {
                return this.normalizeMimeType(file.type) || file.type;
            }
            return "unknown";
        } catch (error) {
            console.error("Error reading file:", error);
            // On error, fall back to Blob.type if available
            if (file.type && file.type.length > 0) {
                return this.normalizeMimeType(file.type) || file.type;
            }
            return "unknown";
        }
    }

    private normalizeMimeType(mimeType?: string): string {
        const normalized = mimeType?.split(";")[0].trim().toLowerCase() ?? "";
        switch (normalized) {
            case "image/jpg":
            case "image/pjpeg": return "image/jpeg";
            case "image/x-png": return "image/png";
            case "image/vnd.microsoft.icon": return "image/x-icon";
            default: return normalized;
        }
    }

    private isPossibleSvg(file: Blob, prefix: ArrayBuffer): boolean {
        if (this.normalizeMimeType(file.type) === "image/svg+xml") return true;
        if (file instanceof File && /\.svg$/i.test(file.name)) return true;

        const bytes = new Uint8Array(prefix);
        if ((bytes[0] === 0xFF && bytes[1] === 0xFE)
            || (bytes[0] === 0xFE && bytes[1] === 0xFF)) {
            return true;
        }
        try {
            return new TextDecoder("utf-8", { fatal: true }).decode(bytes).trimStart().startsWith("<");
        } catch {
            return false;
        }
    }

}
