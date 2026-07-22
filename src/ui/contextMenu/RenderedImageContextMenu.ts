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

interface PendingImageMenu extends PendingImageMenuSeed {
    expiryTimer: number | null;
}

/** Source-first bridge that appends Image Assistant actions to Obsidian menus. */
export class RenderedImageContextMenu extends Component {
    private readonly documentScopes = new Map<Document, Component>();
    private readonly pendingByDocument = new Map<Document, PendingImageMenu>();
    private readonly menuScopes = new Set<Component>();
    private readonly imageResolver: ImageContextMenuResolver;
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
            () => plugin.settings.cleanerSettings.enableDeleteContextMenu,
            () => this.isReferenceInventoryReady()
        );
        void this.editCapabilities.primeAvifCapability();
        const imageMatchFinder = new ImageMatchFinder();
        const viewResolver = new ImageViewContextResolver(app);
        this.imageResolver = new ImageContextMenuResolver(
            app,
            viewResolver,
            imageMatchFinder
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
            pending => pending.context.image.isConnected
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
        const image = this.resolveImageFromEvent(event);
        if (!image) return false;
        const pending = this.pendingByDocument.get(image.ownerDocument);
        if (!pending
            || pending.generation !== this.contextMenuGeneration
            || Date.now() - pending.createdAt >= 1500
            || pending.context.image !== image
            || !image.isConnected) {
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
        const image = this.resolveImageFromEvent(event);
        const pending = image
            ? this.pendingByDocument.get(image.ownerDocument)
            : null;
        if (image
            && pending
            && pending.generation === this.contextMenuGeneration
            && pending.context.image === image) {
            this.refreshPending(pending);
            return;
        }

        const generation = ++this.contextMenuGeneration;
        this.clearAllPending();
        this.seedPendingFromEvent(event, generation);
    };

    private seedPendingFromEvent(
        event: Event,
        generation: number
    ): void {
        const image = this.resolveImageFromEvent(event);
        if (!image || !this.isSupportedImageTarget(image)) return;
        if (this.plugin.supportedImageFormats.isExcalidrawImage(image)) return;

        let context: ImageContextMenuContext;
        try {
            context = this.imageResolver.resolve(image);
        } catch (error) {
            console.warn("[Image Assistant] Image context resolution deferred:", error);
            return;
        }
        this.storePending(context, generation);
    }

    private refreshPending(pending: PendingImageMenu): void {
        let context: ImageContextMenuContext;
        try {
            context = this.imageResolver.resolve(pending.context.image);
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
        if (primaryItems.length === 0 && moreItems.length === 0) return false;
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
        if (moreItems.length > 0) {
            const actions = moreItems.map(id =>
                this.createActionDefinition(id, context));
            addSubmenuOrFallback(
                menu,
                {
                    title: t("MENU_MORE_IMAGE_ACTIONS"),
                    icon: "ellipsis"
                },
                actions.map(action => ({
                    title: t(action.title),
                    icon: action.icon,
                    onClick: () => {
                        void action.run();
                    }
                })),
                () => new ImageContextActionModal(this.app, actions).open(),
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
            refreshedContext = this.imageResolver.resolveForOfficialMenu(
                pending.context.image,
                hint,
                pending.context
            );
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
        if (isImageElement(target)) return target;
        const directImage = target.closest("img");
        if (isImageElement(directImage)) return directImage;
        const wrapper = target.closest(
            ".image-wrapper, .image-embed, .external-embed, "
            + ".cm-embed-block, .image-resize-container, "
            + "[data-image-assistant-layout-owner='true']"
        );
        const image = wrapper?.querySelector("img") ?? null;
        if (isImageElement(image)) return image;

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

    private isSupportedImageTarget(image: HTMLImageElement): boolean {
        if (image.closest(".map-view-main")) return false;
        return !!image.closest(".markdown-preview-view, .markdown-source-view");
    }

    onunload(): void {
        this.clearAllPending();
        for (const scope of this.menuScopes) scope.unload();
        this.menuScopes.clear();
        this.documentScopes.clear();
        this.registered = false;
        super.onunload();
    }

    private resolveImageFromEvent(event: Event): HTMLImageElement | null {
        const eventPath = typeof event.composedPath === "function"
            ? event.composedPath()
            : [];
        for (const target of eventPath) {
            if (!isElementLike(target)) continue;
            const image = this.resolveImageFromTarget(target);
            if (image) return image;
        }
        return isElementLike(event.target)
            ? this.resolveImageFromTarget(event.target)
            : null;
    }
}

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
