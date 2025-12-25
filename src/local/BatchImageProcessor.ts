// BatchImageProcessor.ts
import { App, TFile, TFolder, Notice } from 'obsidian';
import ImageConverterPlugin from '../main';
import { ResizeMode, EnlargeReduce } from "../settings/types";
import { ImageProcessor } from './ImageProcessor';
import { ConcurrentQueue } from '../utils/AsyncLock';
import { FolderAndFilenameManagement } from "./FolderAndFilenameManagement";
import { BatchResult, BatchItemResult } from "../types/BatchTypes";


export class BatchImageProcessor {
    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private imageProcessor: ImageProcessor,
        private folderAndFilenameManagement: FolderAndFilenameManagement
    ) { }

    async processImagesInNote(noteFile: TFile): Promise<void> {

        try {
            const {
                convertTo,
                quality,
                resizeMode,
                desiredWidth,
                desiredHeight,
                desiredLength,
                enlargeOrReduce,
                skipFormats: processCurrentNoteSkipFormats,
                skipImagesInTargetFormat: processCurrentNoteSkipImagesInTargetFormat
            } = this.plugin.settings.processCurrentNote;
            const { revertToOriginalIfLarger } = this.plugin.settings.global;
            const allowLargerFiles = !revertToOriginalIfLarger;

            const isKeepOriginalFormat = convertTo === 'disabled';
            const noCompression = quality === 1;
            const noResize = resizeMode === 'None';
            const targetFormat = convertTo;
            const outputFormat = convertTo === 'disabled' ? 'ORIGINAL' : convertTo.toUpperCase() as 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL';
            const colorDepth = 1; // Assuming full color depth for now, adjust if needed

            // Parse skip formats
            const skipFormats = processCurrentNoteSkipFormats
                .toLowerCase()
                .split(',')
                .map(format => format.trim())
                .filter(format => format.length > 0);

            // Get all image files in the note
            let linkedFiles: TFile[] = [];

            if (noteFile.extension === 'canvas') {
                const canvasImagePaths = await this.getImagesFromCanvas(noteFile);
                linkedFiles = canvasImagePaths
                    .map(path => this.app.vault.getAbstractFileByPath(path))
                    .filter((file): file is TFile => file instanceof TFile && this.plugin.supportedImageFormats.isSupported(undefined, file.name));
            } else {
                linkedFiles = this.getLinkedImageFiles(noteFile);
            }

            // De-duplicate by path while preserving order
            const seen = new Set<string>();
            linkedFiles = linkedFiles.filter((file) => {
                if (seen.has(file.path)) return false;
                seen.add(file.path);
                return true;
            });

            // If no images found at all
            if (linkedFiles.length === 0) {
                new Notice('No images found in the note.');
                return;
            }

            // Check if all images are either in target format or in skip list
            const allImagesSkippable = linkedFiles.every(file =>
                (file.extension === (isKeepOriginalFormat ? file.extension : targetFormat)) ||
                skipFormats.includes(file.extension.toLowerCase())
            );

            // Early return with appropriate message if no processing is needed
            if (allImagesSkippable && noCompression && noResize) {
                if (isKeepOriginalFormat) {
                    new Notice('No processing needed: All images are either in skip list or kept in original format with no compression or resizing.');
                } else {
                    new Notice(`No processing needed: All images are either in skip list or already in ${targetFormat.toUpperCase()} format with no compression or resizing.`);
                }
                return;
            }

            // Early return if no processing is needed
            if (isKeepOriginalFormat && noCompression && noResize) {
                new Notice('No processing needed: Original format selected with no compression or resizing.');
                return;
            }

            // Filter files that actually need processing
            const filesToProcess = linkedFiles.filter(file =>
                this.shouldProcessImage(file, isKeepOriginalFormat, targetFormat, skipFormats, processCurrentNoteSkipImagesInTargetFormat)
            );

            if (filesToProcess.length === 0) {
                if (processCurrentNoteSkipImagesInTargetFormat) {
                    new Notice(`No processing needed: All images are already in ${isKeepOriginalFormat ? 'their original' : targetFormat.toUpperCase()} format.`);
                } else {
                    new Notice('No images found that need processing.');
                }
                return;
            }

            let imageCount = 0;
            const statusBarItemEl = this.plugin.addStatusBarItem();
            const startTime = Date.now();

            const totalImages = filesToProcess.length;

            // Use uploadConcurrency setting for batch processing
            const concurrency = this.plugin.settings.pasteHandling.cloud.uploadConcurrency || 3;
            const queue = new ConcurrentQueue(concurrency);
            const tasks = filesToProcess.map(linkedFile => async () => {
                imageCount++;
                await this.processSingleImage(linkedFile, outputFormat, quality, colorDepth, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);

                const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
                statusBarItemEl.setText(
                    `Processing image ${imageCount} of ${totalImages}, elapsed time: ${elapsedTime} seconds`
                );
            });

            await queue.run(tasks);

            const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
            statusBarItemEl.setText(`Finished processing ${imageCount} images, total time: ${totalTime} seconds`);
            window.setTimeout(() => {
                statusBarItemEl.remove();
            }, 5000);

        } catch (error) {
            console.error('Error processing images in current note:', error);
            new Notice(`Error processing images: ${error.message} `);
        }
    }

    /**
     * Headless batch processing method.
     */
    async batchProcess(files: TFile[]): Promise<BatchResult> {
        const result: BatchResult = {
            successful: [],
            failed: [],
            cancelled: false
        };

        if (files.length === 0) return result;

        // Use "Process Current Note" settings as default for batch operations for now.
        // TODO: Allow overriding settings via args if needed by Modal.
        const {
            convertTo,
            quality,
            resizeMode,
            desiredWidth,
            desiredHeight,
            desiredLength,
            enlargeOrReduce
        } = this.plugin.settings.processCurrentNote;
        const { revertToOriginalIfLarger } = this.plugin.settings.global;
        const allowLargerFiles = !revertToOriginalIfLarger;

        const outputFormat = convertTo === 'disabled' ? 'ORIGINAL' : convertTo.toUpperCase() as 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL';
        const colorDepth = 1;

        const concurrency = this.plugin.settings.pasteHandling.cloud.uploadConcurrency || 3;
        const queue = new ConcurrentQueue(concurrency);

        const tasks = files.map(file => async () => {
            const res = await this.processSingleImage(
                file,
                outputFormat,
                quality,
                colorDepth,
                resizeMode,
                desiredWidth,
                desiredHeight,
                desiredLength,
                enlargeOrReduce,
                allowLargerFiles
            );
            return { file, res };
        });

        const results = await queue.runSettled(tasks);

        results.forEach((res, index) => {
            const task = files[index];
            if (res.status === 'fulfilled') {
                const { success, error } = res.value.res;
                if (success) {
                    result.successful.push({
                        success: true,
                        item: task
                    });
                } else {
                    result.failed.push({
                        success: false,
                        item: task,
                        error: error || "Processing failed"
                    });
                }
            } else {
                result.failed.push({
                    success: false,
                    item: task,
                    error: res.reason?.message || "Unknown error"
                });
            }
        });

        return result;
    }

    private async processSingleImage(
        file: TFile,
        outputFormat: 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL',
        quality: number,
        colorDepth: number,
        resizeMode: string, // Using string type to match settings, recast internally
        desiredWidth: number,
        desiredHeight: number,
        desiredLongestEdge: number,
        enlargeOrReduce: string,
        allowLargerFiles: boolean
    ): Promise<{ success: boolean; error?: string }> {
        try {
            // 1. Process Image (Zero-Copy by passing TFile)
            const processedImageData = await this.imageProcessor.processImage(
                file, // Pass TFile directly
                outputFormat,
                quality,
                colorDepth,
                resizeMode as ResizeMode,
                desiredWidth,
                desiredHeight,
                desiredLongestEdge,
                enlargeOrReduce as EnlargeReduce,
                allowLargerFiles
            );

            // 2. Determine New Path and Filename
            const newFileName = `${file.basename}.${outputFormat.toLowerCase()}`;
            // Use parent path
            const parentPath = file.parent ? file.parent.path : "";

            // Check if we are doing in-place update (same name and extension)
            // Note: outputFormat logic above ensures extension match.
            const isSameFile = file.name === newFileName;

            if (isSameFile) {
                // In-place update: Modify existing binary
                // For atomicity, safer to write temp then swap, but modifyBinary is standard Obsidian API.
                await this.app.vault.modifyBinary(file, processedImageData);
            } else {
                // Formatting Change: Create New -> Update Links -> Delete Old

                // 3. Create New File Atomically
                // We use 'increment' to ensure we don't overwrite unrelated files if name exists,
                // but usually we want to replace the 'conversion target' if it exists?
                // Batch logic usually implies specific intent. If conflicts, 'increment' is safest.
                const newFile = await this.folderAndFilenameManagement.createUniqueBinary(
                    parentPath,
                    newFileName,
                    processedImageData,
                    'increment'
                );

                if (newFile) {
                    // 4. Update References (Links)
                    // Update all links in the vault to point to the new file
                    await this.plugin.vaultReferenceManager.updateReferences(file.path, (loc) => {
                        // loc.link is usually relative or absolute path depending on settings.
                        // We replace the filename part.
                        // Ideally we should just return the new path, but reference manager expects text replacement logic?
                        // "updateReferences" callback receives the link cache object.
                        // We assume standard updating behavior.
                        // Simplest robust update: replace the basename+ext in the link text.

                        // NOTE: If using 'increment', newFile.name might be 'image 1.webp'.
                        // We must use newFile.name.
                        const newName = newFile.name;
                        const oldName = file.name;

                        // Replace the old filename in the link text with the new filename
                        // This handles paths: "Assets/img.png" -> "Assets/img.webp"
                        return loc.original.replace(oldName, newName);
                    });

                    // 5. Delete Old File
                    await this.app.vault.trash(file, true); // true = system trash, false = obsidian trash (.trash)
                    // Using local trash (.trash) is safer for recovery?
                    // Standard is app.vault.trash(file, false) usually? 
                    // Let's use false (Obsidian trash) for safety during batch ops.
                }
            }
            return { success: true };
        } catch (error) {
            console.error(`Failed to process image ${file.path}:`, error);
            // Don't throw, allow batch to continue, but return failure
            return { success: false, error: error.message };
        }
    }


    async processImagesInFolder(folderPath: string, recursive: boolean): Promise<void> {
        try {
            const folder = this.app.vault.getAbstractFileByPath(folderPath);
            if (!(folder instanceof TFolder)) {
                new Notice('Error: Invalid folder path.');
                return;
            }

            // Get settings from the modal
            const {
                convertTo,
                quality,
                resizeMode,
                desiredWidth,
                desiredHeight,
                desiredLength,
                enlargeOrReduce,
                skipFormats: processCurrentNoteSkipFormats,
            } = this.plugin.settings.processCurrentNote; // Using processCurrentNote settings for folder action?
            // "Process Images in Folder" usually shares settings with "Process Current Note" or has its own?
            // Looking at original code: it uses processCurrentNote settings.

            const { revertToOriginalIfLarger } = this.plugin.settings.global;
            const allowLargerFiles = !revertToOriginalIfLarger;

            const outputFormat = convertTo === 'disabled' ? 'ORIGINAL' : convertTo.toUpperCase() as 'WEBP' | 'JPEG' | 'PNG' | 'ORIGINAL';
            const colorDepth = 1;

            const skipFormats = processCurrentNoteSkipFormats
                .toLowerCase()
                .split(',')
                .map(format => format.trim())
                .filter(format => format.length > 0);

            const images = this.getImageFiles(folder, recursive);
            if (images.length === 0) {
                new Notice('No images found in the folder.');
                return;
            }

            let imageCount = 0;
            const statusBarItemEl = this.plugin.addStatusBarItem();
            const startTime = Date.now();
            const totalImages = images.length;

            const concurrency = this.plugin.settings.pasteHandling.cloud.uploadConcurrency || 3;
            const queue = new ConcurrentQueue(concurrency);

            const tasks = images.map(image => async () => {
                if (skipFormats.includes(image.extension.toLowerCase())) {
                    return;
                }
                imageCount++;
                await this.processSingleImage(image, outputFormat, quality, colorDepth, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);

                const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
                statusBarItemEl.setText(
                    `Processing image ${imageCount} of ${totalImages}, elapsed time: ${elapsedTime} seconds`
                );
            });

            await queue.run(tasks);

            const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
            statusBarItemEl.setText(`Finished processing ${imageCount} images, total time: ${totalTime} seconds`);
            window.setTimeout(() => {
                statusBarItemEl.remove();
            }, 5000);

        } catch (error) {
            console.error('Error processing images in folder:', error);
            new Notice(`Error processing images: ${error.message} `);
        }
    }

    private getImageFiles(folder: TFolder, recursive: boolean): TFile[] {
        const allFiles = this.app.vault.getFiles();
        const folderPath = folder.path.replace(/\\/g, '/').replace(/\/$/, '');
        const prefix = folderPath === '' || folderPath === '/' ? '' : `${folderPath}/`;

        const isImmediateChild = (filePath: string) => {
            if (!prefix) {
                return filePath.indexOf('/') === -1;
            }
            if (!filePath.startsWith(prefix)) return false;
            const remainder = filePath.slice(prefix.length);
            return remainder.indexOf('/') === -1;
        };

        return allFiles.filter((file) => {
            if (!this.plugin.supportedImageFormats.isSupported(undefined, file.name)) return false;
            const normalized = file.path.replace(/\\/g, '/');
            if (recursive) {
                return prefix === '' ? true : normalized.startsWith(prefix);
            }
            return isImmediateChild(normalized);
        });
    }

    async processAllVaultImages(): Promise<void> {
        try {
            const {
                convertTo,
                quality,
                resizeMode,
                desiredWidth,
                desiredHeight,
                desiredLength,
                enlargeOrReduce,
                skipFormats: skipFormatsSetting,
                skipImagesInTargetFormat: skipTargetFormat,
            } = this.plugin.settings.processAllVault;
            const { revertToOriginalIfLarger } = this.plugin.settings.global;
            const allowLargerFiles = !revertToOriginalIfLarger;

            const targetFormat = convertTo;
            const outputFormat =
                convertTo === "disabled"
                    ? "ORIGINAL"
                    : (convertTo.toUpperCase() as "WEBP" | "JPEG" | "PNG" | "ORIGINAL");
            const colorDepth = 1;

            const skipFormats = skipFormatsSetting
                .toLowerCase()
                .split(",")
                .map((format) => format.trim())
                .filter((format) => format.length > 0);

            const imageFiles = await this.getAllImageFiles();

            if (imageFiles.length === 0) {
                new Notice('No images found in the vault.');
                return;
            }

            const filesToProcess = imageFiles.filter(file =>
                this.shouldProcessImage(file, convertTo === 'disabled', targetFormat, skipFormats, skipTargetFormat)
            );

            if (filesToProcess.length === 0) {
                new Notice('No images found that need processing.');
                return;
            }

            let imageCount = 0;
            const statusBarItemEl = this.plugin.addStatusBarItem();
            const startTime = Date.now();
            const totalImages = filesToProcess.length;

            const concurrency = this.plugin.settings.pasteHandling.cloud.uploadConcurrency || 3;
            const queue = new ConcurrentQueue(concurrency);

            const tasks = filesToProcess.map(image => async () => {
                imageCount++;
                await this.processSingleImage(image, outputFormat, quality, colorDepth, resizeMode, desiredWidth, desiredHeight, desiredLength, enlargeOrReduce, allowLargerFiles);

                const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
                statusBarItemEl.setText(
                    `Processing image ${imageCount} of ${totalImages}, elapsed time: ${elapsedTime} seconds`
                );
            });

            await queue.run(tasks);

            const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
            statusBarItemEl.setText(
                `Finished processing ${imageCount} images, total time: ${totalTime} seconds`
            );
            window.setTimeout(() => {
                statusBarItemEl.remove();
            }, 5000);
        } catch (error) {
            console.error("Error processing images:", error);
            new Notice(`Error processing images: ${error.message}`);
        }
    }

    async getAllImageFiles(): Promise<TFile[]> {
        const allFiles = this.app.vault.getFiles();
        const imageFiles = allFiles.filter(file =>
            this.plugin.supportedImageFormats.isSupported(undefined, file.name)
        );

        const canvasFiles = allFiles.filter(file =>
            file instanceof TFile &&
            file.extension === 'canvas'
        );

        for (const canvasFile of canvasFiles) {
            const canvasImages = await this.getImagesFromCanvas(canvasFile);
            for (const imagePath of canvasImages) {
                const imageFile = this.app.vault.getAbstractFileByPath(imagePath);
                if (imageFile instanceof TFile && this.plugin.supportedImageFormats.isSupported(undefined, imageFile.name)) {
                    if (!imageFiles.find(existing => existing.path === imageFile.path)) {
                        imageFiles.push(imageFile);
                    }
                }
            }
        }

        return imageFiles;
    }

    async getImagesFromCanvas(file: TFile): Promise<string[]> {
        const images: string[] = [];
        const content = await this.app.vault.read(file);
        const canvasData = JSON.parse(content);

        if (canvasData.nodes && Array.isArray(canvasData.nodes)) {
            for (const node of canvasData.nodes) {
                if (node.type === "file" && node.file) {
                    images.push(node.file);
                }
            }
        }

        return images;
    }

    private getLinkedImageFiles(noteFile: TFile): TFile[] {
        const { resolvedLinks } = this.app.metadataCache;
        const linksInCurrentNote = resolvedLinks[noteFile.path];

        if (!linksInCurrentNote) return [];

        return Object.keys(linksInCurrentNote)
            .map(link => this.app.vault.getAbstractFileByPath(link))
            .filter((file): file is TFile => file instanceof TFile && this.plugin.supportedImageFormats.isSupported(undefined, file.name));
    }

    shouldProcessImage(image: TFile, isKeepOriginalFormat: boolean, targetFormat: string, skipFormats: string[], skipImagesInTargetFormat: boolean): boolean {
        const effectiveTargetFormat = isKeepOriginalFormat
            ? image.extension
            : targetFormat;

        if (skipFormats.includes(image.extension.toLowerCase())) {
            return false;
        }

        if (skipImagesInTargetFormat &&
            image.extension === effectiveTargetFormat) {
            return false;
        }

        return true;
    }

}
