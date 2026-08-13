import { FileView, Notice, setIcon, TFile, WorkspaceLeaf } from "obsidian";
import type ImageConverterPlugin from "../../main";
import { getErrorMessage } from "../../utils/ErrorUtils";
import {
    assertValidDiagramXml,
    assertValidDrawioSvg,
    assertUncompressedDiagramXml,
    EMPTY_DRAWIO_XML,
    extractDrawioModelFromSvg,
    isDrawioSvgPath
} from "./DiagramFile";
import {
    DrawingSaveConflictError,
    type DrawingFileService,
    type DrawingNativeExportFormat
} from "./DrawingFileService";
import {
    DRAWING_VIEW_TYPE,
    type DiagramEditorPort,
    type DiagramViewMetadata,
    type DrawioEditorProviderAdapter
} from "./DrawioTypes";
import { confirmDrawingAction } from "../DrawingConfirmModal";
import { DrawingHistoryModal, type DrawingHistoryEntry } from "./nextai/DrawingHistoryModal";
import { NextAiChatPanel } from "./nextai/NextAiChatPanel";
import { t } from "../../lang/helpers";
import type { NextAiSessionStore } from "./nextai/NextAiSessionStore";
import type { NextAiTemplateStore } from "./nextai/NextAiTemplateStore";
import { DrawingExportModal } from "./DrawingExportModal";

const SAVE_DEBOUNCE_MS = 750;
const SAVE_SNAPSHOT_MAX_ATTEMPTS = 3;

interface DrawingSaveSnapshot {
    readonly revision: number;
    readonly rawXml: string;
    readonly svg: string;
}

export class DrawioEditorView extends FileView {
    private editorContainer: HTMLDivElement | null = null;
    private workspaceEl: HTMLDivElement | null = null;
    private chatContainer: HTMLDivElement | null = null;
    private chatResizeHandle: HTMLDivElement | null = null;
    private chatPanel: NextAiChatPanel | null = null;
    private chatToggle: HTMLButtonElement | null = null;
    private chatCollapsed = false;
    private statusEl: HTMLSpanElement | null = null;
    private conflictEl: HTMLDivElement | null = null;
    private port: ReturnType<DrawioEditorProviderAdapter["createEditor"]> | null = null;
    private removeDirtyListener: (() => void) | null = null;
    private baseline = "";
    private latestRawXml = "";
    private latestRawXmlRevision = -1;
    private lastValidatedSvg = "";
    private lastValidatedSvgRevision = -1;
    private revision = 0;
    private savedRevision = 0;
    private saveTimer: ReturnType<typeof setTimeout> | null = null;
    private savePromise: Promise<void> | null = null;
    private conflicted = false;
    private closing = false;
    private readonly aiHistory: DrawingHistoryEntry[] = [];
    private appearanceKey = "";
    private appearancePromise: Promise<void> | null = null;
    private closePreparationPromise: Promise<void> | null = null;
    private editorReadyPromise!: Promise<boolean>;
    private resolveEditorReady: ((ready: boolean) => void) | null = null;

    constructor(
        leaf: WorkspaceLeaf,
        private readonly plugin: ImageConverterPlugin,
        private readonly provider: DrawioEditorProviderAdapter,
        private readonly files: DrawingFileService,
        private readonly nextAiSessions: NextAiSessionStore,
        private readonly nextAiTemplates: NextAiTemplateStore
    ) {
        super(leaf);
        this.navigation = false;
        this.resetEditorReady();
    }

    getViewType(): string {
        return DRAWING_VIEW_TYPE;
    }

    getDisplayText(): string {
        return this.file?.name.replace(/\.drawio(?:\.svg)?$/i, "") || "Draw.io";
    }

    getIcon(): string {
        return "shapes";
    }

    canAcceptExtension(extension: string): boolean {
        return extension.toLowerCase() === "drawio" || extension.toLowerCase() === "svg";
    }

    async onLoadFile(file: TFile): Promise<void> {
        await super.onLoadFile(file);
        this.resetSaveState();
        this.resetEditorReady();
        this.contentEl.empty();
        this.contentEl.addClass("image-assistant-drawing-view");
        this.renderShell();
        this.baseline = await this.app.vault.read(file);
        let editorSource: string;
        try {
            if (!this.provider.supports(file)) throw new Error("This is not a supported Draw.io file.");
            if (isDrawioSvgPath(file.path)) {
                editorSource = extractDrawioModelFromSvg(this.baseline);
            } else {
                assertValidDiagramXml(this.baseline);
                editorSource = this.baseline;
            }
        } catch (error) {
            this.setStatus(t("DRAWING_STATUS_UNAVAILABLE"));
            this.showFatalError(error);
            this.resolveEditorReady?.(false);
            this.resolveEditorReady = null;
            return;
        }
        this.latestRawXml = editorSource;
        this.latestRawXmlRevision = 0;
        if (isDrawioSvgPath(file.path)) {
            this.lastValidatedSvg = this.baseline;
            this.lastValidatedSvgRevision = 0;
        }
        this.port = this.provider.createEditor(this.editorContainer?.ownerDocument);
        this.appearanceKey = this.provider.getAppearanceKey?.(this.editorContainer?.ownerDocument) ?? "";
        this.removeDirtyListener = this.bindDirtyListener(this.port);
        try {
            this.setStatus(t("DRAWING_STATUS_CONNECTING"));
            await this.port.mount(this.editorContainer!);
            this.setStatus(t("DRAWING_STATUS_LOADING"));
            await this.port.load(editorSource);
            this.setStatus(t("DRAWING_STATUS_SAVED"));
            this.refreshNextAi();
            this.resolveEditorReady?.(true);
            this.resolveEditorReady = null;
        } catch (error) {
            this.setStatus(t("DRAWING_STATUS_UNAVAILABLE"));
            this.showFatalError(error);
            this.resolveEditorReady?.(false);
            this.resolveEditorReady = null;
        }
    }

    async onUnloadFile(file: TFile): Promise<void> {
        if (!this.closing) {
            await this.flushWithRecovery();
            await this.persistChat();
        }
        this.disposeEditor();
        await super.onUnloadFile(file);
    }

    async onClose(): Promise<void> {
        await this.prepareForDetach();
        this.disposeEditor();
        await super.onClose();
    }

    /** Flushes or recovers this owned Draw.io view before its leaf is detached. */
    async prepareForDetach(): Promise<void> {
        if (this.closePreparationPromise) return this.closePreparationPromise;
        this.closing = true;
        this.closePreparationPromise = (async () => {
            await this.flushWithRecovery();
            await this.persistChat();
        })();
        return this.closePreparationPromise;
    }

    async exportXml(): Promise<string> {
        if (!this.port) throw new Error("Draw.io editor is not ready.");
        const { data: xml } = await this.port.export("xml");
        assertUncompressedDiagramXml(xml);
        return xml;
    }

    async restoreNextAiSession(id: string): Promise<void> {
        this.refreshNextAi();
        if (!this.chatPanel) throw new Error(t("NEXT_AI_CHAT_UNAVAILABLE"));
        await this.chatPanel.restoreSession(id);
        this.setChatCollapsed(false);
    }

    waitUntilReady(): Promise<boolean> {
        return this.editorReadyPromise;
    }

    async applyDiagramXml(xml: string): Promise<number> {
        assertValidDiagramXml(xml);
        if (!this.port) throw new Error("Draw.io editor is not ready.");
        if (this.conflicted) throw new DrawingSaveConflictError(
            "Resolve the external drawing conflict before applying an AI edit."
        );
        await this.port.load(xml);
        this.revision++;
        this.latestRawXml = xml;
        this.latestRawXmlRevision = this.revision;
        return this.revision;
    }

    async ensureRevisionSaved(revision: number): Promise<void> {
        for (let attempt = 0; attempt < 3; attempt++) {
            if (this.conflicted) throw new DrawingSaveConflictError();
            await this.flush();
            if (this.conflicted) throw new DrawingSaveConflictError();
            if (this.savedRevision >= revision) return;
        }
        throw new Error("The AI diagram revision could not be confirmed as saved.");
    }

    async exportPng(): Promise<string> {
        if (!this.port) throw new Error("Draw.io editor is not ready.");
        const { data: dataUrl } = await this.port.export("png", { currentPage: true });
        if (!/^data:image\/png(?:;[^,]*)?,/i.test(dataUrl)) {
            throw new Error("Draw.io did not return a PNG image.");
        }
        return dataUrl;
    }

    getViewMetadata(): DiagramViewMetadata {
        return this.port?.getViewMetadata() ?? {
            currentPage: null,
            bounds: null,
            scale: null
        };
    }

    async captureAiHistory(label: string): Promise<void> {
        const [xml, previewSvg] = await Promise.all([
            this.exportXml(),
            this.exportHistoryPreview()
        ]);
        if (this.aiHistory.at(-1)?.xml === xml) return;
        this.aiHistory.push({
            id: globalThis.crypto?.randomUUID?.() ?? `history-${Date.now()}`,
            createdAt: Date.now(),
            label: label.trim().slice(0, 80) || t("DRAWING_HISTORY_AI_EDIT"),
            xml,
            previewSvg
        });
        if (this.aiHistory.length > 20) this.aiHistory.shift();
    }

    getAiHistory(): readonly DrawingHistoryEntry[] {
        return this.aiHistory;
    }

    replaceAiHistory(entries: readonly DrawingHistoryEntry[]): void {
        this.aiHistory.splice(0, this.aiHistory.length, ...entries.slice(-20).map(entry => ({ ...entry })));
    }

    async resetForNewAiChat(): Promise<void> {
        await this.captureAiHistory(t("DRAWING_HISTORY_BEFORE_CLEAR"));
        const revision = await this.applyDiagramXml(EMPTY_DRAWIO_XML);
        await this.ensureRevisionSaved(revision);
    }

    getRevision(): number {
        return this.revision;
    }

    refreshNextAi(): void {
        const enabled = this.plugin.settings.drawing.provider === "drawio"
            && this.plugin.settings.drawing.drawio.nextAi.enabled;
        this.chatToggle?.toggleClass("is-hidden", !enabled);
        if (!enabled) {
            this.chatPanel?.destroy();
            this.chatPanel = null;
            this.chatContainer?.remove();
            this.chatContainer = null;
            this.chatResizeHandle?.remove();
            this.chatResizeHandle = null;
            return;
        }
        if (!this.workspaceEl || this.chatContainer) return;
        this.chatResizeHandle = this.workspaceEl.createDiv("image-assistant-drawing-chat-resize-handle");
        this.installChatResize(this.chatResizeHandle);
        this.chatContainer = this.workspaceEl.createDiv("image-assistant-drawing-chat-container");
        this.chatPanel = new NextAiChatPanel(
            this.chatContainer,
            this.plugin,
            this,
            this.nextAiSessions,
            this.nextAiTemplates,
            () => this.setChatCollapsed(true)
        );
        this.setChatCollapsed(this.chatCollapsed);
    }

    notifyEmbedUrlChanged(): void {
        if (this.port) this.setStatus(t("DRAWING_STATUS_URL_CHANGED"));
    }

    async refreshAppearance(): Promise<void> {
        if (!this.port || !this.editorContainer || !this.workspaceEl) return;
        const key = this.provider.getAppearanceKey?.(this.editorContainer.ownerDocument) ?? "";
        if (!key || key === this.appearanceKey) return;
        if (this.appearancePromise) return this.appearancePromise;
        this.appearancePromise = this.replaceEditorForAppearance(key)
            .finally(() => { this.appearancePromise = null; });
        return this.appearancePromise;
    }

    async flush(): Promise<void> {
        if (!this.port || !this.file || this.conflicted) return;
        if (this.savePromise) return this.savePromise;
        if (this.revision === this.savedRevision) return;
        const requestedRevision = this.revision;
        this.savePromise = this.performSave(requestedRevision)
            .finally(() => {
                this.savePromise = null;
                if (!this.closing && !this.conflicted && this.revision !== this.savedRevision) {
                    this.scheduleSave();
                }
            });
        return this.savePromise;
    }

    private renderShell(): void {
        const toolbar = this.contentEl.createDiv("image-assistant-drawing-toolbar");
        const saveButton = toolbar.createEl("button", {
            cls: "clickable-icon image-assistant-drawing-save",
            attr: { "aria-label": t("DRAWING_SAVE") }
        });
        setIcon(saveButton, "save");
        saveButton.addEventListener("click", () => void this.flush());
        const exportButton = toolbar.createEl("button", {
            cls: "clickable-icon image-assistant-drawing-export",
            attr: { "aria-label": t("DRAWING_EXPORT_ACTION") }
        });
        setIcon(exportButton, "download");
        exportButton.addEventListener("click", () => new DrawingExportModal(
            this.app,
            format => this.exportDrawing(format)
        ).open());
        this.chatToggle = toolbar.createEl("button", {
            cls: "clickable-icon image-assistant-drawing-chat-toggle",
            attr: { "aria-label": t("DRAWING_TOGGLE_NEXT_AI") }
        });
        setIcon(this.chatToggle, "sparkles");
        this.chatToggle.addEventListener("click", () => this.setChatCollapsed(!this.chatCollapsed));
        const historyButton = toolbar.createEl("button", {
            cls: "clickable-icon image-assistant-drawing-history",
            attr: { "aria-label": t("DRAWING_HISTORY_TITLE") }
        });
        setIcon(historyButton, "history");
        historyButton.addEventListener("click", () => new DrawingHistoryModal(
            this.app,
            this.aiHistory,
            entry => this.restoreAiHistory(entry)
        ).open());
        this.statusEl = toolbar.createSpan("image-assistant-drawing-status");

        this.conflictEl = this.contentEl.createDiv("image-assistant-drawing-conflict");
        this.conflictEl.style.display = "none";
        this.workspaceEl = this.contentEl.createDiv("image-assistant-drawing-workspace");
        this.editorContainer = this.workspaceEl.createDiv("image-assistant-drawing-editor");
    }

    private scheduleSave(): void {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            void this.flush();
        }, SAVE_DEBOUNCE_MS);
    }

    private async exportDrawing(format: DrawingNativeExportFormat): Promise<void> {
        if (!this.port || !this.file) throw new Error("Draw.io editor is not ready.");
        await this.flush();
        const portFormat = format === "drawio"
            ? "xml"
            : format === "drawio-svg"
                ? "xmlsvg"
                : format;
        const { data } = await this.port.export(
            portFormat,
            format === "svg" || format === "png" ? { currentPage: true } : {}
        );
        const created = await this.files.saveExportCopy(this.file, format, data);
        if (created) new Notice(t("NOTICE_DRAWIO_EXPORTED", [created.path]));
    }

    private async exportHistoryPreview(): Promise<string | undefined> {
        try {
            const value = (await this.port?.export("svg", { currentPage: true }))?.data;
            return value && value.length <= 512 * 1024 ? value : undefined;
        } catch {
            return undefined;
        }
    }

    private async replaceEditorForAppearance(key: string): Promise<void> {
        const oldPort = this.port;
        const oldContainer = this.editorContainer;
        const workspace = this.workspaceEl;
        if (!oldPort || !oldContainer || !workspace) return;
        this.setStatus(t("DRAWING_STATUS_SWITCHING_THEME"));
        oldContainer.addClass("is-switching");
        const active = oldContainer.ownerDocument.activeElement;
        if (active instanceof HTMLElement) active.blur();
        let nextPort: DiagramEditorPort | null = null;
        let staging: HTMLDivElement | null = null;
        try {
            await this.flush();
            const { data: source } = await oldPort.export("xml");
            assertUncompressedDiagramXml(source);
            const sourceRevision = this.revision;
            staging = workspace.createDiv(
                "image-assistant-drawing-editor image-assistant-drawing-editor-staging"
            );
            nextPort = this.provider.createEditor(staging.ownerDocument);
            await nextPort.mount(staging);
            await nextPort.load(source);
            if (this.port !== oldPort || this.revision !== sourceRevision || this.closing) {
                throw new Error("The drawing changed while its appearance was switching.");
            }
            this.removeDirtyListener?.();
            this.removeDirtyListener = this.bindDirtyListener(nextPort);
            this.port = nextPort;
            this.editorContainer = staging;
            staging.removeClass("image-assistant-drawing-editor-staging");
            oldContainer.remove();
            oldPort.destroy();
            nextPort = null;
            staging = null;
            this.appearanceKey = key;
            this.setStatus(this.revision === this.savedRevision
                ? t("DRAWING_STATUS_SAVED")
                : t("DRAWING_STATUS_UNSAVED"));
        } catch (error) {
            nextPort?.destroy();
            staging?.remove();
            oldContainer.removeClass("is-switching");
            if (!this.closing) {
                this.setStatus(t("DRAWING_STATUS_THEME_FAILED"));
                console.warn("[Image Assistant Drawing] Appearance switch failed:", error);
            }
        }
    }

    private bindDirtyListener(port: DiagramEditorPort): () => void {
        return port.onDirty(xml => {
            if (port !== this.port) return;
            this.revision++;
            this.latestRawXml = xml;
            this.latestRawXmlRevision = this.revision;
            this.setStatus(t("DRAWING_STATUS_UNSAVED"));
            this.scheduleSave();
        });
    }

    private async performSave(requestedRevision: number): Promise<void> {
        if (!this.port || !this.file) return;
        this.setStatus(t("DRAWING_STATUS_SAVING"));
        try {
            const snapshot = await this.captureSaveSnapshot(requestedRevision);
            const result = await this.files.save(
                this.file,
                this.baseline,
                snapshot.rawXml,
                snapshot.svg
            );
            this.baseline = result.baseline;
            this.savedRevision = Math.max(this.savedRevision, snapshot.revision);
            this.conflicted = false;
            this.hideConflict();
            this.setStatus(result.migrated
                ? t("DRAWING_STATUS_MIGRATED")
                : t("DRAWING_STATUS_SAVED"));
            await this.plugin.imageResourceRefreshService?.refreshFile(result.file);
        } catch (error) {
            if (error instanceof DrawingSaveConflictError) {
                this.conflicted = true;
                this.setStatus(t("DRAWING_STATUS_CONFLICT"));
                this.showConflict();
                return;
            }
            this.setStatus(t("DRAWING_STATUS_SAVE_FAILED"));
            new Notice(t("NOTICE_DRAWIO_SAVE_FAILED", [getErrorMessage(error)]));
            throw error;
        }
    }

    private showConflict(): void {
        const banner = this.conflictEl;
        if (!banner || !this.file) return;
        banner.empty();
        banner.style.display = "flex";
        banner.createSpan({ text: t("DRAWING_CONFLICT_MESSAGE") });
        const reload = banner.createEl("button", { text: t("DRAWING_CONFLICT_RELOAD") });
        reload.addEventListener("click", () => void this.reloadExternal());
        const copy = banner.createEl("button", { text: t("DRAWING_CONFLICT_COPY") });
        copy.addEventListener("click", () => void this.saveConflictCopy());
        const overwrite = banner.createEl("button", { text: t("DRAWING_CONFLICT_OVERWRITE") });
        overwrite.addEventListener("click", () => void this.overwriteExternal());
    }

    private hideConflict(): void {
        if (!this.conflictEl) return;
        this.conflictEl.style.display = "none";
        this.conflictEl.empty();
    }

    private async reloadExternal(): Promise<void> {
        if (!this.file || !this.port) return;
        const content = await this.app.vault.read(this.file);
        const editorSource = isDrawioSvgPath(this.file.path)
            ? extractDrawioModelFromSvg(content)
            : content;
        if (!isDrawioSvgPath(this.file.path)) assertValidDiagramXml(editorSource);
        await this.port.load(editorSource);
        this.baseline = content;
        this.latestRawXml = editorSource;
        this.latestRawXmlRevision = this.revision;
        if (isDrawioSvgPath(this.file.path)) {
            this.lastValidatedSvg = content;
            this.lastValidatedSvgRevision = this.revision;
        } else {
            this.lastValidatedSvg = "";
            this.lastValidatedSvgRevision = -1;
        }
        this.savedRevision = this.revision;
        this.conflicted = false;
        this.hideConflict();
        this.setStatus(t("DRAWING_STATUS_RELOADED"));
    }

    private async saveConflictCopy(): Promise<void> {
        if (!this.file || !this.port) return;
        const { data: svg } = await this.port.export("xmlsvg");
        const copy = await this.files.saveCopy(this.file, svg, "conflict");
        new Notice(t("NOTICE_DRAWIO_SAVED_COPY", [copy.path]));
    }

    private async overwriteExternal(): Promise<void> {
        if (!this.file || !this.port) return;
        const confirmed = await confirmDrawingAction(
            this.app,
            t("DRAWING_OVERWRITE_TITLE"),
            t("DRAWING_OVERWRITE_DESC", [this.file.path])
        );
        if (!confirmed) return;
        try {
            const snapshot = await this.captureSaveSnapshot(this.revision);
            const result = await this.files.overwrite(
                this.file,
                snapshot.rawXml,
                snapshot.svg
            );
            this.baseline = result.baseline;
            this.savedRevision = Math.max(this.savedRevision, snapshot.revision);
            this.conflicted = false;
            this.hideConflict();
            this.setStatus(result.migrated
                ? t("DRAWING_STATUS_MIGRATED")
                : t("DRAWING_STATUS_SAVED"));
            await this.plugin.imageResourceRefreshService?.refreshFile(result.file);
            if (!this.closing && this.revision !== this.savedRevision) this.scheduleSave();
        } catch (error) {
            if (error instanceof DrawingSaveConflictError) {
                this.conflicted = true;
                this.setStatus(t("DRAWING_STATUS_CONFLICT"));
                this.showConflict();
                return;
            }
            this.setStatus(t("DRAWING_STATUS_SAVE_FAILED"));
            new Notice(t("NOTICE_DRAWIO_SAVE_FAILED", [getErrorMessage(error)]));
        }
    }

    private async restoreAiHistory(entry: DrawingHistoryEntry): Promise<void> {
        if (!this.port) return;
        if (this.conflicted) throw new DrawingSaveConflictError(
            "Resolve the external drawing conflict before restoring history."
        );
        await this.captureAiHistory(t("DRAWING_HISTORY_BEFORE_RESTORE"));
        const revision = await this.applyDiagramXml(entry.xml);
        const verified = await this.exportXml();
        assertUncompressedDiagramXml(verified);
        await this.ensureRevisionSaved(revision);
        this.setStatus(t("DRAWING_STATUS_SAVED"));
    }

    private async flushWithRecovery(): Promise<void> {
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        if (!this.port || !this.file || this.revision === this.savedRevision) return;
        let saveError: unknown;
        for (let attempt = 0;
            attempt < SAVE_SNAPSHOT_MAX_ATTEMPTS
            && !this.conflicted
            && this.revision !== this.savedRevision;
            attempt++) {
            try {
                await this.flush();
            } catch (error) {
                saveError = error;
                break;
            }
        }
        if (this.revision === this.savedRevision) return;

        const recoveryRevision = this.revision;
        let rawXml = this.latestRawXmlRevision === recoveryRevision ? this.latestRawXml : "";
        let svg = this.lastValidatedSvgRevision === recoveryRevision ? this.lastValidatedSvg : "";
        if (!rawXml && !svg) {
            try {
                await this.captureSaveSnapshot(recoveryRevision);
            } catch (error) {
                saveError ??= error;
            }
            rawXml = this.latestRawXmlRevision === recoveryRevision ? this.latestRawXml : "";
            svg = this.lastValidatedSvgRevision === recoveryRevision ? this.lastValidatedSvg : "";
        }

        try {
            const recovery = await this.files.saveRecoveryCopy(this.file, rawXml, svg);
            new Notice(t("NOTICE_DRAWIO_RECOVERED", [recovery.path]));
        } catch (error) {
            console.error(
                "[Image Assistant Drawing] Failed to preserve unsaved drawing:",
                saveError ?? error,
                error
            );
            new Notice(t("NOTICE_DRAWIO_RECOVERY_FAILED", [getErrorMessage(error)]));
        }
    }

    private async captureSaveSnapshot(minimumRevision: number): Promise<DrawingSaveSnapshot> {
        for (let attempt = 0; attempt < SAVE_SNAPSHOT_MAX_ATTEMPTS; attempt++) {
            const port = this.port;
            if (!port) throw new Error(t("ERROR_DRAWIO_SNAPSHOT_CHANGED"));
            const snapshotRevision = this.revision;
            if (snapshotRevision < minimumRevision) continue;

            const { data: rawXml } = await port.export("xml");
            if (port !== this.port || this.revision !== snapshotRevision) continue;
            assertValidDiagramXml(rawXml);
            this.latestRawXml = rawXml;
            this.latestRawXmlRevision = snapshotRevision;

            const { data: svg } = await port.export("xmlsvg");
            if (port !== this.port || this.revision !== snapshotRevision) continue;
            assertValidDrawioSvg(svg);
            this.lastValidatedSvg = svg;
            this.lastValidatedSvgRevision = snapshotRevision;
            return { revision: snapshotRevision, rawXml, svg };
        }
        throw new Error(t("ERROR_DRAWIO_SNAPSHOT_CHANGED"));
    }

    private showFatalError(error: unknown): void {
        const container = this.editorContainer;
        if (!container) return;
        container.empty();
        container.createDiv({
            cls: "image-assistant-drawing-error",
            text: t("NOTICE_DRAWIO_OPEN_FAILED", [getErrorMessage(error)])
        });
    }

    private setStatus(value: string): void {
        this.statusEl?.setText(value);
    }

    private setChatCollapsed(collapsed: boolean): void {
        this.chatCollapsed = collapsed;
        this.chatContainer?.toggleClass("is-collapsed", collapsed);
        this.chatResizeHandle?.toggleClass("is-collapsed", collapsed);
        this.chatToggle?.toggleClass("is-active", !collapsed);
    }

    private installChatResize(handle: HTMLDivElement): void {
        let pointerId: number | null = null;
        const onPointerDown = (event: PointerEvent): void => {
            if (event.button !== 0 || !this.workspaceEl || !this.chatContainer) return;
            pointerId = event.pointerId;
            handle.setPointerCapture(pointerId);
            this.workspaceEl.addClass("is-resizing-chat");
            event.preventDefault();
        };
        const onPointerMove = (event: PointerEvent): void => {
            if (pointerId !== event.pointerId || !this.workspaceEl || !this.chatContainer) return;
            const bounds = this.workspaceEl.getBoundingClientRect();
            const narrow = bounds.width <= 760;
            const available = narrow ? bounds.height : bounds.width;
            const requested = narrow ? bounds.bottom - event.clientY : bounds.right - event.clientX;
            const size = clampDrawingChatSize(requested, available, narrow);
            this.chatContainer.style.flexBasis = `${size}px`;
            event.preventDefault();
        };
        const onPointerUp = (event: PointerEvent): void => {
            if (pointerId !== event.pointerId) return;
            pointerId = null;
            this.workspaceEl?.removeClass("is-resizing-chat");
            if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
        };
        handle.addEventListener("pointerdown", onPointerDown);
        handle.addEventListener("pointermove", onPointerMove);
        handle.addEventListener("pointerup", onPointerUp);
        handle.addEventListener("pointercancel", onPointerUp);
    }

    private disposeEditor(): void {
        if (this.saveTimer) clearTimeout(this.saveTimer);
        this.saveTimer = null;
        this.removeDirtyListener?.();
        this.removeDirtyListener = null;
        this.chatPanel?.destroy();
        this.chatPanel = null;
        this.chatContainer = null;
        this.chatResizeHandle = null;
        this.port?.destroy();
        this.port = null;
        this.resolveEditorReady?.(false);
        this.resolveEditorReady = null;
    }

    private resetSaveState(): void {
        this.baseline = "";
        this.latestRawXml = "";
        this.latestRawXmlRevision = -1;
        this.lastValidatedSvg = "";
        this.lastValidatedSvgRevision = -1;
        this.revision = 0;
        this.savedRevision = 0;
        this.savePromise = null;
        this.conflicted = false;
        this.closing = false;
        this.closePreparationPromise = null;
    }

    private async persistChat(): Promise<void> {
        try {
            await this.chatPanel?.persist();
        } catch (error) {
            console.warn("[Image Assistant Drawing] Failed to persist Next AI chat:", error);
        }
    }

    private resetEditorReady(): void {
        this.resolveEditorReady?.(false);
        this.editorReadyPromise = new Promise(resolve => {
            this.resolveEditorReady = resolve;
        });
    }
}

export function clampDrawingChatSize(requested: number, available: number, narrow: boolean): number {
    const minimum = narrow ? 180 : 260;
    const maximum = Math.max(minimum, Math.min(narrow ? 520 : 620, available - minimum));
    return Math.min(maximum, Math.max(minimum, requested));
}
