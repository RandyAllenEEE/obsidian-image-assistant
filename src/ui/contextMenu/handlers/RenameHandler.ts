import { App, Menu, Notice, TFile, normalizePath } from 'obsidian';
import * as path from 'path';
import { t } from '../../../lang/helpers';
import ImageConverterPlugin from '../../../main';
import { FolderAndFilenameManagement } from '../../../local/FolderAndFilenameManagement';
import { VariableProcessor, VariableContext } from '../../../local/VariableProcessor';
import { normalizeVaultFolderPath } from '../../../utils/VaultPathUtils';

/**
 * Handles image rename/move operations and caption/dimension updates
 */
export class RenameHandler {
    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private folderManagement: FolderAndFilenameManagement,
        private variableProcessor: VariableProcessor
    ) { }

    /**
     * Handles the renaming and moving of the image.
     * @param menu - The Menu object.
     * @param nameInput - The HTMLInputElement for the new name.
     * @param pathInput - The HTMLInputElement for the new path.
     * @param img - The HTMLImageElement to rename/move.
     * @param isImageResolvable - Boolean indicating if the image path can be resolved.
     * @param fileNameWithoutExt - The current file name without extension.
     * @param fileExtension - The file extension.
     * @param obsidianVaultPathForRename - The original path of the image in the Obsidian vault.
     * @param file - The TFile or File object.
     * @param activeFile - The active TFile.
     */
    async handleRenameAndMove(
        menu: Menu,
        nameInput: HTMLInputElement,
        pathInput: HTMLInputElement,
        img: HTMLImageElement,
        isImageResolvable: boolean,
        fileNameWithoutExt: string,
        fileExtension: string,
        obsidianVaultPathForRename: string | undefined,
        file: TFile | File,
        activeFile: TFile
    ) {
        if (!isImageResolvable) return;
        let newName = nameInput.value;
        let newDirectoryPath = pathInput.value;

        // --- Process variables in the input fields ---
        const variableContext: VariableContext = { file, activeFile };
        newName = await this.variableProcessor.processTemplate(newName, variableContext);
        newDirectoryPath = await this.variableProcessor.processTemplate(newDirectoryPath, variableContext);

        if (!newName.trim()) {
            new Notice(t("MSG_ENTER_NEW_NAME"));
            return;
        }

        newName = this.folderManagement.sanitizeFilename(newName);

        if (!newName.trim() || /^[.]+$/.test(newName.trim())) {
            new Notice(t("MSG_ENTER_VALID_NAME"));
            return;
        }
        if (!newDirectoryPath.trim()) {
            new Notice(t("MSG_ENTER_NEW_PATH"));
            return;
        }

        if (obsidianVaultPathForRename) {
            try {
                const oldPath = obsidianVaultPathForRename;
                const newPath = this.buildVaultPath(newDirectoryPath, `${newName}${fileExtension}`);

                if (newPath !== oldPath) {
                    const abstractFile = this.app.vault.getAbstractFileByPath(oldPath);
                    if (abstractFile instanceof TFile) {
                        await this.ensureTargetFolder(newDirectoryPath);

                        if (oldPath.toLowerCase() === newPath.toLowerCase()) {
                            const safeRenameSuccessful = await this.folderManagement.safeRenameFile(abstractFile, newPath);
                            if (safeRenameSuccessful) {
                                new Notice(t("MSG_PATH_UPDATED_CASE"));
                            } else {
                                new Notice(t("MSG_PATH_UPDATE_FAILED_CASE"));
                            }
                        } else {
                            await this.app.fileManager.renameFile(abstractFile, newPath);
                            new Notice(newName !== fileNameWithoutExt ? t("MSG_NAME_UPDATED") : t("MSG_PATH_UPDATED"));
                        }

                        await this.refreshImageAndView(img, abstractFile);
                    }
                }
            } catch (error) {
                console.error('Failed to update image path:', error);
                new Notice(t("MSG_PATH_UPDATE_FAILED"));
            }
        }
        menu.hide();
    }

    private buildVaultPath(directoryPath: string, filename: string): string {
        const normalizedDirectory = normalizeVaultFolderPath(directoryPath);
        const joined = normalizedDirectory === '/' || normalizedDirectory === ''
            ? filename
            : path.join(normalizedDirectory, filename);
        return normalizePath(joined).replace(/^\/+/, '');
    }

    private async ensureTargetFolder(directoryPath: string): Promise<void> {
        const normalizedDirectory = normalizeVaultFolderPath(directoryPath);
        if (normalizedDirectory && normalizedDirectory !== '/') {
            await this.folderManagement.ensureFolderExists(normalizedDirectory);
        }
    }

    private async refreshImageAndView(img: HTMLImageElement, file: TFile): Promise<void> {
        try {
            const getResourcePath = this.app.vault.getResourcePath;
            if (typeof getResourcePath === 'function') {
                img.src = getResourcePath.call(this.app.vault, file);
            }
        } catch (error) {
            console.warn("Image was renamed, but its resource URL could not be refreshed:", error);
        }

        const leaf = this.app.workspace.getMostRecentLeaf();
        if (!leaf) {
            this.plugin.imageStateManager?.refreshAllImages?.();
            return;
        }

        const currentState = leaf.getViewState();
        let restoreNeeded = false;
        try {
            await leaf.setViewState({ type: 'empty', state: {} });
            restoreNeeded = true;
            await leaf.setViewState(currentState);
            restoreNeeded = false;
        } catch (error) {
            console.warn("Image was renamed, but the active note could not be refreshed:", error);
            if (restoreNeeded) {
                try {
                    await leaf.setViewState(currentState);
                } catch (restoreError) {
                    console.error("Failed to restore the active note after renaming an image:", restoreError);
                }
            }
        } finally {
            this.plugin.imageStateManager?.refreshAllImages?.();
        }
    }

    /**
     * Handles updating image dimensions and caption.
     * @param menu - The Menu object.
     * @param captionInput - The HTMLInputElement for caption.
     * @param widthInput - The HTMLInputElement for width.
     * @param heightInput - The HTMLInputElement for height.
     * @param align - The alignment string.
     * @param img - The HTMLImageElement.
     * @param activeFile - The active TFile.
     * @param isResolvableOrNetwork - Whether the image is resolvable or network image.
     */
    async handleDimensionsAndCaptionUpdate(
        menu: Menu,
        captionInput: HTMLInputElement,
        widthInput: HTMLInputElement,
        heightInput: HTMLInputElement,
        align: string,
        img: HTMLImageElement,
        activeFile: TFile,
        isResolvableOrNetwork: boolean
    ) {
        const newCaption = captionInput.value.trim();
        const widthStr = widthInput.value.trim();
        const heightStr = heightInput.value.trim();

        // Validate dimensions
        if ((widthStr && !(/^\d+$/.test(widthStr))) || (heightStr && !(/^\d+$/.test(heightStr)))) {
            new Notice(t("MSG_DIMENSIONS_POSITIVE"));
            return;
        }

        if (this.plugin.imageStateManager) {
            await this.plugin.imageStateManager.updateState(img, {
                caption: newCaption,
                width: widthStr ? parseInt(widthStr) : null,
                height: heightStr ? parseInt(heightStr) : null,
                align: align as any
            });
            new Notice(t("MSG_CAPTION_UPDATED"));
        }

        menu.hide();
    }
}
