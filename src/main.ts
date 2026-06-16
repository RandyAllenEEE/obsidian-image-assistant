import {
    Plugin,
    Editor,
    Platform,
    Notice,
    TFile,
    TFolder,
    EditorPosition,
    MarkdownView,
    FileSystemAdapter,
    requestUrl,
    Modal,
    FuzzySuggestModal,
    normalizePath,
    App // Ensure App is imported
} from "obsidian";

import { SupportedImageFormats } from "./local/SupportedImageFormats";
import { FolderAndFilenameManagement } from "./local/FolderAndFilenameManagement";
import { ImageProcessor } from "./local/ImageProcessor";
import { VariableProcessor } from "./local/VariableProcessor";
import { LinkFormatter } from "./utils/LinkFormatter";
import { EmbedResizeSettings } from "./settings/NonDestructiveResizeSettings";
import { ContextMenu } from "./ui/ContextMenu";
import { ConcurrentQueue } from "./utils/AsyncLock";
import { ImageAlignment } from './ui/ImageAlignment'; // Import class directly
import { ImageStateManager } from './ui/ImageStateManager';
import { ImageCaption } from './ui/ImageCaption';
import { ImageResizer } from "./ui/ImageResizer";
import { t } from './lang/helpers';
import { BatchImageProcessor } from "./local/BatchImageProcessor";
import { UnifiedBatchProcessModal } from "./ui/modals/UnifiedBatchProcessModal";
import { ProcessSingleImageModal } from "./ui/modals/ProcessSingleImageModal"; // Keep Single Image for now as it might be used differently



import { UploaderManager } from "./cloud/uploader/index";

import { UploadHelper, ImageLink } from "./utils/UploadHelper";
import { UploadHistoryManager } from "./utils/UploadHistoryManager";
import { basename, dirname, extname, join } from "path-browserify";
import { resolve } from "path-browserify";

// Settings tab and all DEFAULTS
import { ImageConverterSettingTab } from "./settings/ImageAssistantSettings";
import { ImageAssistantSettings, DEFAULT_SETTINGS } from "./settings/defaults";
import { LocalLinkSettings } from "./settings/types";
import { VaultReferenceManager } from "./utils/VaultReferenceManager";
import { UnusedFileCleanerModal } from "./utils/UnusedFileCleanerModal";
import { PasteModeConfigModal } from "./ui/modals/PasteModeConfigModal";


// OCR imports
import { EditorContentInserter } from "./utils/EditorContentInserter";
import { getLatexProvider, getMarkdownProvider } from "./ocr/providers/index";
import { CloudImageHandler } from "./cloud/CloudImageHandler";
import { LocalImageHandler } from "./local/LocalImageHandler";

/**
 * Folder Selector Modal for selecting a folder from the vault
 * 文件夹选择器模态框，用于从库中选择文件夹
 */
class FolderSelectorModal extends FuzzySuggestModal<TFolder> {
    private onChoose: (folder: TFolder) => void;

    constructor(app: any, onChoose: (folder: TFolder) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder(t("DIALOG_SELECT_FOLDER_PLACEHOLDER"));
    }

    getItems(): TFolder[] {
        const folders: TFolder[] = [];
        const files = this.app.vault.getAllLoadedFiles();

        for (const file of files) {
            if (file instanceof TFolder) {
                folders.push(file);
            }
        }

        return folders;
    }

    getItemText(folder: TFolder): string {
        return folder.path || "/";
    }

    onChooseItem(folder: TFolder): void {
        this.onChoose(folder);
    }
}

export default class ImageConverterPlugin extends Plugin {
    settings: ImageAssistantSettings;

    // Check supported image formats
    supportedImageFormats: SupportedImageFormats;
    // Handle image management
    folderAndFilenameManagement: FolderAndFilenameManagement;
    // Handle image processing
    imageProcessor: ImageProcessor;
    // Handle variable processing
    variableProcessor: VariableProcessor;
    // Link formatter
    linkFormatter: LinkFormatter;
    // Context menu
    contextMenu: ContextMenu | null = null;
    // Alignment
    imageAlignment: ImageAlignment | null = null;
    imageStateManager: ImageStateManager | null = null;
    imageCaption: ImageCaption | null = null;

    // drag-resize (Managed by StateManager but kept for reference if needed)
    imageResizer: ImageResizer | null = null;

    // batch processing
    batchImageProcessor: BatchImageProcessor;
    // Single Image Modal
    processSingleImageModal: ProcessSingleImageModal;

    // captions
    // captionManager: ImageCaptionManager; // Deprecated
    // upload history
    historyManager: UploadHistoryManager;
    // upload helper for batch upload and download
    uploadHelper: UploadHelper;

    // Handlers
    cloudImageHandler: CloudImageHandler;
    localImageHandler: LocalImageHandler;

    // Concurrent Queue
    public concurrentQueue: ConcurrentQueue;

    // Proxy methods for external access
    public async uploadSingleFile(file: TFile) {
        await this.cloudImageHandler.uploadSingleFile(file);
    }

    public async uploadFolderImagesPublic(folderPath: string, recursive: boolean) {
        await this.cloudImageHandler.uploadFolderImages(folderPath, recursive);
    }

    public async downloadFolderImagesPublic(folderPath: string, recursive: boolean) {
        await this.cloudImageHandler.downloadFolderImages(folderPath, recursive);
    }

    // unused file cleaner
    unusedFileCleaner: UnusedFileCleanerModal | null = null;
    // Vault Reference Manager
    vaultReferenceManager: VaultReferenceManager;

    private processedImage: ArrayBuffer | null = null;
    private temporaryBuffers: (ArrayBuffer | Blob | null)[] = [];
    private get tempFolderPath(): string {
        const configDir = this.app.vault.configDir || ".obsidian";
        return normalizePath(`${configDir}/plugins/${this.manifest.id}/temp`);
    }

    // Memory cleanup method
    private clearMemory() {
        // Clear processed image
        if (this.processedImage) {
            this.processedImage = null;
        }

        // Clear temporary buffers
        if (this.temporaryBuffers.length > 0) {
            this.temporaryBuffers = [];
        }

        // Force garbage collection hint
        if (typeof global !== 'undefined' && global.gc) {
            global.gc();
        }
    }

    private attachImageResizerToMarkdownView(markdownView: MarkdownView, refreshLayout = false) {
        if (!this.settings.interactiveResize.enabled || !this.imageResizer) return;

        if (refreshLayout) {
            this.imageResizer.onLayoutChange(markdownView);
            return;
        }

        this.imageResizer.onActiveViewChange(markdownView);
    }

    private attachImageResizerToActiveView(refreshLayout = false) {
        if (!this.settings.interactiveResize.enabled || !this.imageResizer) return;

        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView) {
            this.attachImageResizerToMarkdownView(activeView, refreshLayout);
            return;
        }

        this.imageResizer.detachView();
    }

    private registerImageResizerWorkspaceEvents() {
        if (!this.settings.interactiveResize.enabled || !this.imageResizer) return;

        this.registerEvent(
            this.app.workspace.on('file-open', (file) => {
                if (!file) {
                    this.imageResizer?.detachView();
                    return;
                }

                this.attachImageResizerToActiveView();
            })
        );

        this.registerEvent(
            this.app.workspace.on('active-leaf-change', (leaf) => {
                const leafView = leaf?.view;
                const markdownView = leafView instanceof MarkdownView
                    ? leafView
                    : this.app.workspace.getActiveViewOfType(MarkdownView);

                if (markdownView) {
                    this.attachImageResizerToMarkdownView(markdownView);
                    return;
                }

                this.imageResizer?.detachView();
            })
        );

        this.registerEvent(
            this.app.workspace.on('layout-change', () => {
                this.attachImageResizerToActiveView(true);
            })
        );
    }



    async onload() {
        await this.loadSettings();



        this.addSettingTab(new ImageConverterSettingTab(this.app, this));

        // Initialize concurrent queue with settings
        this.concurrentQueue = new ConcurrentQueue(
            this.settings.pasteHandling.cloud.uploadConcurrency
        );

        // Initialize core components immediately
        this.supportedImageFormats = new SupportedImageFormats(this.app);

        // Initialize Handlers
        this.cloudImageHandler = new CloudImageHandler(
            this.app,
            this,
            new UploaderManager(this.settings.pasteHandling.cloud.uploader, this),
            this.concurrentQueue
        );
        this.localImageHandler = new LocalImageHandler(this.app, this);

        // Ensure temp folder exists for cloud upload
        await this.ensureTempFolderExists();

        // 应用编辑模式 Wrap 开关
        if (this.settings.alignment.enableEditModeWrap) {
            document.body.addClass('image-assistant-wrap-in-edit-mode');
        } else {
            document.body.removeClass('image-assistant-wrap-in-edit-mode');
        }

        // ✅ 立即注册所有命令（在 onLayoutReady 之前）
        // 这确保命令可以在 Obsidian 设置界面中绑定快捷键
        this.registerAllCommands();

        // Initialize Image State Manager (Coordinator)
        this.imageStateManager = new ImageStateManager(this.app, this);
        this.imageAlignment = new ImageAlignment(this.app, this);
        this.imageCaption = new ImageCaption(this);
        if (this.settings.interactiveResize.enabled) {
            this.imageResizer = new ImageResizer(this);
            this.addChild(this.imageResizer);
        }

        // Register StateManager refresh events
        // Note: ImageStateManager handles its own 'active-leaf-change' observation in setupObserver.
        // We only register 'file-open' here as a backup for same-leaf file switches, but debounced.
        if (this.settings.alignment.enabled || this.settings.captions.enabled) {
            this.registerEvent(
                this.app.workspace.on('file-open', (file) => {
                    if (file) {
                        this.imageStateManager?.refreshAllImages();
                    }
                })
            );
        }

        /* Deprecated Managers (Removed) */

        // Wait for layout to be ready before initializing view-dependent components
        this.app.workspace.onLayoutReady(() => {
            void this.initializeComponents()
                .then(() => {
                    this.registerImageResizerWorkspaceEvents();
                    this.attachImageResizerToActiveView();
                })
                .catch((error) => {
                    console.error('[Image Assistant] Failed to initialize layout components:', error);
                });
        });
        // const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        // if (!activeView) return;

        // this.registerDomEvent(activeView.contentEl, 'click', (evt: MouseEvent) => {
        //     const target = evt.target as HTMLElement;
        //     if (target.tagName === 'IMG') {
        //         evt.preventDefault();
        //         evt.stopPropagation();
        //     }
        // }, true);


        // Register MarkdownPostProcessor for Reading Mode Image Handling
        this.registerMarkdownPostProcessor((element, context) => {
            const images = element.querySelectorAll('img');
            images.forEach((img) => {
                if (img instanceof HTMLImageElement && this.imageStateManager) {
                    this.imageStateManager.processReadingModeImage(img);
                }
            });
        });
    }

    async initializeComponents() {

        // Initialize base components first
        this.variableProcessor = new VariableProcessor(this.app, this.settings);
        this.linkFormatter = new LinkFormatter(this.app);
        this.imageProcessor = new ImageProcessor(this.app, this.supportedImageFormats);
        this.vaultReferenceManager = new VaultReferenceManager(this.app, this);

        // Initialize History Manager
        this.historyManager = new UploadHistoryManager(this.app, this);
        await this.historyManager.init();

        if (this.settings.interactiveResize.enabled) {
            this.attachImageResizerToActiveView();
        }

        // Initialize components that depend on others
        this.folderAndFilenameManagement = new FolderAndFilenameManagement(
            this.app,
            this.settings,
            this.supportedImageFormats,
            this.variableProcessor
        );

        // Initialize upload helper
        this.uploadHelper = new UploadHelper(this.app);

        // Finalize StateManager Initialization
        if (this.imageStateManager && this.imageAlignment && this.imageCaption) {
            this.imageStateManager.initialize(
                this.imageAlignment,
                this.imageResizer!, // Can be null if disabled
                this.imageCaption
            );
        }

        // Initialize network image downloader via CloudImageHandler facade
        this.cloudImageHandler.initializeDownloader(
            this.uploadHelper,
            this.folderAndFilenameManagement
        );

        this.batchImageProcessor = new BatchImageProcessor(
            this.app,
            this,
            this.imageProcessor,
            this.folderAndFilenameManagement
        );

        // Initialize context menu if enabled
        if (this.settings.global.enableContextMenu) {
            this.contextMenu = new ContextMenu(
                this.app,
                this,
                this.folderAndFilenameManagement,
                this.variableProcessor
            );
            this.addChild(this.contextMenu);
        }

        // Register PASTE/DROP events
        this.dropPasteRegisterEvents();

        // Register file menu events
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (file instanceof TFile && this.supportedImageFormats.isSupported(undefined, file.name)) {
                    menu.addItem((item) => {
                        item.setTitle(t("MENU_PROCESS_IMAGE"))
                            .setIcon("cog")
                            .onClick(() => {
                                new ProcessSingleImageModal(this.app, this, file).open();
                            });
                    });

                    // Add "Upload to cloud" option for images in cloud mode
                    if (this.settings.pasteHandling.mode === 'cloud') {
                        menu.addItem((item) => {
                            item.setTitle(t("MENU_UPLOAD_CLOUD"))
                                .setIcon("cloud-upload")
                                .onClick(async () => {
                                    await this.cloudImageHandler.uploadSingleFile(file);
                                });
                        });
                    }
                } else if (file instanceof TFile && file.extension === 'md') {
                    // Context menu for Markdown Notes (Batch Operations)

                    // 1. Local Process
                    menu.addItem((item) => {
                        item.setTitle(t("CMD_PROCESS_CURRENT_NOTE") || "Process Images in Note")
                            .setIcon("cog")
                            .onClick(() => {
                                new UnifiedBatchProcessModal(this.app, this, "note", file, "local_process").open();
                            });
                    });

                } else if (file instanceof TFolder) {
                    menu.addItem((item) => {
                        item.setTitle(t("MENU_PROCESS_FOLDER_IMAGES"))
                            .setIcon("cog")
                            .onClick(() => {
                                new UnifiedBatchProcessModal(this.app, this, "folder", file, "local_process").open();
                            });
                    });
                }
            })
        );
    }

    /**
     * 注册所有命令
     * 重要：必须在 onload() 中立即调用，不能延迟到 onLayoutReady
     * 否则命令无法在 Obsidian 设置界面中绑定快捷键
     */
    registerAllCommands() {
        // 注：这些命令在 onload 时注册，但依赖的组件在 onLayoutReady 中初始化
        // 因此 callback 中需要检查组件是否已初始化

        // 注意：所有命令名称统一使用 "Image Assistant:" 前缀（与 manifest.json 的 name 一致）
        // 这样 Obsidian 快捷键设置的搜索功能才能正确工作

        this.addCommand({
            id: 'process-all-vault-images',
            name: t("CMD_PROCESS_ALL_VAULT"),
            callback: () => {
                new UnifiedBatchProcessModal(this.app, this, "vault", null, "local_process").open();
            }
        });

        this.addCommand({
            id: 'process-all-images-current-note',
            name: t("CMD_PROCESS_CURRENT_NOTE"),
            callback: () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) {
                    new UnifiedBatchProcessModal(this.app, this, "note", activeFile, "local_process").open();
                } else {
                    new Notice(t("MSG_NO_ACTIVE_FILE"));
                }
            }
        });

        this.addCommand({
            id: 'open-image-converter-settings',
            name: t("CMD_OPEN_SETTINGS"),
            callback: () => this.commandOpenSettingsTab()
        });

        // 清理无用文件
        this.addCommand({
            id: 'clean-unused-files',
            name: t("CMD_CLEAN_UNUSED"),
            callback: () => {
                new UnusedFileCleanerModal(this.app, this).open();
            }
        });

        // 批量处理文件夹内的所有图片
        this.addCommand({
            id: 'process-folder-images',
            name: t("MENU_PROCESS_FOLDER_IMAGES"),
            callback: async () => {
                new FolderSelectorModal(this.app, async (folder: TFolder) => {
                    new UnifiedBatchProcessModal(this.app, this, "folder", folder, "local_process").open();
                }).open();
            }
        });

        // Cloud Batch Commands (New)
        // --------------------------

        this.addCommand({
            id: 'upload-all-vault-images',
            name: t("CMD_UPLOAD_ALL_VAULT" as any) || "Upload all images in vault", // Fallback if key missing
            callback: async () => {
                new UnifiedBatchProcessModal(this.app, this, "vault", null, "upload").open();
            }
        });

        this.addCommand({
            id: 'upload-all-images-current-note',
            name: t("CMD_UPLOAD_CURRENT_NOTE" as any) || "Upload all images in current note",
            callback: async () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) {
                    new UnifiedBatchProcessModal(this.app, this, "note", activeFile, "upload").open();
                } else {
                    new Notice(t("MSG_NO_ACTIVE_FILE"));
                }
            }
        });

        this.addCommand({
            id: 'upload-folder-images',
            name: t("MENU_UPLOAD_FOLDER_IMAGES"),
            callback: async () => {
                new FolderSelectorModal(this.app, async (folder: TFolder) => {
                    new UnifiedBatchProcessModal(this.app, this, "folder", folder, "upload").open();
                }).open();
            }
        });

        // Frontmatter 模式控制命令
        this.addCommand({
            id: 'configure-paste-mode-current-note',
            name: t("CMD_CONFIG_PASTE_MODE"),
            callback: async () => {
                await this.showPasteModeConfigModal();
            }
        });

        // OCR 命令（不依赖其他组件，但只在桌面端可用）
        // 移动端不支持 electron clipboard API
        if (!Platform.isMobile) {
            this.addCommand({
                id: 'ocr-latex-multiline',
                name: t("CMD_OCR_LATEX_MULTI"),
                callback: async () => {
                    await this.handleOCRLatex(true);
                }
            });

            this.addCommand({
                id: 'ocr-latex-inline',
                name: t("CMD_OCR_LATEX_INLINE"),
                callback: async () => {
                    await this.handleOCRLatex(false);
                }
            });

            this.addCommand({
                id: 'ocr-markdown',
                name: t("CMD_OCR_MARKDOWN"),
                callback: async () => {
                    await this.handleOCRMarkdown();
                }
            });
        }

        this.addReloadCommand();
    }


    async onunload() {
        // Clean up alignment related components first


        // Clean up resizer next since other components might depend on it
        if (this.imageResizer) {
            const { imageResizer } = this;
            this.imageResizer = null;
            this.removeChild(imageResizer);
        }

        // Clean up UI components
        if (this.contextMenu) {
            const { contextMenu } = this;
            this.contextMenu = null;
            this.removeChild(contextMenu);
        }

        // Clean up modals
        [
            this.processSingleImageModal
        ].forEach(modal => {
            if (modal?.close) modal.close();
        });

        // Clean up any open modals
        [
            this.processSingleImageModal
        ].forEach(modal => {
            if (modal?.close) modal.close();
        });

        document.body.classList.remove('image-captions-enabled');
    }


    // Load settings method
    async loadSettings() {
        const loadedData = await this.loadData();

        // Deep merge helper
        const deepMerge = (target: any, source: any): any => {
            if (typeof target !== 'object' || target === null) {
                return source;
            }
            if (typeof source !== 'object' || source === null) {
                return target;
            }

            const output = { ...target };

            for (const key in source) {
                if (source.hasOwnProperty(key)) {
                    if (source[key] instanceof Array) {
                        // Arrays are overwritten, not merged (usually desired for lists)
                        // But for stability, if source has array, we take it.
                        output[key] = source[key];
                    } else if (typeof source[key] === 'object' && source[key] !== null) {
                        output[key] = deepMerge(target[key], source[key]);
                    } else {
                        output[key] = source[key];
                    }
                }
            }
            return output;
        };

        this.settings = deepMerge(DEFAULT_SETTINGS, loadedData);
        this.stripLegacyPresetSettings(this.settings);

        // Ensure critical sections exist even if deepMerge missed something (e.g. new sections)
        if (!this.settings.global) this.settings.global = { ...DEFAULT_SETTINGS.global };
        if (!this.settings.pasteHandling) this.settings.pasteHandling = { ...DEFAULT_SETTINGS.pasteHandling };
        if (!this.settings.localProcessing) this.settings.localProcessing = { ...DEFAULT_SETTINGS.localProcessing };
        if (!this.settings.operationDefaults) this.settings.operationDefaults = { ...DEFAULT_SETTINGS.operationDefaults };
    }

    public getDefaultSingleImageOperationSettings() {
        const { conversion, externalTools } = this.settings.localProcessing || DEFAULT_SETTINGS.localProcessing;
        return {
            outputFormat: conversion.outputFormat,
            quality: conversion.quality,
            colorDepth: conversion.colorDepth,
            resizeMode: conversion.resizeMode,
            desiredWidth: conversion.desiredWidth,
            desiredHeight: conversion.desiredHeight,
            desiredLongestEdge: conversion.desiredLongestEdge,
            enlargeOrReduce: conversion.enlargeOrReduce,
            allowLargerFiles: conversion.allowLargerFiles,
            pngquantExecutablePath: externalTools.pngquantExecutablePath,
            pngquantQuality: externalTools.pngquantQuality,
            ffmpegExecutablePath: externalTools.ffmpegExecutablePath,
            ffmpegCrf: externalTools.ffmpegCrf,
            ffmpegPreset: externalTools.ffmpegPreset,
            ffmpegDetectedEncoder: externalTools.ffmpegDetectedEncoder,
            ffmpegDetectedEncoderPath: externalTools.ffmpegDetectedEncoderPath,
        };
    }

    // Save settings method
    async saveSettings() {
        this.stripLegacyPresetSettings(this.settings);
        await this.saveData(this.settings);
    }

    private stripLegacyPresetSettings(settings: unknown): void {
        const legacyPresetKeys = new Set([
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
            "globalPresetsVisible",
        ]);

        const strip = (value: unknown): void => {
            if (!value || typeof value !== "object") return;
            if (Array.isArray(value)) {
                value.forEach(strip);
                return;
            }

            const record = value as Record<string, unknown>;
            for (const key of Object.keys(record)) {
                if (legacyPresetKeys.has(key)) {
                    delete record[key];
                } else {
                    strip(record[key]);
                }
            }
        };

        strip(settings);
    }

    /**
     * Update concurrent queue with new concurrency value
     * Called when upload concurrency setting is changed
     */
    updateConcurrentQueue(concurrency: number) {
        this.concurrentQueue = new ConcurrentQueue(concurrency);
    }

    // Command to open settings tab
    async commandOpenSettingsTab() {
        const { setting } = this.app as any;
        if (setting) {
            await setting.open();
            setting.openTabById(this.manifest.id);
        } else {
            new Notice(t("MSG_UNABLE_OPEN_SETTINGS"));
        }
    }

    addReloadCommand() {
        this.addCommand({
            id: 'reload-plugin',
            name: t("CMD_RELOAD_PLUGIN"),
            callback: async () => {
                new Notice(t("MSG_RELOADING_PLUGIN"));

                try {
                    // Use the workaround to access the internal plugins API
                    const { plugins } = this.app as any;

                    // 1. Disable the plugin
                    if (plugins && plugins.disablePlugin) {
                        await plugins.disablePlugin(this.manifest.id);
                    } else {
                        console.error("Plugins API is not accessible.");
                        new Notice(t("MSG_RELOAD_FAILED_API"));
                        return;
                    }

                    // add some delay as disabling takes some time.
                    await new Promise(resolve => setTimeout(resolve, 500)); // even 100ms would be enough.

                    // 2. Re-enable the plugin
                    if (plugins && plugins.enablePlugin) {
                        await plugins.enablePlugin(this.manifest.id);
                    } else {
                        console.error("Plugins API is not accessible.");
                        new Notice(t("MSG_RELOAD_FAILED_API"));
                        return;
                    }


                    new Notice(t("MSG_PLUGIN_RELOADED"));
                } catch (error) {
                    console.error("Error reloading plugin:", error);
                    new Notice(t("MSG_RELOAD_FAILED"));
                }
            },
        });
    }

    // Frontmatter 模式控制相关方法

    /**
     * 获取当前笔记的有效粘贴模式
     * 优先级: 笔记级别 Frontmatter > 全局设置
     */
    private getEffectivePasteMode(): 'local' | 'cloud' | 'disabled' {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            return this.settings.pasteHandling.mode;
        }

        const cache = this.app.metadataCache.getFileCache(activeFile);
        const frontmatter = cache?.frontmatter;

        if (frontmatter && 'image_paste_mode' in frontmatter) {
            const override = frontmatter['image_paste_mode'];
            if (override === 'local' || override === 'cloud' || override === 'disabled') {
                return override;
            }
        }

        return this.settings.pasteHandling.mode;
    }

    /**
     * 显示粘贴模式配置模态框
     */
    private async showPasteModeConfigModal() {
        const modal = new PasteModeConfigModal(this.app, this);
        modal.open();
    }

    // OCR 功能相关方法

    /**
     * 获取剪贴板中的图片数据
     * 注意: 仅桌面端可用，移动端不支持 clipboard API
     */
    private async getClipboardImage(): Promise<Uint8Array | null> {
        // 移动端检查
        if (Platform.isMobile) {
            new Notice(t("MSG_OCR_DESKTOP_ONLY"));
            return null;
        }

        try {
            // 使用 Web Clipboard API 读取图片
            // 在 Obsidian 桌面版中，navigator.clipboard 可用于访问剪贴板内容
            const clipboardItems = await navigator.clipboard.read();

            for (const item of clipboardItems) {
                for (const type of item.types) {
                    if (type.startsWith('image/')) {
                        const blob = await item.getType(type);
                        const arrayBuffer = await blob.arrayBuffer();
                        return new Uint8Array(arrayBuffer);
                    }
                }
            }

            // 检查是否有 PNG 或 JPEG 格式的图片数据
            // 某些情况下图片可能以其他格式提供
            for (const item of clipboardItems) {
                if (item.types.includes('image/png')) {
                    const blob = await item.getType('image/png');
                    const arrayBuffer = await blob.arrayBuffer();
                    return new Uint8Array(arrayBuffer);
                }
                if (item.types.includes('image/jpeg')) {
                    const blob = await item.getType('image/jpeg');
                    const arrayBuffer = await blob.arrayBuffer();
                    return new Uint8Array(arrayBuffer);
                }
            }

            new Notice(t("MSG_NO_CLIPBOARD_IMAGE"));
            return null;
        } catch (error) {
            console.error('Failed to read clipboard image:', error);
            new Notice(t("MSG_CLIPBOARD_READ_FAIL"));
            return null;
        }
    }

    /**
     * 处理 OCR 转 LaTeX
     */
    private async handleOCRLatex(isMultiline: boolean) {
        let editorInteract: EditorContentInserter | null = null;
        try {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view) {
                new Notice(t("MSG_OPEN_MD_DOC"));
                return;
            }

            const image = await this.getClipboardImage();
            if (!image) return;

            editorInteract = new EditorContentInserter(view);
            editorInteract.insertLoadingText(t("LOADING_OCR_LATEX") || "Loading latex...");

            const provider = getLatexProvider(this.app, isMultiline, this.settings.ocrSettings);
            const parsedLatex = await provider.sendRequest(image);
            editorInteract.insertResponseToEditor(parsedLatex);
        } catch (error) {
            console.error('[OCR] LaTeX conversion error:', error);
            new Notice(t("MSG_OCR_FAILED", [error.message]));
            // Remove loading text on error
            if (editorInteract) editorInteract.removeLoadingText();
        } finally {
            // Clear memory after OCR processing
            this.clearMemory();
        }
    }

    /**
     * 处理 OCR 转 Markdown
     */
    private async handleOCRMarkdown() {
        let editorInteract: EditorContentInserter | null = null;
        try {
            const view = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (!view) {
                new Notice(t("MSG_OPEN_MD_DOC"));
                return;
            }

            const image = await this.getClipboardImage();
            if (!image) return;

            editorInteract = new EditorContentInserter(view);
            editorInteract.insertLoadingText(t("LOADING_OCR_MARKDOWN") || "Loading markdown...");

            const provider = getMarkdownProvider(this.app, this.settings.ocrSettings);
            const result = await provider.sendRequest(image);
            editorInteract.insertResponseToEditor(result);
        } catch (error) {
            console.error('[OCR] Markdown conversion error:', error);
            new Notice(t("MSG_OCR_FAILED", [error.message]));
            // Remove loading text on error
            if (editorInteract) editorInteract.removeLoadingText();
        } finally {
            // Clear memory after OCR processing
            this.clearMemory();
        }
    }

    private dropPasteRegisterEvents() {
        if (Platform.isMobile) return;

        // Drop event (Obsidian editor - primary handlers)
        this.registerEvent(
            this.app.workspace.on("editor-drop", async (evt: DragEvent, editor: Editor) => {
                if (evt.defaultPrevented) return;

                if (!evt.dataTransfer) {
                    console.warn("DataTransfer object is null initially. Cannot process drop event.");
                    return;
                }

                // Get the actual drop position from the mouse event
                const pos = editor.posAtMouse(evt);
                if (!pos) {
                    console.warn("Could not determine drop position");
                    return;
                }

                const fileData: { name: string, type: string, file: File }[] = [];
                for (let i = 0; i < evt.dataTransfer.files.length; i++) {
                    const file = evt.dataTransfer.files[i];
                    fileData.push({ name: file.name, type: file.type, file });
                }

                const hasSupportedFiles = fileData.some(data =>
                    this.supportedImageFormats.isSupported(data.type, data.name) &&
                    !this.folderAndFilenameManagement.matchesPatterns(data.name, this.settings.pasteHandling.neverProcessFilenames)
                );

                if (hasSupportedFiles) {
                    // Get effective paste mode (may be overridden by Frontmatter)
                    const effectiveMode = this.getEffectivePasteMode();

                    // Check paste handling mode
                    if (effectiveMode === 'disabled') {
                        // Disabled mode: do nothing, let Obsidian handle it
                        return;
                    }

                    evt.preventDefault(); // Prevent default behavior

                    if (effectiveMode === 'cloud') {
                        // Cloud mode: upload to image hosting
                        await this.cloudImageHandler.handleDrop(evt, editor);
                    } else {
                        // Local mode: use original converter logic
                        await this.localImageHandler.handleDrop(evt, editor);
                    }
                }
            })
        );

        // --- Paste event handler ---
        this.registerEvent(
            this.app.workspace.on("editor-paste", async (evt: ClipboardEvent, editor: Editor) => {
                if (evt.defaultPrevented) return;

                if (!evt.clipboardData) {
                    console.warn("ClipboardData object is null. Cannot process paste event.");
                    return;
                }

                const cursor = editor.getCursor();

                // Extract Clipboard Item Information
                const itemData: { kind: string, type: string, file: File | null }[] = [];
                for (let i = 0; i < evt.clipboardData.items.length; i++) {
                    const item = evt.clipboardData.items[i];
                    const file = item.kind === "file" ? item.getAsFile() : null;
                    itemData.push({ kind: item.kind, type: item.type, file });
                }

                // Get clipboard text for URL detection
                const clipboardText = evt.clipboardData.getData('text/plain');

                const hasSupportedItems = itemData.some(data =>
                    data.kind === "file" &&
                    data.file &&
                    this.supportedImageFormats.isSupported(data.type, data.file.name) &&
                    !this.folderAndFilenameManagement.matchesPatterns(data.file.name, this.settings.pasteHandling.neverProcessFilenames)
                );

                const effectiveMode = this.getEffectivePasteMode();

                if (hasSupportedItems) {
                    if (effectiveMode === 'disabled') {
                        // Disabled mode: do nothing, let Obsidian handle it
                        return;
                    }

                    evt.preventDefault();

                    if (effectiveMode === 'cloud') {
                        // Cloud mode: upload to image hosting
                        await this.cloudImageHandler.handlePaste(evt, editor);
                    } else {
                        // Local mode: use original converter logic
                        await this.localImageHandler.handlePaste(evt, editor);
                    }
                } else if (effectiveMode === 'cloud' && clipboardText) {
                    // Check if pasted text contains image URLs (for URL auto-upload)
                    // Use the CloudImageHandler to handle text paste
                    await this.cloudImageHandler.handlePasteText(clipboardText, editor, cursor, evt);
                }
            })
        );
    }



    // Helper function to insert link at the specified cursor position
    private async insertLinkAtCursorPosition(
        editor: Editor,
        linkPath: string,
        cursor: EditorPosition,
        selectedLinkFormatSetting?: LocalLinkSettings,
        resizeSetting?: EmbedResizeSettings
    ) {

        const activeFile = this.app.workspace.getActiveFile();

        const linkFormatToUse = selectedLinkFormatSetting || this.settings.localProcessing.link;
        const resizeSettingToUse = resizeSetting || this.settings.localProcessing.embedResize;

        // Await the result of formatLink
        const formattedLink = await this.linkFormatter.formatLink(
            linkPath, // Pass the original linkPath
            linkFormatToUse?.linkFormat || "wikilink",
            linkFormatToUse?.pathFormat || "shortest",
            activeFile,
            resizeSettingToUse
        );


        // ----- FRONT or BACK ---------
        // Insert the link at the saved cursor position
        // - FRONT:Keeps the cursor at the front by default (by doing nothing) when cursorLocation is "front"
        editor.replaceRange(formattedLink, cursor);

        // Use positive check for "back"
        // - We have to be carefull not to place it to the back 2 times.
        if (this.settings.pasteHandling.cursorLocation === "back") {
            editor.setCursor({
                line: cursor.line,
                ch: cursor.ch + formattedLink.length,
            });
        }

    }

    // Helper function to insert link using EditorContentInserter (for placeholders)
    public async insertLinkWithInserter(
        inserter: EditorContentInserter,
        editor: Editor,
        linkPath: string,
        selectedLinkFormatSetting?: LocalLinkSettings,
        resizeSetting?: EmbedResizeSettings
    ) {
        const activeFile = this.app.workspace.getActiveFile();

        const linkFormatToUse = selectedLinkFormatSetting || this.settings.localProcessing.link;
        const resizeSettingToUse = resizeSetting || this.settings.localProcessing.embedResize;

        // Await the result of formatLink
        const formattedLink = await this.linkFormatter.formatLink(
            linkPath,
            linkFormatToUse?.linkFormat || "wikilink",
            linkFormatToUse?.pathFormat || "shortest",
            activeFile,
            resizeSettingToUse
        );

        inserter.insertResponseToEditor(formattedLink);
    }

    private formatFileSize(bytes: number): string {
        if (bytes < 1024) {
            return `${bytes} bytes`;
        }
        if (bytes < 1024 * 1024) {
            return `${(bytes / 1024).toFixed(1)} KB`;
        }
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    showSizeComparisonNotification(originalSize: number, newSize: number) {
        if (!this.settings.global.showSpaceSavedNotification) return;

        const originalSizeFormatted = this.formatFileSize(originalSize);
        const newSizeFormatted = this.formatFileSize(newSize);

        const percentChange = ((newSize - originalSize) / originalSize * 100).toFixed(1);
        const changeSymbol = newSize > originalSize ? '+' : '';

        const message = `${originalSizeFormatted} → ${newSizeFormatted} (${changeSymbol}${percentChange}%)`;
        new Notice(message);
    }

    /**
     * Ensure temp folder exists for cloud upload
     */
    private async ensureTempFolderExists(): Promise<void> {
        try {
            console.log('[Cloud Upload] Checking temp folder:', this.tempFolderPath);
            const exists = await this.app.vault.adapter.exists(this.tempFolderPath);
            console.log('[Cloud Upload] Temp folder exists:', exists);

            if (!exists) {
                console.log('[Cloud Upload] Creating temp folder:', this.tempFolderPath);
                await this.app.vault.createFolder(this.tempFolderPath);
                console.log('[Cloud Upload] Created temp folder successfully');
            }
        } catch (error) {
            console.error('[Cloud Upload] Failed to create temp folder:', error);
            console.error('[Cloud Upload] Temp folder path was:', this.tempFolderPath);
            // Re-throw the error so caller knows folder creation failed
            throw new Error(`Failed to ensure temp folder exists: ${error.message}`);
        }
    }

    /**
     * Generate unique temp file path
     */
    private generateTempFilePath(fileName: string): string {
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        // Sanitize filename: remove path separators and special characters
        const sanitizedName = fileName.replace(/[\\/:\*\?"<>\|]/g, '_');
        const tempFileName = `.temp_${timestamp}_${random}_${sanitizedName}`;
        return normalizePath(`${this.tempFolderPath}/${tempFileName}`);
    }

    /**
     * Cleanup temp file safely
     */
    private async cleanupTempFile(filePath: string): Promise<void> {
        try {
            const file = this.app.vault.getAbstractFileByPath(filePath);
            if (file instanceof TFile) {
                await this.app.vault.delete(file);
            }
        } catch (error) {
            console.warn(`Failed to delete temp file ${filePath}:`, error);
            // Don't throw, just log the warning
        }
    }

}
