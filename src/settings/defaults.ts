import { ImageAssistantSettings, LinkFormatSettings, NonDestructiveResizeSettings } from "./types";

// Re-export for convenience
export type { ImageAssistantSettings };

// Import DEFAULT_OCR_SETTINGS from its source
import { DEFAULT_OCR_SETTINGS } from "../ocr/OCRSettings";
export { DEFAULT_OCR_SETTINGS };

export const DEFAULT_SETTINGS: ImageAssistantSettings = {
    folderPresets: [
        { type: "DEFAULT", name: "Default (Obsidian setting)" },
        { type: "ROOT", name: "Root folder" },
        { type: "CURRENT", name: "Same folder as current note" },
    ],
    selectedFolderPreset: "Default (Obsidian setting)",
    filenamePresets: [
        { name: "Keep original name", customTemplate: "{imagename}", skipRenamePatterns: "", conflictResolution: "increment" },
        { name: "NoteName-Timestamp", customTemplate: "{notename}-{timestamp}", skipRenamePatterns: "", conflictResolution: "increment" },
    ],
    selectedFilenamePreset: "Keep original name",
    conversionPresets: [
        { name: "Default (WebP)", outputFormat: "WEBP", quality: 80, colorDepth: 1, resizeMode: "None", desiredWidth: 800, desiredHeight: 600, desiredLongestEdge: 800, enlargeOrReduce: "Always", allowLargerFiles: false, skipConversionPatterns: "" },
        { name: "High Quality (PNG)", outputFormat: "PNG", quality: 100, colorDepth: 1, resizeMode: "None", desiredWidth: 800, desiredHeight: 600, desiredLongestEdge: 800, enlargeOrReduce: "Always", allowLargerFiles: false, skipConversionPatterns: "" }
    ],
    selectedConversionPreset: "Default (WebP)",
    globalPresets: [
        {
            name: "Default (WebP + Fit)",
            folderPreset: "Default (Obsidian setting)",
            filenamePreset: "Keep original name",
            conversionPreset: "Default (WebP)",
            linkFormatPreset: "Default",
            resizePreset: "Default (No Resize)"
        }
    ],
    selectedGlobalPreset: "Default (WebP + Fit)",
    singleImageModalSettings: undefined,
    global: {
        outputFormat: "NONE",
        quality: 100,
        colorDepth: 1,
        pngquantQuality: "65-80",
        pngquantExecutablePath: "",
        ffmpegExecutablePath: "",
        ffmpegCrf: 23,
        ffmpegPreset: "medium",

        modalBehavior: "never",
        enableContextMenu: true,
        showSpaceSavedNotification: true,
        revertToOriginalIfLarger: false,
        useSystemPathForBinary: true,
    },

    linkFormatSettings: new LinkFormatSettings(),
    nonDestructiveResizeSettings: new NonDestructiveResizeSettings(),
    ocrSettings: DEFAULT_OCR_SETTINGS,
    cleanerSettings: {
        basePath: 'attachments',
        trashMode: 'obsidian',
        customTrashPath: '.trash',
        fileTypes: 'jpg,jpeg,png,gif,webp,bmp,svg,pdf,mp4,mp3'
    },

    processCurrentNote: {
        convertTo: 'webp',
        quality: 0.75,
        resizeMode: 'None',
        desiredWidth: 600,
        desiredHeight: 800,
        desiredLength: 800,
        skipImagesInTargetFormat: false,
        enlargeOrReduce: 'Always',
        skipFormats: 'pdf,svg',
    },

    processAllVault: {
        convertTo: 'webp',
        quality: 0.75,
        resizeMode: 'None',
        desiredWidth: 800,
        desiredHeight: 600,
        desiredLength: 800,
        enlargeOrReduce: 'Always',
        skipFormats: 'pdf,svg',
        skipImagesInTargetFormat: false,
    },

    captions: {
        enabled: true,
        skipExtensions: 'pdf,svg',
        fontSize: '12px',
        color: 'var(--text-muted)',
        fontStyle: 'italic',
        backgroundColor: 'transparent',
        padding: '0',
        borderRadius: '0',
        opacity: '1',
        fontWeight: 'normal',
        textTransform: 'none',
        letterSpacing: 'normal',
        border: 'none',
        marginTop: '4px',
        alignment: 'center',
    },

    alignment: {
        enabled: true,
        default: 'center',
        enableEditModeWrap: false,
        cacheCleanupInterval: 3600000,
        cacheLocation: 'plugin',
    },

    interactiveResize: {
        enabled: true,
        dragEnabled: true,
        scrollEnabled: true,
        aspectRatioLocked: false,
        readingModeEnabled: false,
        sensitivity: 0.1,
        scrollModifier: "Shift",
    },

    pasteHandling: {
        mode: 'local',
        cursorLocation: 'back',
        neverProcessFilenames: '',
        cloud: {
            uploader: 'PicGo',
            uploadServer: 'http://127.0.0.1:36677/upload',
            deleteServer: 'http://127.0.0.1:36677/delete',
            picgoCorePath: '',
            remoteServerMode: false,
            imageSizeWidth: undefined,
            imageSizeHeight: undefined,
            imageSizeSource: 'settings',
            workOnNetWork: false,
            newWorkBlackDomains: '',
            applyImage: true,
            deleteSource: false,
            downloadPath: 'attachments',
            uploadConcurrency: 3,
            cloudLinkFormat: 'markdown'
        }
    },

    annotationPresets: {
        drawing: Array(3).fill({
            color: '#000000',
            opacity: 1,
            blendMode: 'source-over',
            size: 2
        }),
        arrow: Array(3).fill({
            color: '#000000',
            opacity: 1,
            blendMode: 'source-over',
            size: 2
        }),
        text: Array(3).fill({
            color: '#000000',
            opacity: 1,
            blendMode: 'source-over',
            size: 24,
            backgroundColor: 'transparent',
            backgroundOpacity: 0.7
        })
    },
    subfolderTemplate: "",
    resizeCursorLocation: "none",
};
