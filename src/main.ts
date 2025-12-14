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
    requestUrl
} from "obsidian";
import { SupportedImageFormats } from "./SupportedImageFormats";
import { FolderAndFilenameManagement } from "./FolderAndFilenameManagement";
import { ImageProcessor } from "./ImageProcessor";
import { VariableProcessor } from "./VariableProcessor";
import { LinkFormatPreset } from "./LinkFormatSettings";
import { LinkFormatter } from "./LinkFormatter";
import { NonDestructiveResizePreset } from "./NonDestructiveResizeSettings";
import { ContextMenu } from "./ContextMenu";
// import { ImageAlignment } from './ImageAlignment';
import { ImageAlignmentManager } from './ImageAlignmentManager';
import { normalizePath } from "obsidian";
import { ImageResizer } from "./ImageResizer";
import { BatchImageProcessor } from "./BatchImageProcessor";
import { ProcessSingleImageModal } from "./ProcessSingleImageModal";
import { ProcessFolderModal } from "./ProcessFolderModal";
import { ProcessCurrentNote } from "./ProcessCurrentNote";
import { ProcessAllVaultModal } from "./ProcessAllVaultModal"
import { ImageCaptionManager } from "./ImageCaptionManager"
import { UploaderManager } from "./uploader/index";
import { CloudLinkFormatter } from "./CloudLinkFormatter";
import { UploadHelper, ImageLink } from "./UploadHelper";
import { basename, dirname, extname, join } from "path-browserify";
import { resolve } from "path-browserify";

// Settings tab and all DEFAULTS
import {
    ImageConverterSettings,
    DEFAULT_SETTINGS,
    ImageConverterSettingTab,
    ConversionPreset,
    FilenamePreset,
    FolderPreset,
    ConfirmDialog
} from "./ImageConverterSettings";

import { PresetSelectionModal } from "./PresetSelectionModal";
import {
    UploadErrorDialog,
    NoReferenceUploadDialog,
    SingleReferenceUploadDialog,
    MultiReferenceUploadDialog,
    ImageMatchResult,
    BatchUploadConfirmDialog,
    BatchUploadTaskInfo,
    BatchDownloadPreviewDialog,
    BatchDownloadProgressDialog,
    DownloadTaskInfo,
    FileMatchInfo  // 添加 FileMatchInfo 导入
} from "./UploadModals";
import { CloudImageDeleter } from "./CloudImageDeleter";
import { NetworkImageDownloader } from "./NetworkImageDownloader";
import { UnusedFileCleanerModal } from "./UnusedFileCleanerModal";

export default class ImageConverterPlugin extends Plugin {
    settings: ImageConverterSettings;

    // Check supported image formats
    supportedImageFormats: SupportedImageFormats;
    // Handle image management
    folderAndFilenameManagement: FolderAndFilenameManagement;
    // Handle image processing
    imageProcessor: ImageProcessor;
    // Handle variable processing
    variableProcessor: VariableProcessor;
    // linkFormatSettings: LinkFormatSettings;     // Link format - it is initialised via ImageConverterSettings
    // Link formatter
    linkFormatter: LinkFormatter;
    // Context menu
    contextMenu: ContextMenu;
    // Alignment
    // imageAlignment: ImageAlignment | null = null;
    ImageAlignmentManager: ImageAlignmentManager | null = null;
    // drag-resize
    imageResizer: ImageResizer | null = null;
    // batch processing
    batchImageProcessor: BatchImageProcessor;
    // Single Image Modal
    processSingleImageModal: ProcessSingleImageModal;
    // Process whole fodler
    processFolderModal: ProcessFolderModal;
    // Processcurrent note/canvas
    processCurrentNote: ProcessCurrentNote;
    // ProcessAllVault
    processAllVaultModal: ProcessAllVaultModal
    // captions
    captionManager: ImageCaptionManager;
    // upload helper for batch upload and download
    uploadHelper: UploadHelper;
    // network image downloader
    networkDownloader: NetworkImageDownloader;
    // unused file cleaner
    unusedFileCleaner: UnusedFileCleanerModal | null = null;
    
    private processedImage: ArrayBuffer | null = null;
    private temporaryBuffers: (ArrayBuffer | Blob | null)[] = [];
    private tempFolderPath = ".obsidian/plugins/image-assistant/temp";

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new ImageConverterSettingTab(this.app, this));

        // Initialize core components immediately
        this.supportedImageFormats = new SupportedImageFormats(this.app);

        // Ensure temp folder exists for cloud upload
        await this.ensureTempFolderExists();

        // Captions are time-sensitive
        if (this.settings.enableImageCaptions) {
            this.captionManager = new ImageCaptionManager(this);
            this.register(() => this.captionManager.cleanup());
        }


        // Initialize ImageAlignment early since it's time-sensitive
        if (this.settings.isImageAlignmentEnabled) {
            this.ImageAlignmentManager = new ImageAlignmentManager(
                this.app,
                this,
                this.supportedImageFormats,
            );
            await this.ImageAlignmentManager.initialize();

            // This helps when opening into note with alignments set and fires less often than e.g. active-leaf-change
            this.registerEvent(
                this.app.workspace.on('file-open', (file) => {
                    if (file) {
                        this.ImageAlignmentManager?.applyAlignmentsToNote(file.path);

                        if (this.settings.enableImageCaptions) {
                            this.captionManager.refresh();
                        }
                    }
                })
            );
        }

        // // REDUNDANT - Below already initializes on layout change and for applying alignemnt "file-open" is much better option as it fires much less often
        // // NOTE: For alignment to be set this must be outside `this.app.workspace.onLayoutReady(() => {`
        // // Initialize DRAG/SCROLL rESIZING and apply alignments- when opening into the note or swithing notes 
        // this.registerEvent(
        //     this.app.workspace.on('active-leaf-change', (leaf) => {
        //         console.count("active-leaf-change triggered")
        //         // const markdownView = leaf?.view instanceof MarkdownView ? leaf.view : null;
        //         // if (markdownView && this.imageResizer && this.settings.isImageResizeEnbaled) {
        //         //     this.imageResizer.onload(markdownView);
        //         // }
        //         // // Delay the execution slightly to ensure the new window's DOM is ready
        //         // setTimeout(() => {
        //         //     this.ImageAlignmentManager!.setupImageObserver();
        //         // }, 500);
        //         const currentFile = this.app.workspace.getActiveFile();
        //         if (currentFile) {
        //             // console.log("current file path:", currentFile.path)
        //             void this.ImageAlignmentManager!.applyAlignmentsToNote(currentFile.path);
        //         }
        //     })
        // );


        // Wait for layout to be ready before initializing view-dependent components
        this.app.workspace.onLayoutReady(() => {
            this.initializeComponents();

            // Apply Image Alignment and Resizing when switching Live to Reading mode etc.
            if (this.settings.isImageAlignmentEnabled || this.settings.isImageResizeEnbaled) {
                this.registerEvent(
                    this.app.workspace.on('layout-change', () => {
                        if (this.settings.isImageAlignmentEnabled) {
                            const currentFile = this.app.workspace.getActiveFile();
                            if (currentFile) {
                                void this.ImageAlignmentManager?.applyAlignmentsToNote(currentFile.path);
                            }
                        }

                        if (this.settings.isImageResizeEnbaled) {
                            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                            if (activeView) {
                                this.imageResizer?.onLayoutChange(activeView);
                            }
                        }

                        if (this.settings.enableImageCaptions) {
                            this.captionManager.refresh();
                        }
                        
                    })
                );
            }
            
            // // Prevent link from showing up
            // const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            // if (!activeView) return;

            // this.registerDomEvent(activeView.contentEl, 'click', (evt: MouseEvent) => {
            //     const target = evt.target as HTMLElement;
            //     if (target.tagName === 'IMG') {
            //         evt.preventDefault();
            //         evt.stopPropagation();
            //     }
            // }, true);

        });
    }

    async initializeComponents() {

        // Initialize base components first
        this.variableProcessor = new VariableProcessor(this.app, this.settings);
        this.linkFormatter = new LinkFormatter(this.app);
        this.imageProcessor = new ImageProcessor(this.supportedImageFormats);

        if (this.settings.isImageResizeEnbaled) {
            this.imageResizer = new ImageResizer(this);
            const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
            if (activeView) {
                this.imageResizer.onload(activeView);
            }
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

        // Initialize network image downloader
        this.networkDownloader = new NetworkImageDownloader(
            this.app,
            this,
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
        if (this.settings.enableContextMenu) {
            this.contextMenu = new ContextMenu(
                this.app,
                this,
                this.folderAndFilenameManagement,
                this.variableProcessor
            );
        }

        // REDUNDANT as it is already initialized inside ImageConverterSettings %%Initialize NonDestructiveResizeSettings if needed%%
        // if (!this.settings.nonDestructiveResizeSettings) {
        //     this.settings.nonDestructiveResizeSettings = new NonDestructiveResizeSettings();
        // }

        // Register PASTE/DROP events
        this.dropPasteRegisterEvents();

        // Register file menu events
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (file instanceof TFile && this.supportedImageFormats.isSupported(undefined, file.name)) {
                    menu.addItem((item) => {
                        item.setTitle("Process image")
                            .setIcon("cog")
                            .onClick(() => {
                                new ProcessSingleImageModal(this.app, this, file).open();
                            });
                    });
                    
                    // Add "Upload to cloud" option for images in cloud mode
                    if (this.settings.pasteHandlingMode === 'cloud') {
                        menu.addItem((item) => {
                            item.setTitle("Upload to cloud")
                                .setIcon("cloud-upload")
                                .onClick(async () => {
                                    await this.uploadSingleFile(file);
                                });
                        });
                    }
                } else if (file instanceof TFolder) {
                    menu.addItem((item) => {
                        item.setTitle("Process all images in Folder")
                            .setIcon("cog")
                            .onClick(() => {
                                new ProcessFolderModal(this.app, this, file.path, this.batchImageProcessor).open();
                            });
                    });
                } else if (file instanceof TFile && (file.extension === 'md' || file.extension === 'canvas')) {
                    menu.addItem((item) => {
                        item.setTitle(`Process all images in ${file.extension === 'md' ? 'Note' : 'Canvas'}`)
                            .setIcon("cog")
                            .onClick(() => {
                                new ProcessCurrentNote(this.app, this, file, this.batchImageProcessor).open();
                            });
                    });
                }
            })
        );

        // Register commands
        this.addCommand({
            id: 'process-all-vault-images',
            name: 'Convert: Process all images in vault',
            callback: () => {
                new ProcessAllVaultModal(this.app, this, this.batchImageProcessor).open();
            }
        });

        this.addCommand({
            id: 'process-all-images-current-note',
            name: 'Convert: Process all images in current note',
            callback: () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) {
                    new ProcessCurrentNote(this.app, this, activeFile, this.batchImageProcessor).open();
                } else {
                    new Notice('Error: No active file found.');
                }
            }
        });

        this.addCommand({
            id: 'open-image-converter-settings',
            name: 'Open Image Assistant Settings',
            callback: () => this.commandOpenSettingsTab()
        });

        // 批量上传当前笔记的所有本地图片到图床
        this.addCommand({
            id: 'upload-all-images',
            name: 'Cloud: Upload all images in current note',
            callback: async () => {
                // 只在图床模式下可用
                if (this.settings.pasteHandlingMode !== 'cloud') {
                    new Notice('This command is only available in cloud mode. Please switch to cloud mode in settings.');
                    return;
                }
                await this.uploadAllImages();
            }
        });

        // 批量下载当前笔记的所有网络图片到本地
        this.addCommand({
            id: 'download-all-images',
            name: 'Cloud: Download all network images in current note',
            callback: async () => {
                await this.downloadAllImages();
            }
        });

        // 清理无用文件
        this.addCommand({
            id: 'clean-unused-files',
            name: 'Clean: Scan and delete unused files',
            callback: () => {
                new UnusedFileCleanerModal(this.app, this).open();
            }
        });

        this.addReloadCommand();
    }


    async onunload() {
        // Clean up alignment related components first
        if (this.ImageAlignmentManager) {
            this.ImageAlignmentManager.onunload();
            this.ImageAlignmentManager = null;
        }

        // Clean up resizer next since other components might depend on it
        if (this.imageResizer) {
            this.imageResizer.onunload();
            this.imageResizer = null;
        }

        // Clean up UI components
        if (this.contextMenu) {
            this.contextMenu.onunload();
        }

        // Clean up modals
        [
            this.processSingleImageModal,
            this.processFolderModal,
            this.processCurrentNote,
            this.processAllVaultModal
        ].forEach(modal => {
            if (modal?.close) modal.close();
        });

        // Clean up any open modals
        [
            this.processSingleImageModal,
            this.processFolderModal,
            this.processCurrentNote,
            this.processAllVaultModal
        ].forEach(modal => {
            if (modal?.close) modal.close();
        });

        document.body.classList.remove('image-captions-enabled');
    }


    // Load settings method
    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    // Save settings method
    async saveSettings() {
        await this.saveData(this.settings);
    }

    // Command to open settings tab
    async commandOpenSettingsTab() {
        const { setting } = this.app as any;
        if (setting) {
            await setting.open();
            setting.openTabById(this.manifest.id);
        } else {
            new Notice('Unable to open settings. Please check if the settings plugin is enabled.');
        }
    }

    addReloadCommand() {
        this.addCommand({
            id: 'reload-plugin',
            name: 'Reload plugin',
            callback: async () => {
                new Notice('Reloading Image Converter plugin...');

                try {
                    // Use the workaround to access the internal plugins API
                    const { plugins } = this.app as any;

                    // 1. Disable the plugin
                    if (plugins && plugins.disablePlugin) {
                        await plugins.disablePlugin(this.manifest.id);
                    } else {
                        console.error("Plugins API is not accessible.");
                        new Notice('Failed to reload plugin: Plugins API unavailable.');
                        return;
                    }

                    // add some delay as disabling takes some time.
                    await new Promise(resolve => setTimeout(resolve, 500)); // even 100ms would be enough.

                    // 2. Re-enable the plugin
                    if (plugins && plugins.enablePlugin) {
                        await plugins.enablePlugin(this.manifest.id);
                    } else {
                        console.error("Plugins API is not accessible.");
                        new Notice('Failed to reload plugin: Plugins API unavailable.');
                        return;
                    }


                    new Notice('Image Converter plugin reloaded!');
                } catch (error) {
                    console.error("Error reloading plugin:", error);
                    new Notice('Failed to reload plugin. See console for details.');
                }
            },
        });
    }

    private dropPasteRegisterEvents() {
        // On mobile DROP events are not supported, but lets still check as a precaution
        if (Platform.isMobile) return;

        // Drop event (Obsidian editor - primary handlers)
        this.registerEvent(
            this.app.workspace.on("editor-drop", async (evt: DragEvent, editor: Editor) => {
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

                // Check if we should process these files
                const hasSupportedFiles = fileData.some(data =>
                    this.supportedImageFormats.isSupported(data.type, data.name) &&
                    !this.folderAndFilenameManagement.matchesPatterns(data.name, this.settings.neverProcessFilenames)
                );

                if (hasSupportedFiles) {
                    // Check paste handling mode
                    if (this.settings.pasteHandlingMode === 'disabled') {
                        // Disabled mode: do nothing, let Obsidian handle it
                        return;
                    }

                    evt.preventDefault(); // Prevent default behavior

                    if (this.settings.pasteHandlingMode === 'cloud') {
                        // Cloud mode: upload to image hosting
                        await this.handleDropCloud(fileData, editor, pos);
                    } else {
                        // Local mode: use original converter logic
                        await this.handleDrop(fileData, editor, evt, pos);
                    }
                }
            })
        );

        // --- Paste event handler ---
        this.registerEvent(
            this.app.workspace.on("editor-paste", async (evt: ClipboardEvent, editor: Editor) => {
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

                // Check if we should process these items
                const hasSupportedItems = itemData.some(data =>
                    data.kind === "file" &&
                    data.file &&
                    this.supportedImageFormats.isSupported(data.type, data.file.name) &&
                    !this.folderAndFilenameManagement.matchesPatterns(data.file.name, this.settings.neverProcessFilenames)
                );

                if (hasSupportedItems) {
                    // Check paste handling mode
                    if (this.settings.pasteHandlingMode === 'disabled') {
                        // Disabled mode: do nothing, let Obsidian handle it
                        return;
                    }

                    evt.preventDefault();

                    if (this.settings.pasteHandlingMode === 'cloud') {
                        // Cloud mode: upload to image hosting
                        await this.handlePasteCloud(itemData, editor, cursor, clipboardText);
                    } else {
                        // Local mode: use original converter logic
                        await this.handlePaste(itemData, editor, cursor);
                    }
                } else if (this.settings.pasteHandlingMode === 'cloud' && clipboardText) {
                    // Check if pasted text contains image URLs (for URL auto-upload)
                    await this.handlePasteTextCloud(clipboardText, editor, cursor, evt);
                }
            })
        );
    }

    private async handleDrop(fileData: { name: string; type: string; file: File }[], editor: Editor, evt: DragEvent, cursor: EditorPosition) {

        // Step 1: Filter Supported Files
        // - Filter the incoming `fileData` to keep only the files that are supported by the plugin (using `isSupported`).
        const supportedFiles = fileData
            .filter(data => {
                // console.log(`Dropped file: ${data.name}, file.type: ${data.type}`);
                return this.supportedImageFormats.isSupported(data.type, data.name)
            })
            .map(data => data.file);

        // Step 2: Check for Active File
        // - Return early if no supported files are found or if there's no active file in the Obsidian workspace.
        if (supportedFiles.length === 0) return;

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file detected.');
            return;
        }

        // Step 3: Map Files to Processing Promises
        // - Create an array of promises, each responsible for processing one file.
        // - This allows for sequential processing, avoiding concurrency issues.
        const filePromises = supportedFiles.map(async (file) => {
            try {
                // Check modal behavior setting
                const { modalBehavior } = this.settings;
                let showModal = modalBehavior === "always";

                if (modalBehavior === "ask") {
                    showModal = await new Promise<boolean>((resolve) => {
                        new ConfirmDialog(
                            this.app,
                            "Show Preset Selection Modal?",
                            "Do you want to select presets for this image?",
                            "Yes",
                            () => resolve(true)
                        ).open();
                    });
                }

                let selectedConversionPreset: ConversionPreset;
                let selectedFilenamePreset: FilenamePreset;
                let selectedFolderPreset: FolderPreset;
                let selectedLinkFormatPreset: LinkFormatPreset;
                let selectedResizePreset: NonDestructiveResizePreset;

                if (showModal) {
                    // Show the modal and wait for user selection
                    ({
                        selectedConversionPreset,
                        selectedFilenamePreset,
                        selectedFolderPreset,
                        selectedLinkFormatPreset,
                        selectedResizePreset
                    } = await new Promise<{
                        selectedConversionPreset: ConversionPreset;
                        selectedFilenamePreset: FilenamePreset;
                        selectedFolderPreset: FolderPreset;
                        selectedLinkFormatPreset: LinkFormatPreset;
                        selectedResizePreset: NonDestructiveResizePreset;
                    }>((resolve) => {
                        new PresetSelectionModal(
                            this.app,
                            this.settings,
                            (conversionPreset, filenamePreset, folderPreset, linkFormatPreset, resizePreset) => {
                                resolve({
                                    selectedConversionPreset: conversionPreset,
                                    selectedFilenamePreset: filenamePreset,
                                    selectedFolderPreset: folderPreset,
                                    selectedLinkFormatPreset: linkFormatPreset,
                                    selectedResizePreset: resizePreset,
                                });
                            },
                            this,
                            this.variableProcessor
                        ).open();
                    }));
                } else {
                    // Use default presets from settings using the generic getter
                    selectedConversionPreset = this.getPresetByName(
                        this.settings.selectedConversionPreset,
                        this.settings.conversionPresets,
                        'Conversion'
                    );

                    selectedFilenamePreset = this.getPresetByName(
                        this.settings.selectedFilenamePreset,
                        this.settings.filenamePresets,
                        'Filename'
                    );

                    selectedFolderPreset = this.getPresetByName(
                        this.settings.selectedFolderPreset,
                        this.settings.folderPresets,
                        'Folder'
                    );

                    selectedLinkFormatPreset = this.getPresetByName(
                        this.settings.linkFormatSettings.selectedLinkFormatPreset,
                        this.settings.linkFormatSettings.linkFormatPresets,
                        'Link Format'
                    );

                    selectedResizePreset = this.getPresetByName(
                        this.settings.nonDestructiveResizeSettings.selectedResizePreset,
                        this.settings.nonDestructiveResizeSettings.resizePresets,
                        'Resize'
                    );
                }

                // Step 3.2: Determine Destination and Filename
                // - Use the `determineDestination` function to calculate the destination path and new filename for the current file.
                let destinationPath: string;
                let newFilename: string;

                try {
                    ({ destinationPath, newFilename } = await this.folderAndFilenameManagement.determineDestination(
                        file,
                        activeFile,
                        selectedConversionPreset,
                        selectedFilenamePreset,
                        selectedFolderPreset
                    ));
                } catch (error) {
                    console.error("Error determining destination and filename:", error);
                    new Notice(`Failed to determine destination or filename for "${file.name}". Check console for details.`);
                    return; // Resolve this promise (no further processing for this file)
                }

                // Rest of the steps (3.3 to 3.7) remain the same,
                // using selectedConversionPreset and selectedFilenamePreset
                // ...
                // Step 3.3: Create Destination Folder
                // - Create the destination folder if it doesn't exist.
                try {
                    await this.folderAndFilenameManagement.ensureFolderExists(destinationPath);
                } catch (error) {
                    // Ignore "Folder already exists" error, but handle other errors.
                    if (!error.message.startsWith('Folder already exists')) {
                        console.error("Error creating folder:", error);
                        new Notice(`Failed to create folder "${destinationPath}". Check console for details.`);
                        return; // Resolve this promise
                    }
                }

                // Step 3.4: Handle Filename Conflicts
                // - Check if a file with the same name already exists at the destination.
                // - Apply conflict resolution rules based on the selected filename preset (e.g., increment, reuse, or skip).
                const fullPath = `${destinationPath}/${newFilename}`;
                let existingFile = this.app.vault.getAbstractFileByPath(fullPath);
                let skipFurtherProcessing = false;

                if (selectedFilenamePreset && this.folderAndFilenameManagement.shouldSkipRename(file.name, selectedFilenamePreset)) {
                    new Notice(
                        `Skipped renaming/conversion of image "${file.name}" due to skip pattern match.`
                    );
                    skipFurtherProcessing = true;
                } else if (selectedFilenamePreset && selectedFilenamePreset.conflictResolution === "increment") {
                    try {
                        newFilename = await this.folderAndFilenameManagement.handleNameConflicts(
                            destinationPath,
                            newFilename,
                            "increment"
                        );
                        existingFile = this.app.vault.getAbstractFileByPath(
                            `${destinationPath}/${newFilename}`
                        );
                    } catch (error) {
                        console.error("Error handling filename conflicts:", error);
                        new Notice(`Error incrementing filename for "${file.name}". Check console for details.`);
                        return; // Resolve this promise
                    }
                }

                const newFullPath = this.folderAndFilenameManagement.combinePath(destinationPath, newFilename);

                // Step 3.5: Process, Reuse, or Skip
                if (!skipFurtherProcessing) {

                    // Step 3.5.1: Reuse Existing File (if applicable)
                    // - If a file exists and the preset is set to "reuse," insert a link to the existing file and skip processing.
                    if (existingFile && selectedFilenamePreset && selectedFilenamePreset.conflictResolution === "reuse") {
                        this.insertLinkAtCursorPosition(editor, existingFile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);
                        return; // Resolve this promise
                    }


                    // Step 3.5.2: Check for Skipped Conversion BEFORE Processing
                    // - Check if the current file matches a skip pattern defined in the selected conversion preset.
                    // - If it matches, skip the image processing step entirely.
                    if (selectedConversionPreset && this.folderAndFilenameManagement.shouldSkipConversion(file.name, selectedConversionPreset)) {
                        new Notice(`Skipped conversion of image "${file.name}" due to skip pattern match in the conversion preset.`);


                        // Save the original file directly to the vault without any processing.
                        // const originalSize = file.size;
                        const fileBuffer = await file.arrayBuffer();
                        const tfile = await this.app.vault.createBinary(newFullPath, fileBuffer) as TFile;

                        if (!tfile) {
                            new Notice(`Failed to create file "${newFilename}". Check console for details.`);
                            return; // Resolve this promise
                        }

                        // Insert a link to the newly created (but unprocessed) file.
                        this.insertLinkAtCursorPosition(editor, tfile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);

                    } else {
                        // Step 3.5.3: Process the Image (ONLY if not skipped)
                        // - Call the `processImage` function to perform image conversion based on the selected preset or default settings.
                        try {
                            const originalSize = file.size;  // Store original size
                            this.processedImage = await this.imageProcessor.processImage(
                                file,
                                selectedConversionPreset
                                    ? selectedConversionPreset.outputFormat
                                    : this.settings.outputFormat,
                                selectedConversionPreset
                                    ? selectedConversionPreset.quality / 100
                                    : this.settings.quality / 100,
                                selectedConversionPreset
                                    ? selectedConversionPreset.colorDepth
                                    : this.settings.colorDepth,
                                selectedConversionPreset
                                    ? selectedConversionPreset.resizeMode
                                    : this.settings.resizeMode,
                                selectedConversionPreset
                                    ? selectedConversionPreset.desiredWidth
                                    : this.settings.desiredWidth,
                                selectedConversionPreset
                                    ? selectedConversionPreset.desiredHeight
                                    : this.settings.desiredHeight,
                                selectedConversionPreset
                                    ? selectedConversionPreset.desiredLongestEdge
                                    : this.settings.desiredLongestEdge,
                                selectedConversionPreset
                                    ? selectedConversionPreset.enlargeOrReduce
                                    : this.settings.enlargeOrReduce,
                                selectedConversionPreset
                                    ? selectedConversionPreset.allowLargerFiles
                                    : this.settings.allowLargerFiles,
                                selectedConversionPreset, // Pass preset to ImageProcessor
                                this.settings
                            );


                            let tfile: TFile;

                            // Step 3.5.4: Create the Image File in Vault
                            // - Create the new image file in the Obsidian vault using `createBinary`.
                            // Show space savings notification
                            // Check if processed image is larger than original
                            if (this.settings.revertToOriginalIfLarger && this.processedImage.byteLength > originalSize) {
                                // User wants to revert AND processed image is larger
                                this.showSizeComparisonNotification(originalSize, this.processedImage.byteLength);
                                new Notice(`Using original image for "${file.name}" as processed image is larger.`);

                                const fileBuffer = await file.arrayBuffer();
                                tfile = await this.app.vault.createBinary(newFullPath, fileBuffer) as TFile;
                            } else {
                                // Processed image is smaller OR user doesn't want to revert
                                this.showSizeComparisonNotification(originalSize, this.processedImage.byteLength);
                                tfile = await this.app.vault.createBinary(newFullPath, this.processedImage) as TFile;
                            }

                            // Step 3.5.5: Insert Link into Editor
                            // - Insert the Markdown link to the newly created image file into the editor at the current cursor position.
                            await this.insertLinkAtCursorPosition(editor, tfile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);
                        } catch (error) {
                            // Step 3.5.6: Handle Image Processing Errors
                            // - Catch and display errors that occur during image processing.
                            console.error("Image processing failed:", error);
                            if (error instanceof Error) {
                                if (error.message.includes("File already exists")) {
                                    new Notice(`Failed to process image: File "${newFilename}" already exists.`);
                                } else if (error.message.includes("Invalid input file type")) {
                                    new Notice(`Failed to process image: Invalid input file type for "${file.name}".`);
                                } else {
                                    new Notice(`Failed to process image "${file.name}": ${error.message}. Check console for details.`);
                                }
                            } else {
                                new Notice(`Failed to process image "${file.name}". Check console for details.`);
                            }
                            return; // Resolve this promise
                        } finally {
                            // Clear memory after processing
                            this.clearMemory();
                        }
                    }
                } else {
                    // Step 3.6: Handle Skipped Processing
                    // - If further processing is skipped due to filename conflict resolution, insert a link to an existing file (if applicable).
                    if (existingFile) {
                        this.insertLinkAtCursorPosition(editor, existingFile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);
                    }
                }
            } catch (error) {
                // Step 3.7: Handle Unexpected Errors
                // - Catch and display any other unexpected errors that might occur.
                console.error("An unexpected error occurred:", error);
                new Notice('An unexpected error occurred. Check console for details.');
            }
        });

        // Step 4: Wait for All Promises to Complete
        // - Use `Promise.all` to wait for all the file processing promises to settle (either fulfilled or rejected).
        await Promise.all(filePromises);
        
        if (this.settings.enableImageCaptions) {
            this.captionManager.refresh();
        }
    }

    private async handlePaste(itemData: { kind: string; type: string; file: File | null }[], editor: Editor, cursor: EditorPosition) {
        // Step 1: Filter Supported Image Files
        // - Filter the pasted `itemData` to keep only supported image files.
        const supportedFiles = itemData
            .filter(data => data.kind === "file" && data.file &&
                this.supportedImageFormats.isSupported(data.type, data.file.name))
            .map(data => data.file!)
            .filter((file): file is File => file !== null);

        // Step 2: Check for Active File
        // - Return early if no supported files are found or if there's no active file.
        if (supportedFiles.length === 0) return;

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file found!');
            return;
        }

        // Step 3: Map Files to Processing Promises
        // - Create an array of promises, each responsible for processing one pasted file.
        const filePromises = supportedFiles.map(async (file) => {
            // Check modal behavior setting
            const { modalBehavior } = this.settings;
            let showModal = modalBehavior === "always";

            if (modalBehavior === "ask") {
                showModal = await new Promise<boolean>((resolve) => {
                    new ConfirmDialog(
                        this.app,
                        "Show Preset Selection Modal?",
                        "Do you want to select presets for this image?",
                        "Yes",
                        () => resolve(true)
                    ).open();
                });
            }

            let selectedConversionPreset: ConversionPreset;
            let selectedFilenamePreset: FilenamePreset;
            let selectedFolderPreset: FolderPreset;
            let selectedLinkFormatPreset: LinkFormatPreset;
            let selectedResizePreset: NonDestructiveResizePreset;

            if (showModal) {
                // Show the modal and wait for user selection
                ({
                    selectedConversionPreset,
                    selectedFilenamePreset,
                    selectedFolderPreset,
                    selectedLinkFormatPreset,
                    selectedResizePreset
                } = await new Promise<{
                    selectedConversionPreset: ConversionPreset;
                    selectedFilenamePreset: FilenamePreset;
                    selectedFolderPreset: FolderPreset;
                    selectedLinkFormatPreset: LinkFormatPreset;
                    selectedResizePreset: NonDestructiveResizePreset;
                }>((resolve) => {
                    new PresetSelectionModal(
                        this.app,
                        this.settings,
                        (conversionPreset, filenamePreset, folderPreset, linkFormatPreset, resizePreset) => {
                            resolve({
                                selectedConversionPreset: conversionPreset,
                                selectedFilenamePreset: filenamePreset,
                                selectedFolderPreset: folderPreset,
                                selectedLinkFormatPreset: linkFormatPreset,
                                selectedResizePreset: resizePreset,
                            });
                        },
                        this,
                        this.variableProcessor
                    ).open();
                }));
            } else {
                // Use default presets from settings using the generic getter
                selectedConversionPreset = this.getPresetByName(
                    this.settings.selectedConversionPreset,
                    this.settings.conversionPresets,
                    'Conversion'
                );

                selectedFilenamePreset = this.getPresetByName(
                    this.settings.selectedFilenamePreset,
                    this.settings.filenamePresets,
                    'Filename'
                );

                selectedFolderPreset = this.getPresetByName(
                    this.settings.selectedFolderPreset,
                    this.settings.folderPresets,
                    'Folder'
                );

                selectedLinkFormatPreset = this.getPresetByName(
                    this.settings.linkFormatSettings.selectedLinkFormatPreset,
                    this.settings.linkFormatSettings.linkFormatPresets,
                    'Link Format'
                );

                selectedResizePreset = this.getPresetByName(
                    this.settings.nonDestructiveResizeSettings.selectedResizePreset,
                    this.settings.nonDestructiveResizeSettings.resizePresets,
                    'Resize'
                );
            }
            // Step 3.2: Determine Destination and Filename
            // - Calculate the destination path and new filename for the current file.
            try {
                let destinationPath: string;
                let newFilename: string;

                try {
                    ({ destinationPath, newFilename } = await this.folderAndFilenameManagement.determineDestination(
                        file,
                        activeFile,
                        selectedConversionPreset,
                        selectedFilenamePreset,
                        selectedFolderPreset
                    ));
                } catch (error) {
                    console.error("Error determining destination and filename:", error);
                    new Notice(`Failed to determine destination or filename for "${file.name}". Check console for details.`);
                    return; // Resolve this promise
                }

                // Step 3.3: Create Destination Folder
                // - Create the destination folder if it doesn't exist.
                try {
                    await this.folderAndFilenameManagement.ensureFolderExists(destinationPath);
                } catch (error) {
                    if (!error.message.startsWith('Folder already exists')) {
                        console.error("Error creating folder:", error);
                        new Notice(`Failed to create folder: ${destinationPath}`);
                        return; // Resolve this promise
                    }
                }

                // Step 3.4: Handle Filename Conflicts
                // - Check for filename conflicts and apply conflict resolution rules.
                const fullPath = `${destinationPath}/${newFilename}`;
                let existingFile = this.app.vault.getAbstractFileByPath(fullPath);
                let skipFurtherProcessing = false;

                if (
                    selectedFilenamePreset &&
                    this.folderAndFilenameManagement.shouldSkipRename(
                        file.name,
                        selectedFilenamePreset
                    )
                ) {
                    new Notice(
                        `Skipped renaming/conversion of image "${file.name}" due to skip pattern match.`
                    );
                    skipFurtherProcessing = true;
                } else if (
                    selectedFilenamePreset &&
                    selectedFilenamePreset.conflictResolution === "increment"
                ) {
                    try {
                        newFilename = await this.folderAndFilenameManagement.handleNameConflicts(
                            destinationPath,
                            newFilename,
                            "increment"
                        );
                        existingFile = this.app.vault.getAbstractFileByPath(
                            `${destinationPath}/${newFilename}`
                        );
                    } catch (error) {
                        console.error("Error handling filename conflicts:", error);
                        new Notice(`Error incrementing filename for "${file.name}". Check console for details.`);
                        return; // Resolve this promise
                    }
                }

                const newFullPath = this.folderAndFilenameManagement.combinePath(destinationPath, newFilename);

                // Step 3.5: Process, Reuse, or Skip
                if (!skipFurtherProcessing) {
                    // Step 3.5.1: Reuse Existing File (if applicable)
                    // - If the file exists and the preset is set to "reuse," insert a link to the existing file.
                    if (existingFile && selectedFilenamePreset && selectedFilenamePreset.conflictResolution === "reuse") {
                        this.insertLinkAtCursorPosition(editor, existingFile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);
                        return;
                    }

                    // Step 3.5.2: Check for Skipped Conversion BEFORE Processing
                    // - Check if the current file matches a skip pattern in the conversion preset.
                    // - If it matches, skip image processing entirely.
                    if (selectedConversionPreset && this.folderAndFilenameManagement.shouldSkipConversion(file.name, selectedConversionPreset)) {
                        new Notice(`Skipped conversion of image "${file.name}" due to skip pattern match in the conversion preset.`);

                        // Save the original file directly to the vault without any processing.
                        // const originalSize = file.size;
                        const fileBuffer = await file.arrayBuffer();
                        const tfile = await this.app.vault.createBinary(newFullPath, fileBuffer) as TFile;

                        if (!tfile) {
                            new Notice(`Failed to create file: ${newFilename}`);
                            return; // Resolve this promise
                        }

                        // Insert a link to the newly created (unprocessed) file.
                        this.insertLinkAtCursorPosition(editor, tfile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);
                    } else {
                        // Step 3.5.3: Process the Image (ONLY if not skipped)
                        // - Process the image using the selected or default settings.
                        try {
                            const originalSize = file.size;
                            this.processedImage = await this.imageProcessor.processImage(
                                file,
                                selectedConversionPreset
                                    ? selectedConversionPreset.outputFormat
                                    : this.settings.outputFormat,
                                selectedConversionPreset
                                    ? selectedConversionPreset.quality / 100
                                    : this.settings.quality / 100,
                                selectedConversionPreset
                                    ? selectedConversionPreset.colorDepth
                                    : this.settings.colorDepth,
                                selectedConversionPreset
                                    ? selectedConversionPreset.resizeMode
                                    : this.settings.resizeMode,
                                selectedConversionPreset
                                    ? selectedConversionPreset.desiredWidth
                                    : this.settings.desiredWidth,
                                selectedConversionPreset
                                    ? selectedConversionPreset.desiredHeight
                                    : this.settings.desiredHeight,
                                selectedConversionPreset
                                    ? selectedConversionPreset.desiredLongestEdge
                                    : this.settings.desiredLongestEdge,
                                selectedConversionPreset
                                    ? selectedConversionPreset.enlargeOrReduce
                                    : this.settings.enlargeOrReduce,
                                selectedConversionPreset
                                    ? selectedConversionPreset.allowLargerFiles
                                    : this.settings.allowLargerFiles,
                                selectedConversionPreset, // Pass preset to ImageProcessor
                                this.settings
                            );

                            let tfile: TFile;
                            // Step 3.5.4: Create the Image File in Vault
                            // - Create the new image file in the Obsidian vault using `createBinary`.
                            // - Show space savings notification
                            // Check if processed image is larger than original
                            if (this.settings.revertToOriginalIfLarger && this.processedImage.byteLength > originalSize) {
                                // User wants to revert AND processed image is larger
                                this.showSizeComparisonNotification(originalSize, this.processedImage.byteLength);
                                new Notice(`Using original image for "${file.name}" as processed image is larger.`);

                                const fileBuffer = await file.arrayBuffer();
                                tfile = await this.app.vault.createBinary(newFullPath, fileBuffer) as TFile;
                            } else {
                                // Processed image is smaller OR user doesn't want to revert
                                this.showSizeComparisonNotification(originalSize, this.processedImage.byteLength);
                                tfile = await this.app.vault.createBinary(newFullPath, this.processedImage) as TFile;
                            }


                            if (!tfile) {
                                new Notice(`Failed to create file "${newFilename}". Check console for details.`);
                                return; // Resolve this promise
                            }

                            // Step 3.5.5: Insert Link into Editor
                            // - Insert the link to the new image into the editor.
                            this.insertLinkAtCursorPosition(editor, tfile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);
                        } catch (error) {
                            // Step 3.5.6: Handle Image Processing Errors
                            // - Handle errors during image processing.
                            console.error("Image processing failed:", error);
                            if (error instanceof Error) {
                                if (error.message.includes("File already exists")) {
                                    new Notice(`Failed to process image: File "${newFilename}" already exists.`);
                                } else if (error.message.includes("Invalid input file type")) {
                                    new Notice(`Failed to process image: Invalid input file type for "${file.name}".`);
                                } else {
                                    new Notice(`Failed to process image "${file.name}": ${error.message}. Check console for details.`);
                                }
                            } else {
                                new Notice(`Failed to process image "${file.name}". Check console for details.`);
                            }
                            return; // Resolve this promise
                        }
                    }
                } else {
                    // Step 3.6: Handle Skipped Processing
                    // - If skipping, insert a link to an existing file or do nothing.
                    if (existingFile) {
                        this.insertLinkAtCursorPosition(editor, existingFile.path, cursor, selectedLinkFormatPreset, selectedResizePreset);
                    }
                }
            } catch (error) {
                // Step 3.7: Handle Unexpected Errors
                console.error("An unexpected error occurred:", error);
                new Notice('An unexpected error occurred. Check console for details.');
            } finally {
                // Clear memory after processing
                this.clearMemory();
            }
        });

        // Step 4: Wait for All Promises to Complete
        // - Wait for all file processing promises to settle.
        await Promise.all(filePromises);

        if (this.settings.enableImageCaptions) {
            this.captionManager.refresh();
        }
    }

    // Helper function to insert link at the specified cursor position
    private async insertLinkAtCursorPosition(
        editor: Editor,
        linkPath: string,
        cursor: EditorPosition,
        selectedLinkFormatPreset?: LinkFormatPreset,
        selectedResizePreset?: NonDestructiveResizePreset
    ) {

        const activeFile = this.app.workspace.getActiveFile();

        // Use the passed presets or fall back to the plugin settings
        const linkFormatPresetToUse = selectedLinkFormatPreset || this.settings.linkFormatSettings.linkFormatPresets.find(
            (preset) => preset.name === this.settings.linkFormatSettings.selectedLinkFormatPreset
        );

        const resizePresetToUse = selectedResizePreset || this.settings.nonDestructiveResizeSettings.resizePresets.find(
            (preset) => preset.name === this.settings.nonDestructiveResizeSettings.selectedResizePreset
        );

        // Await the result of formatLink
        const formattedLink = await this.linkFormatter.formatLink(
            linkPath, // Pass the original linkPath
            linkFormatPresetToUse?.linkFormat || "wikilink",
            linkFormatPresetToUse?.pathFormat || "shortest",
            activeFile,
            resizePresetToUse // Now using the selected resize preset
        );


        // ----- FRONT or BACK ---------
        // Insert the link at the saved cursor position
        // - FRONT:Keeps the cursor at the front by default (by doing nothing) when cursorLocation is "front"
        editor.replaceRange(formattedLink, cursor);

        // Use positive check for "back"
        // - We have to be carefull not to place it to the back 2 times.
        if (this.settings.dropPasteCursorLocation === "back") {
            editor.setCursor({
                line: cursor.line,
                ch: cursor.ch + formattedLink.length,
            });
        }
        
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
        if (!this.settings.showSpaceSavedNotification) return;

        const originalSizeFormatted = this.formatFileSize(originalSize);
        const newSizeFormatted = this.formatFileSize(newSize);

        const percentChange = ((newSize - originalSize) / originalSize * 100).toFixed(1);
        const changeSymbol = newSize > originalSize ? '+' : '';

        const message = `${originalSizeFormatted} → ${newSizeFormatted} (${changeSymbol}${percentChange}%)`;
        new Notice(message);
    }

    getPresetByName<T extends { name: string }>(
        presetName: string,
        presetArray: T[],
        presetType: string
    ): T {
        const preset = presetArray.find(candidate => candidate.name === presetName);
        if (!preset) {
            console.warn(`${presetType} preset "${presetName}" not found, using default`);
            return presetArray[0];
        }
        return preset;
    }

    private clearMemory() {
        // Clear the processed image buffer
        if (this.processedImage) {
            this.processedImage = null;
        }

        // Following might be pointless, but lets do it still  - clear any ArrayBuffers or Blobs in memory
        if (this.temporaryBuffers) {
            for (let i = 0; i < this.temporaryBuffers.length; i++) {
                this.temporaryBuffers[i] = null;
            }
            this.temporaryBuffers = [];
        }
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

    /**
     * Handle drop event in cloud mode
     * Upload images to image hosting service and insert links
     */
    private async handleDropCloud(
        fileData: { name: string; type: string; file: File }[],
        editor: Editor,
        cursor: EditorPosition
    ) {
        console.log('[Cloud Upload] handleDropCloud called with', fileData.length, 'files');
        
        // Filter supported files
        const supportedFiles = fileData
            .filter(data => this.supportedImageFormats.isSupported(data.type, data.name))
            .map(data => data.file);

        console.log('[Cloud Upload] Found', supportedFiles.length, 'supported files');
        if (supportedFiles.length === 0) return;

        const activeFile = this.app.workspace.getActiveFile();
        console.log('[Cloud Upload] Active file:', activeFile?.path);
        if (!activeFile) {
            new Notice('No active file detected.');
            return;
        }

        // Process each file
        for (const file of supportedFiles) {
            console.log('[Cloud Upload] Processing file:', file.name, 'size:', file.size, 'type:', file.type);
            try {
                // Insert uploading placeholder
                const timestamp = Date.now();
                const placeholder = `![Uploading file...${timestamp}]()`;
                editor.replaceRange(placeholder, cursor);
                console.log('[Cloud Upload] Inserted placeholder:', placeholder);

                // Create uploader manager
                const uploaderManager = new UploaderManager(
                    this.settings.cloudUploadSettings.uploader,
                    this
                );
                console.log('[Cloud Upload] Created uploader manager for:', this.settings.cloudUploadSettings.uploader);

                // Convert File to FileList for upload
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                const fileList = dataTransfer.files;
                console.log('[Cloud Upload] Prepared FileList with', fileList.length, 'file(s)');

                // Upload directly from drop without saving to vault
                console.log('[Cloud Upload] Starting clipboard upload for:', file.name);
                const uploadResult = await uploaderManager.uploadByClipboard(fileList);
                console.log('[Cloud Upload] Upload result:', uploadResult);

                // Generate cloud link with size parameters
                const cloudUrl = uploadResult.result[0];
                console.log('[Cloud Upload] Cloud URL:', cloudUrl);
                
                const cloudLink = CloudLinkFormatter.formatCloudLink(
                    cloudUrl,
                    this.settings.cloudUploadSettings
                );
                console.log('[Cloud Upload] Formatted cloud link:', cloudLink);

                // Replace placeholder with actual link
                const content = editor.getValue();
                const newContent = content.replace(placeholder, cloudLink);
                editor.setValue(newContent);

                new Notice('Image uploaded successfully!');
                console.log('[Cloud Upload] Upload completed successfully');
            } catch (error) {
                console.error('[Cloud Upload] Upload failed:', error);
                console.error('[Cloud Upload] Error stack:', error.stack);
                new Notice(`Upload failed: ${error.message}`);
                // Leave placeholder in place for user to see the error
            }
        }

        // Refresh captions if enabled
        if (this.settings.enableImageCaptions) {
            this.captionManager.refresh();
        }
    }

    /**
     * Upload all local images in the current note to cloud storage
     * 批量上传当前笔记中的所有本地图片到图床
     */
    private async uploadAllImages() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file found.');
            return;
        }

        // 创建 Helper 获取图片链接
        const helper = new UploadHelper(this.app);
        const allImageLinks = helper.getAllImageLinks();

        if (allImageLinks.length === 0) {
            new Notice('No images found in current note.');
            return;
        }

        console.log('[Batch Upload] Found', allImageLinks.length, 'image links');

        // 过滤图片链接（本地图片 + 符合条件的网络图片）
        const filteredImageLinks = allImageLinks.filter(img => {
            const isNetworkImage = img.path.startsWith('http://') || img.path.startsWith('https://');
            
            if (isNetworkImage) {
                // 检查是否启用网络图片上传
                if (!this.settings.cloudUploadSettings.workOnNetWork) {
                    console.log('[Batch Upload] Skipping network image (workOnNetWork disabled):', img.path);
                    return false;
                }
                // 检查黑名单域名
                if (this.isBlacklistedDomain(img.path)) {
                    console.log('[Batch Upload] Skipping blacklisted network image:', img.path);
                    return false;
                }
                return true; // 允许上传网络图片
            }
            
            return true; // 本地图片总是包含
        });
        
        if (filteredImageLinks.length === 0) {
            new Notice('No images to upload. All images are filtered or already uploaded.');
            return;
        }

        console.log('[Batch Upload] Found', filteredImageLinks.length, 'image(s) to upload');
        new Notice(`Found ${filteredImageLinks.length} image(s) to upload...`);

        // 构建文件路径映射（用于快速查找本地文件）
        const filePathMap: Record<string, TFile> = {};
        const fileNameMap: Record<string, TFile> = {};
        
        this.app.vault.getFiles().forEach(file => {
            filePathMap[file.path] = file;
            fileNameMap[file.name] = file;
        });

        // 解析并构建上传任务（按路径去重）
        interface UploadTask {
            imageLinks: ImageLink[]; // 该路径对应的所有图片链接
            file: TFile | null; // 本地文件，网络图片为 null
            path: string; // 唯一路径标识
            isNetworkImage: boolean;
        }

        const pathToTaskMap = new Map<string, UploadTask>();

        for (const imageLink of filteredImageLinks) {
            const uri = decodeURI(imageLink.path);
            const isNetworkImage = uri.startsWith('http://') || uri.startsWith('https://');
            
            let uniquePath: string;
            let file: TFile | null = null;
            
            if (isNetworkImage) {
                // 网络图片使用 URL 作为唯一标识
                uniquePath = uri;
            } else {
                // 本地图片：解析文件路径
                // 1. 优先匹配绝对路径
                if (filePathMap[uri]) {
                    file = filePathMap[uri];
                }

                // 2. 处理相对路径
                if (!file && (uri.startsWith('./') || uri.startsWith('../'))) {
                    const filePath = normalizePath(
                        resolve(dirname(activeFile.path), uri)
                    );
                    file = filePathMap[filePath];
                }

                // 3. 尽可能短路径（只匹配文件名）
                if (!file) {
                    const fileName = basename(uri);
                    file = fileNameMap[fileName];
                }

                // 4. 检查是否是图片文件
                if (!file || !this.isImageFile(file.path)) {
                    console.warn('[Batch Upload] Could not find file for image:', imageLink.path);
                    continue;
                }
                
                uniquePath = normalizePath(file.path);
            }
            
            // 按路径去重：相同路径的图片链接添加到同一个任务
            if (pathToTaskMap.has(uniquePath)) {
                pathToTaskMap.get(uniquePath)!.imageLinks.push(imageLink);
            } else {
                pathToTaskMap.set(uniquePath, {
                    imageLinks: [imageLink],
                    file: file,
                    path: uniquePath,
                    isNetworkImage: isNetworkImage
                });
            }
        }

        const uploadTasks = Array.from(pathToTaskMap.values());
        
        if (uploadTasks.length === 0) {
            new Notice('No valid images found to upload.');
            return;
        }

        const totalLinks = uploadTasks.reduce((sum, task) => sum + task.imageLinks.length, 0);
        console.log('[Batch Upload] Prepared', uploadTasks.length, 'unique upload tasks for', totalLinks, 'image links');
        new Notice(`Uploading ${uploadTasks.length} unique image(s)...`);

        // 验证本地文件存在性
        const validationErrors: string[] = [];
        for (const task of uploadTasks) {
            if (!task.isNetworkImage && task.file) {
                const exists = await this.validateFileExists(task.file);
                if (!exists) {
                    validationErrors.push(task.file.name);
                }
            }
        }
        
        if (validationErrors.length > 0) {
            new Notice(`⚠️ 发现 ${validationErrors.length} 个文件不存在，已跳过: ${validationErrors.join(', ')}`);
            console.warn('[Batch Upload] Files not found:', validationErrors);
            // 过滤掉不存在的文件
            const filteredTasks = uploadTasks.filter(task => 
                task.isNetworkImage || !validationErrors.includes(task.file!.name)
            );
            if (filteredTasks.length === 0) {
                new Notice('没有可上传的图片');
                return;
            }
            // 更新 uploadTasks
            uploadTasks.length = 0;
            uploadTasks.push(...filteredTasks);
        }

        // 批量上传
        try {
            const uploaderManager = new UploaderManager(
                this.settings.cloudUploadSettings.uploader,
                this
            );

            // 准备上传路径列表
            const pathsToUpload = uploadTasks.map(task => {
                // 网络图片直接使用 URL
                if (task.isNetworkImage) {
                    console.log('[Batch Upload] Network image:', task.path);
                    return task.path;
                }
                // 本地图片：使用统一的路径构建方法
                return this.buildUploadPath(task.file!);
            });
            console.log('[Batch Upload] Uploading files:', pathsToUpload);
            console.log('[Batch Upload] Remote mode:', this.settings.cloudUploadSettings.remoteServerMode);

            // 上传所有图片
            const uploadResult = await uploaderManager.upload(pathsToUpload);
            console.log('[Batch Upload] Upload result:', uploadResult);

            if (!uploadResult.success) {
                new Notice(`Batch upload failed: ${uploadResult.msg || 'Unknown error'}`);
                console.error('[Batch Upload] Upload failed:', uploadResult.msg);
                return;
            }

            const uploadedUrls = uploadResult.result;

            // 检查上传结果数量
            if (uploadedUrls.length !== uploadTasks.length) {
                new Notice('Warning: Uploaded file count does not match expected count.');
                console.warn('[Batch Upload] Expected', uploadTasks.length, 'but got', uploadedUrls.length);
            }

            // ====================
            // Stage 2: 多引用验证
            // ====================
            new Notice('正在扫描引用...');
            
            // 为每个本地图片检查 Vault 级别的引用
            const multiReferenceImages: BatchUploadTaskInfo[] = [];
            const taskWithVaultMatches: Array<{
                task: typeof uploadTasks[0];
                cloudUrl: string;
                vaultMatches: ImageMatchResult;
            }> = [];

            for (let i = 0; i < Math.min(uploadTasks.length, uploadedUrls.length); i++) {
                const task = uploadTasks[i];
                const cloudUrl = uploadedUrls[i];

                // 只为本地图片检查引用
                if (!task.isNetworkImage && task.file) {
                    const vaultMatches = await this.findVaultImageMatches(task.file);
                    const totalReferences = vaultMatches.totalCount;
                    const currentNoteReferences = vaultMatches.files.find(
                        f => f.path === activeFile.path
                    )?.matches.length || 0;
                    const otherNotesReferences = totalReferences - currentNoteReferences;

                    // 保存任务和匹配信息
                    taskWithVaultMatches.push({
                        task,
                        cloudUrl,
                        vaultMatches
                    });

                    // 如果有其他笔记的引用,记录到多引用列表
                    if (otherNotesReferences > 0) {
                        multiReferenceImages.push({
                            imageName: task.file.name,
                            vaultReferences: totalReferences,
                            currentNoteReferences: currentNoteReferences,
                            otherNotesReferences: otherNotesReferences,
                            hasMultipleReferences: true
                        });
                    }
                }
            }

            // 显示确认对话框
            const userChoice = await new Promise<'replace-current' | 'replace-all' | 'replace-all-delete' | 'cancel'>((resolve) => {
                new BatchUploadConfirmDialog(
                    this.app,
                    uploadTasks.length,
                    multiReferenceImages,
                    activeFile.path,
                    resolve
                ).open();
            });

            if (userChoice === 'cancel') {
                new Notice('已取消替换操作,图片已上传');
                return;
            }

            // ====================
            // Stage 3: 根据用户选择执行替换操作
            // ====================
            let replacedLinkCount = 0;

            if (userChoice === 'replace-current') {
                // 仅替换当前笔记
                let content = helper.getValue();
                
                for (let i = 0; i < Math.min(uploadTasks.length, uploadedUrls.length); i++) {
                    const task = uploadTasks[i];
                    const cloudUrl = uploadedUrls[i];

                    // 生成云图链接
                    const cloudLink = CloudLinkFormatter.formatCloudLink(
                        cloudUrl,
                        this.settings.cloudUploadSettings
                    );

                    // 替换该路径对应的所有图片链接
                    for (const imageLink of task.imageLinks) {
                        content = content.replaceAll(imageLink.source, cloudLink);
                        replacedLinkCount++;
                        console.log('[Batch Upload] Replaced in current note:', imageLink.source, '->', cloudLink);
                    }
                }

                // 更新编辑器内容
                helper.setValue(content);
                new Notice(`已替换当前笔记中的 ${replacedLinkCount} 个链接`);

            } else if (userChoice === 'replace-all' || userChoice === 'replace-all-delete') {
                // 替换所有引用
                for (let i = 0; i < Math.min(uploadTasks.length, uploadedUrls.length); i++) {
                    const task = uploadTasks[i];
                    const cloudUrl = uploadedUrls[i];

                    // 生成云图链接
                    const cloudLink = CloudLinkFormatter.formatCloudLink(
                        cloudUrl,
                        this.settings.cloudUploadSettings
                    );

                    // 检查是否有 Vault 匹配信息
                    const matchInfo = taskWithVaultMatches.find(m => m.task === task);
                    if (matchInfo) {
                        // 本地图片:替换所有 Vault 引用
                        await this.replaceAllReferences(matchInfo.vaultMatches, cloudLink);
                        replacedLinkCount += matchInfo.vaultMatches.totalCount;
                        console.log('[Batch Upload] Replaced all vault references for:', task.path);
                    } else {
                        // 网络图片:仅替换当前笔记
                        let content = helper.getValue();
                        for (const imageLink of task.imageLinks) {
                            content = content.replaceAll(imageLink.source, cloudLink);
                            replacedLinkCount++;
                            console.log('[Batch Upload] Replaced network image in current note:', imageLink.source, '->', cloudLink);
                        }
                        helper.setValue(content);
                    }
                }

                new Notice(`已替换 ${replacedLinkCount} 个图片链接`);

                // 删除本地源文件(仅当用户选择"替换所有并删除本地")
                if (userChoice === 'replace-all-delete' && uploadTasks.length > 0) {
                    let deletedCount = 0;
                    for (const task of uploadTasks) {
                        // 只删除本地图片文件,跳过网络图片
                        if (!task.isNetworkImage && task.file) {
                            try {
                                await this.app.fileManager.trashFile(task.file);
                                deletedCount++;
                                console.log('[Batch Upload] Deleted source file:', task.file.path);
                            } catch (error) {
                                console.error('[Batch Upload] Failed to delete source file:', task.file.path, error);
                            }
                        }
                    }
                    if (deletedCount > 0) {
                        new Notice(`已删除 ${deletedCount} 个本地源文件`);
                    }
                }
            }

            // 刷新图片题注（如果启用）
            if (this.settings.enableImageCaptions) {
                this.captionManager.refresh();
            }

        } catch (error) {
            console.error('[Batch Upload] Upload failed:', error);
            new Notice(`Batch upload failed: ${error.message}`);
        }
    }

    /**
     * Check if a file path is an image file
     */
    private isImageFile(path: string): boolean {
        const ext = extname(path).toLowerCase();
        const imageExts = ['.png', '.jpg', '.jpeg', '.bmp', '.gif', '.svg', '.tiff', '.webp', '.avif'];
        return imageExts.includes(ext);
    }

    /**
     * Download all network images in the current note to local
     * 下载当前笔记中的所有网络图片到本地
     */
    private async downloadAllImages(): Promise<void> {
        try {
            await this.networkDownloader.downloadAllNetworkImages();
        } catch (error) {
            console.error('[Download] Download all images failed:', error);
            new Notice(`下载失败: ${error.message}`);
        }
    }

    /**
     * Check if a network image URL is from a blacklisted domain
     * 检查网络图片 URL 是否来自黑名单域名
     */
    private isBlacklistedDomain(url: string): boolean {
        try {
            const blacklist = this.settings.cloudUploadSettings.newWorkBlackDomains;
            if (!blacklist || blacklist.trim() === '') {
                return false;
            }

            const domains = blacklist.split(',').map(d => d.trim().toLowerCase()).filter(d => d.length > 0);
            if (domains.length === 0) {
                return false;
            }

            const urlObj = new URL(url);
            const hostname = urlObj.hostname.toLowerCase();

            // Check if hostname matches or ends with any blacklisted domain
            return domains.some(domain => {
                return hostname === domain || hostname.endsWith('.' + domain);
            });
        } catch (error) {
            console.error('[Blacklist Check] Invalid URL:', url, error);
            return false;
        }
    }

    /**
     * Handle paste event in cloud mode
     * Upload images to image hosting service and insert links
     */
    private async handlePasteCloud(
        itemData: { kind: string; type: string; file: File | null }[],
        editor: Editor,
        cursor: EditorPosition,
        clipboardText?: string
    ) {
        console.log('[Cloud Upload] handlePasteCloud called with', itemData.length, 'items');
        
        // Check applyImage setting: if clipboard has both text and image
        const hasText = clipboardText && clipboardText.trim().length > 0;
        const hasImageFile = itemData.some(data => data.kind === "file" && data.file);
        
        if (hasText && hasImageFile && !this.settings.cloudUploadSettings.applyImage) {
            console.log('[Cloud Upload] Skipping upload: clipboard has both text and image, but applyImage is disabled');
            return; // Don't upload, let Obsidian handle the paste
        }
        
        // Filter supported files
        const supportedFiles = itemData
            .filter(data => data.kind === "file" && data.file &&
                this.supportedImageFormats.isSupported(data.type, data.file.name))
            .map(data => data.file!)
            .filter((file): file is File => file !== null);

        console.log('[Cloud Upload] Found', supportedFiles.length, 'supported files');
        if (supportedFiles.length === 0) return;

        const activeFile = this.app.workspace.getActiveFile();
        console.log('[Cloud Upload] Active file:', activeFile?.path);
        if (!activeFile) {
            new Notice('No active file detected.');
            return;
        }

        // Process each file
        for (const file of supportedFiles) {
            console.log('[Cloud Upload] Processing file:', file.name, 'size:', file.size, 'type:', file.type);
            try {
                // Insert uploading placeholder
                const timestamp = Date.now();
                const placeholder = `![Uploading file...${timestamp}]()`;
                editor.replaceRange(placeholder, cursor);
                console.log('[Cloud Upload] Inserted placeholder:', placeholder);

                // Create uploader manager
                const uploaderManager = new UploaderManager(
                    this.settings.cloudUploadSettings.uploader,
                    this
                );
                console.log('[Cloud Upload] Created uploader manager for:', this.settings.cloudUploadSettings.uploader);

                // Convert File to FileList for upload
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(file);
                const fileList = dataTransfer.files;
                console.log('[Cloud Upload] Prepared FileList with', fileList.length, 'file(s)');

                // Upload directly from clipboard without saving to vault
                console.log('[Cloud Upload] Starting clipboard upload for:', file.name);
                const uploadResult = await uploaderManager.uploadByClipboard(fileList);
                console.log('[Cloud Upload] Upload result:', uploadResult);

                // Generate cloud link with size parameters
                const cloudUrl = uploadResult.result[0];
                console.log('[Cloud Upload] Cloud URL:', cloudUrl);
                
                const cloudLink = CloudLinkFormatter.formatCloudLink(
                    cloudUrl,
                    this.settings.cloudUploadSettings
                );
                console.log('[Cloud Upload] Formatted cloud link:', cloudLink);

                // Replace placeholder with actual link
                const content = editor.getValue();
                const newContent = content.replace(placeholder, cloudLink);
                editor.setValue(newContent);

                new Notice('Image uploaded successfully!');
                console.log('[Cloud Upload] Upload completed successfully');
            } catch (error) {
                console.error('[Cloud Upload] Upload failed:', error);
                console.error('[Cloud Upload] Error stack:', error.stack);
                new Notice(`Upload failed: ${error.message}`);
                // Leave placeholder in place for user to see the error
            }
        }

        // Refresh captions if enabled
        if (this.settings.enableImageCaptions) {
            this.captionManager.refresh();
        }
    }

    /**
     * Handle pasted text containing image URLs in cloud mode
     * Extract image URLs and upload them to cloud storage
     */
    private async handlePasteTextCloud(
        clipboardText: string,
        editor: Editor,
        cursor: EditorPosition,
        evt: ClipboardEvent
    ) {
        // Check if workOnNetWork is enabled
        if (!this.settings.cloudUploadSettings.workOnNetWork) {
            return; // Network image upload is disabled
        }

        // Extract image URLs from pasted text
        const imageUrlRegex = /!\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g;
        const matches = [...clipboardText.matchAll(imageUrlRegex)];

        if (matches.length === 0) {
            return; // No image URLs found
        }

        console.log('[Cloud Upload] Found', matches.length, 'image URL(s) in pasted text');

        // Filter out blacklisted domains
        const validMatches = matches.filter(match => {
            const url = match[2];
            if (this.isBlacklistedDomain(url)) {
                console.log('[Cloud Upload] Skipping blacklisted URL:', url);
                return false;
            }
            return true;
        });

        if (validMatches.length === 0) {
            return; // All URLs are blacklisted
        }

        evt.preventDefault(); // Prevent default paste

        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file detected.');
            return;
        }

        // Process each image URL
        let newContent = clipboardText;
        const uploaderManager = new UploaderManager(
            this.settings.cloudUploadSettings.uploader,
            this
        );

        for (const match of validMatches) {
            const originalLink = match[0]; // Full markdown link
            const altText = match[1];
            const imageUrl = match[2];

            try {
                console.log('[Cloud Upload] Uploading network image:', imageUrl);

                // Upload the network image
                const uploadResult = await uploaderManager.upload([imageUrl]);

                if (uploadResult.success && uploadResult.result.length > 0) {
                    const cloudUrl = uploadResult.result[0];
                    console.log('[Cloud Upload] Network image uploaded to:', cloudUrl);

                    // Generate cloud link with size parameters
                    const cloudLink = CloudLinkFormatter.formatCloudLink(
                        cloudUrl,
                        this.settings.cloudUploadSettings
                    );

                    // Replace the original link with the new cloud link
                    newContent = newContent.replace(originalLink, cloudLink);
                    console.log('[Cloud Upload] Replaced URL:', imageUrl, '->', cloudUrl);
                } else {
                    console.error('[Cloud Upload] Upload failed for:', imageUrl);
                    new Notice(`Failed to upload network image: ${imageUrl}`);
                }
            } catch (error) {
                console.error('[Cloud Upload] Error uploading network image:', error);
                new Notice(`Error uploading ${imageUrl}: ${error.message}`);
            }
        }

        // Insert the modified content
        editor.replaceRange(newContent, cursor);

        if (validMatches.length > 0) {
            new Notice(`Uploaded ${validMatches.length} network image(s) successfully!`);
        }

        // Refresh captions if enabled
        if (this.settings.enableImageCaptions) {
            this.captionManager.refresh();
        }
    }

    // ============================================
    // Right-click Upload Methods
    // ============================================

    /**
     * Upload a single file from file menu right-click or context menu
     * 右键上传单个文件
     */
    async uploadSingleFile(file: TFile): Promise<void> {
        // 检查文件是否已经是网络图片（通过检查文件路径是否以 http:// 或 https:// 开头）
        if (file.path.startsWith('http://') || file.path.startsWith('https://')) {
            new Notice('⚠️ 不能上传网络图片，请只上传本地图片文件');
            console.warn('[Upload] Attempted to upload network image:', file.path);
            return;
        }

        // Stage 1: Upload
        const uploadResult = await this.uploadWithRetry(file);
        if (!uploadResult) {
            return; // User cancelled or upload failed
        }
        const { cloudUrl } = uploadResult;

        // Stage 2: Scan references
        new Notice("正在扫描引用...");
        const matches = await this.findVaultImageMatches(file);
        const totalCount = matches.totalCount;

        // Stage 3: Decide based on reference count
        if (totalCount === 0) {
            await this.handleNoReference(file, cloudUrl);
        } else if (totalCount === 1) {
            await this.handleSingleReference(file, cloudUrl, matches);
        } else {
            await this.handleMultipleReferences(file, cloudUrl, matches, undefined);
        }
    }

    /**
     * Build upload path for a local file
     * 根据远程模式选择路径格式：
     * - 远程模式：使用 vault 内相对路径
     * - 本地模式：拼接完整的文件系统绝对路径
     */
    private buildUploadPath(file: TFile): string {
        try {
            // 远程模式使用 vault 内路径
            if (this.settings.cloudUploadSettings.remoteServerMode) {
                console.log('[Upload] Remote mode - using vault path:', file.path);
                return file.path;
            }
            
            // 本地模式使用绝对路径
            const basePath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
            const fullPath = normalizePath(join(basePath, file.path));
            console.log('[Upload] Local mode - vault path:', file.path, '-> full path:', fullPath);
            return fullPath;
        } catch (error) {
            console.error('[Upload] Failed to build upload path:', error);
            throw new Error(`无法构建文件路径: ${error.message}`);
        }
    }

    /**
     * Validate file exists in vault
     */
    private async validateFileExists(file: TFile): Promise<boolean> {
        try {
            const exists = await this.app.vault.adapter.exists(file.path);
            if (!exists) {
                console.warn('[Upload] File does not exist:', file.path);
                new Notice(`⚠️ 文件不存在: ${file.name}`);
                return false;
            }
            return true;
        } catch (error) {
            console.error('[Upload] Failed to check file existence:', error);
            return false;
        }
    }

    /**
     * Upload with retry mechanism
     */
    private async uploadWithRetry(file: TFile): Promise<{ cloudUrl: string } | null> {
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount < maxRetries) {
            try {
                new Notice(`正在上传 ${file.name}...`);

                // 验证文件存在性
                if (!await this.validateFileExists(file)) {
                    throw new Error('文件不存在');
                }

                const uploaderManager = new UploaderManager(
                    this.settings.cloudUploadSettings.uploader,
                    this
                );

                // 使用统一的路径构建方法
                const uploadPath = this.buildUploadPath(file);

                const uploadResult = await uploaderManager.upload([uploadPath]);
                const cloudUrl = uploadResult.result[0];

                new Notice(`✓ 上传成功!`);
                return { cloudUrl };
            } catch (error) {
                retryCount++;

                if (retryCount >= maxRetries) {
                    // Show error dialog
                    const retry = await new Promise<boolean>((resolve) => {
                        new UploadErrorDialog(
                            this.app,
                            file.name,
                            error.message,
                            (choice) => resolve(choice === 'retry')
                        ).open();
                    });

                    if (retry) {
                        retryCount = 0; // Reset counter and continue loop
                    } else {
                        return null; // User cancelled
                    }
                } else {
                    // Auto retry
                    new Notice(`上传失败,正在重试... (${retryCount}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }
        }

        return null;
    }

    /**
     * Find all references to an image in the vault (all .md and .canvas files)
     */
    private async findVaultImageMatches(file: TFile): Promise<ImageMatchResult> {
        const result: ImageMatchResult = {
            totalCount: 0,
            files: []
        };

        const allFiles = this.app.vault.getMarkdownFiles();
        const imagePath = file.path;

        for (const mdFile of allFiles) {
            const content = await this.app.vault.read(mdFile);
            const matches = this.findImageMatchesInContent(content, imagePath, mdFile.path);

            if (matches.length > 0) {
                result.files.push({
                    path: mdFile.path,
                    matches: matches
                });
                result.totalCount += matches.length;
            }
        }

        return result;
    }

    /**
     * Find image matches in file content
     */
    private findImageMatchesInContent(
        content: string,
        imagePath: string,
        sourceFilePath: string
    ): Array<{ lineNumber: number; line: string; original: string }> {
        const matches: Array<{ lineNumber: number; line: string; original: string }> = [];
        const lines = content.split('\n');
        const normalizedImagePath = normalizePath(imagePath);

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Match Wiki links: ![[path]]
            const wikiMatches = [...line.matchAll(/!\[\[([^\]]+?)(?:\|[^\]]+?)?\]\]/g)];
            for (const match of wikiMatches) {
                const linkPath = match[1];
                const resolvedPath = this.resolveImagePath(linkPath, sourceFilePath);

                if (this.pathsMatch(normalizedImagePath, resolvedPath)) {
                    matches.push({
                        lineNumber: i + 1,
                        line: line,
                        original: match[0]
                    });
                }
            }

            // Match Markdown links: ![alt](path)
            const mdMatches = [...line.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)];
            for (const match of mdMatches) {
                const linkPath = match[2];
                const resolvedPath = this.resolveImagePath(linkPath, sourceFilePath);

                if (this.pathsMatch(normalizedImagePath, resolvedPath)) {
                    matches.push({
                        lineNumber: i + 1,
                        line: line,
                        original: match[0]
                    });
                }
            }
        }

        return matches;
    }

    /**
     * Resolve image path relative to source file
     */
    private resolveImagePath(linkPath: string, sourceFilePath: string): string {
        if (linkPath.startsWith('http://') || linkPath.startsWith('https://')) {
            return linkPath; // Network image, return as is
        }

        const sourceDir = dirname(sourceFilePath);

        if (linkPath.startsWith('./') || linkPath.startsWith('../')) {
            return normalizePath(join(sourceDir, linkPath));
        }

        // Try to find the file in the vault
        const file = this.app.metadataCache.getFirstLinkpathDest(linkPath, sourceFilePath);
        if (file) {
            return file.path;
        }

        return normalizePath(linkPath);
    }

    /**
     * Check if two paths match
     */
    private pathsMatch(path1: string, path2: string): boolean {
        const normalized1 = normalizePath(path1).toLowerCase();
        const normalized2 = normalizePath(path2).toLowerCase();

        return normalized1 === normalized2 ||
            normalized1.endsWith(normalized2) ||
            normalized2.endsWith(normalized1);
    }

    /**
     * Handle case when image has no references
     */
    private async handleNoReference(file: TFile, cloudUrl: string): Promise<void> {
        const choice = await new Promise<string>((resolve) => {
            new NoReferenceUploadDialog(
                this.app,
                file.name,
                cloudUrl,
                file,
                resolve
            ).open();
        });

        switch (choice) {
            case 'keep-cloud':
                // Delete local file
                await this.app.vault.trash(file, true);
                new Notice(`✓ 已删除本地文件,云端保留`);
                break;

            case 'delete-all':
                // Delete cloud
                await this.deleteCloudImage(cloudUrl);
                // Delete local
                await this.app.vault.trash(file, true);
                new Notice(`✓ 已删除云端和本地文件`);
                break;

            case 'keep-all':
                new Notice(`已保留云端和本地文件`);
                break;
        }
    }

    /**
     * Handle case when image has single reference
     */
    private async handleSingleReference(
        file: TFile,
        cloudUrl: string,
        matches: ImageMatchResult
    ): Promise<void> {
        const referenceFile = matches.files[0];
        const referenceLine = referenceFile.matches[0].lineNumber;

        const choice = await new Promise<string>((resolve) => {
            new SingleReferenceUploadDialog(
                this.app,
                file.name,
                cloudUrl,
                { file: referenceFile.path, line: referenceLine },
                resolve
            ).open();
        });

        switch (choice) {
            case 'replace':
                await this.replaceAllReferences(matches, cloudUrl);
                new Notice(`✓ 已替换引用`);
                break;

            case 'replace-delete':
                await this.replaceAllReferences(matches, cloudUrl);
                if (this.settings.cloudUploadSettings.deleteSource) {
                    await this.app.vault.trash(file, true);
                    new Notice(`✓ 已替换引用并删除本地文件`);
                } else {
                    new Notice(`✓ 已替换引用 (设置中未启用删除源文件)`);
                }
                break;

            case 'undo':
                await this.deleteCloudImage(cloudUrl);
                new Notice(`已撤销上传`);
                break;

            case 'cancel':
                new Notice(`已取消,图片已上传但未替换引用`);
                break;
        }
    }

    /**
     * Handle case when image has multiple references
     */
    private async handleMultipleReferences(
        file: TFile,
        cloudUrl: string,
        matches: ImageMatchResult,
        currentNotePath?: string
    ): Promise<void> {
        const choice = await new Promise<string>((resolve) => {
            new MultiReferenceUploadDialog(
                this.app,
                file.name,
                cloudUrl,
                matches,
                currentNotePath,
                resolve
            ).open();
        });

        switch (choice) {
            case 'replace-current':
                if (currentNotePath) {
                    const currentMatches = {
                        totalCount: 0,
                        files: matches.files.filter(f => f.path === currentNotePath)
                    };
                    currentMatches.totalCount = currentMatches.files.reduce(
                        (sum, f) => sum + f.matches.length, 0
                    );

                    await this.replaceAllReferences(currentMatches, cloudUrl);
                    new Notice(`✓ 已替换当前笔记中的 ${currentMatches.totalCount} 处引用`);
                }
                break;

            case 'replace-all':
                await this.replaceAllReferences(matches, cloudUrl);
                new Notice(`✓ 已替换 ${matches.totalCount} 处引用,涉及 ${matches.files.length} 个文件`);
                break;

            case 'replace-all-delete':
                await this.replaceAllReferences(matches, cloudUrl);
                if (this.settings.cloudUploadSettings.deleteSource) {
                    await this.app.vault.trash(file, true);
                    new Notice(`✓ 已替换所有引用并删除本地文件`);
                } else {
                    new Notice(`✓ 已替换所有引用 (设置中未启用删除源文件)`);
                }
                break;

            case 'cancel':
                new Notice(`已取消,图片已上传但未替换引用`);
                break;
        }
    }

    /**
     * Replace all references to the image with cloud link
     */
    private async replaceAllReferences(
        matches: ImageMatchResult,
        cloudUrl: string
    ): Promise<void> {
        let replacedCount = 0;
        const totalCount = matches.totalCount;

        new Notice(`正在替换引用... (0/${totalCount})`);

        for (const fileMatch of matches.files) {
            const file = this.app.vault.getAbstractFileByPath(fileMatch.path);
            if (!file || !(file instanceof TFile)) continue;

            let content = await this.app.vault.read(file);

            // Replace all matches in this file
            for (const match of fileMatch.matches) {
                const cloudLink = CloudLinkFormatter.formatCloudLink(
                    cloudUrl,
                    this.settings.cloudUploadSettings
                );
                content = content.replace(match.original, cloudLink);
                replacedCount++;

                // Update progress
                new Notice(`正在替换引用... (${replacedCount}/${totalCount})`);
            }

            await this.app.vault.modify(file, content);
        }

        // Refresh captions if enabled
        if (this.settings.enableImageCaptions) {
            this.captionManager.refresh();
        }
    }

    /**
     * Delete cloud image (only works with PicList)
     */
    private async deleteCloudImage(cloudUrl: string): Promise<void> {
        if (this.settings.cloudUploadSettings.uploader !== 'PicList') {
            new Notice(`⚠️ 当前上传器不支持删除,请手动删除云端文件`);
            return;
        }

        try {
            new Notice(`正在删除云端图片...`);

            const deleter = new CloudImageDeleter(this);
            const success = await deleter.deleteImage({
                url: cloudUrl
            });

            if (success) {
                new Notice(`✓ 已删除云端图片`);
            } else {
                new Notice(`⚠️ 删除云端图片失败`);
            }
        } catch (error) {
            console.error('[Delete Cloud] Error:', error);
            new Notice(`❌ 删除云端图片失败: ${error.message}`);
        }
    }


}
