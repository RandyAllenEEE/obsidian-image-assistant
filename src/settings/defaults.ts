import { ImageAssistantSettings } from "./types";

// Re-export for convenience
export type { ImageAssistantSettings };

// Import DEFAULT_OCR_SETTINGS from its source
import { DEFAULT_OCR_SETTINGS } from "../ocr/OCRSettings";
export { DEFAULT_OCR_SETTINGS };

export const DEFAULT_SETTINGS: ImageAssistantSettings = {
    localProcessing: {
        destination: {
            type: "DEFAULT",
            customTemplate: undefined,
            subfolderTemplate: "{notename}",
        },
        filename: {
            customTemplate: "{imagename}",
            skipRenamePatterns: "",
            conflictResolution: "increment",
        },
        conversion: {
            outputFormat: "WEBP",
            quality: 80,
            colorDepth: 1,
            resizeMode: "None",
            desiredWidth: 800,
            desiredHeight: 600,
            desiredLongestEdge: 800,
            enlargeOrReduce: "Always",
            allowLargerFiles: false,
            skipConversionPatterns: "",
            minimumCompressionSavingsInKB: 30,
        },
        externalTools: {
            pngquantExecutablePath: "",
            pngquantQuality: "65-80",
            ffmpegExecutablePath: "",
            ffmpegCrf: 23,
            ffmpegPreset: "medium",
            ffmpegDetectedEncoder: undefined,
            ffmpegDetectedEncoderPath: undefined,
            useSystemPathForBinary: true,
        },
        link: {
            linkFormat: "wikilink",
            pathFormat: "shortest",
            prependCurrentDir: false,
        },
        embedResize: {
            resizeDimension: "none",
            width: undefined,
            height: undefined,
            customValue: undefined,
            longestEdge: undefined,
            shortestEdge: undefined,
            editorMaxWidthValue: undefined,
            resizeScaleMode: "auto",
            respectEditorMaxWidth: true,
            maintainAspectRatio: true,
            resizeUnits: "pixels",
        },
    },
    operationDefaults: {
        singleImage: undefined,
        batchLocal: {
            convertTo: "webp",
            quality: 0.75,
            resizeMode: "None",
            desiredWidth: 600,
            desiredHeight: 800,
            desiredLength: 800,
            skipImagesInTargetFormat: false,
            enlargeOrReduce: "Always",
            skipFormats: "pdf,svg",
        },
    },
    global: {
        enableContextMenu: true,
        codeBlockImageLinkIndexing: true,
        showSpaceSavedNotification: true,
        batchConcurrency: 3,
    },

    ocrSettings: DEFAULT_OCR_SETTINGS,
    cleanerSettings: {
        basePath: 'attachments',
        trashMode: 'obsidian',
        customTrashPath: '.trash',
        fileTypes: 'jpg,jpeg,png,gif,webp,bmp,svg,pdf,mp4,mp3'
    },

    captions: {
        enabled: true,
        showInReadingMode: true,
        showInLivePreview: true,
        inlinePolicy: 'all',
        widthMode: 'auto',
        maxLines: 0,
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
            cloudLinkFormat: 'markdown'
        }
    },

    annotationPresets: {
        drawing: Array(3).fill(null).map(() => ({
            color: '#000000',
            opacity: 1,
            blendMode: 'source-over',
            size: 2
        })),
        arrow: Array(3).fill(null).map(() => ({
            color: '#000000',
            opacity: 1,
            blendMode: 'source-over',
            size: 2
        })),
        text: Array(3).fill(null).map(() => ({
            color: '#000000',
            opacity: 1,
            blendMode: 'source-over',
            size: 24,
            backgroundColor: 'transparent',
            backgroundOpacity: 0.7
        }))
    },
    resizeCursorLocation: "none",
};
