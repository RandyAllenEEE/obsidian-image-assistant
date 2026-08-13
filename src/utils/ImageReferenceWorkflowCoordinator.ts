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
import { canonicalizeHttpUrl } from "./NetworkPolicy";
import { EditorRangeMutationTransaction } from "./EditorRangeMutationTransaction";
import {
    captureImageFileRevision,
    verifyImageFileRevision,
    type ImageFileRevision
} from "./ImageFileRevision";
import type {
    ReferenceIndexToken
} from "./ImageReferenceIndexService";
import { LocalFileDeletionService } from "./LocalFileDeletionService";

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
    readonly signal?: AbortSignal;
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
    readonly indexToken?: ReferenceIndexToken;
}

export interface ReferenceWorkflowResult {
    readonly found: number;
    readonly changed: number;
    readonly complete: boolean;
    readonly failedFiles: readonly string[];
    readonly uncertainFiles: readonly string[];
    readonly sourceDeleted: boolean;
    readonly changedFiles?: readonly string[];
    readonly sourceDeleteResult?: CloudDeleteResult;
    readonly staleInventory?: ReferenceInventory;
}

export type ReferenceWorkflowProgressStage =
    | "index"
    | "verify"
    | "mutate"
    | "delete";

export interface ReferenceWorkflowProgress {
    readonly stage: ReferenceWorkflowProgressStage;
    readonly processed: number;
    readonly total: number;
}

export interface ReferenceWorkflowSession {
    readonly inventory: ReferenceInventory;
    readonly createdAt: number;
}

export interface ReferenceWorkflowExecutionOptions {
    readonly destination?: ImageReferenceDestination;
    readonly signal?: AbortSignal;
    readonly onProgress?: (progress: ReferenceWorkflowProgress) => void;
    readonly onCommitStart?: () => void;
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
    private readonly localFileDeletion: LocalFileDeletionService;
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
        this.localFileDeletion = new LocalFileDeletionService(
            app,
            () => plugin.settings.cleanerSettings
        );
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
        const signal = options.signal;
        const mutationPolicy = createReferenceMutationScanPolicy(
            this.plugin.settings?.global?.codeBlockImageLinkIndexing ?? true
        );
        let safety: ReferenceSafetyReport;
        let mutableMarkdownScan: {
            locations: ReferenceLocation[];
            complete: boolean;
            uncertainFiles: string[];
        } = {
            locations: [],
            complete: false,
            uncertainFiles: []
        };
        let mutableCanvas: CanvasFileReference[] = [];
        let mutableCanvasComplete = false;
        let mutableCanvasUncertainFiles: string[] = [];
        let indexToken: ReferenceIndexToken | undefined;

        if (this.plugin.referenceIndexService) {
            const indexed = source.kind === "local"
                ? await this.plugin.referenceIndexService.inspectLocalFileInventory(
                    source.file,
                    mutationPolicy.includeFencedCode,
                    signal
                )
                : await this.plugin.referenceIndexService.inspectUrlInventory(
                    source.url,
                    mutationPolicy.includeFencedCode,
                    signal
                );
            safety = toSafetyReport(indexed.safety);
            indexToken = indexed.token;
            mutableMarkdownScan = {
                locations: [...indexed.mutation.markdown],
                complete: indexed.mutation.complete,
                uncertainFiles: [...indexed.mutation.uncertainFiles]
            };
            mutableCanvas = [...indexed.mutation.canvas];
            mutableCanvasComplete = indexed.mutation.complete;
            mutableCanvasUncertainFiles = [...indexed.mutation.uncertainFiles];
        } else {
            safety = source.kind === "local"
                ? await this.safetyService.inspectLocalFile(source.file)
                : await this.safetyService.inspectUrl(source.url);
        }

        if (this.plugin.referenceIndexService) {
            // The paired v3 inventory above already projected both policies
            // from one parsed record set.
        } else if (mutationPolicy.includeFencedCode) {
            mutableMarkdownScan = {
                locations: safety.markdown,
                complete: safety.complete,
                uncertainFiles: safety.uncertainFiles
            };
            mutableCanvas = safety.canvas;
            mutableCanvasComplete = safety.complete;
            mutableCanvasUncertainFiles = safety.uncertainFiles;
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
            sourceDeletable,
            sourceRevision: undefined,
            canDeleteAfterAll: safety.complete
                && mutableComplete
                && protectedFencedReferences === 0
                && outOfBoundaryReferences === 0
                && sourceDeletable,
            indexToken
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

    async beginSession(
        source: ImageReferenceSource,
        contextOrOptions?: ClickedImageReferenceContext | ReferenceInspectionOptions
    ): Promise<ReferenceWorkflowSession> {
        return Object.freeze({
            inventory: await this.inspect(source, contextOrOptions),
            createdAt: Date.now()
        });
    }

    async executeDecision(
        session: ReferenceWorkflowSession,
        decision: ReferenceWorkflowDecision,
        options: ReferenceWorkflowExecutionOptions = {}
    ): Promise<ReferenceWorkflowResult> {
        if (decision.action === "cancel" || decision.action === "keep-transfer") {
            return emptyResult(false);
        }
        const signal = options.signal;
        const inventory = session.inventory;
        return ImageReferenceWorkflowCoordinator.sourceLock.acquire(
            getSourceIdentity(inventory.source),
            async () => {
                throwIfAborted(signal);
                if (decision.scope === "clicked") {
                    options.onProgress?.({
                        stage: "mutate",
                        processed: 0,
                        total: 1
                    });
                    options.onCommitStart?.();
                    const clickedResult = options.destination
                        ? await this.replaceClickedReference(inventory, options.destination)
                        : await this.removeClickedReference(inventory);
                    options.onProgress?.({
                        stage: "mutate",
                        processed: clickedResult.changed,
                        total: clickedResult.found
                    });
                    return clickedResult;
                }

                options.onProgress?.({
                    stage: "verify",
                    processed: 0,
                    total: countMutableFiles(inventory)
                });
                if (decision.deleteSource) {
                    await this.plugin.referenceIndexService?.reconcile(signal);
                    throwIfAborted(signal);
                }
                const fresh = await this.getFreshInventoryForExecution(
                    inventory,
                    signal
                );
                if (fresh.signature !== inventory.signature) {
                    return staleResult(fresh);
                }

                let revision: ImageFileRevision | undefined;
                if (decision.deleteSource && fresh.source.kind === "local") {
                    try {
                        revision = await captureImageFileRevision(
                            this.app,
                            fresh.source.file
                        );
                    } catch {
                        return sourceRevisionFailure(fresh.source.file.path);
                    }
                }

                let mutation = emptyResult(false);
                if (decision.scope === "all") {
                    throwIfAborted(signal);
                    options.onProgress?.({
                        stage: "mutate",
                        processed: 0,
                        total: countMutableFiles(fresh)
                    });
                    options.onCommitStart?.();
                    mutation = options.destination
                        ? await this.replaceAllReferences(fresh, options.destination)
                        : await this.removeAllReferences(fresh);
                    options.onProgress?.({
                        stage: "mutate",
                        processed: mutation.changedFiles?.length ?? 0,
                        total: countMutableFiles(fresh)
                    });
                    if (!mutation.complete || mutation.changed !== mutation.found) {
                        return mutation;
                    }
                }

                if (!decision.deleteSource) return mutation;

                options.onProgress?.({
                    stage: "delete",
                    processed: 0,
                    total: 1
                });
                const finalSafety = await this.inspectFinalSafety(
                    fresh.source,
                    signal
                );
                if (!finalSafety.safeToDelete || !fresh.sourceDeletable) {
                    return {
                        ...mutation,
                        complete: false,
                        uncertainFiles: uniqueSorted([
                            ...mutation.uncertainFiles,
                            ...finalSafety.uncertainFiles
                        ]),
                        sourceDeleted: false
                    };
                }
                if (decision.scope === "none") options.onCommitStart?.();
                const deletion = await this.deleteSourceInternal(
                    fresh.source,
                    revision,
                    signal
                );
                options.onProgress?.({
                    stage: "delete",
                    processed: deletion.sourceDeleted ? 1 : 0,
                    total: 1
                });
                return mergeMutationAndDeletion(mutation, deletion);
            },
            signal
        );
    }

    async executeClickedOnly(
        source: ImageReferenceSource,
        clickedContext: ClickedImageReferenceContext,
        options: {
            readonly destination?: ImageReferenceDestination;
            readonly signal?: AbortSignal;
            readonly onCommitStart?: () => void;
        } = {}
    ): Promise<ReferenceWorkflowResult> {
        return ImageReferenceWorkflowCoordinator.sourceLock.acquire(
            getSourceIdentity(source),
            async () => {
                throwIfAborted(options.signal);
                options.onCommitStart?.();
                return options.destination
                    ? this.replaceClickedReferenceContext(
                        source,
                        clickedContext,
                        options.destination
                    )
                    : this.removeClickedReferenceContext(clickedContext);
            },
            options.signal
        );
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
        scope: ReferenceOperationScope,
        signal?: AbortSignal
    ): Promise<ReferenceWorkflowResult> {
        return this.executeDecision(
            { inventory, createdAt: Date.now() },
            {
                action: scope === "clicked"
                    ? "clicked-keep-source"
                    : "all-keep-source",
                scope,
                deleteSource: false
            },
            { destination, signal }
        );
    }

    async remove(
        inventory: ReferenceInventory,
        scope: ReferenceOperationScope,
        signal?: AbortSignal
    ): Promise<ReferenceWorkflowResult> {
        return this.executeDecision(
            { inventory, createdAt: Date.now() },
            {
                action: scope === "clicked"
                    ? "clicked-keep-source"
                    : "all-keep-source",
                scope,
                deleteSource: false
            },
            { signal }
        );
    }

    async deleteSource(
        source: ImageReferenceSource,
        expectedRevision?: ImageFileRevision,
        signal?: AbortSignal
    ): Promise<ReferenceWorkflowResult> {
        return ImageReferenceWorkflowCoordinator.sourceLock.acquire(
            getSourceIdentity(source),
            async () => {
                if (source.kind === "local"
                    && expectedRevision
                    && source.file.path !== expectedRevision.path) {
                    return sourceRevisionFailure(expectedRevision.path);
                }
                const finalSafety = await this.inspectFinalSafety(source, signal);
                if (!finalSafety.safeToDelete || !this.canDeleteSource(source)) {
                    return {
                        found: finalSafety.referenceCount,
                        changed: 0,
                        complete: false,
                        failedFiles: [],
                        uncertainFiles: finalSafety.uncertainFiles,
                        sourceDeleted: false
                    };
                }

                let revision = expectedRevision;
                if (source.kind === "local" && !revision) {
                    try {
                        revision = await captureImageFileRevision(this.app, source.file);
                    } catch {
                        return sourceRevisionFailure(source.file.path);
                    }
                }
                return this.deleteSourceInternal(source, revision, signal);
            },
            signal
        );
    }

    private async getFreshInventoryForExecution(
        inventory: ReferenceInventory,
        signal?: AbortSignal
    ): Promise<ReferenceInventory> {
        const index = this.plugin.referenceIndexService;
        if (index
            && inventory.indexToken
            && await index.isTokenCurrent(inventory.indexToken, signal)) {
            return inventory;
        }
        return this.inspect(inventory.source, {
            clickedContext: inventory.clickedContext,
            mutationBoundary: inventory.mutationBoundary,
            signal
        });
    }

    private async inspectFinalSafety(
        source: ImageReferenceSource,
        signal?: AbortSignal
    ): Promise<ReferenceSafetyReport> {
        await this.plugin.referenceIndexService?.reconcile(signal);
        throwIfAborted(signal);
        return source.kind === "local"
            ? this.safetyService.inspectLocalFile(source.file, signal)
            : this.safetyService.inspectUrl(source.url, signal);
    }

    private async deleteSourceInternal(
        source: ImageReferenceSource,
        expectedRevision?: ImageFileRevision,
        signal?: AbortSignal
    ): Promise<ReferenceWorkflowResult> {
        throwIfAborted(signal);
        if (source.kind === "local") {
            if (!expectedRevision) {
                return sourceRevisionFailure(source.file.path);
            }
            const revisionCheck = await verifyImageFileRevision(
                this.app,
                expectedRevision
            );
            if (!revisionCheck.matches) {
                return sourceRevisionFailure(source.file.path);
            }
            const currentSource = this.app.vault.getAbstractFileByPath(
                expectedRevision.path
            );
            if (!(currentSource instanceof TFile)) {
                return sourceRevisionFailure(expectedRevision.path);
            }
            try {
                throwIfAborted(signal);
                await this.localFileDeletion.delete(currentSource);
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

        const sourceDeleteResult = signal
            ? await this.cloudDeleter.deleteImageDetailed(
                { url: source.url },
                signal
            )
            : await this.cloudDeleter.deleteImageDetailed({
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
                : [sourceDeleteResult.message
                    ?? sourceDeleteResult.reason
                    ?? "Cloud deletion failed"],
            sourceDeleted: sourceDeleteResult.success,
            sourceDeleteResult
        };
    }

    private async replaceClickedReference(
        inventory: ReferenceInventory,
        destination: ImageReferenceDestination
    ): Promise<ReferenceWorkflowResult> {
        const context = inventory.clickedContext;
        if (!context) return incompleteClickedResult();
        return this.replaceClickedReferenceContext(
            inventory.source,
            context,
            destination
        );
    }

    private async replaceClickedReferenceContext(
        source: ImageReferenceSource,
        context: ClickedImageReferenceContext,
        destination: ImageReferenceDestination
    ): Promise<ReferenceWorkflowResult> {
        const current = getClickedReferenceText(context);
        if (current !== context.match.linkText) return incompleteClickedResult(context.file.path);
        if (destination.kind === "local") await this.referenceReplacer.prepare();

        let replacement: string;
        try {
            replacement = this.serializeReplacement(
                current,
                destination,
                context.file,
                source.kind === "url"
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
        return this.removeClickedReferenceContext(context);
    }

    private async removeClickedReferenceContext(
        context: ClickedImageReferenceContext
    ): Promise<ReferenceWorkflowResult> {
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
        if (destination.kind === "local") await this.referenceReplacer.prepare();
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
            const transportAvailable =
                typeof this.cloudDeleter.isDesktopTransportAvailable === "function"
                    ? this.cloudDeleter.isDesktopTransportAvailable()
                    : true;
            return cloud?.uploader === "PicList"
                && typeof cloud.deleteServer === "string"
                && cloud.deleteServer.trim().length > 0
                && canonicalizeHttpUrl(cloud.deleteServer) !== null
                && this.plugin.historyManager?.isUrlUploaded?.(source.url) === true
                && transportAvailable;
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
    return `url:${canonicalizeHttpUrl(source.url) ?? source.url}`;
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

function countMutableFiles(inventory: ReferenceInventory): number {
    return new Set([
        ...inventory.mutableMarkdown.map(reference => reference.file.path),
        ...inventory.mutableCanvas.map(reference => reference.canvasFile.path)
    ]).size;
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
    const changedFiles = uniqueSorted([
        ...markdown.files
            .filter(file => file.replaced > 0)
            .map(file => file.filePath),
        ...canvas.files
            .filter(file => file.replaced > 0)
            .map(file => file.filePath)
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
        changedFiles,
        sourceDeleted: false
    };
}

function mergeMutationAndDeletion(
    mutation: ReferenceWorkflowResult,
    deletion: ReferenceWorkflowResult
): ReferenceWorkflowResult {
    return {
        found: mutation.found,
        changed: mutation.changed,
        complete: mutation.complete && deletion.complete,
        failedFiles: uniqueSorted([
            ...mutation.failedFiles,
            ...deletion.failedFiles
        ]),
        uncertainFiles: uniqueSorted([
            ...mutation.uncertainFiles,
            ...deletion.uncertainFiles
        ]),
        changedFiles: uniqueSorted([
            ...(mutation.changedFiles ?? []),
            ...(deletion.changedFiles ?? [])
        ]),
        sourceDeleted: deletion.sourceDeleted,
        sourceDeleteResult: deletion.sourceDeleteResult
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
        changedFiles: complete ? [filePath] : [],
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
        changedFiles: [],
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

function toSafetyReport(
    snapshot: {
        readonly complete: boolean;
        readonly markdown: readonly ReferenceLocation[];
        readonly canvas: readonly CanvasFileReference[];
        readonly uncertainFiles: readonly string[];
        readonly referenceCount: number;
        readonly safeToDelete: boolean;
    }
): ReferenceSafetyReport {
    return {
        complete: snapshot.complete,
        markdown: [...snapshot.markdown],
        canvas: [...snapshot.canvas],
        uncertainFiles: [...snapshot.uncertainFiles],
        referenceCount: snapshot.referenceCount,
        safeToDelete: snapshot.safeToDelete
    };
}

function throwIfAborted(signal?: AbortSignal): void {
    if (!signal?.aborted) return;
    throw signal.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
}
