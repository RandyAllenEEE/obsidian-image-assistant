// Basic types
export type OutputFormat = "ORIGINAL" | "WEBP" | "PNG" | "JPEG" | "AVIF" | "PNGQUANT" | "NONE";

// Import Class Types (Avoiding circular dependency if possible, used as Types)
import { LinkFormatSettings } from "../settings/LinkFormatSettings";
import { NonDestructiveResizeSettings } from "../settings/NonDestructiveResizeSettings";
import type { LinkFormatPreset } from "./LinkFormatSettings";
import type { NonDestructiveResizePreset } from "./NonDestructiveResizeSettings";
export type { ResizeDimension } from "./NonDestructiveResizeSettings";

// Import OCRSettings locally
import { OCRSettings } from "../ocr/OCRSettings";

// Re-export for convenience
export type { LinkFormatPreset, NonDestructiveResizePreset, OCRSettings };
export type { PathFormat, LinkFormat } from "./LinkFormatSettings";
export type { ResizeScaleMode, ResizeUnits } from "./NonDestructiveResizeSettings";

export type ModalBehavior = "always" | "never" | "ask";

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
    deleteSource: boolean;
    downloadPath: string;
    uploadConcurrency: number;
    cloudLinkFormat: 'markdown' | 'wikilink';
}

export type FolderPresetType = "DEFAULT" | "ROOT" | "CURRENT" | "SUBFOLDER" | "CUSTOM";
export type FilenamePresetType = "imagename" | "notename" | "timestamp" | "custom";
// Unified ResizeMode including all supported modes
export type ResizeMode = "None" | "Fit" | "Fill" | "Scale" | "LongestEdge" | "ShortestEdge" | "Width" | "Height";
export type EnlargeReduce = "Always" | "Reduce" | "Enlarge" | "Auto";

export type ActivePresetSetting =
    | "selectedFolderPreset"
    | "selectedFilenamePreset"
    | "selectedConversionPreset"
    | "selectedLinkFormatPreset"
    | "selectedResizePreset";

export interface FolderPreset {
    type: FolderPresetType;
    customTemplate?: string;
    name: string;
}

export interface FilenamePreset {
    customTemplate?: string;
    name: string;
    skipRenamePatterns: string;
    conflictResolution: "reuse" | "increment" | "skip" | "overwrite";
}

export interface ConversionPreset {
    name: string;
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
    pngquantExecutablePath?: string;
    pngquantQuality?: string;
    ffmpegExecutablePath?: string;
    ffmpegCrf?: number;
    ffmpegPreset?: string;
}

export interface PresetUIState {
    folder: PresetCategoryUIState<FolderPreset>;
    filename: PresetCategoryUIState<FilenamePreset>;
    conversion: PresetCategoryUIState<ConversionPreset>;
    linkformat: PresetCategoryUIState<LinkFormatPreset>;
    globalPresetVisible: boolean;
    resize: PresetCategoryUIState<NonDestructiveResizePreset>;
    pasteHandlingSectionCollapsed: boolean;
    imageAlignmentSectionCollapsed: boolean;
    imageDragResizeSectionCollapsed: boolean;
    imageCaptionSectionCollapsed: boolean;
    cleanerSectionCollapsed: boolean;
    ocrSectionCollapsed: boolean;
    otherSectionCollapsed: boolean;
}

export interface PresetCategoryUIState<T> {
    editingPreset: T | null;
    newPreset: T | null;
}

export interface GlobalPreset {
    name: string;
    folderPreset: string;
    filenamePreset: string;
    conversionPreset: string;
    linkFormatPreset: string;
    resizePreset: string;
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
    resizeMode: ResizeMode;
    desiredWidth: number;
    desiredHeight: number;
    desiredLongestEdge: number;
    enlargeOrReduce: EnlargeReduce;
}

// Import and re-export LinkFormatSettings and NonDestructiveResizeSettings classes
export { LinkFormatSettings } from "./LinkFormatSettings";
export { NonDestructiveResizeSettings } from "./NonDestructiveResizeSettings";

export interface ImageAssistantSettings {
    folderPresets: FolderPreset[];
    selectedFolderPreset: string;
    filenamePresets: FilenamePreset[];
    selectedFilenamePreset: string;
    conversionPresets: ConversionPreset[];
    selectedConversionPreset: string;
    globalPresets: GlobalPreset[];
    selectedGlobalPreset: string;

    global: {
        outputFormat: OutputFormat;
        quality: number;
        colorDepth: number;
        pngquantQuality: string;
        pngquantExecutablePath: string;
        ffmpegExecutablePath: string;
        ffmpegCrf: number;
        ffmpegPreset: string;
        modalBehavior: ModalBehavior;
        enableContextMenu: boolean;
        showSpaceSavedNotification: boolean;
        revertToOriginalIfLarger: boolean;
        useSystemPathForBinary: boolean;
    };

    linkFormatSettings: LinkFormatSettings;
    nonDestructiveResizeSettings: NonDestructiveResizeSettings;
    ocrSettings: OCRSettings;
    cleanerSettings: {
        basePath: string;
        trashMode: 'system' | 'obsidian' | 'custom';
        customTrashPath: string;
        fileTypes: string;
    };

    processCurrentNote: {
        convertTo: string;
        quality: number;
        resizeMode: string;
        desiredWidth: number;
        desiredHeight: number;
        desiredLength: number;
        skipImagesInTargetFormat: boolean;
        enlargeOrReduce: EnlargeReduce;
        skipFormats: string;
    };

    processAllVault: {
        convertTo: string;
        quality: number;
        resizeMode: string;
        desiredWidth: number;
        desiredHeight: number;
        desiredLength: number;
        enlargeOrReduce: string;
        skipFormats: string;
        skipImagesInTargetFormat: boolean;
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
        cacheCleanupInterval: number;
        cacheLocation: ".obsidian" | "plugin";
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

    singleImageModalSettings?: SingleImageModalSettings;
    resizeCursorLocation: "front" | "back" | "below" | "none";
    annotationPresets: {
        drawing: ToolPreset[];
        arrow: ToolPreset[];
        text: ToolPreset[];
    };
    subfolderTemplate: string;
    modalSessionState?: {
        customFolderOverride?: string;
        customFilenameOverride?: string;
        lastUsedFolderPreset?: string;
        lastUsedFilenamePreset?: string;
    };
}
