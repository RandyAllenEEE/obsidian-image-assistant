import { App, TFile } from "obsidian";
import type { FolderAndFilenameManagement } from "./FolderAndFilenameManagement";
import type {
    ReferenceLocation,
    ReferenceScanResult,
    ReferenceUpdateResult,
    VaultReferenceManager
} from "../utils/VaultReferenceManager";
import { ImageReferenceReplacer } from "../utils/ImageReferenceReplacer";
import {
    CanvasReferenceUpdateResult,
    getCanvasFileReferenceIndexDetailed,
    replaceCanvasFileReferences
} from "../utils/CanvasReferenceUtils";
import { AsyncLock } from "../utils/AsyncLock";
import type { LocalLinkSettings } from "../settings/types";
import { DEFAULT_SETTINGS } from "../settings/defaults";

export type ImageConversionCommitStage =
    | "preflight"
    | "target-create"
    | "markdown"
    | "canvas"
    | "source-delete";

export interface ImageConversionCommitReport {
    stage: ImageConversionCommitStage;
    sourcePath: string;
    targetPath?: string;
    sourcePreserved: boolean;
    markdown?: ReferenceUpdateResult;
    canvas?: CanvasReferenceUpdateResult;
    uncertainFiles: string[];
}

export class ImageConversionCommitError extends Error {
    constructor(message: string, public readonly report: ImageConversionCommitReport) {
        super(message);
        this.name = "ImageConversionCommitError";
    }
}

export class ImageConversionCommitter {
    private static readonly commitLock = new AsyncLock();

    constructor(
        private app: App,
        private fileManager: FolderAndFilenameManagement,
        private referenceManager: VaultReferenceManager,
        private readonly canvasScanOptions: { includeFencedCode?: boolean } = {},
        private readonly linkSettingsProvider: () => LocalLinkSettings = () => DEFAULT_SETTINGS.localProcessing.link
    ) { }

    async commit(source: TFile, targetFilename: string, data: ArrayBuffer): Promise<TFile> {
        return ImageConversionCommitter.commitLock.acquire("vault-reference-commit", () =>
            this.commitUnlocked(source, targetFilename, data)
        );
    }

    private async commitUnlocked(source: TFile, targetFilename: string, data: ArrayBuffer): Promise<TFile> {
        if (source.name === targetFilename) {
            await this.app.vault.modifyBinary(source, data);
            return source;
        }

        const markdownScan = await this.scanMarkdownReferences(source.path);
        const canvasScan = await getCanvasFileReferenceIndexDetailed(this.app, [source], this.canvasScanOptions);
        const preflightUncertain = [
            ...markdownScan.uncertainFiles,
            ...canvasScan.uncertainFiles
        ];
        if (!markdownScan.complete || !canvasScan.complete) {
            throw new ImageConversionCommitError(
                `Reference preflight was incomplete: ${preflightUncertain.join(", ")}`,
                {
                    stage: "preflight",
                    sourcePath: source.path,
                    sourcePreserved: true,
                    uncertainFiles: preflightUncertain
                }
            );
        }

        let target: TFile | null;
        try {
            target = await this.fileManager.createUniqueBinary(
                source.parent?.path ?? "",
                targetFilename,
                data,
                "increment"
            );
        } catch (error) {
            throw new ImageConversionCommitError(
                error instanceof Error ? error.message : String(error),
                {
                    stage: "target-create",
                    sourcePath: source.path,
                    sourcePreserved: true,
                    uncertainFiles: []
                }
            );
        }
        if (!target) {
            throw new ImageConversionCommitError(`Could not create converted image ${targetFilename}`, {
                stage: "target-create",
                sourcePath: source.path,
                sourcePreserved: true,
                uncertainFiles: []
            });
        }

        const replacer = new ImageReferenceReplacer(
            this.app,
            this.referenceManager,
            this.linkSettingsProvider
        );
        const replacementGenerator = (location: ReferenceLocation) =>
            replacer.serializeReference(location.original, target, location.file);
        const markdownResult = typeof this.referenceManager.updateReferenceLocationsDetailed === "function"
            ? await this.referenceManager.updateReferenceLocationsDetailed(markdownScan.locations, replacementGenerator)
            : await this.referenceManager.updateReferencesDetailed(source.path, replacementGenerator);
        if (!this.isReferenceUpdateComplete(markdownResult)) {
            throw new ImageConversionCommitError(
                `Updated ${markdownResult.replaced} of ${markdownResult.found} Markdown references`,
                {
                    stage: "markdown",
                    sourcePath: source.path,
                    targetPath: target.path,
                    sourcePreserved: true,
                    markdown: markdownResult,
                    uncertainFiles: markdownResult.uncertainFiles ?? []
                }
            );
        }

        const canvasResult = await replaceCanvasFileReferences(this.app, source, target, {
            ...this.canvasScanOptions,
            formatLocalTextReference: (originalLink, newFile, canvasFile) =>
                replacer.serializeReference(originalLink, newFile, canvasFile)
        });
        if (!this.isCanvasUpdateComplete(canvasResult)) {
            const affected = [...canvasResult.failedFiles, ...canvasResult.uncertainFiles];
            throw new ImageConversionCommitError(
                `Failed to update Canvas references in: ${affected.join(", ")}`,
                {
                    stage: "canvas",
                    sourcePath: source.path,
                    targetPath: target.path,
                    sourcePreserved: true,
                    markdown: markdownResult,
                    canvas: canvasResult,
                    uncertainFiles: canvasResult.uncertainFiles
                }
            );
        }

        const postflightMarkdown = await this.scanMarkdownReferences(source.path);
        const postflightCanvas = await getCanvasFileReferenceIndexDetailed(this.app, [source], this.canvasScanOptions);
        const remainingCanvasRefs = postflightCanvas.references.get(source.path) ?? [];
        if (!postflightMarkdown.complete
            || !postflightCanvas.complete
            || postflightMarkdown.locations.length > 0
            || remainingCanvasRefs.length > 0) {
            const uncertainFiles = [
                ...postflightMarkdown.uncertainFiles,
                ...postflightCanvas.uncertainFiles,
                ...postflightMarkdown.locations.map(location => location.file.path),
                ...remainingCanvasRefs.map(reference => reference.canvasFile.path)
            ];
            throw new ImageConversionCommitError(
                `Source references remain after conversion: ${Array.from(new Set(uncertainFiles)).join(", ")}`,
                {
                    stage: "markdown",
                    sourcePath: source.path,
                    targetPath: target.path,
                    sourcePreserved: true,
                    markdown: markdownResult,
                    canvas: canvasResult,
                    uncertainFiles: Array.from(new Set(uncertainFiles))
                }
            );
        }

        try {
            await this.app.vault.trash(source, true);
        } catch (error) {
            throw new ImageConversionCommitError(
                `Converted references were saved, but the source could not be deleted: ${error instanceof Error ? error.message : String(error)}`,
                {
                    stage: "source-delete",
                    sourcePath: source.path,
                    targetPath: target.path,
                    sourcePreserved: true,
                    markdown: markdownResult,
                    canvas: canvasResult,
                    uncertainFiles: []
                }
            );
        }
        return target;
    }

    private async scanMarkdownReferences(imagePath: string): Promise<ReferenceScanResult> {
        if (typeof this.referenceManager.scanReferencesDetailed === "function") {
            return this.referenceManager.scanReferencesDetailed(imagePath);
        }

        return { locations: [], complete: true, uncertainFiles: [] };
    }

    private isReferenceUpdateComplete(result: ReferenceUpdateResult): boolean {
        return result.complete !== false
            && (result.failedFiles?.length ?? 0) === 0
            && (result.uncertainFiles?.length ?? 0) === 0
            && result.replaced === result.found;
    }

    private isCanvasUpdateComplete(result: CanvasReferenceUpdateResult): boolean {
        return result.complete !== false
            && result.failedFiles.length === 0
            && (result.uncertainFiles?.length ?? 0) === 0
            && result.replaced === result.found;
    }
}
