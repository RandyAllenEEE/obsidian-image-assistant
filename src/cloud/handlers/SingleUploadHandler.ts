import { App, Notice, TFile } from "obsidian";
import ImageConverterPlugin from "../../main";
import { UploaderManager } from "../uploader/index";
import { t } from "../../lang/helpers";
import { ImageLinkPathReplacer } from "../../utils/ImageLinkPathReplacer";
import { CloudImageDeleter } from "../CloudImageDeleter";
import {
    UploadErrorDialog,
    NoReferenceUploadDialog,
    SingleReferenceUploadDialog,
    MultiReferenceUploadDialog,
    ImageMatchResult,
    ImageMatch
} from "../../ui/modals/UploadModals";
import { ReferenceSafetyService } from "../../utils/ReferenceSafetyService";
import { getErrorMessage } from "../../utils/ErrorUtils";
import { isHttpUrl } from "../../utils/NetworkPolicy";
import {
    getCanvasFileReferenceIndexDetailed,
    replaceCanvasFileReferencesWithUrl
} from "../../utils/CanvasReferenceUtils";

export class SingleUploadHandler {
    constructor(
        private app: App,
        private plugin: ImageConverterPlugin
    ) { }

    // Public method for Context Menu usage
    async uploadSingleFile(file: TFile): Promise<void> {
        if (isHttpUrl(file.path)) {
            new Notice('⚠️ 不能上传网络图片，请只上传本地图片文件');
            return;
        }

        const uploadResult = await this.uploadWithRetry(file);
        if (!uploadResult) return;
        const { cloudUrl } = uploadResult;
        new Notice(`上传成功: ${cloudUrl}`);

        const referenceScan = await this.plugin.vaultReferenceManager.scanReferencesDetailed(file.path);
        const canvasScan = await getCanvasFileReferenceIndexDetailed(this.app, [file], this.getCanvasScanOptions());
        if (!referenceScan.complete || !canvasScan.complete) {
            const uncertain = [...referenceScan.uncertainFiles, ...canvasScan.uncertainFiles];
            new Notice(`Upload succeeded, but references could not be scanned completely. Local and cloud files were kept. Uncertain: ${uncertain.join(", ")}`);
            return;
        }
        const references = referenceScan.locations;
        const canvasReferences = canvasScan.references.get(file.path) ?? [];

        const matches: ImageMatchResult = {
            totalCount: references.length + canvasReferences.length,
            files: []
        };
        const fileGroups = new Map<string, ImageMatch[]>();
        for (const ref of references) {
            if (!fileGroups.has(ref.file.path)) fileGroups.set(ref.file.path, []);
            fileGroups.get(ref.file.path)?.push({
                lineNumber: ref.line + 1,
                line: ref.original,
                original: ref.original
            });
        }
        for (const ref of canvasReferences) {
            if (!fileGroups.has(ref.canvasFile.path)) fileGroups.set(ref.canvasFile.path, []);
            fileGroups.get(ref.canvasFile.path)?.push({
                lineNumber: ref.lineNumber,
                line: `Canvas reference: ${ref.nodeFile}`,
                original: ref.nodeFile
            });
        }
        for (const [path, matchItems] of fileGroups.entries()) matches.files.push({ path: path, matches: matchItems });

        if (matches.totalCount > 0) {
            const currentNote = this.app.workspace.getActiveFile();
            const currentNotePath = currentNote ? currentNote.path : undefined;
            if (matches.totalCount === 1) {
                const match = matches.files[0];
                new SingleReferenceUploadDialog(this.app, file.name, cloudUrl, { file: match.path, line: match.matches[0].lineNumber }, (choice) => {
                    if (choice === 'replace') this.runDialogAction(() => this.updateLinksWithManager(file.path, cloudUrl));
                    else if (choice === 'replace-delete') this.runDialogAction(() => this.replaceAllLinksAndDelete(file, cloudUrl));
                    else if (choice === 'undo') this.runDialogAction(() => this.deleteCloudImage(cloudUrl));
                }).open();
            } else {
                new MultiReferenceUploadDialog(this.app, file.name, cloudUrl, matches, currentNotePath, (choice) => {
                    if (choice === 'replace-current') {
                        this.runDialogAction(() => this.updateLinksWithManager(file.path, cloudUrl, currentNotePath ? [currentNotePath] : undefined));
                    } else if (choice === 'replace-all') {
                        this.runDialogAction(() => this.updateLinksWithManager(file.path, cloudUrl));
                    } else if (choice === 'replace-all-delete') {
                        this.runDialogAction(() => this.replaceAllLinksAndDelete(file, cloudUrl));
                    }
                }).open();
            }
        } else {
            new NoReferenceUploadDialog(this.app, file.name, cloudUrl, file, (choice) => {
                void this.handleNoReferenceChoice(choice, file, cloudUrl).catch(error => {
                    console.error("Failed to complete the no-reference upload action:", error);
                    new Notice(error instanceof Error ? error.message : String(error));
                });
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
                const uploadResult = await uploaderManager.upload([{
                    path: file.path,
                    name: file.name,
                    source: file.path,
                    file,
                }]);
                const cloudUrl = uploadResult.success && typeof uploadResult.result?.[0] === "string"
                    ? uploadResult.result[0].trim()
                    : "";
                if (!cloudUrl) throw new Error(uploadResult.msg || "Upload returned no URL");
                return { cloudUrl };
            } catch (error) {
                retryCount++;
                if (retryCount >= maxRetries) {
                    const retry = await new Promise<boolean>((resolve) => {
                        new UploadErrorDialog(this.app, file.name, getErrorMessage(error), (choice) => resolve(choice === 'retry')).open();
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

    private async validateFileExists(file: TFile): Promise<boolean> {
        return await this.app.vault.adapter.exists(file.path);
    }

    private async updateLinksWithManager(imagePath: string, cloudUrl: string, scopeFiles?: string[]): Promise<number> {
        const imageFile = this.app.vault.getAbstractFileByPath(imagePath);
        if (!(imageFile instanceof TFile)) return 0;

        const allowedPaths = scopeFiles ? new Set(scopeFiles) : undefined;
        const scan = await this.plugin.vaultReferenceManager.scanReferencesDetailed(imagePath);
        const locations = allowedPaths
            ? scan.locations.filter(location => allowedPaths.has(location.file.path))
            : scan.locations;
        const markdownResult = await this.plugin.vaultReferenceManager.updateReferenceLocationsDetailed(
            locations,
            loc => ImageLinkPathReplacer.replacePath(loc.original, cloudUrl)
        );
        const canvasResult = await replaceCanvasFileReferencesWithUrl(
            this.app,
            imageFile,
            cloudUrl,
            { allowedCanvasPaths: allowedPaths, ...this.getCanvasScanOptions() }
        );
        const count = markdownResult.replaced + canvasResult.replaced;
        if (!scan.complete || !markdownResult.complete || !canvasResult.complete) {
            new Notice(`Updated ${count} reference(s), but some references could not be verified or replaced.`);
        }
        if (this.plugin.settings.captions.enabled) this.plugin.imageStateManager?.refreshAllImages();
        return count;
    }

    private async replaceAllLinksAndDelete(file: TFile, cloudUrl: string): Promise<void> {
        const scan = await this.plugin.vaultReferenceManager.scanReferencesDetailed(file.path);
        const canvasScan = await getCanvasFileReferenceIndexDetailed(this.app, [file], this.getCanvasScanOptions());
        if (!scan.complete || !canvasScan.complete) {
            new Notice("Reference scans were incomplete. The local file was kept.");
            return;
        }

        const result = await this.plugin.vaultReferenceManager.updateReferenceLocationsDetailed(
            scan.locations,
            location => ImageLinkPathReplacer.replacePath(location.original, cloudUrl)
        );
        const canvasResult = await replaceCanvasFileReferencesWithUrl(
            this.app,
            file,
            cloudUrl,
            this.getCanvasScanOptions()
        );
        const totalFound = result.found + canvasResult.found;
        const totalReplaced = result.replaced + canvasResult.replaced;
        if (totalReplaced !== totalFound) {
            new Notice(`Updated ${totalReplaced} of ${totalFound} references. The local file was kept.`);
            return;
        }

        if (result.complete === false
            || (result.failedFiles?.length ?? 0) > 0
            || (result.uncertainFiles?.length ?? 0) > 0
            || canvasResult.complete === false
            || canvasResult.failedFiles.length > 0
            || canvasResult.uncertainFiles.length > 0) {
            new Notice(`Reference updates were incomplete. The local file was kept.`);
            return;
        }

        const safety = await new ReferenceSafetyService(this.app, this.plugin.vaultReferenceManager, this.getCanvasScanOptions())
            .inspectLocalFile(file);
        if (!safety.safeToDelete) {
            const reason = safety.complete
                ? `${safety.referenceCount} reference(s) remain`
                : `scan incomplete: ${safety.uncertainFiles.join(", ")}`;
            new Notice(`The local file was kept: ${reason}.`);
            return;
        }

        await this.app.vault.trash(file, true);
        if (this.plugin.settings.captions.enabled) this.plugin.imageStateManager?.refreshAllImages();
    }

    private async handleNoReferenceChoice(
        choice: "keep-cloud" | "delete-all" | "keep-all",
        file: TFile,
        cloudUrl: string
    ): Promise<void> {
        if (choice === "keep-all") return;

        const safetyService = new ReferenceSafetyService(this.app, this.plugin.vaultReferenceManager, this.getCanvasScanOptions());
        const preflight = await safetyService.inspectLocalFile(file);
        if (!preflight.safeToDelete) {
            const reason = preflight.complete
                ? `${preflight.referenceCount} reference(s) now exist`
                : `reference scan incomplete: ${preflight.uncertainFiles.join(", ")}`;
            new Notice(`The local and cloud files were kept: ${reason}.`);
            return;
        }

        if (choice === "delete-all" && !await this.deleteCloudImage(cloudUrl)) {
            new Notice("Cloud deletion failed; the local file was kept.");
            return;
        }

        const finalSafety = await safetyService.inspectLocalFile(file);
        if (!finalSafety.safeToDelete) {
            new Notice("The local file was kept because references changed before deletion.");
            return;
        }
        await this.app.vault.trash(file, true);
    }

    private async deleteCloudImage(cloudUrl: string): Promise<boolean> {
        if (this.plugin.settings.pasteHandling.cloud.uploader !== 'PicList') {
            new Notice(t("MSG_DELETE_NOT_SUPPORTED")); return false;
        }
        try {
            const safety = await new ReferenceSafetyService(this.app, this.plugin.vaultReferenceManager, this.getCanvasScanOptions())
                .inspectUrl(cloudUrl);
            if (!safety.safeToDelete) {
                const reason = safety.complete
                    ? `${safety.referenceCount} reference(s) remain`
                    : `reference scan incomplete: ${safety.uncertainFiles.join(", ")}`;
                new Notice(`The cloud image was kept: ${reason}.`);
                return false;
            }

            new Notice(t("MSG_DELETING_CLOUD"));
            const deleter = new CloudImageDeleter(this.plugin);
            const success = await deleter.deleteImage({ url: cloudUrl });
            if (success) new Notice(t("MSG_DELETE_CLOUD_SUCCESS"));
            else new Notice(t("MSG_DELETE_CLOUD_FAILED"));
            return success;
        } catch (error) {
            new Notice(t("MSG_DELETE_CLOUD_ERROR", [getErrorMessage(error)]));
            return false;
        }
    }

    private runDialogAction(action: () => Promise<unknown>): void {
        void action().catch(error => {
            console.error("Failed to complete the upload action:", error);
            new Notice(error instanceof Error ? error.message : String(error));
        });
    }

    private getCanvasScanOptions(): { includeFencedCode: boolean } {
        return {
            includeFencedCode: this.plugin.settings?.global?.codeBlockImageLinkIndexing ?? true
        };
    }
}
