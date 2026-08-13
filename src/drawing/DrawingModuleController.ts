import {
    MarkdownView,
    Menu,
    Notice,
    TFile
} from "obsidian";
import type ImageConverterPlugin from "../main";
import { EditorContentInserter } from "../utils/EditorContentInserter";
import { getAllReferenceLinks } from "../utils/RegexPatterns";
import { LocalImageTargetResolver } from "../utils/LocalImageTargetResolver";
import { DrawioEditorView } from "./drawio/DrawioEditorView";
import { isDrawioDiagramFile } from "./drawio/DiagramFile";
import { DrawingFileService } from "./drawio/DrawingFileService";
import { DrawioProviderAdapter } from "./drawio/DrawioProviderAdapter";
import {
    DRAWING_VIEW_TYPE,
    type DiagramEditorPort
} from "./drawio/DrawioTypes";
import { t } from "../lang/helpers";
import { NextAiSessionStore } from "./drawio/nextai/NextAiSessionStore";
import { NextAiTemplateStore } from "./drawio/nextai/NextAiTemplateStore";
import { appendDrawingOpenMenuItem } from "./DrawingContextMenu";
import {
    DrawingFileInspector,
    isPotentialExcalidrawPreviewFile
} from "./DrawingFileSemantics";
import type { DrawingFileSemantics } from "./DrawingContracts";
import { ExcalidrawBridge, type ExcalidrawCapabilities } from "./excalidraw/ExcalidrawBridge";
import { ExcalidrawService } from "./excalidraw/ExcalidrawService";
import { DrawingProviderRegistry } from "./DrawingProviderRegistry";
import { DrawioDrawingProviderAdapter } from "./drawio/DrawioDrawingProviderAdapter";
import { ExcalidrawProviderAdapter } from "./excalidraw/ExcalidrawProviderAdapter";

export class DrawingModuleController {
    readonly files: DrawingFileService;
    readonly provider: DrawioProviderAdapter;
    readonly nextAiSessions: NextAiSessionStore;
    readonly nextAiTemplates: NextAiTemplateStore;
    readonly fileInspector: DrawingFileInspector;
    readonly excalidraw: ExcalidrawService;
    readonly providers: DrawingProviderRegistry;
    private readonly resolver: LocalImageTargetResolver;
    private readonly previewRefreshTimers = new Map<
        string,
        ReturnType<typeof globalThis.setTimeout>
    >();
    private readonly connectionTests = new Set<{
        port: DiagramEditorPort;
        cancelled: boolean;
    }>();
    private disablePromise: Promise<void> | null = null;

    constructor(private readonly plugin: ImageConverterPlugin) {
        this.files = new DrawingFileService(plugin);
        this.provider = new DrawioProviderAdapter(plugin);
        this.nextAiSessions = new NextAiSessionStore(plugin);
        this.nextAiTemplates = new NextAiTemplateStore(plugin);
        const excalidrawBridge = new ExcalidrawBridge(plugin.app);
        this.fileInspector = new DrawingFileInspector(plugin.app, excalidrawBridge);
        this.excalidraw = new ExcalidrawService(plugin, excalidrawBridge, this.fileInspector);
        this.providers = new DrawingProviderRegistry();
        this.providers.register(new DrawioDrawingProviderAdapter(
            this.fileInspector,
            file => this.openDrawioFile(file)
        ));
        this.providers.register(new ExcalidrawProviderAdapter(this.fileInspector, this.excalidraw));
        this.resolver = new LocalImageTargetResolver(plugin.app);
    }

    register(): void {
        this.plugin.registerView(
            DRAWING_VIEW_TYPE,
            leaf => new DrawioEditorView(
                leaf,
                this.plugin,
                this.provider,
                this.files,
                this.nextAiSessions,
                this.nextAiTemplates
            )
        );
        this.plugin.addCommand({
            id: "create-drawio-diagram",
            name: t("CMD_CREATE_DRAWIO"),
            editorCheckCallback: (checking, _editor, view) => {
                if (!this.isDefaultProvider("drawio") || !(view instanceof MarkdownView) || !view.file) return false;
                if (!checking) void this.createDrawioAndOpen(view);
                return true;
            }
        });
        this.plugin.addCommand({
            id: "edit-drawio-diagram-at-cursor",
            name: t("CMD_EDIT_DRAWIO_CURSOR"),
            editorCheckCallback: (checking, _editor, view) => {
                if (!this.isDrawingEnabled() || !(view instanceof MarkdownView) || !view.file) return false;
                if (!checking) void this.editAtCursor(view, "drawio");
                return true;
            }
        });
        this.plugin.addCommand({
            id: "create-excalidraw-diagram",
            name: t("CMD_CREATE_EXCALIDRAW"),
            editorCheckCallback: (checking, _editor, view) => {
                if (!this.isDefaultProvider("excalidraw") || !(view instanceof MarkdownView) || !view.file) return false;
                if (!checking) void this.createExcalidrawAndOpen(view);
                return true;
            }
        });
        this.plugin.addCommand({
            id: "edit-excalidraw-diagram-at-cursor",
            name: t("CMD_EDIT_EXCALIDRAW_CURSOR"),
            editorCheckCallback: (checking, _editor, view) => {
                if (!this.isDrawingEnabled() || !(view instanceof MarkdownView) || !view.file) return false;
                if (!checking) void this.editAtCursor(view, "excalidraw");
                return true;
            }
        });
        this.plugin.registerEvent(this.plugin.app.workspace.on(
            "file-menu",
            (menu: Menu, target) => {
                appendDrawingOpenMenuItem(
                    menu,
                    target instanceof TFile ? target : null,
                    this.isDrawingEnabled() && !this.plugin.contextMenu,
                    file => this.canOpenFile(file),
                    file => this.openFile(file)
                );
            }
        ));
        this.plugin.registerEvent(this.plugin.app.vault.on(
            "modify",
            file => {
                if (file instanceof TFile) this.scheduleExcalidrawPreviewRefresh(file);
            }
        ));
        this.plugin.registerEvent(this.plugin.app.workspace.on(
            "css-change",
            () => void this.refreshAppearance()
        ));
    }

    async openFile(file: TFile): Promise<DrawioEditorView | null> {
        if (!this.isDrawingEnabled()) return null;
        const semantics = this.providers.inspect(file);
        if (!semantics) return null;
        const adapter = this.providers.get(semantics.providerId);
        if (!adapter) return null;
        try {
            const result = await adapter.open(semantics.sourceFile ?? file);
            return result instanceof DrawioEditorView ? result : null;
        } catch (error) {
            const key = semantics.providerId === "excalidraw"
                ? "NOTICE_EXCALIDRAW_OPEN_FAILED"
                : "NOTICE_DRAWIO_OPEN_FAILED";
            new Notice(t(key, [errorMessage(error)]));
            return null;
        }
    }

    private async openDrawioFile(file: TFile): Promise<DrawioEditorView | null> {
        if (!this.provider.supports(file)) return null;
        const existing = this.plugin.app.workspace.getLeavesOfType(DRAWING_VIEW_TYPE)
            .find(leaf => leaf.view instanceof DrawioEditorView
                && leaf.view.file?.path === file.path);
        if (existing) {
            this.plugin.app.workspace.revealLeaf(existing);
            return existing.view as DrawioEditorView;
        }
        const leaf = this.plugin.app.workspace.getLeaf("tab");
        await leaf.setViewState({
            type: DRAWING_VIEW_TYPE,
            active: true,
            state: { file: file.path }
        });
        this.plugin.app.workspace.revealLeaf(leaf);
        return leaf.view instanceof DrawioEditorView ? leaf.view : null;
    }

    async openNextAiSession(filePath: string, sessionId: string): Promise<void> {
        if (!this.isDrawingEnabled()) {
            throw new Error(t("NEXT_AI_SESSION_FILE_OPEN_FAILED", [filePath]));
        }
        const target = this.plugin.app.vault.getAbstractFileByPath(filePath);
        if (!(target instanceof TFile) || !isDrawioDiagramFile(target)) {
            throw new Error(t("NEXT_AI_SESSION_FILE_MISSING", [filePath]));
        }
        const view = await this.openDrawioFile(target);
        if (!view) throw new Error(t("NEXT_AI_SESSION_FILE_OPEN_FAILED", [filePath]));
        if (!await view.waitUntilReady()) {
            throw new Error(t("NEXT_AI_SESSION_FILE_OPEN_FAILED", [filePath]));
        }
        await view.restoreNextAiSession(sessionId);
    }

    async testDrawioConnection(container?: HTMLElement): Promise<boolean> {
        const ownerDocument = container?.ownerDocument ?? document;
        const host = ownerDocument.createElement("div");
        host.className = "image-assistant-drawing-connection-test";
        host.setAttribute("aria-hidden", "true");
        host.style.position = "fixed";
        host.style.left = "-10000px";
        host.style.top = "0";
        host.style.width = "960px";
        host.style.height = "720px";
        host.style.overflow = "hidden";
        host.style.pointerEvents = "none";
        ownerDocument.body.appendChild(host);
        // A connection test verifies the standard embed init handshake. Running
        // load/export in this fully off-screen iframe is not a valid capability
        // test because Chromium may freeze an occluded cross-origin frame after
        // init. Real editor views exercise the complete protocol while visible.
        let activeTest: { port: DiagramEditorPort; cancelled: boolean } | null = null;
        try {
            const port = this.provider.createEditor(ownerDocument);
            activeTest = { port, cancelled: false };
            this.connectionTests.add(activeTest);
            try {
                await port.mount(host);
                return true;
            } catch (error) {
                if (activeTest.cancelled) return false;
                throw error;
            }
        } finally {
            if (activeTest) this.connectionTests.delete(activeTest);
            try {
                activeTest?.port.destroy();
            } finally {
                host.remove();
            }
        }
    }

    async testNextAiConnection(): Promise<void> {
        const { NextAiHttpClient } = await import("./drawio/nextai/NextAiHttpClient");
        await new NextAiHttpClient(this.plugin).testConfiguration();
    }

    refreshNextAi(): void {
        for (const leaf of this.plugin.app.workspace.getLeavesOfType(DRAWING_VIEW_TYPE)) {
            if (leaf.view instanceof DrawioEditorView) leaf.view.refreshNextAi();
        }
    }

    notifyEmbedUrlChanged(): void {
        for (const leaf of this.plugin.app.workspace.getLeavesOfType(DRAWING_VIEW_TYPE)) {
            if (leaf.view instanceof DrawioEditorView) leaf.view.notifyEmbedUrlChanged();
        }
    }

    async refreshAppearance(): Promise<void> {
        const updates: Promise<void>[] = [];
        for (const leaf of this.plugin.app.workspace.getLeavesOfType(DRAWING_VIEW_TYPE)) {
            if (leaf.view instanceof DrawioEditorView) updates.push(leaf.view.refreshAppearance());
        }
        await Promise.all(updates);
    }

    async disable(): Promise<void> {
        if (this.disablePromise) return this.disablePromise;
        for (const activeTest of this.connectionTests) {
            activeTest.cancelled = true;
            activeTest.port.destroy();
        }
        this.connectionTests.clear();
        for (const timer of this.previewRefreshTimers.values()) {
            globalThis.clearTimeout(timer);
        }
        this.previewRefreshTimers.clear();
        const ownedViews = this.plugin.app.workspace.getLeavesOfType(DRAWING_VIEW_TYPE)
            .flatMap(leaf => leaf.view instanceof DrawioEditorView
                ? [{ leaf, view: leaf.view }]
                : []);
        const operation = (async () => {
            const results = await Promise.allSettled(
                ownedViews.map(({ view }) => view.prepareForDetach())
            );
            const preparedViews = new Set<DrawioEditorView>();
            results.forEach((result, index) => {
                const owned = ownedViews[index];
                if (result.status === "fulfilled" && owned) {
                    preparedViews.add(owned.view);
                } else if (result.status === "rejected") {
                    console.error(
                        "[Image Assistant Drawing] Failed to prepare Draw.io view for closing:",
                        owned?.view.file?.path,
                        result.reason
                    );
                }
            });
            for (const { leaf, view } of ownedViews) {
                // A hot reload or another plugin may have replaced the leaf while saving.
                // Never detach a view that is no longer the instance we prepared.
                if (preparedViews.has(view) && leaf.view === view) leaf.detach();
            }
        })();
        const trackedOperation = operation.finally(() => {
            if (this.disablePromise === trackedOperation) this.disablePromise = null;
        });
        this.disablePromise = trackedOperation;
        return trackedOperation;
    }

    isDrawingEnabled(): boolean {
        return this.plugin.settings.drawing.provider !== "disabled";
    }

    canOpenFile(file: TFile): boolean {
        return this.isDrawingEnabled() && this.providers.inspect(file) !== null;
    }

    inspectFile(file: TFile): DrawingFileSemantics | null {
        return this.providers.inspect(file);
    }

    isProtectedFile(file: TFile): boolean {
        return this.fileInspector.inspect(file)?.protectedFromImageMutation === true;
    }

    getExcalidrawCapabilities(): ExcalidrawCapabilities {
        return this.excalidraw.bridge.probe();
    }

    private isDefaultProvider(provider: "drawio" | "excalidraw"): boolean {
        return this.plugin.settings.drawing.provider === provider;
    }

    private scheduleExcalidrawPreviewRefresh(file: TFile): void {
        if (!isPotentialExcalidrawPreviewFile(file)) return;
        const semantics = this.fileInspector.inspect(file);
        if (semantics?.providerId !== "excalidraw" || semantics.role !== "generated-preview") return;
        const existing = this.previewRefreshTimers.get(file.path);
        if (existing !== undefined) globalThis.clearTimeout(existing);
        const timer = globalThis.setTimeout(() => {
            this.previewRefreshTimers.delete(file.path);
            void this.plugin.imageResourceRefreshService?.refreshFile(file).catch(error => {
                console.warn("[Image Assistant Drawing] Failed to refresh Excalidraw preview:", error);
            });
        }, 120);
        this.previewRefreshTimers.set(file.path, timer);
    }

    private async createDrawioAndOpen(view: MarkdownView): Promise<void> {
        if (!view.file) return;
        const inserter = new EditorContentInserter(view);
        try {
            await inserter.runWithLoadingText(t("LOADING_CREATE_DRAWIO"), async activeInserter => {
                const file = await this.files.createDrawing(view.file!);
                if (!file) return;
                const resize = {
                    ...this.plugin.settings.localProcessing.embedResize,
                    resizeDimension: "none" as const,
                    width: undefined,
                    height: undefined,
                    longestEdge: undefined,
                    shortestEdge: undefined,
                    editorMaxWidthValue: undefined
                };
                const inserted = await this.plugin.insertLinkWithInserter(
                    activeInserter,
                    file.path,
                    view.file!,
                    this.plugin.settings.localProcessing.link,
                    resize,
                    {
                        view,
                        file: view.file!,
                        editor: view.editor,
                        ownerDocument: view.containerEl.ownerDocument
                    }
                );
                if (!inserted) {
                    new Notice(t("NOTICE_DRAWIO_LINK_INSERT_STALE", [file.path]));
                }
                await this.openFile(file);
            });
        } catch (error) {
            console.error("[Image Assistant Drawing] Creation failed:", error);
            new Notice(t("NOTICE_DRAWIO_CREATE_FAILED", [String(error)]));
        }
    }

    private async createExcalidrawAndOpen(view: MarkdownView): Promise<void> {
        if (!view.file) return;
        const inserter = new EditorContentInserter(view);
        try {
            await inserter.runWithLoadingText(t("LOADING_CREATE_EXCALIDRAW"), async activeInserter => {
                const result = await this.excalidraw.create(view.file!);
                if (!result) return;
                const resize = noResizeSettings(this.plugin.settings.localProcessing.embedResize);
                const sourceMode = result.embedFile.path === result.sourceFile.path;
                const linkSettings = sourceMode
                    ? { ...this.plugin.settings.localProcessing.link, linkFormat: "wikilink" as const }
                    : this.plugin.settings.localProcessing.link;
                const inserted = await this.plugin.insertLinkWithInserter(
                    activeInserter,
                    result.embedFile.path,
                    view.file!,
                    linkSettings,
                    resize,
                    {
                        view,
                        file: view.file!,
                        editor: view.editor,
                        ownerDocument: view.containerEl.ownerDocument
                    }
                );
                if (!inserted) {
                    new Notice(t("NOTICE_EXCALIDRAW_LINK_INSERT_STALE", [result.sourceFile.path]));
                }
                try {
                    await this.excalidraw.open(result.sourceFile);
                } catch (error) {
                    new Notice(t("NOTICE_EXCALIDRAW_OPEN_FAILED", [errorMessage(error)]));
                }
            });
        } catch (error) {
            console.error("[Image Assistant Drawing] Excalidraw creation failed:", error);
            new Notice(t("NOTICE_EXCALIDRAW_CREATE_FAILED", [errorMessage(error)]));
        }
    }

    private async editAtCursor(view: MarkdownView, providerId: "drawio" | "excalidraw"): Promise<void> {
        if (!view.file) return;
        const offset = view.editor.posToOffset(view.editor.getCursor());
        const link = getAllReferenceLinks(view.editor.getValue())
            .find(candidate => offset >= candidate.index
                && offset <= candidate.index + candidate.source.length);
        if (!link) {
            new Notice(t(providerId === "drawio"
                ? "NOTICE_DRAWIO_CURSOR_LINK"
                : "NOTICE_EXCALIDRAW_CURSOR_LINK"));
            return;
        }
        const resolution = await this.resolver.resolveAsync(
            link.path,
            view.file,
            { syntax: link.syntax === "markdown" ? "markdown" : "wiki" }
        );
        const semantics = resolution.file ? this.fileInspector.inspect(resolution.file) : null;
        if (!semantics || semantics.providerId !== providerId) {
            new Notice(t(providerId === "drawio"
                ? "NOTICE_DRAWIO_LINK_UNRESOLVED"
                : "NOTICE_EXCALIDRAW_LINK_UNRESOLVED"));
            return;
        }
        await this.openFile(semantics.file);
    }
}

function noResizeSettings(settings: ImageConverterPlugin["settings"]["localProcessing"]["embedResize"]) {
    return {
        ...settings,
        resizeDimension: "none" as const,
        width: undefined,
        height: undefined,
        longestEdge: undefined,
        shortestEdge: undefined,
        editorMaxWidthValue: undefined
    };
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
