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
    CanvasFileReference,
    CanvasReferenceScanResult,
    CanvasReferenceUpdateResult,
    getCanvasFileReferenceIndexDetailed,
    replaceCanvasFileReferences
} from "../utils/CanvasReferenceUtils";
import { AsyncLock } from "../utils/AsyncLock";
import type { LocalLinkSettings } from "../settings/types";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import {
    ReferenceSafetyService,
    type ReferenceSafetyReport
} from "../utils/ReferenceSafetyService";
import {
    createReferenceMutationScanPolicy,
    type ReferenceMutationScanPolicy
} from "../utils/ReferenceScanPolicy";
import {
    verifyImageFileRevision,
    type ImageFileRevision
} from "../utils/ImageFileRevision";
import { ImageEditCommitService } from "../utils/ImageEditCommitService";
import type { ImageReferenceIndexService } from "../utils/ImageReferenceIndexService";

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
    protectedReferences?: number;
    protectedFiles?: string[];
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
        private readonly mutationScanPolicy: ReferenceMutationScanPolicy =
            createReferenceMutationScanPolicy(true),
        private readonly linkSettingsProvider: () => LocalLinkSettings = () => DEFAULT_SETTINGS.localProcessing.link,
        private readonly referenceIndex?: ImageReferenceIndexService
    ) { }

    async commit(
        source: TFile,
        targetFilename: string,
        data: ArrayBuffer,
        expectedRevision?: ImageFileRevision
    ): Promise<TFile> {
        return ImageConversionCommitter.commitLock.acquire("vault-reference-commit", () =>
            this.commitUnlocked(source, targetFilename, data, expectedRevision)
        );
    }

    private async commitUnlocked(
        source: TFile,
        targetFilename: string,
        data: ArrayBuffer,
        expectedRevision?: ImageFileRevision
    ): Promise<TFile> {
        await this.assertExpectedRevision(source, expectedRevision);
        if (source.name === targetFilename) {
            if (expectedRevision) {
                const result = await new ImageEditCommitService(this.app).commit({
                    file: source,
                    expectedRevision,
                    data
                });
                if (!result.success) {
                    throw this.revisionError(
                        source,
                        result.error ?? "Image source changed before it could be saved"
                    );
                }
            } else {
                await this.app.vault.modifyBinary(source, data);
            }
            return source;
        }

        const safetyService = new ReferenceSafetyService(
            this.app,
            this.referenceManager,
            this.referenceIndex
        );
        const safety = await safetyService.inspectLocalFile(source);
        const mutationScans = await this.scanMutationReferences(source, safety);
        const markdownScan = mutationScans.markdown;
        const canvasScan = mutationScans.canvas;
        const preflightUncertain = [
            ...safety.uncertainFiles,
            ...markdownScan.uncertainFiles,
            ...canvasScan.uncertainFiles
        ];
        if (!safety.complete || !markdownScan.complete || !canvasScan.complete) {
            throw new ImageConversionCommitError(
                `Reference preflight was incomplete: ${uniqueSorted(preflightUncertain).join(", ")}`,
                {
                    stage: "preflight",
                    sourcePath: source.path,
                    sourcePreserved: true,
                    uncertainFiles: uniqueSorted(preflightUncertain)
                }
            );
        }
        const mutableCanvas = canvasScan.references.get(source.path) ?? [];
        const protectedReferences = getProtectedReferences(
            safety.markdown,
            safety.canvas,
            markdownScan.locations,
            mutableCanvas
        );
        if (protectedReferences.count > 0) {
            throw new ImageConversionCommitError(
                `${protectedReferences.count} reference(s) are protected by the fenced-code setting`,
                {
                    stage: "preflight",
                    sourcePath: source.path,
                    sourcePreserved: true,
                    uncertainFiles: [],
                    protectedReferences: protectedReferences.count,
                    protectedFiles: protectedReferences.files
                }
            );
        }

        await this.assertExpectedRevision(source, expectedRevision);
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
            includeFencedCode: this.mutationScanPolicy.includeFencedCode,
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
        await this.referenceIndex?.refreshPaths([
            ...markdownResult.files
                .filter(file => file.replaced > 0)
                .map(file => file.filePath),
            ...canvasResult.files
                .filter(file => file.replaced > 0)
                .map(file => file.filePath)
        ]);

        const postflight = await safetyService.inspectLocalFile(source);
        if (!postflight.complete || postflight.referenceCount > 0) {
            const uncertainFiles = [
                ...postflight.uncertainFiles,
                ...postflight.markdown.map(location => location.file.path),
                ...postflight.canvas.map(reference => reference.canvasFile.path)
            ];
            throw new ImageConversionCommitError(
                `Source references remain after conversion: ${uniqueSorted(uncertainFiles).join(", ")}`,
                {
                    stage: "markdown",
                    sourcePath: source.path,
                    targetPath: target.path,
                    sourcePreserved: true,
                    markdown: markdownResult,
                    canvas: canvasResult,
                    uncertainFiles: uniqueSorted(uncertainFiles)
                }
            );
        }

        await this.assertExpectedRevision(source, expectedRevision);
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

    private async assertExpectedRevision(
        source: TFile,
        expectedRevision?: ImageFileRevision
    ): Promise<void> {
        if (!expectedRevision) return;
        if (source.path !== expectedRevision.path) {
            throw this.revisionError(source, "Image source moved before conversion");
        }
        const result = await verifyImageFileRevision(this.app, expectedRevision);
        if (!result.matches) {
            throw this.revisionError(
                source,
                result.error ?? "Image source changed before conversion"
            );
        }
    }

    private revisionError(source: TFile, message: string): ImageConversionCommitError {
        return new ImageConversionCommitError(message, {
            stage: "preflight",
            sourcePath: source.path,
            sourcePreserved: true,
            uncertainFiles: [source.path]
        });
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

    private async scanMutationReferences(
        source: TFile,
        safety: ReferenceSafetyReport
    ): Promise<{
        markdown: ReferenceScanResult;
        canvas: CanvasReferenceScanResult;
    }> {
        if (this.mutationScanPolicy.includeFencedCode) {
            return {
                markdown: {
                    locations: safety.markdown,
                    complete: safety.complete,
                    uncertainFiles: safety.uncertainFiles
                },
                canvas: {
                    references: new Map([[source.path, safety.canvas]]),
                    complete: safety.complete,
                    uncertainFiles: safety.uncertainFiles
                }
            };
        }
        if (this.referenceIndex) {
            const snapshot = await this.referenceIndex.inspectLocalFile(source, {
                includeFencedCode: false
            });
            return {
                markdown: {
                    locations: [...snapshot.markdown],
                    complete: snapshot.complete,
                    uncertainFiles: [...snapshot.uncertainFiles]
                },
                canvas: {
                    references: new Map([[source.path, [...snapshot.canvas]]]),
                    complete: snapshot.complete,
                    uncertainFiles: [...snapshot.uncertainFiles]
                }
            };
        }

        let markdown: ReferenceScanResult;
        try {
            markdown = await this.referenceManager.scanReferencesDetailed(
                source.path,
                this.mutationScanPolicy
            );
        } catch (error) {
            markdown = {
                locations: [],
                complete: false,
                uncertainFiles: [`Markdown mutation scan: ${getErrorMessage(error)}`]
            };
        }

        let canvas: CanvasReferenceScanResult;
        try {
            canvas = await getCanvasFileReferenceIndexDetailed(
                this.app,
                [source],
                this.mutationScanPolicy
            );
        } catch (error) {
            canvas = {
                references: new Map([[source.path, []]]),
                complete: false,
                uncertainFiles: [`Canvas mutation scan: ${getErrorMessage(error)}`]
            };
        }

        return { markdown, canvas };
    }
}

function getProtectedReferences(
    safetyMarkdown: readonly ReferenceLocation[],
    safetyCanvas: readonly CanvasFileReference[],
    mutableMarkdown: readonly ReferenceLocation[],
    mutableCanvas: readonly CanvasFileReference[]
): { count: number; files: string[] } {
    const mutableMarkdownKeys = countKeys(mutableMarkdown.map(markdownKey));
    const mutableCanvasKeys = countKeys(mutableCanvas.map(canvasKey));
    const protectedMarkdown = safetyMarkdown.filter(
        reference => !consumeKey(mutableMarkdownKeys, markdownKey(reference))
    );
    const protectedCanvas = safetyCanvas.filter(
        reference => !consumeKey(mutableCanvasKeys, canvasKey(reference))
    );
    return {
        count: protectedMarkdown.length + protectedCanvas.length,
        files: uniqueSorted([
            ...protectedMarkdown.map(reference => reference.file.path),
            ...protectedCanvas.map(reference => reference.canvasFile.path)
        ])
    };
}

function countKeys(keys: readonly string[]): Map<string, number> {
    const counts = new Map<string, number>();
    for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
}

function consumeKey(counts: Map<string, number>, key: string): boolean {
    const count = counts.get(key) ?? 0;
    if (count === 0) return false;
    if (count === 1) counts.delete(key);
    else counts.set(key, count - 1);
    return true;
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function markdownKey(reference: ReferenceLocation): string {
    return `${reference.file.path}:${reference.start}-${reference.end}`;
}

function canvasKey(reference: CanvasFileReference): string {
    return `${reference.canvasFile.path}:${reference.lineNumber}:${reference.nodeFile}`;
}

function uniqueSorted(values: readonly string[]): string[] {
    return [...new Set(values.filter(Boolean))].sort();
}
