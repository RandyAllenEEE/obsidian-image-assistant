import {
    App,
    Component,
    MarkdownView,
    normalizePath,
    TFile,
    type TAbstractFile
} from "obsidian";
import {
    parseCanvasReferenceDocument,
    type CanvasFileReference
} from "./CanvasReferenceUtils";
import {
    getContextualReferenceLinks,
    MarkdownSourceContextIndex,
    type ContextualReferenceLink
} from "./MarkdownSourceContext";
import {
    getComparableLocalBasename,
    LocalImageTargetResolver,
    type LocalReferenceSyntax
} from "./LocalImageTargetResolver";
import { isHttpUrl, isSameHttpUrl } from "./NetworkPolicy";
import type { ReferenceLocation } from "./VaultReferenceManager";

const INDEX_VERSION = 2;
const INDEX_FILENAME = "image-reference-index.json";
const SAFETY_OPTIONS = Object.freeze({ includeFencedCode: true });
const MUTATION_OPTIONS = Object.freeze({ includeFencedCode: false });

interface StoredLink {
    readonly path: string;
    readonly source: string;
    readonly index: number;
    readonly line: number;
    readonly syntax: ContextualReferenceLink["syntax"];
}

interface IndexedDocument {
    readonly path: string;
    readonly kind: "markdown" | "canvas";
    readonly mtime: number;
    readonly size: number;
    readonly safetyLinks: readonly StoredLink[];
    readonly mutationLinks: readonly StoredLink[];
    readonly nativeFiles: readonly string[];
    readonly nativeUrls: readonly string[];
    readonly unparsedSafetyUrls: readonly string[];
    readonly unparsedMutationUrls: readonly string[];
}

interface PersistedReferenceIndex {
    readonly version: number;
    readonly documents: readonly IndexedDocument[];
}

export interface ReferenceIndexSnapshot {
    readonly generation: number;
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

interface MutableSnapshot {
    readonly markdown: ReferenceLocation[];
    readonly canvas: CanvasFileReference[];
    readonly uncertain: Set<string>;
}

/**
 * Versioned per-document reference index. Markdown parsing remains delegated to
 * MarkdownSourceContextIndex/getContextualReferenceLinks, while Canvas parsing
 * uses the same validated document reader as CanvasReferenceUtils.
 */
export class ImageReferenceIndexService extends Component {
    private readonly documents = new Map<string, IndexedDocument>();
    private readonly dirtyPaths = new Set<string>();
    private readonly uncertainPaths = new Set<string>();
    private readonly resolver: LocalImageTargetResolver;
    private startPromise: Promise<void> | null = null;
    private refreshPromise: Promise<void> | null = null;
    private persistPromise: Promise<void> = Promise.resolve();
    private persistTimer: number | null = null;
    private generation = 0;
    private destroyed = false;

    constructor(
        private readonly app: App,
        private readonly getConcurrency: () => number
    ) {
        super();
        this.resolver = new LocalImageTargetResolver(app);
    }

    onload(): void {
        this.registerVaultEvents();
        void this.start();
    }

    start(): Promise<void> {
        if (!this.startPromise) {
            this.startPromise = this.initialize();
        }
        return this.startPromise;
    }

    async inspectLocalFile(
        target: TFile,
        query: ReferenceIndexQuery
    ): Promise<ReferenceIndexSnapshot> {
        const snapshots = await this.inspectLocalFiles([target], query);
        return snapshots.get(normalizePath(target.path))
            ?? createSnapshot(this.generation, [], [], new Set());
    }

    async inspectLocalFiles(
        targets: readonly TFile[],
        query: ReferenceIndexQuery
    ): Promise<ReadonlyMap<string, ReferenceIndexSnapshot>> {
        await this.prepareForQuery();
        const targetFiles = new Map<string, TFile>();
        const targetPathsByBasename = new Map<string, Set<string>>();
        for (const target of targets) {
            const path = normalizePath(target.path);
            targetFiles.set(path, target);
            const basename = target.name.toLowerCase();
            const paths = targetPathsByBasename.get(basename) ?? new Set<string>();
            paths.add(path);
            targetPathsByBasename.set(basename, paths);
        }
        const commonUncertain = new Set<string>([
            ...this.uncertainPaths,
            ...this.getUnverifiableOpenCanvasPaths()
        ]);
        const states = new Map<string, MutableSnapshot>(
            [...targetFiles.keys()].map(path => [
                path,
                {
                    markdown: [],
                    canvas: [],
                    uncertain: new Set(commonUncertain)
                }
            ])
        );

        for (const document of this.getEffectiveDocuments()) {
            const sourceFile = this.getFile(document.path);
            if (!sourceFile) {
                states.forEach(state => state.uncertain.add(document.path));
                continue;
            }
            const links = query.includeFencedCode
                ? document.safetyLinks
                : document.mutationLinks;
            for (const link of links) {
                if (isHttpUrl(link.path)) continue;
                const syntax = toLocalSyntax(link.syntax);
                const resolution = this.resolver.resolve(link.path, sourceFile, { syntax });
                if (resolution.status === "resolved" && resolution.file) {
                    const state = states.get(normalizePath(resolution.file.path));
                    if (state) {
                        this.addReference(
                            document,
                            sourceFile,
                            link,
                            state.markdown,
                            state.canvas
                        );
                    }
                    continue;
                }
                for (const candidate of resolution.candidates) {
                    states.get(normalizePath(candidate.path))
                        ?.uncertain.add(document.path);
                }
                const basename = getComparableLocalBasename(link.path, syntax);
                for (const targetPath of targetPathsByBasename.get(basename) ?? []) {
                    states.get(targetPath)?.uncertain.add(document.path);
                }
            }

            if (document.kind !== "canvas") continue;
            for (const nativePath of document.nativeFiles) {
                const resolution = this.resolver.resolve(nativePath, sourceFile, {
                    syntax: "native"
                });
                if (resolution.status === "resolved" && resolution.file) {
                    states.get(normalizePath(resolution.file.path))
                        ?.canvas.push(toCanvasReference(sourceFile, nativePath, 1));
                    continue;
                }
                for (const candidate of resolution.candidates) {
                    states.get(normalizePath(candidate.path))
                        ?.uncertain.add(document.path);
                }
                const basename = getComparableLocalBasename(nativePath, "native");
                for (const targetPath of targetPathsByBasename.get(basename) ?? []) {
                    states.get(targetPath)?.uncertain.add(document.path);
                }
            }
        }

        return new Map(
            [...states.entries()].map(([path, state]) => [
                path,
                createSnapshot(
                    this.generation,
                    state.markdown,
                    state.canvas,
                    state.uncertain
                )
            ])
        );
    }

    async inspectUrl(
        targetUrl: string,
        query: ReferenceIndexQuery
    ): Promise<ReferenceIndexSnapshot> {
        await this.prepareForQuery();
        const markdown: ReferenceLocation[] = [];
        const canvas: CanvasFileReference[] = [];
        const uncertain = new Set<string>();
        this.uncertainPaths.forEach(path => uncertain.add(path));
        this.getUnverifiableOpenCanvasPaths().forEach(path => uncertain.add(path));

        for (const document of this.getEffectiveDocuments()) {
            const sourceFile = this.getFile(document.path);
            if (!sourceFile) {
                uncertain.add(document.path);
                continue;
            }
            const links = query.includeFencedCode
                ? document.safetyLinks
                : document.mutationLinks;
            for (const link of links) {
                if (!isSameHttpUrl(link.path, targetUrl)) continue;
                this.addReference(document, sourceFile, link, markdown, canvas);
            }
            if (document.kind === "canvas") {
                for (const url of document.nativeUrls) {
                    if (isSameHttpUrl(url, targetUrl)) {
                        canvas.push(toCanvasReference(sourceFile, url, 1));
                    }
                }
            }
            const unparsed = query.includeFencedCode
                ? document.unparsedSafetyUrls
                : document.unparsedMutationUrls;
            if (unparsed.some(url => isSameHttpUrl(url, targetUrl))) {
                uncertain.add(document.path);
            }
        }

        return createSnapshot(this.generation, markdown, canvas, uncertain);
    }

    markDirty(path: string): void {
        const normalized = normalizePath(path);
        if (!isIndexablePath(normalized)) return;
        this.dirtyPaths.add(normalized);
        this.generation++;
    }

    async refreshPaths(paths: readonly string[]): Promise<void> {
        paths.forEach(path => this.markDirty(path));
        await this.refreshDirty();
    }

    getGeneration(): number {
        return this.generation;
    }

    onunload(): void {
        this.destroyed = true;
        if (this.persistTimer !== null) {
            window.clearTimeout(this.persistTimer);
            this.persistTimer = null;
        }
        super.onunload();
    }

    private async initialize(): Promise<void> {
        await this.loadPersisted();
        const currentPaths = new Set<string>();
        for (const file of this.getIndexableFiles()) {
            currentPaths.add(file.path);
            const indexed = this.documents.get(file.path);
            if (!indexed
                || indexed.mtime !== file.stat.mtime
                || indexed.size !== file.stat.size) {
                this.dirtyPaths.add(file.path);
            }
        }
        for (const path of this.documents.keys()) {
            if (!currentPaths.has(path)) this.documents.delete(path);
        }
        await this.refreshDirty();
    }

    private registerVaultEvents(): void {
        const vault = this.app.vault;
        this.registerEvent(vault.on("create", file => {
            if (file instanceof TFile) this.markDirty(file.path);
        }));
        this.registerEvent(vault.on("modify", file => {
            if (file instanceof TFile) this.markDirty(file.path);
        }));
        this.registerEvent(vault.on("delete", file => {
            this.removeDocument(file);
        }));
        this.registerEvent(vault.on("rename", (file, oldPath) => {
            this.documents.delete(normalizePath(oldPath));
            if (file instanceof TFile) this.markDirty(file.path);
        }));
    }

    private removeDocument(file: TAbstractFile): void {
        const path = normalizePath(file.path);
        if (this.documents.delete(path)) this.generation++;
        this.dirtyPaths.delete(path);
        this.uncertainPaths.delete(path);
        this.schedulePersist();
    }

    private async prepareForQuery(): Promise<void> {
        await this.start();
        this.markMismatchedDocumentsDirty();
        await this.refreshDirty();
    }

    private async refreshDirty(): Promise<void> {
        if (this.destroyed) return;
        if (!this.refreshPromise) {
            this.refreshPromise = this.drainDirty()
                .finally(() => {
                    this.refreshPromise = null;
                });
        }
        await this.refreshPromise;
        if (this.dirtyPaths.size > 0 && !this.destroyed) {
            await this.refreshDirty();
        }
    }

    private async drainDirty(): Promise<void> {
        while (this.dirtyPaths.size > 0 && !this.destroyed) {
            await this.refreshDirtyBatch();
        }
    }

    private async refreshDirtyBatch(): Promise<void> {
        const paths = [...this.dirtyPaths].sort();
        if (paths.length === 0 || this.destroyed) return;
        paths.forEach(path => this.dirtyPaths.delete(path));
        const concurrency = normalizeConcurrency(this.getConcurrency());
        let cursor = 0;
        const workers = Array.from(
            { length: Math.min(concurrency, paths.length) },
            async () => {
                while (!this.destroyed) {
                    const index = cursor++;
                    if (index >= paths.length) return;
                    await this.indexPath(paths[index]);
                }
            }
        );
        await Promise.all(workers);
        this.schedulePersist();
    }

    private markMismatchedDocumentsDirty(): void {
        const currentPaths = new Set<string>();
        for (const file of this.getIndexableFiles()) {
            currentPaths.add(file.path);
            const indexed = this.documents.get(file.path);
            if (!indexed
                || indexed.mtime !== file.stat.mtime
                || indexed.size !== file.stat.size) {
                this.markDirty(file.path);
            }
        }
        for (const path of this.documents.keys()) {
            if (!currentPaths.has(path)) {
                this.documents.delete(path);
                this.uncertainPaths.delete(path);
                this.generation++;
            }
        }
    }

    private async indexPath(path: string): Promise<void> {
        const file = this.getFile(path);
        if (!file || !isIndexablePath(file.path)) {
            this.documents.delete(path);
            this.generation++;
            return;
        }
        try {
            const content = await this.app.vault.read(file);
            this.documents.set(path, createIndexedDocument(file, content));
            this.uncertainPaths.delete(path);
        } catch {
            this.documents.delete(path);
            this.uncertainPaths.add(path);
        } finally {
            this.generation++;
        }
    }

    private getEffectiveDocuments(): readonly IndexedDocument[] {
        const overlays = new Map<string, IndexedDocument>();
        this.app.workspace.iterateAllLeaves?.(leaf => {
            const view = leaf.view;
            if (!(view instanceof MarkdownView)
                || !(view.file instanceof TFile)
                || view.file.extension !== "md"
                || typeof view.editor?.getValue !== "function") {
                return;
            }
            try {
                overlays.set(
                    view.file.path,
                    createIndexedDocument(view.file, view.editor.getValue())
                );
            } catch {
                this.dirtyPaths.add(view.file.path);
            }
        });
        const paths = new Set([...this.documents.keys(), ...overlays.keys()]);
        return [...paths]
            .map(path => overlays.get(path) ?? this.documents.get(path))
            .filter((document): document is IndexedDocument => !!document)
            .sort((a, b) => a.path.localeCompare(b.path));
    }

    private addReference(
        document: IndexedDocument,
        sourceFile: TFile,
        link: StoredLink,
        markdown: ReferenceLocation[],
        canvas: CanvasFileReference[]
    ): void {
        if (document.kind === "canvas") {
            canvas.push(toCanvasReference(sourceFile, link.path, 1));
            return;
        }
        markdown.push({
            file: sourceFile,
            start: link.index,
            end: link.index + link.source.length,
            original: link.source,
            link: link.path,
            line: link.line
        });
    }

    private getFile(path: string): TFile | null {
        const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
        return file instanceof TFile ? file : null;
    }

    private getIndexableFiles(): TFile[] {
        return this.app.vault.getFiles()
            .filter((file): file is TFile =>
                file instanceof TFile && isIndexablePath(file.path))
            .sort((a, b) => a.path.localeCompare(b.path));
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

    private schedulePersist(): void {
        if (this.destroyed || this.persistTimer !== null) return;
        this.persistTimer = window.setTimeout(() => {
            this.persistTimer = null;
            this.persistPromise = this.persistPromise
                .then(() => this.persist())
                .catch(error => {
                    console.warn(
                        "[Image Assistant] Reference index persistence queue failed:",
                        error
                    );
                });
        }, 500);
    }

    private async loadPersisted(): Promise<void> {
        const adapter = this.app.vault.adapter;
        const path = this.getIndexPath();
        // A valid temp file represents a fully written, not-yet-swapped
        // generation. The primary follows, then the older backup.
        const recoveryPaths = [`${path}.tmp`, path, `${path}.bak`];
        for (const recoveryPath of recoveryPaths) {
            try {
                if (!(await adapter.exists(recoveryPath))) continue;
                const parsed = parsePersistedReferenceIndex(
                    await adapter.read(recoveryPath)
                );
                if (!parsed) continue;
                for (const document of parsed.documents) {
                    const normalizedPath = normalizePath(document.path);
                    const current = this.documents.get(normalizedPath);
                    if (!current || document.mtime > current.mtime) {
                        this.documents.set(normalizedPath, document);
                    }
                }
            } catch {
                // The index is a recoverable cache. Other recovery files or a
                // fresh vault scan remain authoritative.
            }
        }
    }

    private async persist(): Promise<void> {
        const adapter = this.app.vault.adapter;
        const path = this.getIndexPath();
        const tempPath = `${path}.tmp`;
        const backupPath = `${path}.bak`;
        try {
            const parent = path.slice(0, path.lastIndexOf("/"));
            if (parent && !(await adapter.exists(parent))) await adapter.mkdir(parent);
            const payload: PersistedReferenceIndex = {
                version: INDEX_VERSION,
                documents: [...this.documents.values()]
            };
            await adapter.write(tempPath, JSON.stringify(payload));
            if (await adapter.exists(backupPath)) await adapter.remove(backupPath);
            if (await adapter.exists(path)) await adapter.rename(path, backupPath);
            await adapter.rename(tempPath, path);
            if (await adapter.exists(backupPath)) await adapter.remove(backupPath);
        } catch (error) {
            console.warn("[Image Assistant] Reference index persistence failed:", error);
            try {
                if (!(await adapter.exists(path))
                    && await adapter.exists(backupPath)) {
                    await adapter.rename(backupPath, path);
                }
                if (await adapter.exists(tempPath)) await adapter.remove(tempPath);
            } catch {
                // Best-effort cleanup.
            }
        }
    }

    private getIndexPath(): string {
        const configDir = (this.app.vault as { configDir?: string }).configDir
            ?? ".obsidian";
        return normalizePath(
            `${configDir}/plugins/obsidian-image-assistant/${INDEX_FILENAME}`
        );
    }
}

function createIndexedDocument(file: TFile, content: string): IndexedDocument {
    if (file.extension === "md") {
        const safetyLinks = getContextualReferenceLinks(content, SAFETY_OPTIONS);
        const mutationLinks = getContextualReferenceLinks(content, MUTATION_OPTIONS);
        return {
            path: file.path,
            kind: "markdown",
            mtime: file.stat.mtime,
            size: file.stat.size,
            safetyLinks: toStoredLinks(safetyLinks, content),
            mutationLinks: toStoredLinks(mutationLinks, content),
            nativeFiles: [],
            nativeUrls: [],
            unparsedSafetyUrls: getUnparsedUrls(content, safetyLinks, true),
            unparsedMutationUrls: getUnparsedUrls(content, mutationLinks, false)
        };
    }

    const document = parseCanvasReferenceDocument(content);
    const safetyLinks: StoredLink[] = [];
    const mutationLinks: StoredLink[] = [];
    const nativeFiles: string[] = [];
    const nativeUrls: string[] = [];
    const unparsedSafetyUrls: string[] = [];
    const unparsedMutationUrls: string[] = [];
    for (const node of document.nodes) {
        if (node.type === "file" && typeof node.file === "string") {
            nativeFiles.push(node.file);
        }
        if (typeof node.url === "string" && isHttpUrl(node.url)) {
            nativeUrls.push(node.url);
        }
        if (typeof node.text !== "string") continue;
        const safe = getContextualReferenceLinks(node.text, SAFETY_OPTIONS);
        const mutable = getContextualReferenceLinks(node.text, MUTATION_OPTIONS);
        safetyLinks.push(...toStoredLinks(safe, node.text));
        mutationLinks.push(...toStoredLinks(mutable, node.text));
        unparsedSafetyUrls.push(...getUnparsedUrls(node.text, safe, true));
        unparsedMutationUrls.push(...getUnparsedUrls(node.text, mutable, false));
    }
    return {
        path: file.path,
        kind: "canvas",
        mtime: file.stat.mtime,
        size: file.stat.size,
        safetyLinks,
        mutationLinks,
        nativeFiles,
        nativeUrls,
        unparsedSafetyUrls: unique(unparsedSafetyUrls),
        unparsedMutationUrls: unique(unparsedMutationUrls)
    };
}

function toStoredLinks(
    links: readonly ContextualReferenceLink[],
    content: string
): StoredLink[] {
    return links.map(link => ({
        path: link.path,
        source: link.source,
        index: link.index,
        line: countLinesBefore(content, link.index),
        syntax: link.syntax
    }));
}

function countLinesBefore(content: string, offset: number): number {
    let line = 0;
    for (let index = 0; index < offset; index++) {
        if (content.charCodeAt(index) === 10) line++;
    }
    return line;
}

function getUnparsedUrls(
    content: string,
    links: readonly ContextualReferenceLink[],
    includeFencedCode: boolean
): string[] {
    const parsedRanges = links.map(link => ({
        start: link.index,
        end: link.index + link.source.length
    }));
    const context = MarkdownSourceContextIndex.create(content);
    const values: string[] = [];
    const pattern = /https?:\/\/[^\s<>"'`\])]+/gi;
    for (const match of content.matchAll(pattern)) {
        const start = match.index ?? -1;
        const value = match[0];
        if (start < 0
            || parsedRanges.some(range => start >= range.start && start < range.end)
            || !context.includes(start, start + value.length, { includeFencedCode })) {
            continue;
        }
        values.push(value);
    }
    return unique(values);
}

function createSnapshot(
    generation: number,
    markdown: ReferenceLocation[],
    canvas: CanvasFileReference[],
    uncertain: Set<string>
): ReferenceIndexSnapshot {
    const uncertainFiles = [...uncertain].sort();
    const complete = uncertainFiles.length === 0;
    const referenceCount = markdown.length + canvas.length;
    return {
        generation,
        complete,
        markdown,
        canvas,
        uncertainFiles,
        referenceCount,
        safeToDelete: complete && referenceCount === 0
    };
}

function toCanvasReference(
    canvasFile: TFile,
    nodeFile: string,
    lineNumber: number
): CanvasFileReference {
    return { canvasFile, nodeFile, lineNumber };
}

function toLocalSyntax(
    syntax: ContextualReferenceLink["syntax"]
): LocalReferenceSyntax {
    return syntax === "markdown" ? "markdown" : "wiki";
}

function isIndexablePath(path: string): boolean {
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    return extension === "md" || extension === "canvas";
}

function normalizeConcurrency(value: number): number {
    if (!Number.isFinite(value)) return 3;
    return Math.max(1, Math.min(10, Math.floor(value)));
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function isValidIndexedDocument(value: unknown): value is IndexedDocument {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<IndexedDocument>;
    return typeof candidate.path === "string"
        && (candidate.kind === "markdown" || candidate.kind === "canvas")
        && Number.isFinite(candidate.mtime)
        && Number.isFinite(candidate.size)
        && Array.isArray(candidate.safetyLinks)
        && candidate.safetyLinks.every(isValidStoredLink)
        && Array.isArray(candidate.mutationLinks)
        && candidate.mutationLinks.every(isValidStoredLink)
        && Array.isArray(candidate.nativeFiles)
        && candidate.nativeFiles.every(item => typeof item === "string")
        && Array.isArray(candidate.nativeUrls)
        && candidate.nativeUrls.every(item => typeof item === "string")
        && Array.isArray(candidate.unparsedSafetyUrls)
        && candidate.unparsedSafetyUrls.every(item => typeof item === "string")
        && Array.isArray(candidate.unparsedMutationUrls)
        && candidate.unparsedMutationUrls.every(item => typeof item === "string");
}

function isValidStoredLink(value: unknown): value is StoredLink {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<StoredLink>;
    return typeof candidate.path === "string"
        && typeof candidate.source === "string"
        && Number.isSafeInteger(candidate.index)
        && Number.isSafeInteger(candidate.line)
        && (candidate.syntax === "markdown"
            || candidate.syntax === "wiki"
            || candidate.syntax === "autolink");
}

function parsePersistedReferenceIndex(raw: string): PersistedReferenceIndex | null {
    try {
        const parsed = JSON.parse(raw) as Partial<PersistedReferenceIndex>;
        if (parsed.version !== INDEX_VERSION
            || !Array.isArray(parsed.documents)
            || !parsed.documents.every(isValidIndexedDocument)) {
            return null;
        }
        return {
            version: INDEX_VERSION,
            documents: parsed.documents
        };
    } catch {
        return null;
    }
}
