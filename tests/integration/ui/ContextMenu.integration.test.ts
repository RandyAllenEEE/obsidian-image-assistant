import { beforeEach, describe, expect, it, vi } from "vitest";
import { Menu } from "obsidian";
import { ContextMenuManager } from "../../../src/ui/contextMenu/ContextMenuManager";
import { IMAGE_ASSISTANT_MENU_SECTION } from "../../../src/ui/contextMenu/shared/MenuSections";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";
import {
    fakeApp,
    fakeTFile,
    fakeVault,
    fakeWorkspace
} from "../../factories/obsidian";

function setupImage(mode: "reading" | "editor" = "reading") {
    document.body.innerHTML = "";
    const container = document.createElement("div");
    container.className = mode === "reading"
        ? "markdown-preview-view"
        : "markdown-source-view";
    const wrapper = document.createElement("div");
    wrapper.className = "image-wrapper";
    const image = document.createElement("img");
    image.src = "blob:https://obsidian.local/proxy";
    wrapper.appendChild(image);
    container.appendChild(wrapper);
    document.body.appendChild(container);
    return { container, image, wrapper };
}

function makeFixture(readiness: "loading" | "ready" | "degraded" = "ready") {
    const note = fakeTFile({
        path: "notes/n1.md",
        name: "n1.md",
        extension: "md"
    });
    const imageFile = fakeTFile({
        path: "imgs/pic.jpg",
        name: "pic.jpg",
        extension: "jpg"
    });
    const editor = {};
    const view = {
        file: note,
        editor,
        contentEl: document.body,
        containerEl: document.body,
        getMode: () => "preview"
    };
    const workspace = fakeWorkspace({
        activeFile: note,
        activeView: view as any
    }) as any;
    const listeners: Record<string, (...args: any[]) => void> = {};
    workspace.on = vi.fn((event: string, callback: (...args: any[]) => void) => {
        listeners[event] = callback;
        return { detach: vi.fn() };
    });
    workspace.getLeavesOfType = vi.fn(() => [{ view }]);
    const app = fakeApp({
        vault: fakeVault({ files: [note, imageFile] }),
        workspace
    }) as any;
    const plugin = {
        settings: structuredClone(DEFAULT_SETTINGS),
        supportedImageFormats: {
            isSupported: vi.fn((_extension?: string, name?: string) =>
                /\.(?:png|jpe?g|webp)$/i.test(name ?? "")
            )
        },
        cloudImageHandler: {},
        historyManager: {
            isUrlUploaded: vi.fn(() => false),
            getRecord: vi.fn(),
            removeRecord: vi.fn()
        },
        imageStateManager: {
            getImageState: vi.fn(() => null),
            refreshAllImages: vi.fn()
        },
        imageCaption: { refreshAllViews: vi.fn() },
        referenceIndexService: { getReadiness: vi.fn(() => readiness) },
        drawingModule: { openFile: vi.fn(async () => null) }
    } as any;
    const folderManagement = {
        ensureFolderExists: vi.fn(),
        safeRenameFile: vi.fn(),
        sanitizeFilename: (value: string) => value
    };
    const manager = new ContextMenuManager(
        app,
        plugin,
        folderManagement as any,
        { processTemplate: vi.fn(async (value: string) => value) } as any,
        { open: vi.fn() } as any
    );
    const contextMenu = manager.renderedImageMenu;
    const makeContext = (image: HTMLImageElement) => {
        const source = "![[imgs/pic.jpg|Caption|center|320]]";
        const clicked = {
            view,
            file: note,
            editor,
            match: {
                line: 0,
                start: 0,
                end: source.length,
                linkText: source,
                descriptor: { path: imageFile.path, pipeData: null }
            }
        };
        return {
            image,
            ownerDocument: image.ownerDocument,
            ownerWindow: image.ownerDocument.defaultView,
            renderedSrc: image.src,
            sourceKind: "local",
            resolution: "resolved",
            owner: clicked,
            viewContext: clicked,
            descriptor: clicked.match.descriptor,
            localFile: imageFile,
            url: null,
            dataReference: null
        } as any;
    };
    return {
        app,
        contextMenu,
        editor,
        imageFile,
        listeners,
        manager,
        makeContext,
        note,
        plugin,
        view
    };
}

function menuTitles(menu: Menu): string[] {
    return ((menu as any).items as Array<{ title: string }>)
        .map(item => item.title);
}

function submenuTitles(menu: Menu, title: string): string[] {
    const parent = ((menu as any).items as Array<{
        getTitle(): string;
        getItems(): Array<{ getTitle(): string }>;
    }>).find(item => item.getTitle() === title);
    return parent?.getItems().map(item => item.getTitle()) ?? [];
}

function pluginMenuItems(menu: Menu): Array<{
    getTitle(): string;
    getSection(): string;
    isWarning(): boolean;
}> {
    return (menu as any).getItems().filter(
        (item: { getSection(): string }) =>
            item.getSection() === IMAGE_ASSISTANT_MENU_SECTION
    );
}

describe("ContextMenu integration", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        vi.clearAllMocks();
        vi.useRealTimers();
    });

    it("captures context without preventing the official or browser menu", async () => {
        vi.useFakeTimers();
        const addSpy = vi.spyOn(window, "addEventListener");
        const fixture = makeFixture();
        const { image } = setupImage("reading");
        vi.spyOn((fixture.contextMenu as any).imageResolver, "resolve")
            .mockReturnValue(fixture.makeContext(image));
        const event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true
        });
        const stop = vi.spyOn(event, "stopPropagation");
        const show = vi.spyOn(Menu.prototype, "showAtMouseEvent")
            .mockImplementation(function (this: Menu) {
                return this;
            });

        image.dispatchEvent(event);

        expect(addSpy).toHaveBeenCalledWith(
            "pointerdown",
            expect.any(Function),
            true
        );
        expect(addSpy).toHaveBeenCalledWith(
            "contextmenu",
            expect.any(Function),
            true
        );
        expect(event.defaultPrevented).toBe(false);
        expect(stop).not.toHaveBeenCalled();
        expect(show).not.toHaveBeenCalled();
        expect((fixture.contextMenu as any).pendingByDocument.size).toBe(1);
        await vi.advanceTimersByTimeAsync(1500);
        expect((fixture.contextMenu as any).pendingByDocument.size).toBe(0);
        fixture.manager.unload();
    });

    it("does not exclude an ordinary drawing preview through CSS-class heuristics", () => {
        const fixture = makeFixture();
        const { image } = setupImage("reading");
        image.classList.add("excalidraw-svg");
        fixture.plugin.drawingModule.inspectFile = vi.fn(() => ({
            providerId: "excalidraw",
            file: fixture.imageFile,
            sourceFile: fixture.imageFile,
            role: "source",
            compoundSuffix: ".excalidraw.md",
            protectedFromImageMutation: true
        }));
        fixture.plugin.drawingModule.canOpenFile = vi.fn(() => true);
        const context = fixture.makeContext(image);
        vi.spyOn((fixture.contextMenu as any).imageResolver, "resolve")
            .mockReturnValue(context);

        image.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true
        }));
        expect((fixture.contextMenu as any).pendingByDocument.size).toBe(1);

        const menu = new Menu();
        fixture.contextMenu.createContextMenuItems(menu, context);
        expect(menuTitles(menu)).toContain("Edit image properties…");
        expect(menuTitles(menu)).toContain("Delete reference or source…");
        expect(menuTitles(menu)).not.toContain("Upload to image host…");
        expect(submenuTitles(menu, "More image actions...")).toEqual([
            "Open in editor",
            "Copy image",
            "Copy as Base64 encoded image"
        ]);
        fixture.manager.unload();
    });

    it("shows a fallback menu for Excalidraw's real inline SVG render", async () => {
        vi.useFakeTimers();
        const fixture = makeFixture();
        fixture.plugin.settings.drawing.provider = "excalidraw";
        const sourceFile = fakeTFile({
            path: "Drawings/Flow.excalidraw.md",
            name: "Flow.excalidraw.md",
            extension: "md"
        });
        fixture.plugin.drawingModule.inspectFile = vi.fn(() => ({
            providerId: "excalidraw",
            file: sourceFile,
            sourceFile,
            role: "source",
            compoundSuffix: ".excalidraw.md",
            protectedFromImageMutation: true
        }));
        fixture.plugin.drawingModule.canOpenFile = vi.fn(() => true);

        document.body.innerHTML = "";
        const view = document.body.appendChild(document.createElement("div"));
        view.className = "markdown-preview-view";
        const wrapper = view.appendChild(document.createElement("div"));
        wrapper.className = "internal-embed image-embed";
        const rendered = wrapper.appendChild(document.createElement("div"));
        rendered.className = "excalidraw-svg excalidraw-embedded-img";
        rendered.setAttribute("fileSource", sourceFile.path);
        const svg = rendered.appendChild(document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg"
        ));
        svg.classList.add("excalidraw-svg");
        const path = svg.appendChild(document.createElementNS(
            "http://www.w3.org/2000/svg",
            "path"
        ));
        const context = {
            image: null,
            mediaElement: rendered,
            ownerDocument: document,
            ownerWindow: window,
            renderedSrc: "",
            sourceKind: "local",
            resolution: "unresolved",
            owner: {
                view: fixture.view,
                file: fixture.note,
                editor: fixture.editor
            },
            viewContext: null,
            descriptor: null,
            localFile: sourceFile,
            url: null,
            dataReference: null
        } as any;
        vi.spyOn((fixture.contextMenu as any).excalidrawResolver, "resolve")
            .mockReturnValue(context);
        let shownMenu: Menu | null = null;
        const show = vi.spyOn(Menu.prototype, "showAtMouseEvent")
            .mockImplementation(function (this: Menu) {
                shownMenu = this;
                return this;
            });
        const event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true
        });

        path.dispatchEvent(event);
        await vi.runAllTimersAsync();

        expect(event.defaultPrevented).toBe(true);
        expect(show).toHaveBeenCalledOnce();
        expect(shownMenu).not.toBeNull();
        expect(menuTitles(shownMenu!)).toEqual(["More image actions..."]);
        expect(submenuTitles(shownMenu!, "More image actions..."))
            .toEqual(["Open in editor"]);
        expect((fixture.contextMenu as any).pendingByDocument.size).toBe(0);
        fixture.manager.unload();
    });

    it("uses a right-button pointer seed when contextmenu never reaches the plugin", () => {
        const fixture = makeFixture();
        const { image } = setupImage("editor");
        const sourceUrl =
            "https://image.180428.xyz/imagehosting/2026/01/"
            + "5101737b9bf4cc110ad865f06a38e0ff.png";
        const source = `![GFL简化模型|500](${sourceUrl})`;
        const clicked = {
            view: fixture.view,
            file: fixture.note,
            editor: fixture.editor,
            match: {
                line: 0,
                start: 0,
                end: source.length,
                linkText: source,
                descriptor: { path: sourceUrl, pipeData: null }
            }
        };
        const context = {
            ...fixture.makeContext(image),
            sourceKind: "url",
            renderedSrc: "blob:https://obsidian.local/proxy",
            owner: clicked,
            viewContext: clicked,
            descriptor: clicked.match.descriptor,
            localFile: null,
            url: sourceUrl
        } as any;
        const resolver = (fixture.contextMenu as any).imageResolver;
        vi.spyOn(resolver, "resolve").mockReturnValue(context);
        vi.spyOn(resolver, "resolveForOfficialMenu").mockReturnValue(context);
        const pointerEvent = new MouseEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            button: 2
        });
        const stop = vi.spyOn(pointerEvent, "stopPropagation");

        image.dispatchEvent(pointerEvent);
        const menu = new Menu();
        menu.addItem(item => item
            .setTitle("Copy image")
            .setSection("action"));
        fixture.listeners["url-menu"]?.(menu, sourceUrl);

        expect(pointerEvent.defaultPrevented).toBe(false);
        expect(stop).not.toHaveBeenCalled();
        expect(pluginMenuItems(menu).map(item => item.getTitle())).toEqual([
            "Edit image properties…",
            "Download locally…",
            "Delete reference or source…"
        ]);
        fixture.manager.unload();
    });

    it("extends the direct Live Preview image menu created by Menu.forEvent", () => {
        const fixture = makeFixture();
        const { image, wrapper } = setupImage("editor");
        const sourceUrl =
            "https://image.180428.xyz/imagehosting/2026/01/"
            + "5101737b9bf4cc110ad865f06a38e0ff.png";
        const source = `![GFL简化模型|500](${sourceUrl})`;
        const clicked = {
            view: fixture.view,
            file: fixture.note,
            editor: fixture.editor,
            match: {
                line: 0,
                start: 0,
                end: source.length,
                linkText: source,
                descriptor: { path: sourceUrl, pipeData: null }
            }
        };
        const context = {
            ...fixture.makeContext(image),
            sourceKind: "url",
            renderedSrc: sourceUrl,
            owner: clicked,
            viewContext: clicked,
            descriptor: clicked.match.descriptor,
            localFile: null,
            url: sourceUrl
        } as any;
        const resolver = (fixture.contextMenu as any).imageResolver;
        vi.spyOn(resolver, "resolve").mockReturnValue(context);
        vi.spyOn(resolver, "resolveForOfficialMenu").mockReturnValue(context);
        let nativeMenu: Menu | null = null;

        wrapper.addEventListener("contextmenu", event => {
            nativeMenu = Menu.forEvent(event);
            nativeMenu.addItem(item => item
                .setTitle("Copy image")
                .setSection("image"));
            nativeMenu.addItem(item => item
                .setTitle("Reset size")
                .setSection("image"));
        });

        image.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true
        }));

        expect(nativeMenu).not.toBeNull();
        expect(menuTitles(nativeMenu!)).toEqual([
            "Edit image properties…",
            "Download locally…",
            "Delete reference or source…",
            "Copy image",
            "Reset size"
        ]);
        expect(pluginMenuItems(nativeMenu!).map(item => item.getTitle()))
            .toEqual([
                "Edit image properties…",
                "Download locally…",
                "Delete reference or source…"
            ]);
        expect((fixture.contextMenu as any).pendingByDocument.size).toBe(0);
        fixture.manager.unload();
    });

    it("keeps the Draw.io action only in More for a Menu.forEvent menu", () => {
        const fixture = makeFixture();
        fixture.plugin.settings.drawing.provider = "drawio";
        const { image, wrapper } = setupImage("editor");
        const diagram = fakeTFile({
            path: "imgs/Drawing.drawio.svg",
            name: "Drawing.drawio.svg",
            extension: "svg"
        });
        const context = {
            ...fixture.makeContext(image),
            localFile: diagram,
            descriptor: { path: diagram.path, pipeData: null }
        } as any;
        const resolver = (fixture.contextMenu as any).imageResolver;
        vi.spyOn(resolver, "resolve").mockReturnValue(context);
        vi.spyOn(resolver, "resolveForOfficialMenu").mockReturnValue(context);
        let nativeMenu: Menu | null = null;

        wrapper.addEventListener("contextmenu", event => {
            nativeMenu = Menu.forEvent(event);
            nativeMenu.addItem(item => item
                .setTitle("Copy image")
                .setSection("image"));
        });

        image.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true
        }));

        expect(nativeMenu).not.toBeNull();
        expect(menuTitles(nativeMenu!)
            .filter(title => title === "Open in editor"))
            .toHaveLength(0);
        expect(submenuTitles(nativeMenu!, "More image actions...")
            .filter(title => title === "Open in editor"))
            .toHaveLength(1);
        const more = (nativeMenu as any).items.find(
            (item: any) => item.getTitle() === "More image actions..."
        );
        const open = more.getItems().find(
            (item: any) => item.getTitle() === "Open in editor"
        );
        open.trigger();
        expect(fixture.plugin.drawingModule.openFile).toHaveBeenCalledWith(
            diagram
        );
        fixture.manager.unload();
    });

    it("restores Menu.forEvent when the context menu manager unloads", () => {
        const before = Menu.forEvent;
        const fixture = makeFixture();

        expect(Menu.forEvent).not.toBe(before);

        fixture.manager.unload();

        expect(Menu.forEvent).toBe(before);
    });

    it("resolves a caption sibling back to its single image on pointerdown", () => {
        const fixture = makeFixture();
        const { container, image } = setupImage("editor");
        image.setAttribute("data-image-assistant-layout-key", "url:0");
        const caption = container.createSpan({
            cls: "image-assistant-live-preview-caption"
        });
        caption.setAttribute("data-image-assistant-layout-key", "url:0");
        const resolve = vi.spyOn(
            (fixture.contextMenu as any).imageResolver,
            "resolve"
        ).mockReturnValue(fixture.makeContext(image));

        caption.dispatchEvent(new MouseEvent("pointerdown", {
            bubbles: true,
            cancelable: true,
            button: 2
        }));

        expect(resolve).toHaveBeenCalledWith(image);
        fixture.manager.unload();
    });

    it("appends to the official editor menu and preserves existing items", async () => {
        vi.useFakeTimers();
        const fixture = makeFixture();
        const { image } = setupImage("editor");
        const context = fixture.makeContext(image);
        const resolver = (fixture.contextMenu as any).imageResolver;
        vi.spyOn(resolver, "resolve").mockReturnValue(context);
        vi.spyOn(resolver, "resolveForOfficialMenu").mockReturnValue(context);
        const event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true
        });
        const fallback = vi.spyOn(Menu.prototype, "showAtMouseEvent")
            .mockImplementation(function (this: Menu) {
                return this;
            });
        image.dispatchEvent(event);

        const menu = new Menu();
        menu.addItem(item => item.setTitle("Other plugin action"));
        const info = { file: fixture.note, editor: fixture.editor };
        fixture.listeners["editor-menu"]?.(menu, fixture.editor, info);
        fixture.listeners["editor-menu"]?.(menu, fixture.editor, info);

        const titles = menuTitles(menu);
        expect(titles).toContain("Other plugin action");
        expect(titles.filter(title => title === "More image actions..."))
            .toHaveLength(1);
        expect(submenuTitles(menu, "More image actions..."))
            .toContain("Convert/compress...");
        expect((fixture.contextMenu as any).pendingByDocument.size).toBe(0);
        await vi.runAllTimersAsync();
        expect(fallback).not.toHaveBeenCalled();
        fixture.manager.unload();
    });

    it("keeps resolved URL transfer and deletion actions at the compact top level", () => {
        const fixture = makeFixture();
        const { image } = setupImage("reading");
        const context = {
            ...fixture.makeContext(image),
            sourceKind: "url",
            renderedSrc: "blob:https://obsidian.local/proxy",
            descriptor: {
                path: "https://cdn.example.com/image?id=42"
            },
            localFile: null,
            url: "https://cdn.example.com/image?id=42"
        } as any;
        const menu = new Menu();

        fixture.contextMenu.createContextMenuItems(menu, context);

        expect(menuTitles(menu)).toEqual([
            "Edit image properties…",
            "Download locally…",
            "Delete reference or source…"
        ]);
        expect(pluginMenuItems(menu).map(item => item.getTitle())).toEqual(
            menuTitles(menu)
        );
        expect(pluginMenuItems(menu).find(
            item => item.getTitle() === "Delete reference or source…"
        )?.isWarning()).toBe(true);
        fixture.manager.unload();
    });

    it("places the Draw.io editor action inside the local image More submenu", () => {
        const fixture = makeFixture();
        fixture.plugin.settings.drawing.provider = "drawio";
        const { image } = setupImage("editor");
        const diagram = fakeTFile({
            path: "imgs/Drawing.drawio.svg",
            name: "Drawing.drawio.svg",
            extension: "svg"
        });
        const context = {
            ...fixture.makeContext(image),
            localFile: diagram,
            descriptor: { path: diagram.path, pipeData: null }
        } as any;
        const menu = new Menu();

        fixture.contextMenu.createContextMenuItems(menu, context);

        expect(menuTitles(menu)).not.toContain("Open in editor");
        expect(submenuTitles(menu, "More image actions..."))
            .toContain("Open in editor");
        const parent = (menu as any).items.find(
            (item: any) => item.getTitle() === "More image actions..."
        );
        const open = parent.getItems().find(
            (item: any) => item.getTitle() === "Open in editor"
        );
        open.trigger();
        expect(fixture.plugin.drawingModule.openFile).toHaveBeenCalledWith(diagram);
        fixture.manager.unload();
    });

    it.each(["reading", "editor"] as const)(
        "does not duplicate the Draw.io action in the %s official menu path",
        mode => {
            const fixture = makeFixture();
            fixture.plugin.settings.drawing.provider = "drawio";
            const { image } = setupImage(mode);
            const diagram = fakeTFile({
                path: "imgs/Drawing.drawio.svg",
                name: "Drawing.drawio.svg",
                extension: "svg"
            });
            const context = {
                ...fixture.makeContext(image),
                localFile: diagram,
                descriptor: { path: diagram.path, pipeData: null }
            } as any;
            const resolver = (fixture.contextMenu as any).imageResolver;
            vi.spyOn(resolver, "resolve").mockReturnValue(context);
            vi.spyOn(resolver, "resolveForOfficialMenu").mockReturnValue(context);
            image.dispatchEvent(new MouseEvent("pointerdown", {
                bubbles: true,
                cancelable: true,
                button: 2
            }));
            const menu = new Menu();

            if (mode === "reading") {
                fixture.listeners["file-menu"]?.(menu, diagram);
            } else {
                fixture.listeners["editor-menu"]?.(
                    menu,
                    fixture.editor,
                    { file: fixture.note, editor: fixture.editor }
                );
            }

            expect(menuTitles(menu).filter(title => title === "Open in editor"))
                .toHaveLength(0);
            expect(submenuTitles(menu, "More image actions...")
                .filter(title => title === "Open in editor"))
                .toHaveLength(1);
            fixture.manager.unload();
        }
    );

    it("uses the official URL event to expose safe actions for a Blob proxy", () => {
        const fixture = makeFixture();
        const { image } = setupImage("reading");
        const initial = {
            ...fixture.makeContext(image),
            sourceKind: "blob",
            resolution: "pending",
            viewContext: null,
            descriptor: null,
            localFile: null,
            url: null
        } as any;
        const pendingUrl = {
            ...initial,
            sourceKind: "url",
            url: "https://cdn.example.com/dynamic?id=42"
        } as any;
        const resolver = (fixture.contextMenu as any).imageResolver;
        vi.spyOn(resolver, "resolve").mockReturnValue(initial);
        const enhance = vi.spyOn(resolver, "resolveForOfficialMenu")
            .mockReturnValue(pendingUrl);

        image.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true
        }));
        const menu = new Menu();
        menu.addItem(item => item
            .setTitle("Copy image")
            .setSection("action"));
        fixture.listeners["url-menu"]?.(
            menu,
            "https://cdn.example.com/dynamic?id=42"
        );

        expect(enhance).toHaveBeenCalledWith(
            image,
            {
                kind: "url",
                url: "https://cdn.example.com/dynamic?id=42"
            },
            initial
        );
        expect(menuTitles(menu)).toEqual([
            "Copy image",
            "Download locally…"
        ]);
        expect(pluginMenuItems(menu).map(item => item.getTitle())).toEqual([
            "Download locally…"
        ]);
        fixture.manager.unload();
    });

    it("does not let an unrelated URL event consume a local image context", () => {
        const fixture = makeFixture();
        const { image } = setupImage("reading");
        const local = fixture.makeContext(image);
        const resolver = (fixture.contextMenu as any).imageResolver;
        vi.spyOn(resolver, "resolve").mockReturnValue(local);
        const enhance = vi.spyOn(resolver, "resolveForOfficialMenu");

        image.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true
        }));
        const menu = new Menu();
        fixture.listeners["url-menu"]?.(
            menu,
            "https://example.com/unrelated"
        );

        expect(enhance).not.toHaveBeenCalled();
        expect(pluginMenuItems(menu)).toHaveLength(0);
        fixture.manager.unload();
    });

    it("invalidates an image context when a newer non-image right-click occurs", () => {
        vi.useFakeTimers();
        const fixture = makeFixture();
        const { image } = setupImage("reading");
        vi.spyOn((fixture.contextMenu as any).imageResolver, "resolve")
            .mockReturnValue(fixture.makeContext(image));

        image.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true
        }));
        document.body.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true
        }));
        const menu = new Menu();
        fixture.listeners["file-menu"]?.(menu, fixture.note);

        expect(menuTitles(menu)).not.toContain("Convert/compress...");
        expect((fixture.contextMenu as any).pendingByDocument.size).toBe(0);
        fixture.manager.unload();
    });

    it("uses the image inside a supported wrapper as the resolver target", async () => {
        vi.useFakeTimers();
        const fixture = makeFixture();
        const { image, wrapper } = setupImage("reading");
        const resolve = vi.spyOn(
            (fixture.contextMenu as any).imageResolver,
            "resolve"
        ).mockReturnValue(fixture.makeContext(image));
        const show = vi.spyOn(Menu.prototype, "showAtMouseEvent")
            .mockImplementation(function (this: Menu) {
                return this;
            });

        wrapper.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true
        }));
        await vi.runAllTimersAsync();

        expect(resolve).toHaveBeenCalledWith(image);
        expect(show).not.toHaveBeenCalled();
        fixture.manager.unload();
    });

    it("still records reliable image context after Obsidian prevents the browser menu", async () => {
        vi.useFakeTimers();
        const fixture = makeFixture();
        const { image } = setupImage("reading");
        const resolve = vi.spyOn(
            (fixture.contextMenu as any).imageResolver,
            "resolve"
        ).mockReturnValue(fixture.makeContext(image));
        const show = vi.spyOn(Menu.prototype, "showAtMouseEvent")
            .mockImplementation(function (this: Menu) {
                return this;
            });
        const event = new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true
        });
        event.preventDefault();

        image.dispatchEvent(event);
        expect(resolve).toHaveBeenCalledWith(image);
        expect((fixture.contextMenu as any).pendingByDocument.size).toBe(1);
        await vi.runAllTimersAsync();

        expect(show).not.toHaveBeenCalled();
        expect((fixture.contextMenu as any).pendingByDocument.size).toBe(0);
        fixture.manager.unload();
    });

    it("keeps popout document listeners scoped to that window", async () => {
        vi.useFakeTimers();
        const fixture = makeFixture();
        const popoutDocument = document.implementation.createHTMLDocument(
            "popout"
        );
        const container = popoutDocument.createElement("div");
        container.className = "markdown-preview-view";
        const image = popoutDocument.createElement("img");
        image.src = "https://example.com/photo.png";
        container.appendChild(image);
        popoutDocument.body.appendChild(container);
        const resolver = (fixture.contextMenu as any).imageResolver;
        const context = fixture.makeContext(image);
        const resolve = vi.spyOn(resolver, "resolve")
            .mockReturnValue(context);
        vi.spyOn(resolver, "resolveForOfficialMenu")
            .mockReturnValue(context);
        fixture.listeners["window-open"]?.(null, {
            document: popoutDocument
        });
        image.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true
        }));
        const firstMenu = new Menu();
        fixture.listeners["file-menu"]?.(firstMenu, fixture.imageFile);
        expect(menuTitles(firstMenu)).toContain("More image actions...");

        fixture.listeners["window-close"]?.(null, {
            document: popoutDocument
        });
        image.dispatchEvent(new MouseEvent("contextmenu", {
            bubbles: true,
            cancelable: true
        }));
        expect(resolve).toHaveBeenCalledOnce();
        expect((fixture.contextMenu as any).pendingByDocument.size).toBe(0);
        const secondMenu = new Menu();
        fixture.listeners["file-menu"]?.(secondMenu, fixture.imageFile);
        expect(menuTitles(secondMenu)).not.toContain("Convert/compress...");
        expect((fixture.contextMenu as any).documentScopes.has(popoutDocument))
            .toBe(false);
        fixture.manager.unload();
    });

    it("renders only capability-approved actions for unresolved images", () => {
        const fixture = makeFixture();
        const { image } = setupImage("reading");
        const context = {
            ...fixture.makeContext(image),
            sourceKind: "unresolved",
            resolution: "unresolved",
            owner: null,
            viewContext: null,
            descriptor: null,
            localFile: null
        } as any;
        const menu = new Menu();

        fixture.contextMenu.createContextMenuItems(menu, context);

        expect(menuTitles(menu)).toEqual(["More image actions..."]);
        expect((fixture.contextMenu as any).menuScopes.size).toBe(1);
        menu.hide();
        expect((fixture.contextMenu as any).menuScopes.size).toBe(0);
        fixture.manager.unload();
    });
});
