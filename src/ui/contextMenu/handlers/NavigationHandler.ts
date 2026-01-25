import { App, Notice, TFile } from 'obsidian';
import { t } from '../../../lang/helpers';
import { FolderAndFilenameManagement } from '../../../local/FolderAndFilenameManagement';

/**
 * Handles navigation operations (show in navigation/explorer)
 */
export class NavigationHandler {
    constructor(
        private app: App,
        private folderManagement: FolderAndFilenameManagement
    ) { }

    /**
     * Shows the image file in the navigation pane.
     * @param img - The HTMLImageElement whose file needs to be shown.
     */
    async showImageInNavigation(img: HTMLImageElement) {
        try {
            const imagePath = this.folderManagement.getImagePath(img);
            if (imagePath) {
                const file = this.app.vault.getAbstractFileByPath(imagePath);
                if (file instanceof TFile) {
                    // First, try to get existing file explorer
                    let [fileExplorerLeaf] = this.app.workspace.getLeavesOfType('file-explorer');

                    // If file explorer isn't open, create it
                    if (!fileExplorerLeaf) {
                        const newLeaf = this.app.workspace.getLeftLeaf(false);
                        if (newLeaf) {
                            await newLeaf.setViewState({
                                type: 'file-explorer'
                            });
                            fileExplorerLeaf = newLeaf;
                        }
                    }

                    // Proceed only if we have a valid leaf
                    if (fileExplorerLeaf) {
                        // Ensure the left sidebar is expanded
                        if (this.app.workspace.leftSplit) {
                            this.app.workspace.leftSplit.expand();
                        }

                        // Now reveal the file
                        const fileExplorerView = fileExplorerLeaf.view;
                        if (fileExplorerView) {
                            // @ts-ignore (since revealInFolder is not in the type definitions)
                            fileExplorerView.revealInFolder(file);
                        }
                    }
                }
            }
        } catch (error) {
            new Notice(t("MSG_FAIL_SHOW_NAV"));
            console.error(error);
        }
    }

    /**
     * Shows the image file in the system explorer.
     * @param img - The HTMLImageElement whose file needs to be shown in the system explorer.
     */
    async showImageInSystemExplorer(img: HTMLImageElement) {
        try {
            const imagePath = this.folderManagement.getImagePath(img);
            if (imagePath) {
                // Use the Obsidian API to reveal the file in the system explorer
                await this.app.showInFolder(imagePath);
            }
        } catch (error) {
            new Notice(t("MSG_FAIL_SHOW_EXPLORER"));
            console.error(error);
        }
    }
}
