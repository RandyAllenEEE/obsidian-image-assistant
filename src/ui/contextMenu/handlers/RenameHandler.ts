import { App, Menu, Notice, TFile, normalizePath } from 'obsidian';
import * as path from 'path';
import { t } from '../../../lang/helpers';
import ImageConverterPlugin from '../../../main';
import { FolderAndFilenameManagement } from '../../../local/FolderAndFilenameManagement';
import { VariableProcessor, VariableContext } from '../../../local/VariableProcessor';

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

        if (/^[.]+$/.test(newName.trim())) {
            new Notice(t("MSG_ENTER_VALID_NAME"));
            return;
        }
        if (!newDirectoryPath.trim()) {
            new Notice(t("MSG_ENTER_NEW_PATH"));
            return;
        }

        if (obsidianVaultPathForRename) {
            try {
                // Handle Rename
                if (newName && newName !== fileNameWithoutExt) {
                    const newPath = normalizePath(path.join(newDirectoryPath, `${newName}${fileExtension}`));
                    const abstractFile = this.app.vault.getAbstractFileByPath(obsidianVaultPathForRename);
                    if (abstractFile instanceof TFile) {
                        await this.folderManagement.ensureFolderExists(newDirectoryPath);
                        await this.app.fileManager.renameFile(abstractFile, newPath);
                        img.src = this.app.vault.getResourcePath(abstractFile);
                        new Notice(t("MSG_NAME_UPDATED"));
                    }
                }
                // Handle Move
                const currentNameWithExtension = `${newName}${fileExtension}`;
                const oldPath = obsidianVaultPathForRename;
                const newPath = normalizePath(path.join(newDirectoryPath, currentNameWithExtension));

                if (newPath !== oldPath) {
                    const abstractFile = this.app.vault.getAbstractFileByPath(oldPath);
                    if (abstractFile instanceof TFile) {
                        await this.folderManagement.ensureFolderExists(newDirectoryPath);

                        if (oldPath.toLowerCase() === newPath.toLowerCase()) {
                            const safeRenameSuccessful = await this.folderManagement.safeRenameFile(abstractFile, newPath);
                            if (safeRenameSuccessful) {
                                new Notice(t("MSG_PATH_UPDATED_CASE"));
                            } else {
                                new Notice(t("MSG_PATH_UPDATE_FAILED_CASE"));
                            }
                        } else {
                            await this.app.fileManager.renameFile(abstractFile, newPath);
                            new Notice(t("MSG_PATH_UPDATED"));
                        }
                        img.src = this.app.vault.getResourcePath(abstractFile);
                        const leaf = this.app.workspace.getMostRecentLeaf();
                        if (leaf) {
                            const currentState = leaf.getViewState();
                            await leaf.setViewState({ type: 'empty', state: {} });
                            await leaf.setViewState(currentState);
                        }
                    }
                }
            } catch (error) {
                console.error('Failed to update image path:', error);
                new Notice(t("MSG_PATH_UPDATE_FAILED"));
            }
        }
        menu.hide();
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
                width: widthStr ? parseInt(widthStr) : undefined,
                height: heightStr ? parseInt(heightStr) : undefined,
                align: align as any
            });
            new Notice(t("MSG_CAPTION_UPDATED"));
        }

        menu.hide();
    }
}
