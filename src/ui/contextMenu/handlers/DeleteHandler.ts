import { App, Notice, TFile } from 'obsidian';
import { t } from '../../../lang/helpers';
import ImageConverterPlugin from '../../../main';
import { FolderAndFilenameManagement } from '../../../local/FolderAndFilenameManagement';
import { CloudDeleteResult, CloudImageDeleter } from '../../../cloud/CloudImageDeleter';
import { ImageMatchFinder } from '../utils/ImageMatchFinder';
import { EditorLinkRemover } from '../utils/EditorLinkRemover';
import { ConfirmDialog } from '../../../settings/SettingsModals';
import { ImageMatch } from '../types';
import { ReferenceSafetyReport, ReferenceSafetyService } from '../../../utils/ReferenceSafetyService';
import { isHttpUrl } from '../../../utils/NetworkPolicy';
import { ImageViewContext, ImageViewContextResolver } from '../utils/ImageViewContextResolver';
import {
    inferLocalReferenceSyntax,
    LocalImageTargetResolver
} from '../../../utils/LocalImageTargetResolver';
import { getAllImageLinks } from '../../../utils/RegexPatterns';

/** Handles local and remote image deletion with exact-occurrence targeting. */
export class DeleteHandler {
    private readonly viewContextResolver: ImageViewContextResolver;
    private readonly localTargetResolver: LocalImageTargetResolver;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        _folderManagement: FolderAndFilenameManagement,
        private imageMatchFinder: ImageMatchFinder,
        private linkRemover: EditorLinkRemover,
        private cloudDeleter: CloudImageDeleter,
        viewContextResolver?: ImageViewContextResolver
    ) {
        this.viewContextResolver = viewContextResolver ?? new ImageViewContextResolver(app);
        this.localTargetResolver = new LocalImageTargetResolver(app);
    }

    async deleteImageAndLink(event: MouseEvent, targetImage?: HTMLImageElement): Promise<void> {
        await this.deleteImageLinks(event, targetImage, false);
    }

    async deleteAllMatchingImageLinks(event: MouseEvent, targetImage?: HTMLImageElement): Promise<void> {
        await this.deleteImageLinks(event, targetImage, true);
    }

    private async deleteImageLinks(
        event: MouseEvent,
        targetImage: HTMLImageElement | undefined,
        allInCurrentNote: boolean
    ): Promise<void> {
        const img = targetImage ?? (event.target as HTMLImageElement | null);
        const src = img?.getAttribute?.('src');
        if (!img || !src) return;

        try {
            if (src.startsWith('data:image/')) {
                await this.deleteBase64Link(img, src, allInCurrentNote);
                return;
            }

            const context = this.viewContextResolver.resolve(img);
            if (!context) {
                new Notice(t('MSG_IMAGE_CONTEXT_UNRESOLVED'));
                return;
            }

            const matches = await this.resolveSelectedMatches(context, src, allInCurrentNote);
            if (matches.length === 0) {
                new Notice(t('MSG_FAIL_FIND_IMAGE'));
                return;
            }
            if (allInCurrentNote && matches.length < 2) {
                new Notice(t('MSG_NO_DUPLICATE_IMAGE_LINKS'));
                return;
            }

            if (this.cloudDeleter.isCloudImage(src)) {
                await this.deleteCloudImageAndLinks(context, src, matches, allInCurrentNote);
                return;
            }

            await this.deleteLocalImageAndLinks(context, matches, allInCurrentNote);
        } catch (error) {
            console.error('[Image Assistant] Failed to delete image:', error);
            new Notice(t('MSG_FAIL_DELETE'));
        }
    }

    private async resolveSelectedMatches(
        context: ImageViewContext,
        src: string,
        allInCurrentNote: boolean
    ): Promise<ImageMatch[]> {
        if (!allInCurrentNote) {
            return [{
                lineNumber: context.match.line,
                line: context.editor.getLine(context.match.line),
                fullMatch: context.match.linkText,
                index: context.match.start
            }];
        }

        const isNetwork = isHttpUrl(src);
        const localResolution = isNetwork
            ? null
            : this.localTargetResolver.resolve(this.getContextTargetPath(context), context.file, {
                syntax: inferLocalReferenceSyntax(context.match.linkText)
            });
        const imagePath = isNetwork ? src : localResolution?.file?.path ?? null;
        const matches = await this.imageMatchFinder.findImageMatches(
            context.editor,
            imagePath,
            isNetwork || !imagePath,
            context.file
        );
        return uniqueMatches(matches);
    }

    private async deleteBase64Link(
        img: HTMLImageElement,
        src: string,
        allInCurrentNote: boolean
    ): Promise<void> {
        if (allInCurrentNote) {
            new Notice(t('MSG_BATCH_BASE64_UNSUPPORTED'));
            return;
        }
        const owner = this.viewContextResolver.resolveOwner(img);
        if (!owner) {
            new Notice(t('MSG_IMAGE_CONTEXT_UNRESOLVED'));
            return;
        }
        const found = await this.imageMatchFinder.processBase64Image(
            owner.editor,
            src,
            async (editor, lineNumber, line, fullMatch) => {
                await this.linkRemover.removeImageLink(editor, lineNumber, line, fullMatch, false);
                await this.saveLinkRemoval(owner.view);
            }
        );
        if (!found) new Notice(t('MSG_FAIL_FIND_BASE64'));
    }

    private async deleteLocalImageAndLinks(
        context: ImageViewContext,
        matches: ImageMatch[],
        explicitBatch: boolean
    ): Promise<void> {
        const resolution = this.localTargetResolver.resolve(
            this.getContextTargetPath(context),
            context.file,
            { syntax: inferLocalReferenceSyntax(context.match.linkText) }
        );
        const abstractFile = resolution.file;
        if (resolution.status !== "resolved" || !(abstractFile instanceof TFile)) {
            new Notice(t('MSG_IMAGE_CONTEXT_UNRESOLVED'));
            return;
        }

        const safetyService = this.createSafetyService();
        const preflight = await safetyService.inspectLocalFile(abstractFile);
        const mayDeleteSource = this.canDeleteAfterRemoving(preflight, matches.length);

        const action = async (deleteSource: boolean) => {
            if (!await this.removeAndSave(context, matches)) return;
            if (!deleteSource) {
                new Notice(t('MSG_IMAGE_SOURCE_KEPT'));
                return;
            }

            const revalidated = await safetyService.inspectLocalFile(abstractFile);
            if (!revalidated.safeToDelete) {
                new Notice(this.sourceKeptMessage(revalidated, 'MSG_IMAGE_FILE_KEPT_REFERENCED'));
                return;
            }
            await this.app.vault.trash(abstractFile, true);
            new Notice(t('MSG_TRASHED_FILE'));
        };

        if (!mayDeleteSource) {
            this.openKeepSourceWarning(preflight, matches.length, () => action(false));
            return;
        }

        if (explicitBatch) {
            this.openBatchConfirmation(matches.length, () => action(true));
            return;
        }
        await action(true);
    }

    private async deleteCloudImageAndLinks(
        context: ImageViewContext,
        cloudUrl: string,
        matches: ImageMatch[],
        explicitBatch: boolean
    ): Promise<void> {
        const owned = this.plugin.historyManager.isUrlUploaded(cloudUrl);
        if (!owned) {
            await this.confirmBatchIfNeeded(explicitBatch, matches.length, async () => {
                if (await this.removeAndSave(context, matches)) {
                    new Notice(t('MSG_REMOTE_NOT_OWNED_KEPT'));
                }
            });
            return;
        }

        const safetyService = this.createSafetyService();
        const preflight = await safetyService.inspectUrl(cloudUrl);
        const mayDeleteSource = this.canDeleteAfterRemoving(preflight, matches.length);
        const action = async (deleteSource: boolean) => {
            if (!await this.removeAndSave(context, matches)) return;
            if (!deleteSource) {
                new Notice(t('MSG_REMOTE_SOURCE_KEPT'));
                return;
            }

            const revalidated = await safetyService.inspectUrl(cloudUrl);
            if (!revalidated.safeToDelete) {
                new Notice(this.sourceKeptMessage(revalidated, 'MSG_REMOTE_FILE_KEPT_REFERENCED'));
                return;
            }
            const result = await this.cloudDeleter.deleteImageDetailed({ url: cloudUrl });
            new Notice(result.success ? t('MSG_CLOUD_DELETE_SUCCESS') : this.getCloudDeleteFailureNotice(result));
        };

        if (!mayDeleteSource) {
            this.openKeepSourceWarning(preflight, matches.length, () => action(false));
            return;
        }
        if (explicitBatch) {
            this.openBatchConfirmation(matches.length, () => action(true));
            return;
        }
        await action(true);
    }

    private canDeleteAfterRemoving(report: ReferenceSafetyReport, selectedCount: number): boolean {
        return report.complete && report.referenceCount <= selectedCount;
    }

    private openKeepSourceWarning(
        report: ReferenceSafetyReport,
        selectedCount: number,
        action: () => Promise<void>
    ): void {
        const remaining = Math.max(0, report.referenceCount - selectedCount);
        const message = report.complete
            ? t('DIALOG_DELETE_KEEP_SOURCE_REFERENCES', [remaining.toString()])
            : t('DIALOG_DELETE_KEEP_SOURCE_UNCERTAIN', [report.uncertainFiles.join(', ')]);
        new ConfirmDialog(
            this.app,
            t('DIALOG_DELETE_KEEP_SOURCE_TITLE'),
            message,
            t('BUTTON_REMOVE_LINKS_KEEP_SOURCE', [selectedCount.toString()]),
            action
        ).open();
    }

    private openBatchConfirmation(count: number, action: () => Promise<void>): void {
        new ConfirmDialog(
            this.app,
            t('DIALOG_DELETE_ALL_TITLE'),
            t('DIALOG_DELETE_ALL_MSG', [count.toString()]),
            t('BUTTON_DELETE_ALL', [count.toString()]),
            action
        ).open();
    }

    private async confirmBatchIfNeeded(
        explicitBatch: boolean,
        count: number,
        action: () => Promise<void>
    ): Promise<void> {
        if (explicitBatch) {
            this.openBatchConfirmation(count, action);
        } else {
            await action();
        }
    }

    private async removeAndSave(context: ImageViewContext, matches: ImageMatch[]): Promise<boolean> {
        for (const match of [...matches].sort(compareMatchesForDeletion)) {
            await this.linkRemover.removeImageLink(
                context.editor,
                match.lineNumber,
                context.editor.getLine(match.lineNumber),
                match.fullMatch,
                false,
                match.index
            );
        }
        const saved = await this.saveLinkRemoval(context.view);
        if (saved) new Notice(t('MSG_REMOVED_LINKS_COUNT', [matches.length.toString()]));
        return saved;
    }

    private createSafetyService(): ReferenceSafetyService {
        return new ReferenceSafetyService(this.app, this.plugin.vaultReferenceManager, {
            includeFencedCode: this.plugin.settings?.global?.codeBlockImageLinkIndexing ?? true
        });
    }

    private getContextTargetPath(context: ImageViewContext): string {
        return context.match.descriptor?.path
            ?? getAllImageLinks(context.match.linkText)[0]?.path
            ?? "";
    }

    private async saveLinkRemoval(view: ImageViewContext['view']): Promise<boolean> {
        try {
            await view.save();
            return true;
        } catch (error) {
            console.error('[Image Assistant] Failed to save note after removing an image link:', error);
            new Notice(t('MSG_LINK_REMOVED_SAVE_FAILED_SOURCE_KEPT'));
            return false;
        }
    }

    private sourceKeptMessage(report: ReferenceSafetyReport, referencedKey: string): string {
        return report.complete
            ? t(referencedKey as any, [report.referenceCount.toString()])
            : t('MSG_SOURCE_KEPT_SCAN_INCOMPLETE', [report.uncertainFiles.join(', ')]);
    }

    private getCloudDeleteFailureNotice(result: CloudDeleteResult): string {
        const uploader = result.uploader || this.plugin.settings.pasteHandling.cloud.uploader;
        switch (result.reason) {
            case 'unsupported-uploader':
                return t('MSG_CLOUD_DELETE_UNSUPPORTED', [uploader]);
            case 'missing-delete-server':
                return t('MSG_CLOUD_DELETE_MISSING_SERVER');
            case 'missing-history':
                return t('MSG_CLOUD_DELETE_FAIL_HISTORY');
            case 'api-failed':
                return t('MSG_CLOUD_DELETE_API_FAILED', [result.message || t('MSG_UNKNOWN_ERROR')]);
            case 'request-failed':
                return t('MSG_CLOUD_DELETE_REQUEST_FAILED', [result.message || t('MSG_UNKNOWN_ERROR')]);
            default:
                return t('MSG_CLOUD_DELETE_FAIL');
        }
    }
}

function uniqueMatches(matches: ImageMatch[]): ImageMatch[] {
    const unique = new Map<string, ImageMatch>();
    for (const match of matches) {
        unique.set(`${match.lineNumber}:${match.index}:${match.fullMatch}`, match);
    }
    return [...unique.values()];
}

function compareMatchesForDeletion(a: ImageMatch, b: ImageMatch): number {
    return b.lineNumber - a.lineNumber || b.index - a.index;
}
