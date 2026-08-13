import {
    App,
    Component,
    Menu,
    Notice,
    type Editor,
    type MarkdownFileInfo,
    type MarkdownView,
    type TAbstractFile,
    type WorkspaceLeaf
} from "obsidian";
import { CloudImageDeleter } from "../../cloud/CloudImageDeleter";
import { t } from "../../lang/helpers";
import type { FolderAndFilenameManagement } from "../../local/FolderAndFilenameManagement";
import type { VariableProcessor } from "../../local/VariableProcessor";
import type ImageConverterPlugin from "../../main";
import { ImageContextMenuPolicy } from "./ImageContextMenuPolicy";
import { ClipboardHandler } from "./handlers/ClipboardHandler";
import { DeleteHandler } from "./handlers/DeleteHandler";
import { ProcessingHandler } from "./handlers/ProcessingHandler";
import { RenameHandler } from "./handlers/RenameHandler";
import { UploadDownloadHandler } from "./handlers/UploadDownloadHandler";
import { RenameInputBuilder } from "./inputs/RenameInputBuilder";
import type {
    ImageContextMenuContext,
    ImageContextMenuItemId,
    OfficialImageMenuHint,
    PendingImageMenuSeed
} from "./types";
import { ImageContextMenuResolver } from "./utils/ImageContextMenuResolver";
import { ImageMatchFinder } from "./utils/ImageMatchFinder";
import { ImageViewContextResolver } from "./utils/ImageViewContextResolver";
import { ExcalidrawRenderedContextResolver } from "./utils/ExcalidrawRenderedContextResolver";
import { MenuSessionRegistry } from "./shared/MenuSessionRegistry";
import { isHttpUrl } from "../../utils/NetworkPolicy";
import { CanvasEditCapabilityService } from "../../utils/CanvasEditCapability";
import { addSubmenuOrFallback } from "./shared/MenuSubmenuAdapter";
import { IMAGE_ASSISTANT_MENU_SECTION } from "./shared/MenuSections";
import { ObsidianImageMenuBridge } from "./shared/ObsidianImageMenuBridge";
import {
    ImageContextActionModal,
    type ImageContextActionDefinition
} from "../modals/ImageContextActionModal";
import { canOpenDrawingFile, inspectDrawingFile } from "../../drawing/DrawingFileSemantics";
import { findExcalidrawRenderedEmbed } from "../../drawing/excalidraw/ExcalidrawRenderedEmbed";
import { resolveRenderedMediaLayoutTarget } from "../RenderedMediaLayoutTarget";

interface PendingImageMenu extends PendingImageMenuSeed {
    expiryTimer: number | null;
}

/** Source-first bridge that appends Image Assistant actions to Obsidian menus. */
export class RenderedImageContextMenu extends Component {
    private readonly documentScopes = new Map<Document, Component>();
    private readonly pendingByDocument = new Map<Document, PendingImageMenu>();
    private readonly menuScopes = new Set<Component>();
    private readonly imageResolver: ImageContextMenuResolver;
    private readonly excalidrawResolver: ExcalidrawRenderedContextResolver;
    private readonly policy: ImageContextMenuPolicy;
    private readonly editCapabilities: CanvasEditCapabilityService;
    private readonly deleteHandler: DeleteHandler;
    private readonly uploadDownloadHandler: UploadDownloadHandler;
    private readonly clipboardHandler: ClipboardHandler;
    private readonly processingHandler: ProcessingHandler;
    private readonly renameHandler: RenameHandler;
    private readonly propertiesBuilder: RenameInputBuilder;
    private registered = false;
    private contextMenuGeneration = 0;

    constructor(
        private readonly app: App,
        private readonly plugin: ImageConverterPlugin,
        folderManagement: FolderAndFilenameManagement,
        variableProcessor: VariableProcessor,
        private readonly ownership = new MenuSessionRegistry()
    ) {
        super();
        this.editCapabilities = new CanvasEditCapabilityService(plugin);
        this.policy = new ImageContextMenuPolicy(
            extension => this.editCapabilities.peek(extension),
            () => plugin.settings.cleanerSettings.enabled
                && plugin.settings.cleanerSettings.enableDeleteContextMenu,
            () => this.isReferenceInventoryReady(),
            file => inspectDrawingFile(plugin, file)
        );
        void this.editCapabilities.primeAvifCapability();
        const imageMatchFinder = new ImageMatchFinder();
        const viewResolver = new ImageViewContextResolver(app);
        this.imageResolver = new ImageContextMenuResolver(
            app,
            viewResolver,
            imageMatchFinder
        );
        this.excalidrawResolver = new ExcalidrawRenderedContextResolver(
            app,
            plugin,
            viewResolver
        );
        this.clipboardHandler = new ClipboardHandler();
        this.processingHandler = new ProcessingHandler(
            app,
            plugin,
            this.editCapabilities
        );
        this.renameHandler = new RenameHandler(
            app,
            plugin,
            folderManagement,
            variableProcessor
        );
        this.propertiesBuilder = this.addChild(
            new RenameInputBuilder(app, plugin)
        );
        this.uploadDownloadHandler = new UploadDownloadHandler(app, plugin);
        this.deleteHandler = new DeleteHandler(
            app,
            plugin,
            new CloudImageDeleter(plugin)
        );
        this.addChild(new ObsidianImageMenuBridge(
            (menu, event) => this.consumeMenuForEvent(menu, event)
        ));
        this.registerContextMenuListener();
    }

    registerContextMenuListener(): void {
        if (this.registered) return;
        this.registerKnownDocuments();
        this.registerEvent(
            this.app.workspace.on(
                "window-open" as never,
                (_workspaceWindow: unknown, win: Window) => {
                    if (win?.document) this.registerDocument(win.document);
                }
            )
        );
        this.registerEvent(
            this.app.workspace.on(
                "window-close" as never,
                (_workspaceWindow: unknown, win: Window) => {
                    if (win?.document) this.unregisterDocument(win.document);
                }
            )
        );
        this.registered = true;
    }

    consumeEditorMenu(
        menu: Menu,
        editor: Editor,
        info: MarkdownView | MarkdownFileInfo
    ): boolean {
        return this.consumePending(
            menu,
            { kind: "editor" },
            pending => matchesEditorMenu(pending, editor, info)
        );
    }

    consumeFileMenu(
        menu: Menu,
        file: TAbstractFile,
        leaf?: WorkspaceLeaf
    ): boolean {
        return this.consumePending(
            menu,
            { kind: "file" },
            pending => matchesFileMenu(pending, file, leaf)
        );
    }

    consumeUrlMenu(menu: Menu, url: string): boolean {
        if (!isHttpUrl(url)) return false;
        return this.consumePending(
            menu,
            { kind: "url", url },
            pending => getContextTarget(pending.context).isConnected
                && isUrlMenuCandidate(pending.context)
        );
    }

    /**
     * Live Preview image widgets build their native menu directly through
     * Menu.forEvent() and do not emit url-menu/editor-menu.
     */
    consumeMenuForEvent(
        menu: Menu,
        event: PointerEvent | MouseEvent
    ): boolean {
        if (this.ownership.has(menu)) return false;
        const target = this.resolveMenuTargetFromEvent(event);
        if (!target) return false;
        const element = target.element;
        const pending = this.pendingByDocument.get(element.ownerDocument);
        if (!pending
            || pending.generation !== this.contextMenuGeneration
            || Date.now() - pending.createdAt >= 1500
            || getContextTarget(pending.context) !== element
            || !element.isConnected) {
            return false;
        }
        const hint = this.getImageMenuHint(pending.context);
        return this.consumeMatchedPending(menu, hint, pending);
    }

    handlePointerDownEvent = (event: PointerEvent): void => {
        if (event.button !== 2) return;
        const generation = ++this.contextMenuGeneration;
        this.clearAllPending();
        this.seedPendingFromEvent(event, generation);
    };

    handleContextMenuEvent = (event: MouseEvent): void => {
        const target = this.resolveMenuTargetFromEvent(event);
        const element = target?.element ?? null;
        const pending = element
            ? this.pendingByDocument.get(element.ownerDocument)
            : null;
        if (element
            && pending
            && pending.generation === this.contextMenuGeneration
            && getContextTarget(pending.context) === element) {
            this.refreshPending(pending);
            this.scheduleExcalidrawContextMenuFallback(event, target);
            return;
        }

        const generation = ++this.contextMenuGeneration;
        this.clearAllPending();
        this.seedPendingFromEvent(event, generation);
        this.scheduleExcalidrawContextMenuFallback(event, target);
    };

    private scheduleExcalidrawContextMenuFallback(
        event: MouseEvent,
        target: ResolvedMenuTarget | null
    ): void {
        if (target?.kind !== "excalidraw") return;
        const pending = this.pendingByDocument.get(target.element.ownerDocument);
        if (!pending || getContextTarget(pending.context) !== target.element) return;

        // Claim only the verified rendered drawing's browser menu. The timer is
        // independent of event bubbling: if Obsidian or Excalidraw creates a
        // Menu.forEvent menu synchronously, that bridge consumes the pending
        // context first; otherwise Image Assistant supplies the fallback.
        event.preventDefault();
        ownerWindow(target.element.ownerDocument).setTimeout(() => {
            this.showExcalidrawContextMenuFallback(event);
        }, 0);
    }

    private seedPendingFromEvent(
        event: Event,
        generation: number
    ): void {
        const target = this.resolveMenuTargetFromEvent(event);
        if (!target || !this.isSupportedMediaTarget(target.element)) return;

        let context: ImageContextMenuContext;
        try {
            if (target.kind === "excalidraw") {
                const resolved = this.excalidrawResolver.resolve(target.element);
                if (!resolved) return;
                context = resolved;
            } else {
                context = this.imageResolver.resolve(target.element);
            }
        } catch (error) {
            console.warn("[Image Assistant] Image context resolution deferred:", error);
            return;
        }
        this.storePending(context, generation);
    }

    private refreshPending(pending: PendingImageMenu): void {
        let context: ImageContextMenuContext;
        try {
            const target = getContextTarget(pending.context);
            context = pending.context.image
                ? this.imageResolver.resolve(pending.context.image)
                : this.excalidrawResolver.resolve(target) ?? pending.context;
        } catch {
            return;
        }
        this.clearPending(pending.context.ownerDocument);
        this.storePending(context, pending.generation);
    }

    private storePending(
        context: ImageContextMenuContext,
        generation: number
    ): void {
        const ownerDocument = context.ownerDocument;
        const pending: PendingImageMenu = {
            context,
            createdAt: Date.now(),
            generation,
            expiryTimer: null
        };
        this.pendingByDocument.set(ownerDocument, pending);

        pending.expiryTimer = ownerWindow(ownerDocument).setTimeout(() => {
            if (this.pendingByDocument.get(ownerDocument) !== pending) return;
            this.pendingByDocument.delete(ownerDocument);
            pending.expiryTimer = null;
        }, 1500);
    }

    createContextMenuItems(
        menu: Menu,
        context: ImageContextMenuContext,
        _appendToExisting = false
    ): boolean {
        if (this.ownership.has(menu)) return false;
        const primaryItems = this.policy.getPrimaryItems(context);
        const moreItems = this.policy.getMoreItems(context);
        const moreActions = moreItems.map(id =>
            this.createActionDefinition(id, context));
        const drawingAction = this.createDrawingActionDefinition(context);
        if (drawingAction) moreActions.unshift(drawingAction);
        if (primaryItems.length === 0 && moreActions.length === 0) return false;
        const menuSession = this.ownership.claim(menu);
        if (!menuSession) return false;

        const scope = new Component();
        this.menuScopes.add(scope);
        const dispose = () => {
            if (!this.menuScopes.delete(scope)) return;
            scope.unload();
        };
        menuSession.onRelease(dispose);

        for (const item of primaryItems) {
            this.addMenuItem(menu, item, context);
        }
        if (moreActions.length > 0) {
            addSubmenuOrFallback(
                menu,
                {
                    title: t("MENU_MORE_IMAGE_ACTIONS"),
                    icon: "ellipsis"
                },
                moreActions.map(action => ({
                    title: t(action.title),
                    icon: action.icon,
                    onClick: () => {
                        void action.run();
                    }
                })),
                () => new ImageContextActionModal(this.app, moreActions).open(),
                IMAGE_ASSISTANT_MENU_SECTION
            );
        }
        return true;
    }

    private addMenuItem(
        menu: Menu,
        id: ImageContextMenuItemId,
        context: ImageContextMenuContext
    ): void {
        const definition = getMenuItemDefinition(id);
        menu.addItem(item => {
            item.setTitle(t(definition.title))
                .setIcon(definition.icon)
                .setSection(IMAGE_ASSISTANT_MENU_SECTION)
                .onClick(() => this.executeMenuItem(id, context));
            if (id === "delete") item.setWarning(true);
        });
    }

    private createActionDefinition(
        id: ImageContextMenuItemId,
        context: ImageContextMenuContext
    ): ImageContextActionDefinition {
        const definition = getMenuItemDefinition(id);
        return {
            ...definition,
            run: () => this.executeMenuItem(id, context)
        };
    }

    private createDrawingActionDefinition(
        context: ImageContextMenuContext
    ): ImageContextActionDefinition | null {
        const file = context.localFile;
        if (!file || !canOpenDrawingFile(this.plugin, file)) return null;
        return {
            title: "MENU_EDIT_DRAWING",
            icon: "shapes",
            run: async () => {
                await this.plugin.drawingModule.openFile(file);
            }
        };
    }

    private executeMenuItem(
        id: ImageContextMenuItemId,
        context: ImageContextMenuContext
    ): void | Promise<void> {
        if (REFERENCE_INVENTORY_REQUIRED_ITEMS.has(id)
            && !this.isReferenceInventoryReady()) {
            new Notice(t("REFERENCE_INDEX_MENU_ACTIONS_UNAVAILABLE"));
            return;
        }
        switch (id) {
            case "properties":
                this.propertiesBuilder.openModal(
                    context,
                    changes => this.renameHandler.applyProperties(
                        context,
                        changes
                    )
                );
                return;
            case "copy":
                return this.clipboardHandler.copyImage(context);
            case "copy-base64":
                return this.clipboardHandler.copyImageAsBase64(context);
            case "process":
                return this.processingHandler.processImage(context);
            case "crop":
                return this.processingHandler.cropRotateFlip(context);
            case "annotate":
                return this.processingHandler.annotateImage(context);
            case "upload":
                return this.uploadDownloadHandler.uploadImageToCloud(context);
            case "download":
                return this.uploadDownloadHandler.downloadNetworkImage(context);
            case "delete":
                return this.deleteHandler.deleteImageAndLink(context);
        }
    }

    private isReferenceInventoryReady(): boolean {
        try {
            return this.plugin.referenceIndexService?.getReadiness?.() === "ready";
        } catch {
            return false;
        }
    }

    private consumePending(
        menu: Menu,
        hint: OfficialImageMenuHint,
        matches: (pending: PendingImageMenu) => boolean
    ): boolean {
        if (this.ownership.has(menu)) return false;
        const pending = [...this.pendingByDocument.values()]
            .filter(candidate =>
                candidate.generation === this.contextMenuGeneration
                && Date.now() - candidate.createdAt < 1500
                && matches(candidate)
            )
            .sort((a, b) => b.createdAt - a.createdAt)[0];
        if (!pending) return false;
        return this.consumeMatchedPending(menu, hint, pending, matches);
    }

    private consumeMatchedPending(
        menu: Menu,
        hint: OfficialImageMenuHint,
        pending: PendingImageMenu,
        matches?: (pending: PendingImageMenu) => boolean
    ): boolean {
        let refreshedContext: ImageContextMenuContext;
        try {
            refreshedContext = pending.context.image
                ? this.imageResolver.resolveForOfficialMenu(
                    pending.context.image,
                    hint,
                    pending.context
                )
                : this.excalidrawResolver.resolve(
                    getContextTarget(pending.context)
                ) ?? pending.context;
        } catch {
            this.clearPending(pending.context.ownerDocument);
            return false;
        }
        if (hint.kind !== "url" && matches && !matches({
            ...pending,
            context: refreshedContext
        })) {
            this.clearPending(pending.context.ownerDocument);
            return false;
        }
        this.clearPending(pending.context.ownerDocument);
        return this.createContextMenuItems(menu, refreshedContext, true);
    }

    private getImageMenuHint(
        context: ImageContextMenuContext
    ): OfficialImageMenuHint {
        const url = context.url
            ?? (isHttpUrl(context.renderedSrc) ? context.renderedSrc : null);
        return url
            ? { kind: "url", url }
            : { kind: "editor" };
    }

    private registerKnownDocuments(): void {
        this.registerDocument(document);
        const workspaceDocument = this.app.workspace.containerEl?.ownerDocument;
        if (workspaceDocument) this.registerDocument(workspaceDocument);
        this.app.workspace.iterateAllLeaves?.(leaf => {
            const ownerDocument = leaf.view?.containerEl?.ownerDocument;
            if (ownerDocument) this.registerDocument(ownerDocument);
        });
    }

    private registerDocument(ownerDocument: Document): void {
        if (this.documentScopes.has(ownerDocument)) return;
        const scope = this.addChild(new Component());
        const ownerView = ownerDocument.defaultView;
        const handleDocumentPointerDown = (event: PointerEvent): void => {
            if (!isElementLike(event.target)) return;
            if (event.target.ownerDocument !== ownerDocument) return;
            this.handlePointerDownEvent(event);
        };
        const handleDocumentContextMenu = (event: MouseEvent): void => {
            if (!isElementLike(event.target)) return;
            if (event.target.ownerDocument !== ownerDocument) return;
            this.handleContextMenuEvent(event);
        };
        if (ownerView?.document === ownerDocument) {
            scope.registerDomEvent(
                ownerView,
                "pointerdown",
                handleDocumentPointerDown,
                true
            );
            scope.registerDomEvent(
                ownerView,
                "contextmenu",
                handleDocumentContextMenu,
                true
            );
        } else {
            scope.registerDomEvent(
                ownerDocument,
                "pointerdown",
                this.handlePointerDownEvent,
                true
            );
            scope.registerDomEvent(
                ownerDocument,
                "contextmenu",
                handleDocumentContextMenu,
                true
            );
        }
        this.documentScopes.set(ownerDocument, scope);
    }

    private showExcalidrawContextMenuFallback(event: MouseEvent): void {
        const target = this.resolveMenuTargetFromEvent(event);
        if (target?.kind !== "excalidraw") return;
        const pending = this.pendingByDocument.get(target.element.ownerDocument);
        if (!pending
            || pending.generation !== this.contextMenuGeneration
            || Date.now() - pending.createdAt >= 1500
            || getContextTarget(pending.context) !== target.element
            || !target.element.isConnected) {
            return;
        }

        let context: ImageContextMenuContext;
        try {
            context = this.excalidrawResolver.resolve(target.element) ?? pending.context;
        } catch {
            this.clearPending(target.element.ownerDocument);
            return;
        }
        this.clearPending(target.element.ownerDocument);

        const menu = new Menu();
        if (!this.createContextMenuItems(menu, context)) return;
        event.preventDefault();
        menu.showAtMouseEvent(event);
    }

    private unregisterDocument(ownerDocument: Document): void {
        this.clearPending(ownerDocument);
        const scope = this.documentScopes.get(ownerDocument);
        if (!scope) return;
        this.documentScopes.delete(ownerDocument);
        this.removeChild(scope);
    }

    private clearPending(ownerDocument: Document): void {
        const pending = this.pendingByDocument.get(ownerDocument);
        if (!pending) return;
        this.pendingByDocument.delete(ownerDocument);
        if (pending.expiryTimer !== null) {
            ownerWindow(ownerDocument).clearTimeout(pending.expiryTimer);
            pending.expiryTimer = null;
        }
    }

    private clearAllPending(): void {
        for (const ownerDocument of [...this.pendingByDocument.keys()]) {
            this.clearPending(ownerDocument);
        }
    }

    private resolveImageFromTarget(target: Element): HTMLImageElement | null {
        const media = resolveRenderedMediaLayoutTarget(target);
        if (media?.kind === "obsidian-image" && media.image) return media.image;

        const caption = target.closest(
            "[data-image-assistant-caption-node], "
            + ".image-assistant-live-preview-caption"
        );
        const captionParent = caption?.parentElement;
        if (!caption || !captionParent) return null;
        const sourceKey = caption.getAttribute(
            "data-image-assistant-source-key"
        );
        const layoutKey = caption.getAttribute(
            "data-image-assistant-layout-key"
        );
        const candidates = Array.from(
            captionParent.querySelectorAll<HTMLImageElement>("img")
        );
        const matchingCandidates = candidates.filter(candidate =>
            (sourceKey && candidate.getAttribute(
                "data-image-assistant-source-key"
            ) === sourceKey)
            || (layoutKey && candidate.getAttribute(
                "data-image-assistant-layout-key"
            ) === layoutKey)
        );
        if (matchingCandidates.length === 1) return matchingCandidates[0];
        return candidates.length === 1 ? candidates[0] : null;
    }

    private isSupportedMediaTarget(element: Element): boolean {
        if (element.closest(".map-view-main, .excalidraw-wrapper")) return false;
        return !!element.closest(".markdown-preview-view, .markdown-source-view");
    }

    onunload(): void {
        this.clearAllPending();
        for (const scope of this.menuScopes) scope.unload();
        this.menuScopes.clear();
        this.documentScopes.clear();
        this.registered = false;
        super.onunload();
    }

    private resolveMenuTargetFromEvent(event: Event): ResolvedMenuTarget | null {
        const eventPath = typeof event.composedPath === "function"
            ? event.composedPath()
            : [];
        for (const target of eventPath) {
            if (!isElementLike(target)) continue;
            const resolved = this.resolveMenuTargetFromElement(target);
            if (resolved) return resolved;
        }
        return isElementLike(event.target)
            ? this.resolveMenuTargetFromElement(event.target)
            : null;
    }

    private resolveMenuTargetFromElement(target: Element): ResolvedMenuTarget | null {
        const excalidraw = findExcalidrawRenderedEmbed(target);
        if (excalidraw) return {
            kind: "excalidraw",
            element: excalidraw.element
        };
        if (isImageElement(target)) return { kind: "image", element: target };
        const image = this.resolveImageFromTarget(target);
        return image ? { kind: "image", element: image } : null;
    }
}

type ResolvedMenuTarget =
    | { readonly kind: "image"; readonly element: HTMLImageElement }
    | {
        readonly kind: "excalidraw";
        readonly element: HTMLElement;
    };

const REFERENCE_INVENTORY_REQUIRED_ITEMS = new Set<ImageContextMenuItemId>([
    "properties",
    "process",
    "crop",
    "annotate",
    "upload",
    "download",
    "delete"
]);

function matchesEditorMenu(
    pending: PendingImageMenu,
    editor: Editor,
    info: MarkdownView | MarkdownFileInfo
): boolean {
    const owner = pending.context.owner;
    return !!owner
        && owner.editor === editor
        && info?.file?.path === owner.file.path
        && (!info.editor || info.editor === editor);
}

function matchesFileMenu(
    pending: PendingImageMenu,
    file: TAbstractFile,
    leaf?: WorkspaceLeaf
): boolean {
    const owner = pending.context.owner;
    if (!owner || !file?.path) return false;
    if (leaf && owner.leaf && leaf !== owner.leaf) return false;
    return file.path === owner.file.path
        || file.path === pending.context.localFile?.path;
}

function isUrlMenuCandidate(context: ImageContextMenuContext): boolean {
    return context.sourceKind === "url"
        || context.sourceKind === "blob"
        || context.sourceKind === "unresolved"
        || isHttpUrl(context.renderedSrc);
}

function getContextTarget(context: ImageContextMenuContext): Element {
    const target = context.mediaElement ?? context.image;
    if (!target) throw new Error("Image context has no rendered target.");
    return target;
}

function getMenuItemDefinition(id: ImageContextMenuItemId): {
    title: Parameters<typeof t>[0];
    icon: string;
} {
    switch (id) {
        case "properties":
            return { title: "MENU_EDIT_IMAGE_PROPERTIES", icon: "sliders-horizontal" };
        case "copy":
            return { title: "MENU_COPY_IMAGE", icon: "copy" };
        case "copy-base64":
            return { title: "MENU_COPY_BASE64", icon: "copy" };
        case "process":
            return { title: "MENU_CONVERT_COMPRESS", icon: "cog" };
        case "crop":
            return { title: "MENU_CROP_FLIP", icon: "scissors" };
        case "annotate":
            return { title: "MENU_ANNOTATE", icon: "pencil" };
        case "upload":
            return { title: "MENU_UPLOAD_CLOUD", icon: "cloud-upload" };
        case "download":
            return { title: "MENU_DOWNLOAD_NETWORK_IMAGE", icon: "download" };
        case "delete":
            return { title: "MENU_DELETE_LINK", icon: "trash" };
    }
}

function isElementLike(target: EventTarget | null): target is Element {
    return !!target && typeof (target as Element).closest === "function";
}

function isImageElement(element: Element | null): element is HTMLImageElement {
    return !!element && element.tagName.toLowerCase() === "img";
}

function ownerWindow(ownerDocument: Document): Window {
    return ownerDocument.defaultView ?? window;
}
