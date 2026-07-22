import {
    App,
    Component,
    MarkdownView,
    normalizePath,
    TFile,
    type TAbstractFile
} from "obsidian";
import type { CanvasFileReference } from "./CanvasReferenceUtils";
import {
    LocalImageTargetResolver,
    type LocalReferenceSyntax
} from "./LocalImageTargetResolver";
import type { ReferenceLocation } from "./VaultReferenceManager";
import {
    ReferenceIndexActivityGate
} from "./reference-index/ReferenceIndexActivityGate";
import {
    REFERENCE_INDEX_VERSION,
    type ReferenceIndexDocumentMetadata
} from "./reference-index/ReferenceIndexDocument";
import type {
    ReferenceIndexCandidateDTO,
    ReferenceIndexCandidateQueryResult,
    ReferenceIndexDocumentHeader
} from "./reference-index/ReferenceIndexWorkerCore";
import {
    isReferenceIndexWorkerUnavailable,
    ReferenceIndexWorkerClient
} from "./reference-index/ReferenceIndexWorkerClient";
import {
    getSharedVaultFileLookupService,
    type VaultFileLookupService
} from "./VaultFileLookupService";

const INDEX_FILENAME = "image-reference-index.json";
const PERSIST_QUIET_PERIOD_MS = 2_000;
const RECONCILIATION_INTERVAL_MS = 10 * 60_000;

export type ReferenceIndexReadiness = "loading" | "ready" | "degraded";

interface OpenDocumentToken {
    readonly path: string;
    readonly version: number;
}

interface OpenDocumentCacheEntry {
    readonly identity: unknown;
    readonly content?: string;
    readonly version: number;
}

interface OpenOverlaySnapshot {
    readonly paths: readonly string[];
    readonly conflicts: ReadonlySet<string>;
    readonly tokens: readonly OpenDocumentToken[];
}

export interface ReferenceIndexToken {
    readonly generation: number;
    readonly topologyGeneration: number;
    readonly openDocuments: readonly OpenDocumentToken[];
}

export interface ReferenceIndexSnapshot {
    readonly generation: number;
    readonly token: ReferenceIndexToken;
    readonly readiness: ReferenceIndexReadiness;
    readonly complete: boolean;
    readonly markdown: readonly ReferenceLocation[];
    readonly canvas: readonly CanvasFileReference[];
    readonly uncertainFiles: readonly string[];
    readonly referenceCount: number;
    readonly safeToDelete: boolean;
}

export interface ReferenceIndexQuery {
    readonly includeFencedCode: boolean;
}

export interface ReferenceIndexInventory {
    readonly token: ReferenceIndexToken;
    readonly readiness: ReferenceIndexReadiness;
    readonly safety: ReferenceIndexSnapshot;
    readonly mutation: ReferenceIndexSnapshot;
}

interface MutableSnapshot {
    readonly markdown: ReferenceLocation[];
    readonly canvas: CanvasFileReference[];
    readonly uncertain: Set<string>;
}

/**
 * Worker-backed V3 reference index. Obsidian objects and final local-path
 * resolution stay on the renderer thread; parsing and raw reverse buckets do not.
 */
export class ImageReferenceIndexService extends Component {
    private readonly worker: ReferenceIndexWorkerClient;
    private readonly activityGate: ReferenceIndexActivityGate;
    private readonly fileLookup: VaultFileLookupService;
    private readonly resolver: LocalImageTargetResolver;
    private readonly headers = new Map<string, ReferenceIndexDocumentHeader>();
    private readonly dirtyPaths = new Set<string>();
    private readonly uncertainPaths = new Set<string>();
    private readonly openDocumentCache = new Map<string, OpenDocumentCacheEntry>();

    private startPromise: Promise<void> | null = null;
    private refreshPromise: Promise<void> | null = null;
    private persistPromise: Promise<void> = Promise.resolve();
    private persistTimer: number | null = null;
    private reconciliationTimer: number | null = null;
    private backgroundRefreshScheduled = false;
    private backgroundPauseController: AbortController | null = null;
    private generation = 0;
    private readiness: ReferenceIndexReadiness = "loading";
    private destroyed = false;
    private lifecycleLoaded = false;
    private foregroundRequested = false;
    private workerAvailable = true;
    private workerFailureReported = false;
    private workerRestartAttempted = false;

    constructor(
        private readonly app: App,
        _getConcurrency: () => number
    ) {
        super();
        void _getConcurrency;
        this.worker = new ReferenceIndexWorkerClient(
            undefined,
            error => this.handleWorkerFailure(error)
        );
        this.activityGate = new ReferenceIndexActivityGate(app);
        this.fileLookup = getSharedVaultFileLookupService(app);
        this.resolver = new LocalImageTargetResolver(app, this.fileLookup);
    }

    onload(): void {
        this.lifecycleLoaded = true;
        this.addChild(this.activityGate);
        this.registerVaultEvents();
        this.scheduleWarmup();
    }

    start(): Promise<void> {
        this.requestForeground();
        return this.ensureInitialized();
    }

    getReadiness(): ReferenceIndexReadiness {
        return this.readiness;
    }

    async inspectLocalFile(
        target: TFile,
        query: ReferenceIndexQuery,
        signal?: AbortSignal
    ): Promise<ReferenceIndexSnapshot> {
        const snapshots = await this.inspectLocalFiles([target], query, signal);
        return snapshots.get(normalizePath(target.path))
            ?? createSnapshot(
                this.generation,
                this.createToken([]),
                this.readiness,
                [],
                [],
                new Set([INDEX_FILENAME])
            );
    }

    async inspectLocalFiles(
        targets: readonly TFile[],
        query: ReferenceIndexQuery,
        signal?: AbortSignal
    ): Promise<ReadonlyMap<string, ReferenceIndexSnapshot>> {
        const overlays = await this.prepareForQuery(signal);
        return this.queryLocalFiles(targets, query.includeFencedCode, overlays, signal);
    }

    async inspectLocalFileInventory(
        target: TFile,
        mutationIncludeFencedCode: boolean,
        signal?: AbortSignal
    ): Promise<ReferenceIndexInventory> {
        const overlays = await this.prepareForQuery(signal);
        const token = this.createToken(overlays.tokens);
        const safetyMap = await this.queryLocalFiles([target], true, overlays, signal);
        const mutationMap = mutationIncludeFencedCode
            ? safetyMap
            : await this.queryLocalFiles([target], false, overlays, signal);
        const fallback = createSnapshot(
            this.generation,
            token,
            this.readiness,
            [],
            [],
            new Set([INDEX_FILENAME])
        );
        return {
            token,
            readiness: this.readiness,
            safety: safetyMap.get(normalizePath(target.path)) ?? fallback,
            mutation: mutationMap.get(normalizePath(target.path)) ?? fallback
        };
    }

    async inspectUrl(
        targetUrl: string,
        query: ReferenceIndexQuery,
        signal?: AbortSignal
    ): Promise<ReferenceIndexSnapshot> {
        const overlays = await this.prepareForQuery(signal);
        return this.queryUrl(targetUrl, query.includeFencedCode, overlays, signal);
    }

    async inspectUrlInventory(
        targetUrl: string,
        mutationIncludeFencedCode: boolean,
        signal?: AbortSignal
    ): Promise<ReferenceIndexInventory> {
        const overlays = await this.prepareForQuery(signal);
        const token = this.createToken(overlays.tokens);
        const safety = await this.queryUrl(targetUrl, true, overlays, signal);
        const mutation = mutationIncludeFencedCode
            ? safety
            : await this.queryUrl(targetUrl, false, overlays, signal);
        return { token, readiness: this.readiness, safety, mutation };
    }

    async getToken(signal?: AbortSignal): Promise<ReferenceIndexToken> {
        const overlays = await this.prepareForQuery(signal);
        return this.createToken(overlays.tokens);
    }

    async isTokenCurrent(
        token: ReferenceIndexToken,
        signal?: AbortSignal
    ): Promise<boolean> {
        if (token.generation !== this.generation
            || token.topologyGeneration !== this.fileLookup.getGeneration()) {
            return false;
        }
        const overlays = await this.collectOpenMarkdownOverlays(signal);
        return areOpenDocumentTokensEqual(token.openDocuments, overlays.tokens);
    }

    markDirty(path: string): void {
        const normalized = normalizePath(path);
        if (!isIndexablePath(normalized)) return;
        this.dirtyPaths.add(normalized);
        this.generation++;
        this.scheduleBackgroundRefresh();
    }

    async refreshPaths(paths: readonly string[]): Promise<void> {
        this.requestForeground();
        paths.forEach(path => this.markDirty(path));
        await this.ensureInitialized();
        await this.refreshDirty();
    }

    async reconcile(signal?: AbortSignal): Promise<void> {
        this.requestForeground();
        throwIfAborted(signal);
        await waitForPromise(this.ensureInitialized(), signal);
        await this.fileLookup.reconcile(signal);
        this.markMismatchedDocumentsDirty();
        await waitForPromise(this.refreshDirty(), signal);
    }

    getGeneration(): number {
        return this.generation;
    }

    onunload(): void {
        this.destroyed = true;
        this.backgroundPauseController?.abort(
            new DOMException("Reference index service was unloaded.", "AbortError")
        );
        this.backgroundPauseController = null;
        if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
        if (this.reconciliationTimer !== null) window.clearTimeout(this.reconciliationTimer);
        this.persistTimer = null;
        this.reconciliationTimer = null;
        void this.worker.terminate();
        super.onunload();
    }

    private scheduleWarmup(): void {
        void this.activityGate.waitForIdle()
            .then(() => this.ensureInitialized())
            .catch(error => this.handleWorkerFailure(error));
    }

    private ensureInitialized(): Promise<void> {
        if (!this.startPromise) {
            this.startPromise = this.initialize()
                .then(() => {
                    if (this.workerAvailable) {
                        this.readiness = this.uncertainPaths.has(INDEX_FILENAME)
                            ? "degraded"
                            : "ready";
                    }
                    this.scheduleReconciliation();
                })
                .catch(error => this.handleWorkerFailure(error));
        }
        return this.startPromise;
    }

    private async initialize(): Promise<void> {
        if (this.destroyed) return;
        this.worker.start();
        await this.loadPersisted();
        const currentPaths = new Set<string>();
        for (const file of this.getIndexableFiles()) {
            currentPaths.add(file.path);
            const indexed = this.headers.get(file.path);
            if (!indexed
                || normalizeMtime(indexed.mtime) !== normalizeMtime(file.stat.mtime)
                || indexed.size !== file.stat.size) {
                this.dirtyPaths.add(file.path);
            }
        }
        for (const path of [...this.headers.keys()]) {
            if (currentPaths.has(path)) continue;
            await this.worker.deleteDocument(path);
            this.headers.delete(path);
            this.generation++;
        }
        await this.refreshDirty();
    }

    private registerVaultEvents(): void {
        const vault = this.app.vault;
        this.registerEvent(vault.on("create", file => {
            this.fileLookup.handleCreate(file);
            if (file instanceof TFile && isIndexablePath(file.path)) this.markDirty(file.path);
        }));
        this.registerEvent(vault.on("modify", file => {
            if (file instanceof TFile && isIndexablePath(file.path)) this.markDirty(file.path);
        }));
        this.registerEvent(vault.on("delete", file => {
            this.fileLookup.handleDelete(file);
            if (isIndexablePath(file.path)) void this.removeDocument(file);
        }));
        this.registerEvent(vault.on("rename", (file, oldPath) => {
            this.fileLookup.handleRename(file, oldPath);
            if (!isIndexablePath(oldPath) && !isIndexablePath(file.path)) return;
            void this.deleteIndexedDocument(oldPath);
            if (file instanceof TFile && isIndexablePath(file.path)) this.markDirty(file.path);
        }));
    }

    private async removeDocument(file: TAbstractFile): Promise<void> {
        await this.deleteIndexedDocument(file.path);
        this.dirtyPaths.delete(normalizePath(file.path));
        this.uncertainPaths.delete(normalizePath(file.path));
        this.openDocumentCache.delete(normalizePath(file.path));
        this.schedulePersist();
    }

    private async deleteIndexedDocument(path: string): Promise<void> {
        const normalized = normalizePath(path);
        if (this.workerAvailable && this.startPromise) {
            try {
                await this.worker.deleteDocument(normalized);
            } catch (error) {
                this.handleWorkerFailure(error);
            }
        }
        if (this.headers.delete(normalized)) this.generation++;
    }

    private async prepareForQuery(signal?: AbortSignal): Promise<OpenOverlaySnapshot> {
        throwIfAborted(signal);
        this.requestForeground();
        await waitForPromise(this.ensureInitialized(), signal);
        await waitForPromise(this.refreshDirty(), signal);
        throwIfAborted(signal);
        return this.collectOpenMarkdownOverlays(signal);
    }

    private async refreshDirty(): Promise<void> {
        if (this.destroyed || !this.workerAvailable) return;
        if (!this.refreshPromise) {
            this.refreshPromise = this.drainDirty().finally(() => {
                this.refreshPromise = null;
            });
        }
        await this.refreshPromise;
        if (this.dirtyPaths.size > 0 && !this.destroyed) await this.refreshDirty();
    }

    private async drainDirty(): Promise<void> {
        while (this.dirtyPaths.size > 0 && !this.destroyed && this.workerAvailable) {
            const paths = [...this.dirtyPaths].sort();
            paths.forEach(path => this.dirtyPaths.delete(path));
            for (const path of paths) {
                if (!this.foregroundRequested) await this.waitForBackgroundPermission();
                if (this.destroyed) return;
                await this.indexPath(path);
            }
        }
        this.schedulePersist();
    }

    private async indexPath(path: string): Promise<void> {
        const file = this.getFile(path);
        if (!file || !isIndexablePath(file.path)) {
            await this.deleteIndexedDocument(path);
            return;
        }
        try {
            const content = await this.app.vault.read(file);
            const header = await this.worker.upsertDocument(toMetadata(file), content);
            this.headers.set(header.path, header);
            this.uncertainPaths.delete(path);
        } catch {
            await this.deleteIndexedDocument(path);
            this.uncertainPaths.add(path);
        } finally {
            this.generation++;
        }
    }

    private scheduleBackgroundRefresh(): void {
        if (!this.lifecycleLoaded || !this.startPromise || this.backgroundRefreshScheduled) return;
        this.backgroundRefreshScheduled = true;
        void this.activityGate.waitForIdle()
            .then(async () => {
                this.backgroundRefreshScheduled = false;
                this.foregroundRequested = false;
                await this.refreshDirty();
            })
            .catch(error => {
                this.backgroundRefreshScheduled = false;
                this.handleWorkerFailure(error);
            });
    }

    private async waitForBackgroundPermission(): Promise<void> {
        if (!this.lifecycleLoaded || this.foregroundRequested) return;
        const controller = new AbortController();
        this.backgroundPauseController = controller;
        try {
            await this.worker.setPaused(true);
            await this.activityGate.waitForIdle(controller.signal);
        } catch (error) {
            if (!isAbortError(error) || !this.foregroundRequested) throw error;
        } finally {
            if (this.backgroundPauseController === controller) {
                this.backgroundPauseController = null;
            }
            if (this.workerAvailable && !this.destroyed) await this.worker.setPaused(false);
        }
    }

    private requestForeground(): void {
        this.foregroundRequested = true;
        this.backgroundPauseController?.abort(
            new DOMException("Foreground reference query requested.", "AbortError")
        );
    }

    private markMismatchedDocumentsDirty(): void {
        const currentPaths = new Set<string>();
        for (const file of this.getIndexableFiles()) {
            currentPaths.add(file.path);
            const indexed = this.headers.get(file.path);
            if (!indexed
                || normalizeMtime(indexed.mtime) !== normalizeMtime(file.stat.mtime)
                || indexed.size !== file.stat.size) {
                this.markDirty(file.path);
            }
        }
        for (const path of [...this.headers.keys()]) {
            if (!currentPaths.has(path)) void this.deleteIndexedDocument(path);
        }
    }

    private async collectOpenMarkdownOverlays(
        signal?: AbortSignal
    ): Promise<OpenOverlaySnapshot> {
        const candidates = new Map<string, Array<{
            file: TFile;
            editor: MarkdownView["editor"] & { getValue(): string };
            identity: unknown;
        }>>();
        this.app.workspace.iterateAllLeaves?.(leaf => {
            const view = leaf.view;
            if (!isMarkdownEditorView(view)) return;
            const existing = candidates.get(view.file.path) ?? [];
            existing.push({
                file: view.file,
                editor: view.editor,
                identity: getEditorDocumentIdentity(view.editor)
            });
            candidates.set(view.file.path, existing);
        });

        const paths: string[] = [];
        const conflicts = new Set<string>();
        const tokens: OpenDocumentToken[] = [];
        for (const [path, entries] of candidates) {
            throwIfAborted(signal);
            const identities = new Set(entries.map(entry => entry.identity));
            const unknownIdentityContents = entries.some(entry => entry.identity === undefined)
                ? new Set(entries.map(entry => entry.editor.getValue()))
                : null;
            if (entries.length > 1
                && (identities.size > 1 || (unknownIdentityContents?.size ?? 0) > 1)) {
                conflicts.add(path);
                continue;
            }
            const entry = entries[0];
            const cached = this.openDocumentCache.get(path);
            const content = entry.identity === undefined
                ? entry.editor.getValue()
                : undefined;
            if (cached
                && cached.identity === entry.identity
                && (entry.identity !== undefined || cached.content === content)) {
                paths.push(path);
                tokens.push({ path, version: cached.version });
                continue;
            }
            const currentContent = content ?? entry.editor.getValue();
            const version = (cached?.version ?? 0) + 1;
            if (this.workerAvailable) {
                try {
                    await this.worker.upsertOverlay({
                        ...toMetadata(entry.file),
                        size: currentContent.length
                    }, currentContent, signal);
                } catch (error) {
                    this.handleWorkerFailure(error);
                }
            }
            this.openDocumentCache.set(path, {
                identity: entry.identity,
                content: entry.identity === undefined ? currentContent : undefined,
                version
            });
            if (this.workerAvailable) paths.push(path);
            tokens.push({ path, version });
        }

        for (const path of [...this.openDocumentCache.keys()]) {
            if (candidates.has(path) && !conflicts.has(path)) continue;
            this.openDocumentCache.delete(path);
            if (this.workerAvailable) {
                try {
                    await this.worker.deleteOverlay(path, signal);
                } catch (error) {
                    this.handleWorkerFailure(error);
                }
            }
        }
        conflicts.forEach(path => tokens.push({ path, version: -1 }));
        tokens.sort((left, right) => left.path.localeCompare(right.path));
        return { paths, conflicts, tokens };
    }

    private async queryLocalFiles(
        targets: readonly TFile[],
        includeFencedCode: boolean,
        overlays: OpenOverlaySnapshot,
        signal?: AbortSignal
    ): Promise<ReadonlyMap<string, ReferenceIndexSnapshot>> {
        throwIfAborted(signal);
        const commonUncertain = this.getCommonUncertain(overlays);
        const states = new Map<string, MutableSnapshot>();
        const targetsByBasename = new Map<string, Map<string, TFile>>();
        targets.forEach(target => {
            const path = normalizePath(target.path);
            states.set(path, {
                markdown: [],
                canvas: [],
                uncertain: new Set(commonUncertain)
            });
            const basename = target.name.toLowerCase();
            const values = targetsByBasename.get(basename) ?? new Map<string, TFile>();
            values.set(path, target);
            targetsByBasename.set(basename, values);
        });
        if (!this.workerAvailable) {
            states.forEach(state => state.uncertain.add(INDEX_FILENAME));
            return this.finalizeLocalStates(states, overlays.tokens);
        }

        await this.fileLookup.ensureReady(signal);
        const basenames = [...targetsByBasename.keys()].sort();
        let buckets: Record<string, ReferenceIndexCandidateQueryResult>;
        try {
            buckets = await this.worker.queryLocal(
                basenames,
                includeFencedCode,
                overlays.paths,
                signal
            );
        } catch (error) {
            if (isAbortError(error)) throw error;
            this.handleWorkerFailure(error);
            states.forEach(state => state.uncertain.add(INDEX_FILENAME));
            return this.finalizeLocalStates(states, overlays.tokens);
        }
        for (const basename of basenames) {
            const targetFiles = targetsByBasename.get(basename);
            if (!targetFiles) continue;
            const bucket = buckets[basename];
            bucket?.uncertainDocuments.forEach(path =>
                targetFiles.forEach((_target, targetPath) =>
                    states.get(targetPath)?.uncertain.add(path)));
            for (const candidate of bucket?.references ?? []) {
                throwIfAborted(signal);
                const sourceFile = this.getFile(candidate.documentPath);
                if (!sourceFile) {
                    targetFiles.forEach((_target, targetPath) =>
                        states.get(targetPath)?.uncertain.add(candidate.documentPath));
                    continue;
                }
                const resolution = await this.resolver.resolveAsync(
                    candidate.value,
                    sourceFile,
                    { syntax: toLocalSyntax(candidate) },
                    signal
                );
                if (resolution.status === "resolved" && resolution.file) {
                    const targetPath = normalizePath(resolution.file.path);
                    const state = states.get(targetPath);
                    if (state) this.addCandidate(candidate, sourceFile, state);
                    continue;
                }
                const affected = resolution.candidates
                    .map(file => normalizePath(file.path))
                    .filter(path => targetFiles.has(path));
                const uncertainTargets = affected.length > 0
                    ? affected
                    : [...targetFiles.keys()];
                uncertainTargets.forEach(path =>
                    states.get(path)?.uncertain.add(candidate.documentPath));
            }
        }
        return this.finalizeLocalStates(states, overlays.tokens);
    }

    private async queryUrl(
        targetUrl: string,
        includeFencedCode: boolean,
        overlays: OpenOverlaySnapshot,
        signal?: AbortSignal
    ): Promise<ReferenceIndexSnapshot> {
        const state: MutableSnapshot = {
            markdown: [],
            canvas: [],
            uncertain: this.getCommonUncertain(overlays)
        };
        if (!this.workerAvailable) {
            state.uncertain.add(INDEX_FILENAME);
        } else {
            let result: ReferenceIndexCandidateQueryResult;
            try {
                result = await this.worker.queryUrl(
                    targetUrl,
                    includeFencedCode,
                    overlays.paths,
                    signal
                );
            } catch (error) {
                if (isAbortError(error)) throw error;
                this.handleWorkerFailure(error);
                state.uncertain.add(INDEX_FILENAME);
                return createSnapshot(
                    this.generation,
                    this.createToken(overlays.tokens),
                    this.readiness,
                    state.markdown,
                    state.canvas,
                    state.uncertain
                );
            }
            result.uncertainDocuments.forEach(path => state.uncertain.add(path));
            for (const candidate of result.references) {
                const sourceFile = this.getFile(candidate.documentPath);
                if (!sourceFile) state.uncertain.add(candidate.documentPath);
                else this.addCandidate(candidate, sourceFile, state);
            }
        }
        return createSnapshot(
            this.generation,
            this.createToken(overlays.tokens),
            this.readiness,
            state.markdown,
            state.canvas,
            state.uncertain
        );
    }

    private addCandidate(
        candidate: ReferenceIndexCandidateDTO,
        sourceFile: TFile,
        state: MutableSnapshot
    ): void {
        if (candidate.documentKind === "canvas") {
            state.canvas.push({
                canvasFile: sourceFile,
                nodeFile: candidate.value,
                lineNumber: Math.max(1, candidate.line + 1)
            });
            return;
        }
        if (!candidate.link) {
            state.uncertain.add(candidate.documentPath);
            return;
        }
        state.markdown.push({
            file: sourceFile,
            start: candidate.link.index,
            end: candidate.link.index + candidate.link.source.length,
            original: candidate.link.source,
            link: candidate.link.path,
            line: candidate.link.line
        });
    }

    private finalizeLocalStates(
        states: ReadonlyMap<string, MutableSnapshot>,
        tokens: readonly OpenDocumentToken[]
    ): ReadonlyMap<string, ReferenceIndexSnapshot> {
        const token = this.createToken(tokens);
        return new Map([...states.entries()].map(([path, state]) => [
            path,
            createSnapshot(
                this.generation,
                token,
                this.readiness,
                state.markdown,
                state.canvas,
                state.uncertain
            )
        ]));
    }

    private getCommonUncertain(overlays: OpenOverlaySnapshot): Set<string> {
        const uncertain = new Set(this.uncertainPaths);
        overlays.conflicts.forEach(path => uncertain.add(path));
        this.getUnverifiableOpenCanvasPaths().forEach(path => uncertain.add(path));
        if (this.readiness === "degraded" || !this.workerAvailable) {
            uncertain.add(INDEX_FILENAME);
        }
        return uncertain;
    }

    private createToken(openDocuments: readonly OpenDocumentToken[]): ReferenceIndexToken {
        return {
            generation: this.generation,
            topologyGeneration: this.fileLookup.getGeneration(),
            openDocuments: openDocuments.map(token => ({ ...token }))
        };
    }

    private schedulePersist(): void {
        if (this.destroyed || !this.workerAvailable || !this.startPromise) return;
        if (this.persistTimer !== null) window.clearTimeout(this.persistTimer);
        this.persistTimer = window.setTimeout(() => {
            this.persistTimer = null;
            const run = async (): Promise<void> => {
                if (this.lifecycleLoaded) await this.activityGate.waitForIdle();
                this.persistPromise = this.persistPromise
                    .then(() => this.persist())
                    .catch(error => console.warn(
                        "[Image Assistant] Reference index persistence queue failed:",
                        error
                    ));
                await this.persistPromise;
            };
            void run();
        }, PERSIST_QUIET_PERIOD_MS);
    }

    private scheduleReconciliation(): void {
        if (this.destroyed || this.reconciliationTimer !== null) return;
        this.reconciliationTimer = window.setTimeout(() => {
            this.reconciliationTimer = null;
            const run = async (): Promise<void> => {
                if (this.lifecycleLoaded) await this.activityGate.waitForIdle();
                this.foregroundRequested = false;
                this.markMismatchedDocumentsDirty();
                await this.refreshDirty();
            };
            void run()
                .catch(error => console.warn(
                    "[Image Assistant] Reference index audit failed:",
                    error
                ))
                .finally(() => this.scheduleReconciliation());
        }, RECONCILIATION_INTERVAL_MS);
    }

    private async loadPersisted(): Promise<void> {
        const adapter = this.app.vault.adapter;
        const path = this.getIndexPath();
        for (const recoveryPath of [path, `${path}.tmp`, `${path}.bak`]) {
            try {
                if (!(await adapter.exists(recoveryPath))) continue;
                const buffer = await readAdapterBinary(adapter, recoveryPath);
                if (!hasCurrentPersistedVersion(buffer)) continue;
                const result = await this.worker.hydrate(buffer);
                if (!result.accepted) continue;
                this.headers.clear();
                result.headers.forEach(header =>
                    this.headers.set(normalizePath(header.path), header));
                this.generation++;
                return;
            } catch {
                // The V3 index is a disposable cache and will be rebuilt.
            }
        }
    }

    private async persist(): Promise<void> {
        if (!this.workerAvailable || this.destroyed) return;
        const adapter = this.app.vault.adapter;
        const path = this.getIndexPath();
        const tempPath = `${path}.tmp`;
        const backupPath = `${path}.bak`;
        try {
            const parent = path.slice(0, path.lastIndexOf("/"));
            if (parent && !(await adapter.exists(parent))) await adapter.mkdir(parent);
            const payload = await this.worker.serialize();
            await writeAdapterBinary(adapter, tempPath, payload);
            if (await adapter.exists(backupPath)) await adapter.remove(backupPath);
            if (await adapter.exists(path)) await adapter.rename(path, backupPath);
            await adapter.rename(tempPath, path);
            if (await adapter.exists(backupPath)) await adapter.remove(backupPath);
        } catch (error) {
            console.warn("[Image Assistant] Reference index persistence failed:", error);
            try {
                if (!(await adapter.exists(path)) && await adapter.exists(backupPath)) {
                    await adapter.rename(backupPath, path);
                }
                if (await adapter.exists(tempPath)) await adapter.remove(tempPath);
            } catch {
                // Best-effort cleanup.
            }
        }
    }

    private getIndexableFiles(): TFile[] {
        return this.app.vault.getFiles()
            .filter((file): file is TFile =>
                file instanceof TFile && isIndexablePath(file.path))
            .sort((left, right) => left.path.localeCompare(right.path));
    }

    private getUnverifiableOpenCanvasPaths(): string[] {
        const paths = new Set<string>();
        this.app.workspace.iterateAllLeaves?.(leaf => {
            const view = leaf.view as typeof leaf.view & {
                file?: TFile | null;
                getViewType?: () => string;
            };
            if (view?.getViewType?.() === "canvas"
                && view.file instanceof TFile
                && view.file.extension === "canvas") {
                paths.add(view.file.path);
            }
        });
        return [...paths];
    }

    private getFile(path: string): TFile | null {
        const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
        return file instanceof TFile ? file : null;
    }

    private getIndexPath(): string {
        const configDir = (this.app.vault as { configDir?: string }).configDir
            ?? ".obsidian";
        return normalizePath(
            `${configDir}/plugins/obsidian-image-assistant/${INDEX_FILENAME}`
        );
    }

    private handleWorkerFailure(error: unknown): void {
        if (this.destroyed || isAbortError(error)) return;
        this.workerAvailable = false;
        this.readiness = "degraded";
        this.uncertainPaths.add(INDEX_FILENAME);
        if (!this.workerFailureReported) {
            this.workerFailureReported = true;
            console.warn("[Image Assistant] Reference index Worker unavailable:", error);
        }
        if (!isReferenceIndexWorkerUnavailable(error)
            && !this.workerRestartAttempted) {
            this.workerRestartAttempted = true;
            void this.restartWorkerOnce();
        }
    }

    private async restartWorkerOnce(): Promise<void> {
        try {
            await this.refreshPromise?.catch(() => undefined);
            if (this.destroyed) return;
            await this.worker.restart();
            if (this.destroyed) return;

            this.workerAvailable = true;
            this.readiness = "loading";
            this.uncertainPaths.delete(INDEX_FILENAME);
            this.headers.clear();
            this.openDocumentCache.clear();
            this.startPromise = null;
            this.refreshPromise = null;
            await this.ensureInitialized();
        } catch (restartError) {
            this.workerAvailable = false;
            this.readiness = "degraded";
            this.uncertainPaths.add(INDEX_FILENAME);
            if (!this.destroyed) {
                console.warn(
                    "[Image Assistant] Reference index Worker restart failed:",
                    restartError
                );
            }
        }
    }
}

function createSnapshot(
    generation: number,
    token: ReferenceIndexToken,
    readiness: ReferenceIndexReadiness,
    markdown: readonly ReferenceLocation[],
    canvas: readonly CanvasFileReference[],
    uncertain: ReadonlySet<string>
): ReferenceIndexSnapshot {
    const uncertainFiles = [...uncertain].sort();
    const complete = readiness === "ready" && uncertainFiles.length === 0;
    const referenceCount = markdown.length + canvas.length;
    return {
        generation,
        token,
        readiness,
        complete,
        markdown: [...markdown],
        canvas: [...canvas],
        uncertainFiles,
        referenceCount,
        safeToDelete: complete && referenceCount === 0
    };
}

function toMetadata(file: TFile): ReferenceIndexDocumentMetadata {
    return {
        path: normalizePath(file.path),
        kind: file.extension === "canvas" ? "canvas" : "markdown",
        mtime: normalizeMtime(file.stat.mtime),
        size: file.stat.size
    };
}

function toLocalSyntax(candidate: ReferenceIndexCandidateDTO): LocalReferenceSyntax {
    if (!candidate.link) return "native";
    return candidate.link.syntax === "wiki" ? "wiki" : "markdown";
}

function normalizeMtime(value: number): number {
    return Math.round(value);
}

function isIndexablePath(path: string): boolean {
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    return extension === "md" || extension === "canvas";
}

function isMarkdownEditorView(
    view: unknown
): view is MarkdownView & {
    file: TFile;
    editor: MarkdownView["editor"] & { getValue(): string };
} {
    if (!view || typeof view !== "object") return false;
    const candidate = view as Partial<MarkdownView>;
    const viewType = (candidate as { getViewType?: () => string }).getViewType?.();
    return (candidate instanceof MarkdownView || viewType === "markdown")
        && candidate.file instanceof TFile
        && candidate.file.extension === "md"
        && typeof candidate.editor?.getValue === "function";
}

function getEditorDocumentIdentity(editor: MarkdownView["editor"]): unknown {
    return (editor as MarkdownView["editor"] & {
        cm?: { state?: { doc?: unknown } };
    }).cm?.state?.doc;
}

function areOpenDocumentTokensEqual(
    left: readonly OpenDocumentToken[],
    right: readonly OpenDocumentToken[]
): boolean {
    return left.length === right.length
        && left.every((token, index) =>
            token.path === right[index]?.path
            && token.version === right[index]?.version);
}

function hasCurrentPersistedVersion(buffer: ArrayBuffer): boolean {
    const header = new TextDecoder().decode(
        new Uint8Array(buffer, 0, Math.min(256, buffer.byteLength))
    );
    const match = header.match(/"version"\s*:\s*(\d+)/);
    return match?.[1] === String(REFERENCE_INDEX_VERSION);
}

async function readAdapterBinary(
    adapter: App["vault"]["adapter"],
    path: string
): Promise<ArrayBuffer> {
    if (typeof adapter.readBinary === "function") return adapter.readBinary(path);
    return new TextEncoder().encode(await adapter.read(path)).buffer;
}

async function writeAdapterBinary(
    adapter: App["vault"]["adapter"],
    path: string,
    buffer: ArrayBuffer
): Promise<void> {
    if (typeof adapter.writeBinary === "function") {
        await adapter.writeBinary(path, buffer);
        return;
    }
    await adapter.write(path, new TextDecoder().decode(new Uint8Array(buffer)));
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw toAbortError(signal);
}

async function waitForPromise<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    throwIfAborted(signal);
    return new Promise<T>((resolve, reject) => {
        const abort = (): void => reject(toAbortError(signal));
        signal.addEventListener("abort", abort, { once: true });
        promise.then(
            value => {
                signal.removeEventListener("abort", abort);
                resolve(value);
            },
            error => {
                signal.removeEventListener("abort", abort);
                reject(error);
            }
        );
    });
}

function toAbortError(signal?: AbortSignal): Error {
    return signal?.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === "AbortError";
}
