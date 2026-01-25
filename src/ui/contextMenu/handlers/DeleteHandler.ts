import { App, Editor, MarkdownView, Notice, TFile, Modal } from 'obsidian';
import { t } from '../../../lang/helpers';
import ImageConverterPlugin from '../../../main';
import { FolderAndFilenameManagement } from '../../../local/FolderAndFilenameManagement';
import { CloudImageDeleter } from '../../../cloud/CloudImageDeleter';
import { ImageMatchFinder } from '../utils/ImageMatchFinder';
import { EditorLinkRemover } from '../utils/EditorLinkRemover';
import { ConfirmDialog } from '../../../settings/SettingsModals';
import { ImageMatch } from '../types';

/**
 * Handles image deletion operations (both local and cloud)
 */
export class DeleteHandler {
    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private folderManagement: FolderAndFilenameManagement,
        private imageMatchFinder: ImageMatchFinder,
        private linkRemover: EditorLinkRemover,
        private cloudDeleter: CloudImageDeleter
    ) { }

    /**
     * Deletes both the image file and its link from the note.
     * Auto-detects whether it's a local or cloud image and handles accordingly.
     * - Local images: Deletes text link and local file
     * - Cloud images: Deletes text link and cloud image (PicList only)
     * @param event - The MouseEvent object.
     */
    async deleteImageAndLink(event: MouseEvent) {
        const img = event.target as HTMLImageElement;
        const src = img.getAttribute('src');
        if (!src) return;

        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) {
            new Notice(t("MSG_NO_ACTIVE_VIEW"));
            return;
        }

        try {
            const { editor } = activeView;

            // Handle Base64 images
            if (src.startsWith('data:image/')) {
                const found = await this.imageMatchFinder.processBase64Image(editor, src, async (editor, lineNumber, line, fullMatch) => {
                    await this.linkRemover.removeImageLink(editor, lineNumber, line, fullMatch, false);
                });
                if (!found) {
                    new Notice(t("MSG_FAIL_FIND_BASE64"));
                }
                return;
            }

            // Check if it's a cloud image
            const isCloudImage = this.cloudDeleter.isCloudImage(src);

            if (isCloudImage) {
                // Handle cloud image deletion
                await this.deleteCloudImageAndLink(editor, src);
                return;
            }

            // Handle local image deletion
            const imagePath = this.folderManagement.getImagePath(img);
            const isExternal = !imagePath;
            const matches = await this.imageMatchFinder.findImageMatches(editor, imagePath, isExternal);

            if (matches.length === 0) {
                new Notice(t("MSG_FAIL_FIND_IMAGE"));
                return;
            }

            // Identify unique matches based on line number, line content, and full match
            const uniqueMatchesMap: Map<string, ImageMatch> = new Map();
            for (const match of matches) {
                const key = `${match.lineNumber}-${match.line}-${match.fullMatch}`; // Create a unique key
                if (!uniqueMatchesMap.has(key)) {
                    uniqueMatchesMap.set(key, match); // Add to map if not already present
                }
            }
            const uniqueMatches: ImageMatch[] = Array.from(uniqueMatchesMap.values());


            if (uniqueMatches.length === 0) {
                new Notice(t("MSG_FAIL_FIND_UNIQUE")); // Should not happen ideally as 'matches.length > 0' check is before, but good to have.
                return;
            }


            const handleConfirmation = async () => {
                // Sort matches by line number in descending order to handle deletions from bottom to top
                // This prevents line number shifting from affecting subsequent deletions
                const sortedMatches = uniqueMatches.sort((matchA, matchB) => matchB.lineNumber - matchA.lineNumber);

                for (const match of sortedMatches) {
                    await this.linkRemover.removeImageLink(editor, match.lineNumber, match.line, match.fullMatch, false);
                }

                new Notice(t("MSG_REMOVED_LINKS"));

                // Delete the actual local image file if it exists in the vault
                if (imagePath) {
                    const imageFile = this.app.vault.getAbstractFileByPath(imagePath);
                    if (imageFile instanceof TFile) {
                        await this.app.vault.trash(imageFile, true);
                        new Notice(t("MSG_TRASHED_FILE"));
                    }
                }
            };

            // Show info in confirmation MODAL if more than 1 UNIQUE image were found
            if (uniqueMatches.length > 1) {
                // Create a DocumentFragment for the details
                const detailsFragment = document.createDocumentFragment();

                // Create a container div for the message within the fragment
                const messageContainer = document.createElement('div');
                detailsFragment.appendChild(messageContainer);

                // Add introductory text
                const introText = document.createElement('p');
                introText.textContent = t("MSG_FOUND_IMAGE_REFS").replace("{0}", uniqueMatches.length.toString()); // Updated message
                messageContainer.appendChild(introText);

                // Add details to the message container
                uniqueMatches.forEach((match, index) => { // Iterate over uniqueMatches
                    const lineNumber = match.lineNumber + 1;
                    const lineContent = match.line.trim();
                    const detailDiv = document.createElement('div');
                    detailDiv.style.marginBottom = '5px'; // Add some spacing between lines
                    detailDiv.innerHTML = `  ${index + 1}. Line ${lineNumber}: ${lineContent}`;
                    messageContainer.appendChild(detailDiv); // Append to messageContainer
                });

                new ConfirmDialog(
                    this.app,
                    t("DIALOG_DELETE_TITLE"),
                    detailsFragment, // Pass the fragment
                    t("BUTTON_DELETE"),
                    handleConfirmation
                ).open();
            } else if (uniqueMatches.length === 1) { // if only 1 unique match, proceed directly without confirmation for multiple
                await handleConfirmation();
            } else {
                // This case should not happen because of the initial check `if (uniqueMatches.length === 0)` but for completeness.
                new Notice(t("MSG_NO_UNIQUE_LINKS"));
            }


        } catch (error) {
            console.error('Error deleting image:', error);
            new Notice(t("MSG_FAIL_DELETE"));
        }
    }

    /**
     * Delete cloud image and its link from the note
     * 删除云端图片及其在笔记中的链接
     * - 单次引用：直接删除
     * - 多次引用：弹出确认框，让用户选择只删除一个还是全部删除
     * @param editor - The Editor instance
     * @param cloudUrl - The cloud image URL
     */
    private async deleteCloudImageAndLink(editor: Editor, cloudUrl: string) {
        try {
            console.log('[Cloud Delete] Starting cloud image deletion for:', cloudUrl);

            // Find all matches of this cloud image in the note
            const matches = await this.imageMatchFinder.findImageMatches(editor, cloudUrl, true);

            if (matches.length === 0) {
                new Notice(t("MSG_FAIL_FIND_CLOUD"));
                return;
            }

            // Remove duplicates
            const uniqueMatchesMap: Map<string, ImageMatch> = new Map();
            for (const match of matches) {
                const key = `${match.lineNumber}-${match.line}-${match.fullMatch}`;
                if (!uniqueMatchesMap.has(key)) {
                    uniqueMatchesMap.set(key, match);
                }
            }
            const uniqueMatches: ImageMatch[] = Array.from(uniqueMatchesMap.values());

            if (uniqueMatches.length === 0) {
                new Notice(t("MSG_FAIL_FIND_UNIQUE"));
                return;
            }

            // 删除单个图片链接和云端文件的函数
            const deleteSingleImage = async (match: ImageMatch) => {
                await this.linkRemover.removeImageLink(editor, match.lineNumber, match.line, match.fullMatch, false);
                new Notice(t("MSG_CLOUD_LINK_REMOVED"));

                // Try to delete from cloud storage (PicList only)
                const cloudDeleteSuccess = await this.cloudDeleter.deleteImage({ url: cloudUrl });

                // Force remove from history to avoid bloat (even if cloud delete failed or not supported)
                await this.plugin.historyManager.removeRecord(cloudUrl);

                if (cloudDeleteSuccess) {
                    new Notice(t("MSG_CLOUD_DELETE_SUCCESS"));
                } else {
                    const uploader = this.plugin.settings.pasteHandling.cloud.uploader;
                    if (uploader === 'PicList') {
                        new Notice(t("MSG_CLOUD_DELETE_FAIL_HISTORY"));
                    } else {
                        new Notice(t("MSG_CLOUD_DELETE_UNSUPPORTED").replace("{0}", uploader));
                    }
                }
            };

            // 删除所有图片链接和云端文件的函数
            const deleteAllImages = async () => {
                // Sort matches by line number in descending order
                const sortedMatches = uniqueMatches.sort((matchA, matchB) => matchB.lineNumber - matchA.lineNumber);

                // Delete all text links from editor
                for (const match of sortedMatches) {
                    await this.linkRemover.removeImageLink(editor, match.lineNumber, match.line, match.fullMatch, false);
                }

                new Notice(t("MSG_REMOVED_CLOUD_LINKS").replace("{0}", uniqueMatches.length.toString()));

                // Try to delete from cloud storage (PicList only)
                const cloudDeleteSuccess = await this.cloudDeleter.deleteImage({ url: cloudUrl });

                // Force remove from history to avoid bloat
                await this.plugin.historyManager.removeRecord(cloudUrl);

                if (cloudDeleteSuccess) {
                    new Notice(t("MSG_CLOUD_DELETED"));
                } else {
                    const uploader = this.plugin.settings.pasteHandling.cloud.uploader;
                    if (uploader === 'PicList') {
                        new Notice(t("MSG_CLOUD_DELETE_FAIL"));
                    } else {
                        new Notice(t("MSG_CLOUD_MANUAL_DELETE").replace("{0}", uploader));
                    }
                }
            };

            // 如果只有一次引用，直接删除
            if (uniqueMatches.length === 1) {
                await deleteSingleImage(uniqueMatches[0]);
            } else {
                // 多次引用，显示确认对话框
                const detailsFragment = document.createDocumentFragment();
                const messageContainer = document.createElement('div');
                detailsFragment.appendChild(messageContainer);

                const introText = document.createElement('p');
                introText.textContent = t("MSG_FOUND_CLOUD_REFS").replace("{0}", uniqueMatches.length.toString());
                messageContainer.appendChild(introText);

                // 列出所有引用位置
                const listTitle = document.createElement('p');
                listTitle.style.fontWeight = 'bold';
                listTitle.style.marginTop = '10px';
                listTitle.textContent = t("LABEL_REFERENCES");
                messageContainer.appendChild(listTitle);

                uniqueMatches.forEach((match, index) => {
                    const lineNumber = match.lineNumber + 1;
                    const lineContent = match.line.trim();
                    const detailDiv = document.createElement('div');
                    detailDiv.style.marginBottom = '5px';
                    detailDiv.style.fontSize = '0.9em';
                    detailDiv.innerHTML = `  ${index + 1}. Line ${lineNumber}: ${lineContent.substring(0, 60)}${lineContent.length > 60 ? '...' : ''}`;
                    messageContainer.appendChild(detailDiv);
                });

                // 创建自定义确认对话框，带有两个按钮
                const modal = new Modal(this.app);
                modal.titleEl.setText(t("DIALOG_DELETE_CLOUD_TITLE"));
                modal.contentEl.empty();
                modal.contentEl.appendChild(detailsFragment);

                // 按钮容器
                const buttonContainer = modal.contentEl.createDiv({ cls: 'modal-button-container' });
                buttonContainer.style.display = 'flex';
                buttonContainer.style.justifyContent = 'flex-end';
                buttonContainer.style.gap = '10px';
                buttonContainer.style.marginTop = '20px';

                // "Delete Only This One" 按钮
                const deleteOneBtn = buttonContainer.createEl('button', { text: t("BUTTON_DELETE_ONE") });
                deleteOneBtn.addEventListener('click', async () => {
                    modal.close();
                    await deleteSingleImage(uniqueMatches[0]); // 删除第一个匹配（用户点击的）
                });

                // "Delete All" 按钮
                const deleteAllBtn = buttonContainer.createEl('button', { text: t("BUTTON_DELETE_ALL").replace("{0}", uniqueMatches.length.toString()), cls: 'mod-warning' });
                deleteAllBtn.addEventListener('click', async () => {
                    modal.close();
                    await deleteAllImages();
                });

                // "Cancel" 按钮
                const cancelBtn = buttonContainer.createEl('button', { text: t("BUTTON_CANCEL") });
                cancelBtn.addEventListener('click', () => {
                    modal.close();
                });

                modal.open();
            }

        } catch (error) {
            console.error('[Cloud Delete] Error deleting cloud image:', error);
            new Notice(t("MSG_FAIL_DELETE_CLOUD"));
        }
    }
}
