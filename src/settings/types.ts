// Basic types
export type OutputFormat = "ORIGINAL" | "WEBP" | "PNG" | "JPEG" | "AVIF" | "PNGQUANT" | "NONE";
export type AvifEncoder = "libaom-av1" | "libsvtav1" | "av1_nvenc" | "av1_qsv" | "av1_amf" | "av1_vaapi" | "av1_mf";

import type { EmbedResizeSettings } from "./NonDestructiveResizeSettings";
import type { LinkFormat, PathFormat } from "./LinkFormatSettings";
export type { ResizeDimension } from "./NonDestructiveResizeSettings";

// Import OCRSettings locally
import { OCRSettings } from "../ocr/OCRSettings";

// Re-export for convenience
export type { EmbedResizeSettings, OCRSettings };
export type { PathFormat, LinkFormat } from "./LinkFormatSettings";
export type { ResizeScaleMode, ResizeUnits } from "./NonDestructiveResizeSettings";

// Paste handling mode types
export type PasteHandlingMode = "local" | "cloud" | "disabled";

// Cloud upload settings interface
export interface CloudUploadSettings {
    uploader: string;
    uploadServer: string;
    deleteServer: string;
    picgoCorePath: string;
    remoteServerMode: boolean;
    imageSizeWidth: number | undefined;
    imageSizeHeight: number | undefined;
    imageSizeSource: 'settings' | 'actual';
    workOnNetWork: boolean;
    newWorkBlackDomains: string;
    applyImage: boolean;
    downloadPath: string;
    uploadConcurrency: number;
    cloudLinkFormat: 'markdown' | 'wikilink';
}

export type FolderDestinationType = "DEFAULT" | "ROOT" | "CURRENT" | "SUBFOLDER" | "CUSTOM";
// Unified ResizeMode including all supported modes
export type ResizeMode = "None" | "Fit" | "Fill" | "Scale" | "LongestEdge" | "ShortestEdge" | "Width" | "Height";
export type EnlargeReduce = "Always" | "Reduce" | "Enlarge" | "Auto";

export interface SettingsUIState {
    pasteHandlingSectionCollapsed: boolean;
    imageAlignmentSectionCollapsed: boolean;
    imageDragResizeSectionCollapsed: boolean;
    imageCaptionSectionCollapsed: boolean;
    cleanerSectionCollapsed: boolean;
    ocrSectionCollapsed: boolean;
    otherSectionCollapsed: boolean;
}

// Re-export OCRSettings from its source (already imported and exported above)
// export type { OCRSettings } from "../ocr/OCRSettings";

export type BlendMode = "source-over" | "destination-over" | "source-in" | "destination-in" | "source-out" | "destination-out" | "source-atop" | "destination-atop" | "xor" | "lighter" | "copy" | "color" | "color-burn" | "color-dodge" | "darken" | "difference" | "exclusion" | "hard-light" | "hue" | "lighten" | "luminosity" | "multiply" | "overlay" | "saturation" | "screen" | "soft-light";

export interface ToolPreset {
    color: string;
    opacity: number;
    blendMode: BlendMode;
    size: number;
    backgroundColor?: string;
    backgroundOpacity?: number;
}

export interface SingleImageModalSettings {
    outputFormat: OutputFormat;
    quality: number;
    colorDepth: number;
    resizeMode: ResizeMode;
    desiredWidth: number;
    desiredHeight: number;
    desiredLongestEdge: number;
    enlargeOrReduce: EnlargeReduce;
    allowLargerFiles: boolean;
    pngquantExecutablePath: string;
    pngquantQuality: string;
    ffmpegExecutablePath: string;
    ffmpegCrf: number;
    ffmpegPreset: string;
    ffmpegDetectedEncoder?: AvifEncoder;
    ffmpegDetectedEncoderPath?: string;
}

export interface LocalDestinationSettings {
    type: FolderDestinationType;
    customTemplate?: string;
    subfolderTemplate?: string;
}

export interface LocalFilenameSettings {
    customTemplate?: string;
    skipRenamePatterns: string;
    conflictResolution: "reuse" | "increment" | "skip" | "overwrite";
}

export interface LocalConversionSettings {
    outputFormat: OutputFormat;
    quality: number;
    colorDepth: number;
    resizeMode: ResizeMode;
    desiredWidth: number;
    desiredHeight: number;
    desiredLongestEdge: number;
    enlargeOrReduce: EnlargeReduce;
    allowLargerFiles: boolean;
    skipConversionPatterns: string;
    minimumCompressionSavingsInKB: number;
}

export interface LocalExternalToolSettings {
    pngquantExecutablePath: string;
    pngquantQuality: string;
    ffmpegExecutablePath: string;
    ffmpegCrf: number;
    ffmpegPreset: string;
    ffmpegDetectedEncoder?: AvifEncoder;
    ffmpegDetectedEncoderPath?: string;
    useSystemPathForBinary: boolean;
}

export interface LocalLinkSettings {
    linkFormat: LinkFormat;
    pathFormat: PathFormat;
    prependCurrentDir: boolean;
    hideFolders: boolean;
}

export interface LocalProcessingSettings {
    destination: LocalDestinationSettings;
    filename: LocalFilenameSettings;
    conversion: LocalConversionSettings;
    externalTools: LocalExternalToolSettings;
    link: LocalLinkSettings;
    embedResize: EmbedResizeSettings;
}

export interface SingleImageOperationDefaults extends SingleImageModalSettings { }

export interface BatchLocalOperationDefaults {
    convertTo: string;
    quality: number;
    resizeMode: string;
    desiredWidth: number;
    desiredHeight: number;
    desiredLength: number;
    skipImagesInTargetFormat: boolean;
    enlargeOrReduce: EnlargeReduce;
    skipFormats: string;
}

export interface OperationDefaults {
    singleImage?: SingleImageOperationDefaults;
    batchLocal: BatchLocalOperationDefaults;
}

export interface ImageAssistantSettings {
    localProcessing: LocalProcessingSettings;
    operationDefaults: OperationDefaults;

    global: {
        enableContextMenu: boolean;
        codeBlockImageLinkIndexing: boolean;
        showSpaceSavedNotification: boolean;
    };

    ocrSettings: OCRSettings;
    cleanerSettings: {
        basePath: string;
        trashMode: 'system' | 'obsidian' | 'custom';
        customTrashPath: string;
        fileTypes: string;
    };

    captions: {
        enabled: boolean;
        skipExtensions: string;
        fontSize: string;
        color: string;
        fontStyle: string;
        backgroundColor: string;
        padding: string;
        borderRadius: string;
        opacity: string;
        fontWeight: string;
        textTransform: string;
        letterSpacing: string;
        border: string;
        marginTop: string;
        alignment: string;
    };

    alignment: {
        enabled: boolean;
        default: 'left' | 'center' | 'right';
        enableEditModeWrap: boolean;
    };

    interactiveResize: {
        enabled: boolean;
        dragEnabled: boolean;
        scrollEnabled: boolean;
        aspectRatioLocked: boolean;
        readingModeEnabled: boolean;
        sensitivity: number;
        scrollModifier: "None" | "Shift" | "Control" | "Alt" | "Meta";
    };

    pasteHandling: {
        mode: PasteHandlingMode;
        cursorLocation: "front" | "back";
        cloud: CloudUploadSettings;
        neverProcessFilenames: string;
    };

    resizeCursorLocation: "front" | "back" | "below" | "none";
    annotationPresets: {
        drawing: ToolPreset[];
        arrow: ToolPreset[];
        text: ToolPreset[];
    };
    modalSessionState?: {
        customFolderOverride?: string;
        customFilenameOverride?: string;
    };
}
