import { TFile, type App, type Editor, type MarkdownView } from "obsidian";
import type ImageConverterPlugin from "../main";
import { t } from "../lang/helpers";
import {
    CloudImageDeleter,
    type CloudDeleteResult
} from "../cloud/CloudImageDeleter";
import { AsyncLock } from "./AsyncLock";
import {
    getCanvasFileReferenceIndexDetailed,
    getCanvasUrlReferencesDetailed,
    removeCanvasFileReferences,
    removeCanvasUrlReferences,
    replaceCanvasFileReferences,
    replaceCanvasFileReferencesWithUrl,
    replaceCanvasUrlReferencesWithFile,
    type CanvasFileReference,
    type CanvasReferenceUpdateResult
} from "./CanvasReferenceUtils";
import { ImageLinkPathReplacer } from "./ImageLinkPathReplacer";
import { ImageReferenceReplacer } from "./ImageReferenceReplacer";
import {
    ReferenceSafetyService,
    type ReferenceSafetyReport
} from "./ReferenceSafetyService";
import { createReferenceMutationScanPolicy } from "./ReferenceScanPolicy";
import type {
    ReferenceLocation,
    ReferenceUpdateResult
} from "./VaultReferenceManager";
import { EditorRangeMutationTransaction } from "./EditorRangeMutationTransaction";
import {
    captureImageFileRevision,
    verifyImageFileRevision,
    type ImageFileRevision
} from "./ImageFileRevision";

export type ImageReferenceSource =
    | { kind: "local"; file: TFile }
    | { kind: "url"; url: string };

export type ImageReferenceDestination =
    | { kind: "local"; file: TFile }
    | { kind: "url"; url: string };

export type ReferenceOperationScope = "clicked" | "all";

export type ReferenceWorkflowOperation = "delete" | "upload" | "download";

export type ReferenceWorkflowDecisionAction =
    | "clicked-keep-source"
    | "all-keep-source"
    | "all-delete-source"
    | "delete-source-only"
    | "keep-transfer"
    | "cancel";

export interface ReferenceWorkflowDecision {
    readonly action: ReferenceWorkflowDecisionAction;
    readonly scope: ReferenceOperationScope | "none";
    readonly deleteSource: boolean;
}

export interface ClickedImageReferenceContext {
    readonly view: MarkdownView;
    readonly file: TFile;
    readonly editor: Editor;
    readonly match: {
        readonly line: number;
        readonly start: number;
        readonly end: number;
        readonly linkText: string;
    };
}

export interface ReferenceMutationBoundary {
    readonly allowedDocumentPaths: readonly string[];
}

export interface ReferenceInspectionOptions {
    readonly clickedContext?: ClickedImageReferenceContext;
    readonly mutationBoundary?: ReferenceMutationBoundary;
}

export interface ReferenceInventory {
    readonly source: ImageReferenceSource;
    readonly clickedContext?: ClickedImageReferenceContext;
    readonly mutationBoundary?: ReferenceMutationBoundary;
    readonly safety: ReferenceSafetyReport;
    readonly mutableMarkdown: readonly ReferenceLocation[];
    readonly mutableCanvas: readonly CanvasFileReference[];
    readonly mutableComplete: boolean;
    readonly uncertainFiles: readonly string[];
    readonly totalReferences: number;
    readonly mutableReferences: number;
    readonly protectedFencedReferences: number;
    readonly outOfBoundaryReferences: number;
    readonly markdownReferences: number;
    readonly canvasReferences: number;
    readonly sourceDeletable: boolean;
    readonly sourceRevision?: ImageFileRevision;
    readonly canDeleteAfterAll: boolean;
    readonly signature: string;
}

export interface ReferenceWorkflowResult {
    readonly found: number;
    readonly changed: number;
    readonly complete: boolean;
    readonly failedFiles: readonly string[];
    readonly uncertainFiles: readonly string[];
    readonly sourceDeleted: boolean;
    readonly sourceDeleteResult?: CloudDeleteResult;
    readonly staleInventory?: ReferenceInventory;
}

/**
 * Coordinates reference workflows without introducing another Markdown parser.
 * All discovery and mutation is delegated to the existing vault, context and
 * Canvas utilities.
 */
export class ImageReferenceWorkflowCoordinator {
    private static readonly sourceLock = new AsyncLock();
    private readonly safetyService: ReferenceSafetyService;
    private readonly referenceReplacer: ImageReferenceReplacer;
    private readonly cloudDeleter: CloudImageDeleter;
    private readonly editorTransaction = new EditorRangeMutationTransaction();

    constructor(
        private readonly app: App,
        private readonly plugin: ImageConverterPlugin,
        cloudDeleter?: CloudImageDeleter
    ) {
        this.safetyService = new ReferenceSafetyService(
            app,
            plugin.vaultReferenceManager,
            plugin.referenceIndexService
        );
        this.referenceReplacer = new ImageReferenceReplacer(
            app,
            plugin.vaultReferenceManager,
            () => plugin.settings.localProcessing.link,
            () => plugin.settings.localProcessing.embedResize
        );
        this.cloudDeleter = cloudDeleter ?? new CloudImageDeleter(plugin);
    }

    async inspect(
        source: ImageReferenceSource,
        contextOrOptions?: ClickedImageReferenceContext | ReferenceInspectionOptions
    ): Promise<ReferenceInventory> {
        const options = normalizeInspectionOptions(contextOrOptions);
        const clickedContext = options.clickedContext;
        const mutationBoundary = normalizeMutationBoundary(options.mutationBoundary);
        const allowedDocumentPaths = mutationBoundary
            ? new Set(mutationBoundary.allowedDocumentPaths)
            : null;
        const verifiedClickedContext = clickedContext
            && getClickedReferenceText(clickedContext) === clickedContext.match.linkText
            ? clickedContext
            : undefined;
        const mutationPolicy = createReferenceMutationScanPolicy(
            this.plugin.settings?.global?.codeBlockImageLinkIndexing ?? true
        );
        const safety = source.kind === "local"
            ? await this.safetyService.inspectLocalFile(source.file)
            : await this.safetyService.inspectUrl(source.url);
        let mutableMarkdownScan;
        let mutableCanvas: CanvasFileReference[];
        let mutableCanvasComplete: boolean;
        let mutableCanvasUncertainFiles: string[];

        if (mutationPolicy.includeFencedCode) {
            mutableMarkdownScan = {
                locations: safety.markdown,
                complete: safety.complete,
                uncertainFiles: safety.uncertainFiles
            };
            mutableCanvas = safety.canvas;
            mutableCanvasComplete = safety.complete;
            mutableCanvasUncertainFiles = safety.uncertainFiles;
        } else if (this.plugin.referenceIndexService) {
            const indexedMutable = source.kind === "local"
                ? await this.plugin.referenceIndexService.inspectLocalFile(source.file, {
                    includeFencedCode: false
                })
                : await this.plugin.referenceIndexService.inspectUrl(source.url, {
                    includeFencedCode: false
                });
            mutableMarkdownScan = {
                locations: [...indexedMutable.markdown],
                complete: indexedMutable.complete,
                uncertainFiles: [...indexedMutable.uncertainFiles]
            };
            mutableCanvas = [...indexedMutable.canvas];
            mutableCanvasComplete = indexedMutable.complete;
            mutableCanvasUncertainFiles = [...indexedMutable.uncertainFiles];
        } else {
            try {
                mutableMarkdownScan = await this.plugin.vaultReferenceManager.scanReferencesDetailed(
                    getSourceTarget(source),
                    mutationPolicy
                );
            } catch (error) {
                mutableMarkdownScan = {
                    locations: [],
                    complete: false,
                    uncertainFiles: [`Markdown scan: ${getErrorMessage(error)}`]
                };
            }
            try {
                if (source.kind === "local") {
                    const canvasScan = await getCanvasFileReferenceIndexDetailed(
                        this.app,
                        [source.file],
                        mutationPolicy
                    );
                    mutableCanvas = canvasScan.references.get(source.file.path) ?? [];
                    mutableCanvasComplete = canvasScan.complete;
                    mutableCanvasUncertainFiles = canvasScan.uncertainFiles;
                } else {
                    const canvasScan = await getCanvasUrlReferencesDetailed(
                        this.app,
                        source.url,
                        mutationPolicy
                    );
                    mutableCanvas = canvasScan.references;
                    mutableCanvasComplete = canvasScan.complete;
                    mutableCanvasUncertainFiles = canvasScan.uncertainFiles;
                }
            } catch (error) {
                mutableCanvas = [];
                mutableCanvasComplete = false;
                mutableCanvasUncertainFiles = [`Canvas scan: ${getErrorMessage(error)}`];
            }
        }
        const globalMutableMarkdown = mutableMarkdownScan.locations;
        const globalMutableCanvas = mutableCanvas;
        const mutableMarkdown = allowedDocumentPaths
            ? mutableMarkdownScan.locations.filter(location =>
                allowedDocumentPaths.has(location.file.path)
            )
            : mutableMarkdownScan.locations;
        const boundedMutableCanvas = allowedDocumentPaths
            ? mutableCanvas.filter(reference =>
                allowedDocumentPaths.has(reference.canvasFile.path)
            )
            : mutableCanvas;
        const mutableComplete = mutableMarkdownScan.complete && mutableCanvasComplete;
        const uncertainFiles = uniqueSorted([
            ...safety.uncertainFiles,
            ...mutableMarkdownScan.uncertainFiles,
            ...mutableCanvasUncertainFiles
        ]);
        const protectedFencedReferences = countReferenceDifference(
            safety.markdown,
            safety.canvas,
            globalMutableMarkdown,
            globalMutableCanvas
        );
        const outOfBoundaryReferences = countReferenceDifference(
            globalMutableMarkdown,
            globalMutableCanvas,
            mutableMarkdown,
            boundedMutableCanvas
        );
        const sourceDeletable = this.canDeleteSource(source);
        let sourceRevision: ImageFileRevision | undefined;
        if (source.kind === "local" && sourceDeletable) {
            try {
                sourceRevision = await captureImageFileRevision(
                    this.app,
                    source.file
                );
            } catch {
                sourceRevision = undefined;
            }
        }
        const inventoryBase = {
            source,
            clickedContext: verifiedClickedContext,
            mutationBoundary,
            safety,
            mutableMarkdown: Object.freeze([...mutableMarkdown]),
            mutableCanvas: Object.freeze([...boundedMutableCanvas]),
            mutableComplete,
            uncertainFiles: Object.freeze(uncertainFiles),
            totalReferences: safety.referenceCount,
            mutableReferences: mutableMarkdown.length + boundedMutableCanvas.length,
            protectedFencedReferences,
            outOfBoundaryReferences,
            markdownReferences: safety.markdown.length,
            canvasReferences: safety.canvas.length,
            sourceDeletable: sourceDeletable
                && (source.kind === "url" || !!sourceRevision),
            sourceRevision,
            canDeleteAfterAll: safety.complete
                && mutableComplete
                && protectedFencedReferences === 0
                && outOfBoundaryReferences === 0
                && sourceDeletable
                && (source.kind === "url" || !!sourceRevision)
        };
        return Object.freeze({
            ...inventoryBase,
            signature: createInventorySignature(inventoryBase)
        });
    }

    async revalidate(
        source: ImageReferenceSource,
        contextOrOptions?: ClickedImageReferenceContext | ReferenceInspectionOptions
    ): Promise<ReferenceInventory> {
        return this.inspect(source, contextOrOptions);
    }

    getAllowedDecisionActions(
        inventory: ReferenceInventory,
        operation: ReferenceWorkflowOperation
    ): ReadonlySet<ReferenceWorkflowDecisionAction> {
        const actions = new Set<ReferenceWorkflowDecisionAction>(["cancel"]);
        if (operation !== "delete") actions.add("keep-transfer");
        if (inventory.clickedContext) actions.add("clicked-keep-source");

        if (inventory.safety.complete && inventory.mutableComplete) {
            const clickedDuplicatesAll = !!inventory.clickedContext
                && inventory.mutableReferences <= 1;
            if (inventory.mutableReferences > 0 && !clickedDuplicatesAll) {
                actions.add("all-keep-source");
            }
            if (inventory.mutableReferences > 0 && inventory.canDeleteAfterAll) {
                actions.add("all-delete-source");
            }
            if (operation !== "delete"
                && inventory.totalReferences === 0
                && inventory.sourceDeletable) {
                actions.add("delete-source-only");
            }
        }

        return actions;
    }

    async replace(
        inventory: ReferenceInventory,
        destination: ImageReferenceDestination,
        scope: ReferenceOperationScope
    ): Promise<ReferenceWorkflowResult> {
        return ImageReferenceWorkflowCoordinator.sourceLock.acquire(
            getSourceIdentity(inventory.source),
            async () => {
                const fresh = await this.inspect(inventory.source, {
                    clickedContext: inventory.clickedContext,
                    mutationBoundary: inventory.mutationBoundary
                });
                if (fresh.signature !== inventory.signature) {
                    return staleResult(fresh);
                }
                if (scope === "clicked") {
                    return this.replaceClickedReference(fresh, destination);
                }
                return this.replaceAllReferences(fresh, destination);
            }
        );
    }

    async remove(
        inventory: ReferenceInventory,
        scope: ReferenceOperationScope
    ): Promise<ReferenceWorkflowResult> {
        return ImageReferenceWorkflowCoordinator.sourceLock.acquire(
            getSourceIdentity(inventory.source),
            async () => {
                const fresh = await this.inspect(inventory.source, {
                    clickedContext: inventory.clickedContext,
                    mutationBoundary: inventory.mutationBoundary
                });
                if (fresh.signature !== inventory.signature) {
                    return staleResult(fresh);
                }
                if (scope === "clicked") {
                    return this.removeClickedReference(fresh);
                }
                return this.removeAllReferences(fresh);
            }
        );
    }

    async deleteSource(
        source: ImageReferenceSource,
        expectedRevision?: ImageFileRevision
    ): Promise<ReferenceWorkflowResult> {
        return ImageReferenceWorkflowCoordinator.sourceLock.acquire(
            getSourceIdentity(source),
            async () => {
                if (source.kind === "local"
                    && expectedRevision
                    && source.file.path !== expectedRevision.path) {
                    return sourceRevisionFailure(expectedRevision.path);
                }
                const finalInventory = await this.inspect(source);
                if (!finalInventory.safety.safeToDelete || !finalInventory.sourceDeletable) {
                    return {
                        found: finalInventory.totalReferences,
                        changed: 0,
                        complete: false,
                        failedFiles: [],
                        uncertainFiles: finalInventory.uncertainFiles,
                        sourceDeleted: false
                    };
                }

                if (source.kind === "local") {
                    const revision = expectedRevision
                        ?? finalInventory.sourceRevision;
                    if (!revision) {
                        return sourceRevisionFailure(source.file.path);
                    }
                    const revisionCheck = await verifyImageFileRevision(
                        this.app,
                        revision
                    );
                    if (!revisionCheck.matches) {
                        return sourceRevisionFailure(source.file.path);
                    }
                    const currentSource = this.app.vault.getAbstractFileByPath(
                        revision.path
                    );
                    if (!(currentSource instanceof TFile)) {
                        return sourceRevisionFailure(revision.path);
                    }
                    try {
                        await this.app.vault.trash(currentSource, true);
                        return emptyResult(true);
                    } catch (error) {
                        return {
                            found: 0,
                            changed: 0,
                            complete: false,
                            failedFiles: [source.file.path],
                            uncertainFiles: [getErrorMessage(error)],
                            sourceDeleted: false
                        };
                    }
                }

                const sourceDeleteResult = await this.cloudDeleter.deleteImageDetailed({
                    url: source.url
                });
                const historyWarning = sourceDeleteResult.success
                    && sourceDeleteResult.historyUpdated === false
                    ? [sourceDeleteResult.message
                        ?? t("REFERENCE_WORKFLOW_SOURCE_DELETED_HISTORY_STALE", [
                            t("MSG_UNKNOWN_ERROR")
                        ])]
                    : [];
                return {
                    found: 0,
                    changed: 0,
                    complete: sourceDeleteResult.success
                        && sourceDeleteResult.historyUpdated !== false,
                    failedFiles: [],
                    uncertainFiles: sourceDeleteResult.success
                        ? historyWarning
                        : [sourceDeleteResult.message ?? sourceDeleteResult.reason ?? "Cloud deletion failed"],
                    sourceDeleted: sourceDeleteResult.success,
                    sourceDeleteResult
                };
            }
        );
    }

    private async replaceClickedReference(
        inventory: ReferenceInventory,
        destination: ImageReferenceDestination
    ): Promise<ReferenceWorkflowResult> {
        const context = inventory.clickedContext;
        if (!context) return incompleteClickedResult();
        const current = getClickedReferenceText(context);
        if (current !== context.match.linkText) return incompleteClickedResult(context.file.path);

        let replacement: string;
        try {
            replacement = this.serializeReplacement(
                current,
                destination,
                context.file,
                inventory.source.kind === "url"
            );
        } catch (error) {
            return incompleteClickedResult(getErrorMessage(error));
        }
        if (!replacement || replacement === current) return incompleteClickedResult(context.file.path);

        const mutation = await this.editorTransaction.run(context, {
            line: context.match.line,
            start: context.match.start,
            end: context.match.end,
            expectedText: current,
            replacement
        });
        if (mutation.applied && mutation.saved) {
            await this.plugin.referenceIndexService?.refreshPaths([context.file.path]);
        }
        return clickedMutationResult(context.file.path, mutation);
    }

    private async removeClickedReference(
        inventory: ReferenceInventory
    ): Promise<ReferenceWorkflowResult> {
        const context = inventory.clickedContext;
        if (!context) return incompleteClickedResult();
        const current = getClickedReferenceText(context);
        if (current !== context.match.linkText) return incompleteClickedResult(context.file.path);

        const mutation = await this.editorTransaction.run(context, {
            line: context.match.line,
            start: context.match.start,
            end: context.match.end,
            expectedText: current,
            replacement: "",
            removeStandaloneLine: true
        });
        if (mutation.applied && mutation.saved) {
            await this.plugin.referenceIndexService?.refreshPaths([context.file.path]);
        }
        return clickedMutationResult(context.file.path, mutation);
    }

    private async replaceAllReferences(
        inventory: ReferenceInventory,
        destination: ImageReferenceDestination
    ): Promise<ReferenceWorkflowResult> {
        const markdown = await this.plugin.vaultReferenceManager.updateReferenceLocationsDetailed(
            [...inventory.mutableMarkdown],
            location => this.serializeReplacement(
                location.original,
                destination,
                location.file,
                inventory.source.kind === "url"
            )
        );
        const canvas = await this.replaceCanvasReferences(inventory, destination);
        await this.refreshIndexAfterMutation(markdown, canvas);
        return combineMutationResults(markdown, canvas);
    }

    private async removeAllReferences(
        inventory: ReferenceInventory
    ): Promise<ReferenceWorkflowResult> {
        const markdown = await this.plugin.vaultReferenceManager.updateReferenceLocationsDetailed(
            [...inventory.mutableMarkdown],
            () => ""
        );
        const allowedCanvasPaths = new Set(
            inventory.mutableCanvas.map(reference => reference.canvasFile.path)
        );
        const options = {
            allowedCanvasPaths,
            includeFencedCode: this.plugin.settings?.global?.codeBlockImageLinkIndexing ?? true
        };
        const canvas = inventory.source.kind === "local"
            ? await removeCanvasFileReferences(this.app, inventory.source.file, options)
            : await removeCanvasUrlReferences(this.app, inventory.source.url, options);
        await this.refreshIndexAfterMutation(markdown, canvas);
        return combineMutationResults(markdown, canvas);
    }

    private async replaceCanvasReferences(
        inventory: ReferenceInventory,
        destination: ImageReferenceDestination
    ): Promise<CanvasReferenceUpdateResult> {
        const allowedCanvasPaths = new Set(
            inventory.mutableCanvas.map(reference => reference.canvasFile.path)
        );
        const options = {
            allowedCanvasPaths,
            includeFencedCode: this.plugin.settings?.global?.codeBlockImageLinkIndexing ?? true,
            formatLocalTextReference: (
                originalLink: string,
                newFile: TFile,
                canvasFile: TFile
            ) => this.referenceReplacer.serializeReference(
                originalLink,
                newFile,
                canvasFile,
                {
                    applyInitialSize: inventory.source.kind === "url"
                }
            )
        };

        if (inventory.source.kind === "local" && destination.kind === "url") {
            return replaceCanvasFileReferencesWithUrl(
                this.app,
                inventory.source.file,
                destination.url,
                options
            );
        }
        if (inventory.source.kind === "local" && destination.kind === "local") {
            return replaceCanvasFileReferences(
                this.app,
                inventory.source.file,
                destination.file,
                options
            );
        }
        if (inventory.source.kind === "url" && destination.kind === "local") {
            return replaceCanvasUrlReferencesWithFile(
                this.app,
                inventory.source.url,
                destination.file,
                options
            );
        }

        return {
            found: inventory.mutableCanvas.length,
            replaced: 0,
            complete: false,
            files: [],
            failedFiles: [],
            uncertainFiles: ["URL-to-URL Canvas replacement is unsupported"]
        };
    }

    private serializeReplacement(
        originalLink: string,
        destination: ImageReferenceDestination,
        sourceFile: TFile,
        applyInitialSize: boolean
    ): string {
        return destination.kind === "local"
            ? this.referenceReplacer.serializeReference(
                originalLink,
                destination.file,
                sourceFile,
                {
                    applyInitialSize
                }
            )
            : ImageLinkPathReplacer.replacePath(originalLink, destination.url);
    }

    private canDeleteSource(source: ImageReferenceSource): boolean {
        if (source.kind === "local") return true;
        const cloud = this.plugin.settings?.pasteHandling?.cloud;
        try {
            return cloud?.uploader === "PicList"
                && typeof cloud.deleteServer === "string"
                && cloud.deleteServer.trim().length > 0
                && this.plugin.historyManager?.isUrlUploaded?.(source.url) === true;
        } catch {
            return false;
        }
    }

    private async refreshIndexAfterMutation(
        markdown: ReferenceUpdateResult,
        canvas: CanvasReferenceUpdateResult
    ): Promise<void> {
        const index = this.plugin.referenceIndexService;
        if (!index) return;
        const changedPaths = [
            ...markdown.files
                .filter(file => file.replaced > 0)
                .map(file => file.filePath),
            ...canvas.files
                .filter(file => file.replaced > 0)
                .map(file => file.filePath)
        ];
        if (changedPaths.length > 0) await index.refreshPaths(changedPaths);
    }
}

function getSourceTarget(source: ImageReferenceSource): string {
    return source.kind === "local" ? source.file.path : source.url;
}

function getSourceIdentity(source: ImageReferenceSource): string {
    if (source.kind === "local") return `local:${source.file.path}`;
    try {
        return `url:${new URL(source.url).toString()}`;
    } catch {
        return `url:${source.url}`;
    }
}

function getClickedReferenceText(context: ClickedImageReferenceContext): string {
    const line = context.editor.getLine(context.match.line);
    return line.slice(context.match.start, context.match.end);
}

function createInventorySignature(inventory: Omit<ReferenceInventory, "signature">): string {
    return JSON.stringify({
        source: getSourceIdentity(inventory.source),
        safetyMarkdown: inventory.safety.markdown.map(markdownKey).sort(),
        safetyCanvas: inventory.safety.canvas.map(canvasKey).sort(),
        mutableMarkdown: inventory.mutableMarkdown.map(markdownKey).sort(),
        mutableCanvas: inventory.mutableCanvas.map(canvasKey).sort(),
        safetyComplete: inventory.safety.complete,
        mutableComplete: inventory.mutableComplete,
        mutationBoundary: inventory.mutationBoundary?.allowedDocumentPaths ?? null,
        uncertainFiles: [...inventory.uncertainFiles].sort(),
        sourceRevision: inventory.sourceRevision
            ? [
                inventory.sourceRevision.path,
                inventory.sourceRevision.size,
                inventory.sourceRevision.mtime,
                inventory.sourceRevision.sha256
            ]
            : null,
        clicked: inventory.clickedContext
            ? `${inventory.clickedContext.file.path}:${inventory.clickedContext.match.line}:`
                + `${inventory.clickedContext.match.start}-${inventory.clickedContext.match.end}:`
                + inventory.clickedContext.match.linkText
            : null
    });
}

function normalizeInspectionOptions(
    value?: ClickedImageReferenceContext | ReferenceInspectionOptions
): ReferenceInspectionOptions {
    if (!value) return {};
    if ("view" in value && "editor" in value && "match" in value) {
        return { clickedContext: value };
    }
    return value;
}

function normalizeMutationBoundary(
    boundary?: ReferenceMutationBoundary
): ReferenceMutationBoundary | undefined {
    if (!boundary) return undefined;
    return Object.freeze({
        allowedDocumentPaths: Object.freeze(uniqueSorted(boundary.allowedDocumentPaths))
    });
}

function countReferenceDifference(
    allMarkdown: readonly ReferenceLocation[],
    allCanvas: readonly CanvasFileReference[],
    mutableMarkdown: readonly ReferenceLocation[],
    mutableCanvas: readonly CanvasFileReference[]
): number {
    return countMultisetDifference(
        allMarkdown.map(markdownKey),
        mutableMarkdown.map(markdownKey)
    ) + countMultisetDifference(
        allCanvas.map(canvasKey),
        mutableCanvas.map(canvasKey)
    );
}

function countMultisetDifference(all: string[], mutable: string[]): number {
    const counts = new Map<string, number>();
    for (const key of mutable) counts.set(key, (counts.get(key) ?? 0) + 1);
    let protectedCount = 0;
    for (const key of all) {
        const remaining = counts.get(key) ?? 0;
        if (remaining > 0) counts.set(key, remaining - 1);
        else protectedCount++;
    }
    return protectedCount;
}

function markdownKey(reference: ReferenceLocation): string {
    return `${reference.file.path}:${reference.start}-${reference.end}`;
}

function canvasKey(reference: CanvasFileReference): string {
    return `${reference.canvasFile.path}:${reference.lineNumber}:${reference.nodeFile}`;
}

function combineMutationResults(
    markdown: ReferenceUpdateResult,
    canvas: CanvasReferenceUpdateResult
): ReferenceWorkflowResult {
    const found = markdown.found + canvas.found;
    const changed = markdown.replaced + canvas.replaced;
    const failedFiles = uniqueSorted([...markdown.failedFiles, ...canvas.failedFiles]);
    const uncertainFiles = uniqueSorted([
        ...markdown.uncertainFiles,
        ...canvas.uncertainFiles
    ]);
    return {
        found,
        changed,
        complete: markdown.complete
            && canvas.complete
            && failedFiles.length === 0
            && uncertainFiles.length === 0
            && changed === found,
        failedFiles,
        uncertainFiles,
        sourceDeleted: false
    };
}

function staleResult(inventory: ReferenceInventory): ReferenceWorkflowResult {
    return {
        found: inventory.mutableReferences,
        changed: 0,
        complete: false,
        failedFiles: [],
        uncertainFiles: [],
        sourceDeleted: false,
        staleInventory: inventory
    };
}

function incompleteClickedResult(detail?: string): ReferenceWorkflowResult {
    return {
        found: 1,
        changed: 0,
        complete: false,
        failedFiles: detail ? [detail] : [],
        uncertainFiles: [],
        sourceDeleted: false
    };
}

function clickedMutationResult(
    filePath: string,
    mutation: Awaited<ReturnType<EditorRangeMutationTransaction["run"]>>
): ReferenceWorkflowResult {
    const complete = mutation.applied && mutation.saved;
    return {
        found: 1,
        changed: complete ? 1 : 0,
        complete,
        failedFiles: complete ? [] : [filePath],
        uncertainFiles: mutation.uncertain && mutation.error
            ? [mutation.error]
            : [],
        sourceDeleted: false
    };
}

function emptyResult(sourceDeleted: boolean): ReferenceWorkflowResult {
    return {
        found: 0,
        changed: 0,
        complete: true,
        failedFiles: [],
        uncertainFiles: [],
        sourceDeleted
    };
}

function sourceRevisionFailure(filePath: string): ReferenceWorkflowResult {
    return {
        found: 0,
        changed: 0,
        complete: false,
        failedFiles: [],
        uncertainFiles: [filePath],
        sourceDeleted: false
    };
}

function uniqueSorted(values: readonly string[]): string[] {
    return [...new Set(values.filter(Boolean))].sort();
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
