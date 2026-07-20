import imageType from "image-type";
import type ImageConverterPlugin from "../main";

export type CanvasEditEncoder = "canvas" | "avif-external" | null;

export interface CanvasEditCapability {
    readonly decodable: boolean;
    readonly encodable: boolean;
    readonly encoder: CanvasEditEncoder;
}

const NATIVE_EDITABLE = new Set(["jpg", "jpeg", "png", "webp"]);
const AVIF_EXTENSION = "avif";
const NATIVE_AVIF_PROBE_TIMEOUT_MS = 1_500;

/**
 * Separates browser decoding from output encoding. AVIF is enabled only after
 * a real native export or FFmpeg encoder probe succeeds.
 */
export class CanvasEditCapabilityService {
    private static readonly avifCache = new Map<string, CanvasEditCapability>();
    private probePromise: Promise<CanvasEditCapability> | null = null;

    constructor(private readonly plugin: ImageConverterPlugin) { }

    peek(extension: string): CanvasEditCapability {
        const normalized = normalizeExtension(extension);
        if (NATIVE_EDITABLE.has(normalized)) return nativeCapability();
        if (normalized !== AVIF_EXTENSION) return unsupportedCapability();

        const key = this.getAvifCacheKey();
        const cached = CanvasEditCapabilityService.avifCache.get(key);
        if (cached) return cached;
        void this.primeAvifCapability();
        return unsupportedCapability(true);
    }

    async get(extension: string, ownerDocument?: Document): Promise<CanvasEditCapability> {
        const normalized = normalizeExtension(extension);
        if (NATIVE_EDITABLE.has(normalized)) return nativeCapability();
        if (normalized !== AVIF_EXTENSION) return unsupportedCapability();
        return this.primeAvifCapability(ownerDocument);
    }

    async primeAvifCapability(ownerDocument?: Document): Promise<CanvasEditCapability> {
        const key = this.getAvifCacheKey();
        const cached = CanvasEditCapabilityService.avifCache.get(key);
        if (cached) return cached;
        if (this.probePromise) return this.probePromise;

        this.probePromise = this.probeAvifCapability(ownerDocument)
            .then(capability => {
                CanvasEditCapabilityService.avifCache.set(key, capability);
                return capability;
            })
            .finally(() => {
                this.probePromise = null;
            });
        return this.probePromise;
    }

    static clearCache(): void {
        CanvasEditCapabilityService.avifCache.clear();
    }

    private async probeAvifCapability(ownerDocument?: Document): Promise<CanvasEditCapability> {
        if (await supportsNativeAvifEncoding(ownerDocument ?? globalThis.document)) {
            return {
                decodable: true,
                encodable: true,
                encoder: "canvas"
            };
        }

        const tools = this.plugin.settings.localProcessing.externalTools;
        const executablePath = tools.ffmpegExecutablePath?.trim();
        if (!executablePath) return unsupportedCapability(true);

        try {
            const encoder = await this.plugin.imageProcessor.detectAvifEncoder(
                executablePath,
                tools.ffmpegDetectedEncoder,
                { forceProbe: true }
            );
            return encoder
                ? {
                    decodable: true,
                    encodable: true,
                    encoder: "avif-external"
                }
                : unsupportedCapability(true);
        } catch {
            return unsupportedCapability(true);
        }
    }

    private getAvifCacheKey(): string {
        const tools = this.plugin.settings.localProcessing.externalTools;
        return [
            tools.ffmpegExecutablePath?.trim() ?? "",
            tools.ffmpegDetectedEncoder ?? "",
            tools.ffmpegDetectedEncoderPath?.trim() ?? ""
        ].join("|");
    }
}

async function supportsNativeAvifEncoding(ownerDocument?: Document): Promise<boolean> {
    if (!ownerDocument?.createElement) return false;
    const canvas = ownerDocument.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d");
    if (!context || typeof canvas.toBlob !== "function") return false;
    context.fillStyle = "#000";
    context.fillRect(0, 0, 1, 1);

    const blob = await new Promise<Blob | null>(resolve => {
        let settled = false;
        const finish = (result: Blob | null): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            resolve(result);
        };
        const timeoutId = setTimeout(
            () => finish(null),
            NATIVE_AVIF_PROBE_TIMEOUT_MS
        );
        try {
            canvas.toBlob(finish, "image/avif", 0.8);
        } catch {
            finish(null);
        }
    });
    if (!blob || blob.size === 0) return false;

    try {
        const detected = await imageType(await blob.arrayBuffer());
        return detected?.mime === "image/avif";
    } catch {
        return false;
    }
}

function normalizeExtension(extension: string): string {
    return extension.trim().replace(/^\./, "").toLowerCase();
}

function nativeCapability(): CanvasEditCapability {
    return {
        decodable: true,
        encodable: true,
        encoder: "canvas"
    };
}

function unsupportedCapability(decodable = false): CanvasEditCapability {
    return {
        decodable,
        encodable: false,
        encoder: null
    };
}
