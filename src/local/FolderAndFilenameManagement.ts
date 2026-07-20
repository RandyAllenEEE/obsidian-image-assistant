// FolderAndFilenameManagement.ts
import { TFile, TFolder, App, normalizePath, Notice } from "obsidian";
import * as path from 'path';
import {
    ImageAssistantSettings,
    LocalDestinationSettings,
    LocalFilenameSettings,
    LocalConversionSettings,
} from "../settings/types";
import {
    VariableProcessor,
    type NamingEvaluationSession
} from "./VariableProcessor";
import { SupportedImageFormats } from "./SupportedImageFormats";
import { getVaultConfigString } from "../utils/vaultConfig";
import { getErrorMessage } from "../utils/ErrorUtils";
import { assertSafeVaultFilename, normalizeVaultFolderPath } from "../utils/VaultPathUtils";
import { AsyncLock } from "../utils/AsyncLock";
import { createUniqueOperationId } from "../utils/UniqueOperationId";

export interface ImageNamePlan {
    readonly destinationPath: string;
    readonly newFilename: string;
}

export class FolderAndFilenameManagement {
    private static readonly binaryWriteLock = new AsyncLock();
    private static readonly renameLock = new AsyncLock();

    constructor(
        private app: App,
        private settings: ImageAssistantSettings,
        private supportedImageFormats: SupportedImageFormats,
        private variableProcessor: VariableProcessor
    ) { }

    /**
     * Validates templates to ensure variables won't resolve to empty strings that would cause issues
     * @param file The file being processed
     * @param activeFile The current active file
     * @param selectedFilenameSetting The filename settings to validate
     * @param selectedFolderSetting The folder settings to validate
     * @throws Error if validation fails with descriptive message
     */
    private validateTemplates(
        file: File,
        activeFile: TFile,
        selectedFilenameSetting: LocalFilenameSettings,
        selectedFolderSetting: LocalDestinationSettings
    ): void {
        const context = { file, activeFile };

        // Validate folder template if it's a custom template
        if (selectedFolderSetting?.type === "CUSTOM" && selectedFolderSetting.customTemplate) {
            const folderValidation = this.variableProcessor.validateTemplate(selectedFolderSetting.customTemplate, context);
            if (!folderValidation.valid) {
                new Notice(`Folder template validation failed: ${folderValidation.errors.join(', ')}`);
                throw new Error(`Folder template validation failed: ${folderValidation.errors.join(', ')}`);
            }
        }

        // Validate subfolder template if using SUBFOLDER type
        const subfolderTemplate = selectedFolderSetting?.subfolderTemplate;
        if (selectedFolderSetting?.type === "SUBFOLDER" && subfolderTemplate) {
            const subfolderValidation = this.variableProcessor.validateTemplate(subfolderTemplate, context);
            if (!subfolderValidation.valid) {
                new Notice(`Subfolder template validation failed: ${subfolderValidation.errors.join(', ')}`);
                throw new Error(`Subfolder template validation failed: ${subfolderValidation.errors.join(', ')}`);
            }
        }

        // Validate filename template if it's a custom template
        if (selectedFilenameSetting?.customTemplate) {
            const filenameValidation = this.variableProcessor.validateTemplate(selectedFilenameSetting.customTemplate, context);
            if (!filenameValidation.valid) {
                new Notice(`Filename template validation failed: ${filenameValidation.errors.join(', ')}`);
                throw new Error(`Filename template validation failed: ${filenameValidation.errors.join(', ')}`);
            }
        }
    }

    async determineDestination(
        file: File,
        activeFile: TFile,
        selectedConversionSetting: LocalConversionSettings,
        selectedFilenameSetting: LocalFilenameSettings,
        selectedFolderSetting: LocalDestinationSettings
    ): Promise<ImageNamePlan> {
        // Step 0: Validate templates before processing
        this.validateTemplates(file, activeFile, selectedFilenameSetting, selectedFolderSetting);

        const namingSession = this.variableProcessor.createSession({
            file,
            activeFile,
            quality: selectedConversionSetting.quality
        });

        // Step 1: Determine the target directory based on the local folder setting
        const destinationDir = await this.getDestinationDirectory(
            selectedFolderSetting,
            file,
            activeFile,
            namingSession
        );

        let newFilename: string;

        // Step 2: Handle filename generation based on whether we should skip renaming
        if (selectedFilenameSetting && this.shouldSkipRename(file.name, selectedFilenameSetting)) {
            // Skip rename case - use the original name without extension
            newFilename = this.getFilenameStem(file.name);

        } else {
            // Normal case - generate a new filename according to the local filename setting
            newFilename = await this.generateNewFilename(
                selectedFilenameSetting,
                file,
                activeFile,
                selectedConversionSetting,
                namingSession,
                destinationDir
            );
        }

        // Step 3: Add the appropriate file extension based on conversion settings
        newFilename = await this.addCorrectExtension(newFilename, file, selectedConversionSetting);
        newFilename = this.sanitizeFilename(newFilename);
        assertSafeVaultFilename(newFilename);


        // Step 4: Return both the destination path and final filename
        return {
            destinationPath: destinationDir,
            newFilename
        };
    }

    private async getDestinationDirectory(
        selectedFolderSetting: LocalDestinationSettings,
        file: File,
        activeFile: TFile,
        namingSession?: NamingEvaluationSession
    ): Promise<string> {
        let destinationDir = "";

        switch (selectedFolderSetting?.type) {
            case "DEFAULT":
                destinationDir = this.getDefaultAttachmentFolderPath(activeFile);
                break;
            case "ROOT":
                destinationDir = this.app.vault.getRoot().path;
                break;
            case "CURRENT":
                destinationDir = activeFile.parent?.path || "";
                break;
            case "SUBFOLDER": {
                // Use the custom template if provided, otherwise use activeFile.basename
                const subfolderTemplate = selectedFolderSetting.subfolderTemplate;
                const subfolderName = subfolderTemplate
                    ? await this.processSubfolderVariables(
                        subfolderTemplate,
                        file,
                        activeFile,
                        namingSession
                    )
                    : activeFile.basename;

                destinationDir = activeFile.parent
                    ? normalizePath(`${activeFile.parent.path}/${subfolderName}`)
                    : subfolderName;
                break;
            }
            case "CUSTOM":
                if (selectedFolderSetting.customTemplate) {
                    destinationDir = await this.processSubfolderVariables(
                        selectedFolderSetting.customTemplate,
                        file,
                        activeFile,
                        namingSession
                    );
                } else {
                    new Notice("Custom folder template is not defined.");
                    destinationDir = this.getDefaultAttachmentFolderPath(
                        activeFile
                    );
                }
                break;
            default:
                destinationDir = this.getDefaultAttachmentFolderPath(
                    activeFile
                );
        }
        return destinationDir;
    }

    /**
     * Combines a base path and a filename, handling root paths correctly.
     * @param basePath The base path.
     * @param filename The filename.
     * @returns The combined path.
     */
    combinePath(basePath: string, filename: string): string {
        if (basePath === "/") {
            return normalizePath(`/${filename}`);
        }
        return normalizePath(`${basePath}/${filename}`);
    }

    /**
     * Ensures that a folder exists at the given path, creating it if necessary.
     * Handles case sensitivity by first checking for an exact case match, and if not found, 
     * performs a case-insensitive search for an existing folder. If a folder with a different
     * case is found, its path is used instead.
     *
     * @param path - The path where the folder should exist.
     * @async
     * @throws {Error} If there is an error during folder creation.
     * 
     * @example
     * // Assume a folder "/MyNotes/images" exists in the vault.
     * 
     * // User tries to move an image to "/MyNotes/Images" (uppercase "I").
     * await ensureFolderExists("/MyNotes/Images"); 
     * // The existing "/MyNotes/images" folder will be used (no new folder created).
     *
     * // User tries to move an image to "/MyNotes/IMAGES" (all uppercase).
     * await ensureFolderExists("/MyNotes/IMAGES");
     * // The existing "/MyNotes/images" folder will be used (no new folder created).
     *
     * // User tries to move an image to "/NewFolder/Subfolder" (neither folder exists).
     * await ensureFolderExists("/NewFolder/Subfolder");
     * // Folders "/NewFolder" and "/NewFolder/Subfolder" will be created.
     */
    async ensureFolderExists(path: string): Promise<void> {
        const normalizedPath = normalizeVaultFolderPath(path);
        if (!normalizedPath || normalizedPath === "/") return;
        if (!(await this.app.vault.adapter.exists(normalizedPath))) {
            const folders = normalizedPath.split('/').filter(Boolean);
            let currentPath = '';

            for (const folder of folders) {
                currentPath += (currentPath ? '/' : '') + folder;

                if (!(await this.app.vault.adapter.exists(currentPath))) {
                    // Folder doesn't exist (exact case), try case-insensitive search
                    const allFiles = this.app.vault.getAllLoadedFiles();
                    const existingFolder = allFiles.find(file =>
                        file.path.toLowerCase() === currentPath.toLowerCase() && file instanceof TFolder
                    );

                    if (existingFolder) {
                        // Found folder with different case, use it
                        currentPath = existingFolder.path;
                    } else {
                        // No folder found (any case), create it
                        await this.app.vault.createFolder(currentPath);
                    }
                } else {
                    // Folder exists (exact case), check and correct case if needed (original logic)
                    const existingFolder = await this.app.vault.getAbstractFileByPath(currentPath);
                    if (existingFolder && existingFolder.name !== folder) {
                        const newPath = `${currentPath.substring(0, currentPath.lastIndexOf('/'))}/${existingFolder.name}`;
                        if (await this.app.vault.adapter.exists(newPath)) {
                            currentPath = newPath;  // Use existing folder path
                        } else {
                            // Rare case: renamed folder does not exist, stick to original
                            new Notice(`Warning: Inconsistent folder casing detected. Using original path: ${currentPath}`);
                        }
                    }
                }
            }
        }
    }

    public getDefaultAttachmentFolderPath(activeFile: TFile): string {
        const configuredPath = getVaultConfigString(this.app, "attachmentFolderPath");
        if (!configuredPath) {
            return activeFile.parent?.path || "";
        }

        if (configuredPath.startsWith("./")) {
            return activeFile.parent?.path
                ? normalizePath(`${activeFile.parent.path}/${configuredPath.substring(2)}`)
                : configuredPath.substring(2);
        }
        return normalizePath(configuredPath);
    }

    // Handle filename conflicts by adding a number suffix
    async handleNameConflicts(
        destinationDir: string,
        baseFilename: string,
        conflictMode: "reuse" | "increment" | "skip" | "overwrite" = "reuse"
    ): Promise<string> {
        const normalizedDestination = normalizePath(destinationDir);
        const lastDotIndex = baseFilename.lastIndexOf('.');
        const nameWithoutExt = lastDotIndex > -1
            ? baseFilename.substring(0, lastDotIndex)
            : baseFilename;
        const extension = lastDotIndex > -1
            ? baseFilename.substring(lastDotIndex)
            : '';

        let finalFilename = baseFilename;

        // If reuse mode, just return the original filename
        if (conflictMode === "reuse") {
            return finalFilename;
        }

        // Increment mode logic
        if (await this.app.vault.adapter.exists(`${normalizedDestination}/${finalFilename}`)) {
            let conflictCounter = 1;
            let candidate = buildIncrementedFilename(
                nameWithoutExt,
                extension,
                conflictCounter
            );
            while (await this.app.vault.adapter.exists(`${normalizedDestination}/${candidate}`)) {
                conflictCounter++;
                candidate = buildIncrementedFilename(
                    nameWithoutExt,
                    extension,
                    conflictCounter
                );
            }
            finalFilename = candidate;
        }

        return finalFilename;
    }

    async generateNewFilename(
        selectedFilenameSetting: LocalFilenameSettings,
        file: File,
        activeFile: TFile,
        selectedConversionSetting?: LocalConversionSettings,
        namingSession?: NamingEvaluationSession,
        counterScope?: string
    ): Promise<string> {
        let newFilename = file.name;

        if (selectedFilenameSetting && selectedFilenameSetting.customTemplate) {
            const session = namingSession ?? this.variableProcessor.createSession({
                file,
                activeFile,
                quality: selectedConversionSetting?.quality
            });
            newFilename = await session.evaluate(
                selectedFilenameSetting.customTemplate,
                { counterScope: counterScope ?? activeFile.parent?.path ?? "/" }
            );
            newFilename = this.sanitizeFilename(newFilename);
            if (!newFilename || /^[.]+$/.test(newFilename)) {
                throw new Error("Filename template resolved to an empty filename.");
            }

            // Validate and remove extension if necessary
            newFilename = await this.validateAndRemoveExtension(newFilename, file);
        } else {
            // Default behavior (e.g., original filename without extension)
            newFilename = this.getFilenameStem(file.name);
        }

        return newFilename;
    }

    private async validateAndRemoveExtension(filename: string, file: File): Promise<string> {
        const lastDotIndex = filename.lastIndexOf(".");
        if (lastDotIndex === -1) {
            return filename; // No extension found
        }

        const potentialExtension = filename.substring(lastDotIndex + 1).toLowerCase();

        // Check if the potential extension is supported
        if (this.supportedImageFormats.supportedExtensions.has(potentialExtension)) {
            // Get the mime type of the file
            const mimeType = await this.supportedImageFormats.getMimeTypeFromFile(file);

            // If mime type is known, validate the extension against it
            if (mimeType !== "unknown") {
                const mimeExtensions = this.supportedImageFormats.getExtensionsFromMimeType(mimeType);
                if (mimeExtensions && mimeExtensions.includes(potentialExtension)) {
                    // Valid extension for the given mime type, remove it
                    return filename.substring(0, lastDotIndex);
                }
                // Invalid extension for the given mime type, keep the original filename
                console.warn(`Mismatched extension for file: ${filename}, based on mime type: ${mimeType}. Keeping original filename.`);
                return filename;
            }
            // Mime type is unknown, remove the extension as a precaution
            console.warn(`Unknown mime type for file: ${filename}. Removing potential extension.`);
            return filename.substring(0, lastDotIndex);
        }

        // Potential extension is not supported, keep the original filename
        return filename;
    }

    private async addCorrectExtension(
        filename: string,
        file: File,
        selectedConversionSetting?: LocalConversionSettings
    ): Promise<string> {
        const originalExtension = await this.getOriginalExtension(file);

        // First check if conversion should be skipped
        if (selectedConversionSetting && this.shouldSkipConversion(file.name, selectedConversionSetting)) {
            return `${filename}${originalExtension}`;
        }

        // If not skipped, proceed with normal conversion logic
        const outputFormat = selectedConversionSetting
            ? selectedConversionSetting.outputFormat
            : this.settings.localProcessing.conversion.outputFormat;
        switch (outputFormat) {
            case "WEBP":
                return `${filename}.webp`;
            case "JPEG":
                return `${filename}.jpeg`;  // Corrected to .jpeg
            case "PNG":
                return `${filename}.png`;
            case "AVIF": // Correctly handle AVIF
                return `${filename}.avif`;
            case "ORIGINAL":
            case "NONE":
            default:
                return `${filename}${originalExtension}`;
        }
    }

    private getFilenameStem(filename: string): string {
        const lastDot = filename.lastIndexOf(".");
        if (lastDot > 0) return filename.substring(0, lastDot);

        const withoutLeadingDots = filename.replace(/^\.+/, "");
        return withoutLeadingDots || "image";
    }

    private async getOriginalExtension(file: File): Promise<string> {
        const lastDot = file.name.lastIndexOf(".");
        if (lastDot > 0 && lastDot < file.name.length - 1) {
            return file.name.substring(lastDot).toLowerCase();
        }

        const mimeType = await this.supportedImageFormats.getMimeTypeFromFile(file);
        const detectedExtension = this.supportedImageFormats.getExtensionsFromMimeType(mimeType)?.[0];
        return detectedExtension ? `.${detectedExtension}` : "";
    }

    /**
     * Sanitizes a filename by removing or replacing invalid characters, handling reserved names,
     * and ensuring compliance with common filesystem restrictions.
     *
     * @param filename - The filename string to sanitize.
     * @returns The sanitized filename string.
     *
     * **Character Restrictions and Replacements:**
     *
     * - **Invalid Characters:** The following characters are considered invalid and are replaced with underscores (`_`):
     *   - `\ / : * ? " < > |`
     * - **Allowed Characters:** Square brackets `[]` and parentheses `()` are now allowed in filenames.
     *
     * - **Reserved Names (Windows):** If the filename matches one of the following reserved names (case-insensitive),
     *   an underscore (`_`) is appended to the end:
     *   - `CON, PRN, AUX, NUL, COM1, COM2, COM3, COM4, COM5, COM6, COM7, COM8, COM9, LPT1, LPT2, LPT3, LPT4, LPT5, LPT6, LPT7, LPT8, LPT9`
     *
     * - **Leading/Trailing Dots:** Leading and trailing dots (`.`) are removed.
     *
     * - **Leading/Trailing Spaces:** Leading and trailing spaces are removed.
     *
     * - **Multiple Consecutive Dots:** Multiple consecutive dots in the middle of the filename are replaced with a single dot.
     *
     * NOT SAFE for FOLDER creation thus removed!! - **Empty Filename:** If the filename is empty or consists only of whitespace after sanitization, it is replaced with `"unnamed"`.
     *
     * - **Length Truncation (Optional):** By default, the maximum length of the sanitized filename (including extension) is 250 characters.
     * 
     * **Allowed Characters:**
     *
     * After sanitization, the filename will only contain the following characters:
     * - Alphanumeric characters (a-z, A-Z, 0-9)
     * - Underscores (`_`)
     * - Spaces (except leading or trailing)
     * - Dots (`.`) (except leading, trailing, or multiple consecutive dots, and it must have an extension)
     *
     * @example
     * ```typescript
     * sanitizeFilename("  My/File\\Name??**.txt  ");    // Returns: "My_File_Name.txt"
     * sanitizeFilename("...file.name...");           // Returns: "file.name"
     * sanitizeFilename("CON");                       // Returns: "CON_"
     * sanitizeFilename("  ");                         // Returns: "unnamed" NOT SAFE for FOLDER creation thus removed!! 
     * sanitizeFilename("...");                        // Returns: "unnamed" NOT SAFE for FOLDER creation thus removed!! 
     * sanitizeFilename("normal_file.txt");           // Returns: "normal_file.txt"
     * sanitizeFilename("a.very.long.name.with.dots.pdf"); // Returns: "a.very.long.name.with.dots.pdf"
     * sanitizeFilename("");                           // Returns: "unnamed" NOT SAFE for FOLDER creation thus removed!! 
     * sanitizeFilename("  . ");                     // Returns: "unnamed" NOT SAFE for FOLDER creation thus removed!! 
     * sanitizeFilename("LPT9.txt");                  // Returns: "LPT9_.txt"
     * sanitizeFilename(".hiddenfile");               // Returns: "hiddenfile"
     * sanitizeFilename("normal.file.name.with.spaces.txt"); // Returns: "normal.file.name.with.spaces.txt"
     * sanitizeFilename("A".repeat(300) + ".txt");    // Returns: "(truncated to 250 characters).txt"
     * sanitizeFilename("A".repeat(200) + "." + "B".repeat(200)); // Returns: "(truncated to 125 characters).(truncated to 125 characters)
     * ```
     */
    sanitizeFilename(filename: string): string {
        const normalized = filename.normalize("NFC").trim();
        const lastDotIndex = normalized.lastIndexOf(".");
        const hasExtension = lastDotIndex > 0
            && lastDotIndex < normalized.length - 1;
        let base = hasExtension
            ? normalized.slice(0, lastDotIndex)
            : normalized;
        let extension = hasExtension
            ? normalized.slice(lastDotIndex + 1)
            : "";

        base = sanitizeVaultNamePart(base);
        extension = sanitizeVaultNamePart(extension);
        if (WINDOWS_RESERVED_NAMES.has(base.toUpperCase())) base += "_";
        if (!base) return "";

        const suffix = extension ? `.${extension}` : "";
        const availableBytes = Math.max(1, 240 - utf8Length(suffix));
        base = truncateUtf8(base, availableBytes).replace(/[ .]+$/g, "");
        if (!base) return "";
        return `${base}${suffix}`;
    }

    shouldSkipConversion(filename: string, setting: LocalConversionSettings): boolean {
        return this.matchesPatterns(filename, setting.skipConversionPatterns);
    }

    shouldSkipRename(
        filename: string,
        setting: LocalFilenameSettings
    ): boolean {
        return this.matchesPatterns(filename, setting.skipRenamePatterns);
    }

    matchesPatterns(
        filename: string,
        patternsString: string
    ): boolean {
        if (!patternsString.trim()) {
            return false;
        }

        const patterns = patternsString
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0);

        return patterns.some((pattern) => {
            try {
                // Check if pattern is a regex (enclosed in /)
                if (pattern.startsWith("/") && pattern.endsWith("/")) {
                    // Extract regex pattern without the slashes
                    const regexPattern = pattern.slice(1, -1);
                    const regex = new RegExp(regexPattern, "i");
                    return regex.test(filename);
                }
                // Check if pattern is a regex (enclosed in r/)
                if (pattern.startsWith("r/") && pattern.endsWith("/")) {
                    // Extract regex pattern without r/ and /
                    const regexPattern = pattern.slice(2, -1);
                    const regex = new RegExp(regexPattern, "i");
                    return regex.test(filename);
                }
                // Check if pattern is a regex (enclosed in regex:)
                if (pattern.startsWith("regex:")) {
                    // Extract regex pattern without regex:
                    const regexPattern = pattern.slice(6);
                    const regex = new RegExp(regexPattern, "i");
                    return regex.test(filename);
                }
                // Default to glob pattern
                const globPattern = pattern
                    .replace(/\./g, "\\.")
                    .replace(/\*/g, ".*")
                    .replace(/\?/g, ".");
                const regex = new RegExp(`^${globPattern}$`, "i");
                return regex.test(filename);
            } catch (e) {
                console.error(`Invalid pattern: ${pattern}`, e);
                return false;
            }
        });
    }

    async processSubfolderVariables(
        template: string,
        file: File,
        activeFile: TFile,
        namingSession?: NamingEvaluationSession
    ): Promise<string> {
        const session = namingSession ?? this.variableProcessor.createSession({
            file,
            activeFile
        });
        let result = await session.evaluate(
            template,
            {
                counterScope: activeFile.parent?.path ?? "/"
            }
        );

        // Clean up the path
        result = result.normalize("NFC").replace(/\\/g, "/");
        result = result.replace(/\/+/g, "/");
        result = result.replace(/^\/+|\/+$/g, "");
        const segments = result.split("/");
        if (segments.some(segment => !segment || segment === "." || segment === "..")) {
            throw new Error("Folder template resolved to an unsafe path.");
        }
        result = segments
            .map(segment => {
                const sanitized = this.sanitizeFilename(segment);
                if (!sanitized) {
                    throw new Error("Folder template resolved to an empty path segment.");
                }
                return sanitized;
            })
            .join("/");

        return normalizePath(result);
    }

    /**
     * Performs a safe rename operation for a file, especially useful for case-only changes 
     * on case-insensitive file systems. It uses a temporary intermediate rename to ensure 
     * the file system properly updates the file's name and path.
     *
     * @param file - The TFile object representing the file to rename.
     * @param newPath - The new path (including filename) for the file.
     * @returns A Promise that resolves to true if the rename was successful, false otherwise.
     */
    async safeRenameFile(file: TFile, newPath: string): Promise<boolean> {
        return FolderAndFilenameManagement.renameLock.acquire(
            "image-assistant-rename",
            () => this.safeRenameFileUnlocked(file, newPath)
        );
    }

    private async safeRenameFileUnlocked(
        file: TFile,
        newPath: string
    ): Promise<boolean> {
        const originalPath = file.path;
        const basePath = path.dirname(newPath);
        const newName = path.basename(newPath);
        const tempPath = normalizePath(path.join(
            basePath,
            buildTemporaryRenameFilename(newName)
        ));
        let tempFile: TFile | null = null;

        try {
            await this.app.fileManager.renameFile(file, tempPath);
            const resolvedTempFile = this.app.vault.getAbstractFileByPath(tempPath);
            tempFile = resolvedTempFile instanceof TFile
                ? resolvedTempFile
                : file.path === tempPath ? file : null;
            if (!tempFile) {
                throw new Error(`Temporary file not found after renaming to ${tempPath}`);
            }

            await this.app.fileManager.renameFile(tempFile, newPath);
            return true;
        } catch (error) {
            console.error('Error during safe rename:', error);
            const rollbackFile = tempFile
                ?? (this.app.vault.getAbstractFileByPath(tempPath) instanceof TFile
                    ? this.app.vault.getAbstractFileByPath(tempPath) as TFile
                    : file.path === tempPath ? file : null);
            if (rollbackFile) {
                try {
                    await this.app.fileManager.renameFile(rollbackFile, originalPath);
                } catch (rollbackError) {
                    console.error(`Failed to roll back temporary rename from ${tempPath} to ${originalPath}:`, rollbackError);
                }
            }
            new Notice(`Error renaming file: ${getErrorMessage(error)}`);
            return false;
        }
    }



    /**
     * Creates a binary file with atomic conflict resolution safeguards.
     * @param folderPath Destination folder path
     * @param filename Desired filename (basename + extension)
     * @param data File content
     * @param conflictResolution Resolution mode
     * @returns The created or reused TFile, or null if skipped.
     */
    async createUniqueBinary(
        folderPath: string,
        filename: string, // basename + extension
        data: ArrayBuffer,
        conflictResolution: "reuse" | "increment" | "skip" | "overwrite" = "increment"
    ): Promise<TFile | null> {
        return (await this.createUniqueBinaryDetailed(
            folderPath,
            filename,
            data,
            conflictResolution
        )).file;
    }

    async createUniqueBinaryDetailed(
        folderPath: string,
        filename: string,
        data: ArrayBuffer,
        conflictResolution: "reuse" | "increment" | "skip" | "overwrite" = "increment",
        options: { capturePreviousData?: boolean } = {}
    ): Promise<BinaryWriteResult> {
        const folder = normalizeVaultFolderPath(folderPath);
        assertSafeVaultFilename(filename);
        return FolderAndFilenameManagement.binaryWriteLock.acquire(
            // Incremented candidates from different requested names can overlap
            // (for example image.png -> image-1.png versus a direct image-1.png
            // request). Serialize planning and commit per destination folder.
            `binary-write-folder:${folder.toLowerCase()}`,
            () => this.createUniqueBinaryDetailedUnlocked(
                folder,
                filename,
                data,
                conflictResolution,
                options
            )
        );
    }

    private async createUniqueBinaryDetailedUnlocked(
        folderPath: string,
        filename: string,
        data: ArrayBuffer,
        conflictResolution: "reuse" | "increment" | "skip" | "overwrite",
        options: { capturePreviousData?: boolean }
    ): Promise<BinaryWriteResult> {
        const folder = normalizeVaultFolderPath(folderPath);
        const lastDotIndex = filename.lastIndexOf(".");
        const baseName = lastDotIndex > 0
            ? filename.slice(0, lastDotIndex)
            : filename;
        const extension = lastDotIndex > 0
            ? filename.slice(lastDotIndex)
            : "";
        let currentFilename = filename;
        let incrementCounter = 1;
        let attempt = 0;
        const maxAttempts = 50;

        while (attempt < maxAttempts) {
            const fullPath = this.combinePath(folder, currentFilename);
            const existing = this.app.vault.getAbstractFileByPath(fullPath);

            if (existing) {
                if (conflictResolution === 'skip') {
                    return { file: null, disposition: "skipped" };
                }
                if (conflictResolution === 'reuse') {
                    if (existing instanceof TFile) return { file: existing, disposition: "reused" };
                    conflictResolution = "increment";
                }
                if (conflictResolution === 'overwrite') {
                    if (existing instanceof TFile) {
                        const previousData = options.capturePreviousData
                            ? await this.app.vault.readBinary(existing)
                            : undefined;
                        await this.app.vault.modifyBinary(existing, data);
                        return { file: existing, disposition: "overwritten", previousData };
                    }
                    conflictResolution = 'increment';
                }
            }

            // For 'increment' mode or if we are ready to try creation
            if (existing && conflictResolution === 'increment') {
                currentFilename = buildIncrementedFilename(
                    baseName,
                    extension,
                    incrementCounter++
                );
                attempt++;
                continue;
            }

            // Try to create
            try {
                return {
                    file: await this.app.vault.createBinary(fullPath, data),
                    disposition: "created"
                };
            } catch (error) {
                // Check for "file already exists" error
                if (getErrorMessage(error).toLowerCase().includes("file already exists")) {
                    // Race condition occurred
                    if (conflictResolution === 'increment') {
                        currentFilename = buildIncrementedFilename(
                            baseName,
                            extension,
                            incrementCounter++
                        );
                    }
                    attempt++;
                    continue;
                }
                throw error;
            }
        }

        throw new Error(`Failed to create unique binary '${filename}' after ${maxAttempts} attempts.`);
    }

}

export type BinaryWriteDisposition = "created" | "reused" | "overwritten" | "skipped";

export interface BinaryWriteResult {
    file: TFile | null;
    disposition: BinaryWriteDisposition;
    previousData?: ArrayBuffer;
}

const WINDOWS_RESERVED_NAMES = new Set([
    "CON", "PRN", "AUX", "NUL",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9"
]);

function sanitizeVaultNamePart(value: string): string {
    return Array.from(value)
        .map(character => {
            const code = character.charCodeAt(0);
            return code <= 0x1f || code === 0x7f ? "_" : character;
        })
        .join("")
        .replace(/[\\/:"*?<>|]/g, "_")
        .replace(/^[ .]+|[ .]+$/g, "");
}

function utf8Length(value: string): number {
    return new TextEncoder().encode(value).byteLength;
}

function truncateUtf8(value: string, maxBytes: number): string {
    if (utf8Length(value) <= maxBytes) return value;
    let result = "";
    for (const character of value) {
        if (utf8Length(result + character) > maxBytes) break;
        result += character;
    }
    return result;
}

function buildIncrementedFilename(
    base: string,
    extension: string,
    counter: number
): string {
    const suffix = `-${counter}`;
    const reservedBytes = utf8Length(suffix + extension);
    const fittedBase = truncateUtf8(base, Math.max(1, 240 - reservedBytes))
        .replace(/[ .]+$/g, "");
    return `${fittedBase}${suffix}${extension}`;
}

function buildTemporaryRenameFilename(filename: string): string {
    const lastDot = filename.lastIndexOf(".");
    const extension = lastDot > 0 ? filename.slice(lastDot) : "";
    const stem = lastDot > 0 ? filename.slice(0, lastDot) : filename;
    const prefix = createUniqueOperationId(".image-assistant-rename-");
    const availableBytes = Math.max(1, 240 - utf8Length(prefix + extension));
    const fittedStem = truncateUtf8(stem, availableBytes)
        .replace(/[ .]+$/g, "") || "image";
    return `${prefix}${fittedStem}${extension}`;
}
