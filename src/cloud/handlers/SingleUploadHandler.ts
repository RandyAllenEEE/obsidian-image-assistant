import { App, Notice, TFile, normalizePath, FileSystemAdapter } from "obsidian";
import { join } from "path-browserify";
import ImageConverterPlugin from "../../main";
import { UploaderManager } from "../uploader/index";
import { CloudLinkFormatter } from "../CloudLinkFormatter";
import { t } from "../../lang/helpers";
import { CloudImageDeleter } from "../CloudImageDeleter";
import {
    UploadErrorDialog,
    NoReferenceUploadDialog,
    SingleReferenceUploadDialog,
    MultiReferenceUploadDialog,
    ImageMatchResult,
    ImageMatch
} from "../../ui/modals/UploadModals";

export class SingleUploadHandler {
    constructor(
        private app: App,
        private plugin: ImageConverterPlugin
    ) { }

    // Public method for Context Menu usage
    async uploadSingleFile(file: TFile): Promise<void> {
        if (file.path.startsWith('http://') || file.path.startsWith('https://')) {
            new Notice('⚠️ 不能上传网络图片，请只上传本地图片文件');
            return;
        }

        const uploadResult = await this.uploadWithRetry(file);
        if (!uploadResult) return;
        const { cloudUrl } = uploadResult;
        new Notice(`上传成功: ${cloudUrl}`);

        const references = await this.plugin.vaultReferenceManager.getFilesReferencingImage(file.path);

        const matches: ImageMatchResult = { totalCount: references.length, files: [] };
        const fileGroups = new Map<string, ImageMatch[]>();
        for (const ref of references) {
            if (!fileGroups.has(ref.file.path)) fileGroups.set(ref.file.path, []);
            fileGroups.get(ref.file.path)?.push({ lineNumber: 0, line: ref.original, original: ref.original });
        }
        for (const [path, matchItems] of fileGroups.entries()) matches.files.push({ path: path, matches: matchItems });

        if (matches.totalCount > 0) {
            const currentNote = this.app.workspace.getActiveFile();
            const currentNotePath = currentNote ? currentNote.path : undefined;
            if (matches.totalCount === 1) {
                const match = matches.files[0];
                new SingleReferenceUploadDialog(this.app, file.name, cloudUrl, { file: match.path, line: match.matches[0].lineNumber }, (choice) => {
                    if (choice === 'replace') this.updateLinksWithManager(file.path, cloudUrl);
                    else if (choice === 'replace-delete') this.updateLinksWithManager(file.path, cloudUrl).then(() => this.app.vault.trash(file, true));
                    else if (choice === 'undo') this.deleteCloudImage(cloudUrl);
                }).open();
            } else {
                new MultiReferenceUploadDialog(this.app, file.name, cloudUrl, matches, currentNotePath, (choice) => {
                    if (choice === 'replace-current') this.updateLinksWithManager(file.path, cloudUrl, currentNotePath ? [currentNotePath] : undefined);
                    else if (choice === 'replace-all') this.updateLinksWithManager(file.path, cloudUrl);
                    else if (choice === 'replace-all-delete') this.updateLinksWithManager(file.path, cloudUrl).then(() => this.app.vault.trash(file, true));
                }).open();
            }
        } else {
            new NoReferenceUploadDialog(this.app, file.name, cloudUrl, file, (choice) => {
                if (choice === 'delete-all') { this.deleteCloudImage(cloudUrl); this.app.vault.trash(file, true); }
                else if (choice === 'keep-cloud') this.app.vault.trash(file, true);
            }).open();
        }
    }

    private async uploadWithRetry(file: TFile): Promise<{ cloudUrl: string } | null> {
        let retryCount = 0;
        const maxRetries = 3;
        while (retryCount < maxRetries) {
            try {
                new Notice(`正在上传 ${file.name}...`);
                if (!await this.validateFileExists(file)) throw new Error('文件不存在');

                const uploaderManager = new UploaderManager(this.plugin.settings.pasteHandling.cloud.uploader, this.plugin);
                const uploadPath = this.buildUploadPath(file);
                const uploadResult = await uploaderManager.upload([uploadPath]);
                return { cloudUrl: uploadResult.result[0] };
            } catch (error) {
                retryCount++;
                if (retryCount >= maxRetries) {
                    const retry = await new Promise<boolean>((resolve) => {
                        new UploadErrorDialog(this.app, file.name, error.message, (choice) => resolve(choice === 'retry')).open();
                    });
                    if (retry) retryCount = 0; else return null;
                } else {
                    new Notice(`上传失败,正在重试... (${retryCount}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }
        }
        return null;
    }

    private buildUploadPath(file: TFile): string {
        if (this.plugin.settings.pasteHandling.cloud.remoteServerMode) return file.path;
        const basePath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
        return normalizePath(join(basePath, file.path));
    }

    private async validateFileExists(file: TFile): Promise<boolean> {
        return await this.app.vault.adapter.exists(file.path);
    }

    private async updateLinksWithManager(imagePath: string, cloudUrl: string, scopeFiles?: string[]): Promise<number> {
        const count = await this.plugin.vaultReferenceManager.updateReferences(imagePath, (loc) => {
            if (scopeFiles && !scopeFiles.includes(loc.file.path)) return loc.original;
            return CloudLinkFormatter.formatCloudLink(cloudUrl, this.plugin.settings.pasteHandling.cloud, loc.original);
        });
        if (this.plugin.settings.captions.enabled) this.plugin.imageStateManager?.refreshAllImages();
        return count;
    }

    private async deleteCloudImage(cloudUrl: string): Promise<void> {
        if (this.plugin.settings.pasteHandling.cloud.uploader !== 'PicList') {
            new Notice(t("MSG_DELETE_NOT_SUPPORTED")); return;
        }
        try {
            new Notice(t("MSG_DELETING_CLOUD"));
            const deleter = new CloudImageDeleter(this.plugin);
            const success = await deleter.deleteImage({ url: cloudUrl });
            if (success) new Notice(t("MSG_DELETE_CLOUD_SUCCESS"));
            else new Notice(t("MSG_DELETE_CLOUD_FAILED"));
        } catch (error) {
            new Notice(t("MSG_DELETE_CLOUD_ERROR", [error.message]));
        }
    }
}
