import { DEFAULT_SETTINGS } from "./defaults";
import type {
    BlendMode,
    ImageAssistantSettings,
    SingleImageOperationDefaults,
    ToolPreset,
    VisualValidationMode
} from "./types";

const unsafeKeys = new Set(["__proto__", "constructor", "prototype"]);
const retiredPresetKeys = new Set([
    "conversionPresets",
    "folderPresets",
    "filenamePresets",
    "linkFormatPresets",
    "resizePresets",
    "globalPresets",
    "globalPresetConfig",
    "activeConversionPreset",
    "activeFolderPreset",
    "activeFilenamePreset",
    "activeLinkFormatPreset",
    "activeResizePreset",
    "activeGlobalPreset",
    "selectedConversionPreset",
    "selectedFolderPreset",
    "selectedFilenamePreset",
    "selectedLinkFormatPreset",
    "selectedResizePreset",
    "selectedGlobalPreset",
    "defaultConversionPreset",
    "defaultFolderPreset",
    "defaultFilenamePreset",
    "defaultLinkFormatPreset",
    "defaultResizePreset",
    "defaultGlobalPreset",
    "showGlobalPresets",
    "globalPresetsVisible"
]);
const blendModes: readonly BlendMode[] = [
    "source-over", "destination-over", "source-in", "destination-in", "source-out",
    "destination-out", "source-atop", "destination-atop", "xor", "lighter", "copy",
    "color", "color-burn", "color-dodge", "darken", "difference", "exclusion",
    "hard-light", "hue", "lighten", "luminosity", "multiply", "overlay",
    "saturation", "screen", "soft-light"
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

function cloneValue(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(cloneValue);
    if (!isPlainObject(value)) return value;

    const clone: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
        if (!unsafeKeys.has(key)) clone[key] = cloneValue(nestedValue);
    }
    return clone;
}

function removeRetiredPresetSettings(value: unknown): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
        value.forEach(removeRetiredPresetSettings);
        return;
    }

    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
        if (retiredPresetKeys.has(key)) delete record[key];
        else removeRetiredPresetSettings(record[key]);
    }
}

export function mergeWithDefaults<T>(defaults: T, saved: unknown): T {
    if (Array.isArray(defaults)) {
        return (Array.isArray(saved) ? cloneValue(saved) : cloneValue(defaults)) as T;
    }

    if (!isPlainObject(defaults)) {
        if (saved === undefined) return cloneValue(defaults) as T;
        if (defaults === undefined) return cloneValue(saved) as T;
        return (typeof saved === typeof defaults ? cloneValue(saved) : cloneValue(defaults)) as T;
    }

    const result = cloneValue(defaults) as Record<string, unknown>;
    if (!isPlainObject(saved)) return result as T;

    for (const [key, savedValue] of Object.entries(saved)) {
        if (unsafeKeys.has(key) || savedValue === undefined || !Object.hasOwn(result, key)) continue;

        const defaultValue = result[key];
        if (isPlainObject(defaultValue)) {
            if (isPlainObject(savedValue)) result[key] = mergeWithDefaults(defaultValue, savedValue);
            continue;
        }
        if (Array.isArray(defaultValue)) {
            if (Array.isArray(savedValue)) result[key] = cloneValue(savedValue);
            continue;
        }
        if (defaultValue === undefined || typeof savedValue === typeof defaultValue) {
            result[key] = cloneValue(savedValue);
        }
    }

    return result as T;
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
    return typeof value === "string" && values.includes(value as T);
}

function clampNumber(value: unknown, fallback: number, min: number, max: number, integer = false): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    const clamped = Math.min(max, Math.max(min, numeric));
    return integer ? Math.round(clamped) : clamped;
}

function normalizeOptionalDimension(value: unknown): number | undefined {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "number" && typeof value !== "string") return undefined;
    const normalized = typeof value === "string" ? value.trim() : value;
    if (typeof normalized === "string" && !/^\d+(?:\.\d+)?$/.test(normalized)) return undefined;
    const numeric = Number(normalized);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    const rounded = Math.round(numeric);
    if (!Number.isSafeInteger(rounded) || rounded <= 0) return undefined;
    return Math.min(100_000, rounded);
}

function normalizeSecretId(value: unknown): string {
    if (typeof value !== "string") return "";
    const normalized = value.trim();
    return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(normalized) ? normalized : "";
}

function normalizePresetArray(value: ToolPreset[], defaults: ToolPreset[]): ToolPreset[] {
    return defaults.map((fallback, index) => {
        const merged = mergeWithDefaults(fallback, value[index]);
        merged.opacity = clampNumber(merged.opacity, fallback.opacity, 0, 1);
        merged.size = clampNumber(merged.size, fallback.size, 1, 500);
        if (!isOneOf(merged.blendMode, blendModes)) merged.blendMode = fallback.blendMode;
        if (merged.backgroundOpacity !== undefined) {
            merged.backgroundOpacity = clampNumber(merged.backgroundOpacity, fallback.backgroundOpacity ?? 1, 0, 1);
        }
        return merged;
    });
}

export function normalizeSettings(settings: ImageAssistantSettings): ImageAssistantSettings {
    removeRetiredPresetSettings(settings);
    if (!isOneOf(settings.drawing.provider, ["disabled", "drawio", "excalidraw"] as const)) {
        settings.drawing.provider = DEFAULT_SETTINGS.drawing.provider;
    }
    if (!isOneOf(settings.drawing.excalidraw.embedMode, ["source", "auto-export-preview"] as const)) {
        settings.drawing.excalidraw.embedMode = DEFAULT_SETTINGS.drawing.excalidraw.embedMode;
    }
    if (typeof settings.drawing.excalidraw.manageCreatedFileLocation !== "boolean") {
        settings.drawing.excalidraw.manageCreatedFileLocation =
            DEFAULT_SETTINGS.drawing.excalidraw.manageCreatedFileLocation;
    }
    const drawio = settings.drawing.drawio;
    if (!isOneOf(drawio.theme, ["kennedy", "atlas", "dark", "minimal", "sketch", "simple"] as const)) {
        drawio.theme = DEFAULT_SETTINGS.drawing.drawio.theme;
    }
    if (typeof drawio.followObsidianTheme !== "boolean") {
        drawio.followObsidianTheme = DEFAULT_SETTINGS.drawing.drawio.followObsidianTheme;
    }
    const nextAi = drawio.nextAi;
    nextAi.accessCodeSecretId = normalizeSecretId(nextAi.accessCodeSecretId);
    nextAi.apiKeySecretId = normalizeSecretId(nextAi.apiKeySecretId);
    if (!isOneOf(nextAi.visualValidationMode, ["disabled", "user-model", "next-ai-server"] as const)) {
        nextAi.visualValidationMode = DEFAULT_SETTINGS.drawing.drawio.nextAi.visualValidationMode;
    }
    if (nextAi.sendShortcut !== "enter" && nextAi.sendShortcut !== "mod-enter") {
        nextAi.sendShortcut = DEFAULT_SETTINGS.drawing.drawio.nextAi.sendShortcut;
    }
    nextAi.promptTemplates = Array.isArray(nextAi.promptTemplates)
        ? nextAi.promptTemplates.flatMap(value => {
            if (!value || typeof value !== "object" || Array.isArray(value)) return [];
            const candidate = value as unknown as Record<string, unknown>;
            if (typeof candidate.id !== "string") return [];
            const id = candidate.id.trim().slice(0, 100);
            const titleSource = typeof candidate.title === "string"
                ? candidate.title
                : typeof candidate.name === "string" ? candidate.name : "";
            const bodySource = typeof candidate.body === "string"
                ? candidate.body
                : typeof candidate.prompt === "string" ? candidate.prompt : "";
            const title = titleSource.trim().slice(0, 100);
            const body = bodySource.trim().slice(0, 20_000);
            const now = Date.now();
            return id && title && body ? [{
                id,
                title,
                description: typeof candidate.description === "string"
                    ? candidate.description.trim().slice(0, 500)
                    : "",
                body,
                pinned: candidate.pinned === true,
                createdAt: typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt)
                    ? Math.trunc(candidate.createdAt)
                    : now,
                updatedAt: typeof candidate.updatedAt === "number" && Number.isFinite(candidate.updatedAt)
                    ? Math.trunc(candidate.updatedAt)
                    : now,
                useCount: typeof candidate.useCount === "number" && Number.isFinite(candidate.useCount)
                    ? Math.max(0, Math.trunc(candidate.useCount))
                    : 0
            }] : [];
        }).slice(0, 100)
        : [];

    const paste = settings.pasteHandling;
    if (!isOneOf(paste.mode, ["local", "cloud", "disabled"] as const)) {
        paste.mode = DEFAULT_SETTINGS.pasteHandling.mode;
    }
    if (!isOneOf(paste.cursorLocation, ["front", "back"] as const)) {
        paste.cursorLocation = DEFAULT_SETTINGS.pasteHandling.cursorLocation;
    }
    if (!isOneOf(paste.cloud.imageSizeSource, ["settings", "actual"] as const)) {
        paste.cloud.imageSizeSource = DEFAULT_SETTINGS.pasteHandling.cloud.imageSizeSource;
    }
    if (!isOneOf(paste.cloud.cloudLinkFormat, ["markdown", "wikilink"] as const)) {
        paste.cloud.cloudLinkFormat = DEFAULT_SETTINGS.pasteHandling.cloud.cloudLinkFormat;
    }
    if (!isOneOf(paste.cloud.uploader, ["PicGo", "PicGo-Core", "PicList"] as const)) {
        paste.cloud.uploader = DEFAULT_SETTINGS.pasteHandling.cloud.uploader;
    }
    paste.cloud.imageSizeWidth = normalizeOptionalDimension(paste.cloud.imageSizeWidth);
    paste.cloud.imageSizeHeight = normalizeOptionalDimension(paste.cloud.imageSizeHeight);
    delete (paste.cloud as unknown as Record<string, unknown>).downloadPath;
    delete (paste.cloud as unknown as Record<string, unknown>).uploadConcurrency;

    settings.global.batchConcurrency = clampNumber(
        settings.global.batchConcurrency,
        DEFAULT_SETTINGS.global.batchConcurrency,
        1,
        10,
        true
    );

    const conversion = settings.localProcessing.conversion;
    const destination = settings.localProcessing.destination;
    if (!isOneOf(destination.type, ["DEFAULT", "ROOT", "CURRENT", "SUBFOLDER", "CUSTOM"] as const)) {
        destination.type = DEFAULT_SETTINGS.localProcessing.destination.type;
    }
    const filename = settings.localProcessing.filename;
    if (!isOneOf(filename.conflictResolution, ["reuse", "increment", "skip", "overwrite"] as const)) {
        filename.conflictResolution = DEFAULT_SETTINGS.localProcessing.filename.conflictResolution;
    }
    if (!isOneOf(conversion.outputFormat, ["ORIGINAL", "WEBP", "PNG", "JPEG", "AVIF", "PNGQUANT", "NONE"] as const)) {
        conversion.outputFormat = DEFAULT_SETTINGS.localProcessing.conversion.outputFormat;
    }
    if (!isOneOf(conversion.resizeMode, ["None", "Fit", "Fill", "Scale", "LongestEdge", "ShortestEdge", "Width", "Height"] as const)) {
        conversion.resizeMode = DEFAULT_SETTINGS.localProcessing.conversion.resizeMode;
    }
    if (!isOneOf(conversion.enlargeOrReduce, ["Always", "Reduce", "Enlarge", "Auto"] as const)) {
        conversion.enlargeOrReduce = DEFAULT_SETTINGS.localProcessing.conversion.enlargeOrReduce;
    }
    conversion.quality = clampNumber(conversion.quality, DEFAULT_SETTINGS.localProcessing.conversion.quality, 0, 100);
    conversion.colorDepth = clampNumber(conversion.colorDepth, DEFAULT_SETTINGS.localProcessing.conversion.colorDepth, 0, 1);
    conversion.desiredWidth = clampNumber(conversion.desiredWidth, DEFAULT_SETTINGS.localProcessing.conversion.desiredWidth, 1, 100_000, true);
    conversion.desiredHeight = clampNumber(conversion.desiredHeight, DEFAULT_SETTINGS.localProcessing.conversion.desiredHeight, 1, 100_000, true);
    conversion.desiredLongestEdge = clampNumber(conversion.desiredLongestEdge, DEFAULT_SETTINGS.localProcessing.conversion.desiredLongestEdge, 1, 100_000, true);
    conversion.minimumCompressionSavingsInKB = clampNumber(
        conversion.minimumCompressionSavingsInKB,
        DEFAULT_SETTINGS.localProcessing.conversion.minimumCompressionSavingsInKB,
        0,
        Number.MAX_SAFE_INTEGER
    );

    const externalTools = settings.localProcessing.externalTools;
    externalTools.ffmpegCrf = clampNumber(
        externalTools.ffmpegCrf,
        DEFAULT_SETTINGS.localProcessing.externalTools.ffmpegCrf,
        0,
        63,
        true
    );
    if (externalTools.ffmpegDetectedEncoder !== undefined
        && !isOneOf(externalTools.ffmpegDetectedEncoder, [
            "libaom-av1", "libsvtav1", "av1_nvenc", "av1_qsv", "av1_amf", "av1_vaapi", "av1_mf"
        ] as const)) {
        externalTools.ffmpegDetectedEncoder = undefined;
        externalTools.ffmpegDetectedEncoderPath = undefined;
    }
    if (typeof externalTools.ffmpegDetectedEncoderPath !== "string") {
        externalTools.ffmpegDetectedEncoderPath = undefined;
    }

    const link = settings.localProcessing.link;
    if (!isOneOf(link.linkFormat, ["wikilink", "markdown"] as const)) {
        link.linkFormat = DEFAULT_SETTINGS.localProcessing.link.linkFormat;
    }
    if (!isOneOf(link.pathFormat, ["shortest", "relative", "absolute"] as const)) {
        link.pathFormat = DEFAULT_SETTINGS.localProcessing.link.pathFormat;
    }

    const embedResize = settings.localProcessing.embedResize;
    if (!isOneOf(embedResize.resizeDimension, [
        "width", "height", "both", "longest-edge", "shortest-edge", "original-width",
        "original-height", "editor-max-width", "none"
    ] as const)) {
        embedResize.resizeDimension = DEFAULT_SETTINGS.localProcessing.embedResize.resizeDimension;
    }
    if (!isOneOf(embedResize.resizeScaleMode, ["auto", "reduce", "enlarge"] as const)) {
        embedResize.resizeScaleMode = DEFAULT_SETTINGS.localProcessing.embedResize.resizeScaleMode;
    }
    if (!isOneOf(embedResize.resizeUnits, ["pixels", "percentage"] as const)) {
        embedResize.resizeUnits = DEFAULT_SETTINGS.localProcessing.embedResize.resizeUnits;
    }
    embedResize.width = normalizeOptionalDimension(embedResize.width);
    embedResize.height = normalizeOptionalDimension(embedResize.height);
    embedResize.longestEdge = normalizeOptionalDimension(embedResize.longestEdge);
    embedResize.shortestEdge = normalizeOptionalDimension(embedResize.shortestEdge);
    embedResize.editorMaxWidthValue = normalizeOptionalDimension(embedResize.editorMaxWidthValue);

    const batch = settings.operationDefaults.batchLocal;
    if (!isOneOf(batch.convertTo, ["disabled", "webp", "jpg", "png"] as const)) {
        batch.convertTo = batch.convertTo === "Original"
            ? "disabled"
            : DEFAULT_SETTINGS.operationDefaults.batchLocal.convertTo;
    }
    if (!isOneOf(batch.resizeMode, ["None", "Fit", "Fill", "LongestEdge", "ShortestEdge", "Width", "Height"] as const)) {
        batch.resizeMode = DEFAULT_SETTINGS.operationDefaults.batchLocal.resizeMode;
    }
    batch.quality = clampNumber(batch.quality, DEFAULT_SETTINGS.operationDefaults.batchLocal.quality, 0, 1);
    batch.desiredWidth = clampNumber(batch.desiredWidth, DEFAULT_SETTINGS.operationDefaults.batchLocal.desiredWidth, 1, 100_000, true);
    batch.desiredHeight = clampNumber(batch.desiredHeight, DEFAULT_SETTINGS.operationDefaults.batchLocal.desiredHeight, 1, 100_000, true);
    batch.desiredLength = clampNumber(batch.desiredLength, DEFAULT_SETTINGS.operationDefaults.batchLocal.desiredLength, 1, 100_000, true);
    if (!isOneOf(batch.enlargeOrReduce, ["Always", "Reduce", "Enlarge", "Auto"] as const)) {
        batch.enlargeOrReduce = DEFAULT_SETTINGS.operationDefaults.batchLocal.enlargeOrReduce;
    }

    settings.operationDefaults.singleImage = normalizeSingleImageSettings(
        settings.operationDefaults.singleImage
    );

    if (!isOneOf(settings.captions.alignment, ["left", "center", "right"] as const)) {
        settings.captions.alignment = DEFAULT_SETTINGS.captions.alignment;
    }
    if (!isOneOf(settings.captions.fontStyle, ["italic", "normal"] as const)) {
        settings.captions.fontStyle = DEFAULT_SETTINGS.captions.fontStyle;
    }
    if (!isOneOf(settings.captions.textTransform, ["none", "uppercase", "lowercase", "capitalize"] as const)) {
        settings.captions.textTransform = DEFAULT_SETTINGS.captions.textTransform;
    }
    if (!isOneOf(settings.captions.inlinePolicy, ["all", "standalone-only"] as const)) {
        settings.captions.inlinePolicy = DEFAULT_SETTINGS.captions.inlinePolicy;
    }
    if (!isOneOf(settings.captions.widthMode, ["auto", "container"] as const)) {
        settings.captions.widthMode = DEFAULT_SETTINGS.captions.widthMode;
    }
    settings.captions.maxLines = clampNumber(
        settings.captions.maxLines,
        DEFAULT_SETTINGS.captions.maxLines,
        0,
        5,
        true
    );
    settings.captions.opacity = String(clampNumber(
        settings.captions.opacity,
        Number(DEFAULT_SETTINGS.captions.opacity),
        0,
        1
    ));

    if (!isOneOf(settings.alignment.default, ["left", "center", "right"] as const)) {
        settings.alignment.default = DEFAULT_SETTINGS.alignment.default;
    }
    if (!isOneOf(
        settings.cleanerSettings.trashMode,
        ["follow-obsidian", "system", "obsidian", "custom"] as const
    )) {
        settings.cleanerSettings.trashMode = DEFAULT_SETTINGS.cleanerSettings.trashMode;
    }

    const ocr = settings.ocrSettings;
    if (!isOneOf(ocr.latexProvider, ["SimpleTex", "Pix2Tex", "Texify", "LLM"] as const)) {
        ocr.latexProvider = DEFAULT_SETTINGS.ocrSettings.latexProvider;
    }
    if (!isOneOf(ocr.markdownProvider, ["Texify", "LLM"] as const)) {
        ocr.markdownProvider = DEFAULT_SETTINGS.ocrSettings.markdownProvider;
    }
    if (!isOneOf(ocr.aiModel.providerType, ["openai", "ollama"] as const)) {
        ocr.aiModel.providerType = DEFAULT_SETTINGS.ocrSettings.aiModel.providerType;
    }
    ocr.aiModel.maxTokens = clampNumber(
        ocr.aiModel.maxTokens,
        DEFAULT_SETTINGS.ocrSettings.aiModel.maxTokens,
        1,
        1_000_000,
        true
    );
    ocr.simpleTex.appIdSecretId = normalizeSecretId(ocr.simpleTex.appIdSecretId);
    ocr.simpleTex.appSecretSecretId = normalizeSecretId(ocr.simpleTex.appSecretSecretId);
    ocr.simpleTex.tokenSecretId = normalizeSecretId(ocr.simpleTex.tokenSecretId);
    ocr.pix2tex.passwordSecretId = normalizeSecretId(ocr.pix2tex.passwordSecretId);
    ocr.texify.passwordSecretId = normalizeSecretId(ocr.texify.passwordSecretId);
    ocr.aiModel.apiKeySecretId = normalizeSecretId(ocr.aiModel.apiKeySecretId);

    settings.annotationPresets.drawing = normalizePresetArray(
        settings.annotationPresets.drawing,
        DEFAULT_SETTINGS.annotationPresets.drawing
    );
    settings.annotationPresets.arrow = normalizePresetArray(
        settings.annotationPresets.arrow,
        DEFAULT_SETTINGS.annotationPresets.arrow
    );
    settings.annotationPresets.text = normalizePresetArray(
        settings.annotationPresets.text,
        DEFAULT_SETTINGS.annotationPresets.text
    );

    return settings;
}

function normalizeSingleImageSettings(value: unknown): SingleImageOperationDefaults | undefined {
    if (value === undefined) return undefined;
    if (!isPlainObject(value)) return undefined;

    const conversion = DEFAULT_SETTINGS.localProcessing.conversion;
    const tools = DEFAULT_SETTINGS.localProcessing.externalTools;
    const fallback: SingleImageOperationDefaults = {
        outputFormat: conversion.outputFormat,
        quality: conversion.quality,
        colorDepth: conversion.colorDepth,
        resizeMode: conversion.resizeMode,
        desiredWidth: conversion.desiredWidth,
        desiredHeight: conversion.desiredHeight,
        desiredLongestEdge: conversion.desiredLongestEdge,
        enlargeOrReduce: conversion.enlargeOrReduce,
        allowLargerFiles: conversion.allowLargerFiles,
        pngquantExecutablePath: tools.pngquantExecutablePath,
        pngquantQuality: tools.pngquantQuality,
        ffmpegExecutablePath: tools.ffmpegExecutablePath,
        ffmpegCrf: tools.ffmpegCrf,
        ffmpegPreset: tools.ffmpegPreset,
        ffmpegDetectedEncoder: tools.ffmpegDetectedEncoder,
        ffmpegDetectedEncoderPath: tools.ffmpegDetectedEncoderPath,
    };
    const single = mergeWithDefaults(fallback, value);
    if (!isOneOf(single.outputFormat, ["ORIGINAL", "WEBP", "PNG", "JPEG", "AVIF", "PNGQUANT", "NONE"] as const)) {
        single.outputFormat = fallback.outputFormat;
    }
    if (!isOneOf(single.resizeMode, ["None", "Fit", "Fill", "Scale", "LongestEdge", "ShortestEdge", "Width", "Height"] as const)) {
        single.resizeMode = fallback.resizeMode;
    }
    if (!isOneOf(single.enlargeOrReduce, ["Always", "Reduce", "Enlarge", "Auto"] as const)) {
        single.enlargeOrReduce = fallback.enlargeOrReduce;
    }
    single.quality = clampNumber(single.quality, fallback.quality, 0, 100);
    single.colorDepth = clampNumber(single.colorDepth, fallback.colorDepth, 0, 1);
    single.desiredWidth = clampNumber(single.desiredWidth, fallback.desiredWidth, 1, 100_000, true);
    single.desiredHeight = clampNumber(single.desiredHeight, fallback.desiredHeight, 1, 100_000, true);
    single.desiredLongestEdge = clampNumber(single.desiredLongestEdge, fallback.desiredLongestEdge, 1, 100_000, true);
    single.ffmpegCrf = clampNumber(single.ffmpegCrf, fallback.ffmpegCrf, 0, 63, true);
    if (single.ffmpegDetectedEncoder !== undefined
        && !isOneOf(single.ffmpegDetectedEncoder, [
            "libaom-av1", "libsvtav1", "av1_nvenc", "av1_qsv", "av1_amf", "av1_vaapi", "av1_mf"
        ] as const)) {
        single.ffmpegDetectedEncoder = undefined;
        single.ffmpegDetectedEncoderPath = undefined;
    }
    if (typeof single.ffmpegDetectedEncoderPath !== "string") {
        single.ffmpegDetectedEncoderPath = undefined;
    }
    return single;
}

export function getLegacyBatchConcurrency(saved: unknown): number | undefined {
    if (!isPlainObject(saved)) return undefined;
    if (isPlainObject(saved.global) && saved.global.batchConcurrency !== undefined) return undefined;
    const paste = saved.pasteHandling;
    if (!isPlainObject(paste) || !isPlainObject(paste.cloud)) return undefined;
    const value = paste.cloud.uploadConcurrency;
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? Math.min(10, Math.max(1, Math.round(numeric))) : undefined;
}

export function getLegacyUploadHistory(saved: unknown): unknown[] {
    if (!isPlainObject(saved) || !Array.isArray(saved.uploadedImages)) return [];
    return cloneValue(saved.uploadedImages) as unknown[];
}

/** Maps the former VLM toggle without mutating the raw persisted settings. */
export function getLegacyVisualValidationMode(saved: unknown): VisualValidationMode | undefined {
    if (!isPlainObject(saved)) return undefined;
    const drawing = saved.drawing;
    if (!isPlainObject(drawing)) return undefined;
    const drawio = drawing.drawio;
    if (!isPlainObject(drawio)) return undefined;
    const nextAi = drawio.nextAi;
    if (!isPlainObject(nextAi) || Object.hasOwn(nextAi, "visualValidationMode")) return undefined;
    return typeof nextAi.visualValidationEnabled === "boolean"
        ? nextAi.visualValidationEnabled ? "next-ai-server" : "disabled"
        : undefined;
}
