import { Menu } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import { FileContextMenu } from "../../../../../src/ui/contextMenu/file/FileContextMenu";
import { MenuSessionRegistry } from "../../../../../src/ui/contextMenu/shared/MenuSessionRegistry";
import {
    fakeApp,
    fakeTFile,
    fakeVault
} from "../../../../factories/obsidian";

interface TestMenuItem {
    getIcon(): string;
    getItems(): TestMenuItem[];
    getSection(): string;
    getTitle(): string;
    trigger(): void;
}

function getMenuItems(menu: Menu): TestMenuItem[] {
    return (menu as unknown as { getItems(): TestMenuItem[] }).getItems();
}

function createFixture(readiness: "loading" | "ready" | "degraded" = "ready") {
    const note = fakeTFile({ path: "notes/source.md", extension: "md" });
    const image = fakeTFile({ path: "assets/photo.png", extension: "png" });
    const app = fakeApp({
        vault: fakeVault({ files: [note, image] })
    }) as any;
    const uploadSingleFile = vi.fn(async () => undefined);
    const plugin = {
        supportedImageFormats: {
            isSupported: vi.fn((_extension?: string, name?: string) =>
                /\.(?:png|jpe?g|webp|svg)$/i.test(name ?? "")
            )
        },
        cloudImageHandler: { uploadSingleFile },
        referenceIndexService: { getReadiness: vi.fn(() => readiness) },
        settings: { drawing: { provider: "disabled" } },
        drawingModule: { openFile: vi.fn(async () => null) }
    } as any;
    const launcher = { open: vi.fn() } as any;
    const ownership = new MenuSessionRegistry();
    const fileMenu = new FileContextMenu(app, plugin, launcher, ownership);
    return {
        fileMenu,
        image,
        launcher,
        note,
        ownership,
        plugin,
        uploadSingleFile
    };
}

describe("FileContextMenu", () => {
    it("adds image processing and upload independently of paste mode", () => {
        const fixture = createFixture();
        const menu = new Menu();

        expect(fixture.fileMenu.append(menu, fixture.image)).toBe(true);
        const items = getMenuItems(menu);

        expect(items).toHaveLength(2);
        expect(items.map(item => item.getIcon())).toEqual(["cog", "cloud-upload"]);
        expect(items.map(item => item.getSection()))
            .toEqual(["image-assistant", "image-assistant"]);
        items[1].trigger();
        expect(fixture.uploadSingleFile).toHaveBeenCalledWith(fixture.image);
    });

    it.each(["Flow.drawio", "Flow.drawio.svg"])(
        "adds one direct editor action for a file-level %s menu",
        path => {
            const fixture = createFixture("loading");
            fixture.plugin.settings.drawing.provider = "drawio";
            const diagram = fakeTFile({ path: `assets/${path}`, name: path });
            const menu = new Menu();

            expect(fixture.fileMenu.append(menu, diagram)).toBe(true);
            const items = getMenuItems(menu);
            expect(items.map(item => item.getTitle())).toEqual(["Open in editor"]);
            expect(items[0].getIcon()).toBe("shapes");
            expect(items[0].getSection()).toBe("image-assistant");
            items[0].trigger();
            expect(fixture.plugin.drawingModule.openFile).toHaveBeenCalledWith(diagram);
        }
    );

    it("does not expose a drawing action when the provider is disabled", () => {
        const fixture = createFixture();
        const diagram = fakeTFile({
            path: "assets/Flow.drawio.svg",
            name: "Flow.drawio.svg"
        });
        const menu = new Menu();

        expect(fixture.fileMenu.append(menu, diagram)).toBe(false);
        expect(getMenuItems(menu)).toHaveLength(0);
    });

    it("routes an existing Excalidraw source even when Draw.io is the default new engine", () => {
        const fixture = createFixture("loading");
        fixture.plugin.settings.drawing.provider = "drawio";
        const source = fakeTFile({
            path: "drawings/Flow.excalidraw.md",
            name: "Flow.excalidraw.md",
            extension: "md"
        });
        fixture.plugin.drawingModule.inspectFile = vi.fn(file => file === source ? ({
            providerId: "excalidraw",
            file,
            sourceFile: file,
            role: "source",
            compoundSuffix: ".excalidraw.md",
            protectedFromImageMutation: true
        }) : null);
        fixture.plugin.drawingModule.canOpenFile = vi.fn(() => true);
        const menu = new Menu();

        expect(fixture.fileMenu.append(menu, source)).toBe(true);
        expect(getMenuItems(menu).map(item => item.getTitle())).toEqual(["Open in editor"]);
        getMenuItems(menu)[0].trigger();
        expect(fixture.plugin.drawingModule.openFile).toHaveBeenCalledWith(source);
    });

    it("keeps an ordinary SVG on the regular local-image menu path", () => {
        const fixture = createFixture();
        fixture.plugin.settings.drawing.provider = "drawio";
        const svg = fakeTFile({ path: "assets/Icon.svg", name: "Icon.svg" });
        const menu = new Menu();

        expect(fixture.fileMenu.append(menu, svg)).toBe(true);
        expect(getMenuItems(menu).map(item => item.getTitle())).toEqual([
            "Process image",
            "Upload to image host…"
        ]);
    });

    it("adds three direct batch modes to a note submenu", () => {
        const fixture = createFixture();
        const menu = new Menu();

        fixture.fileMenu.append(menu, fixture.note);
        const parent = getMenuItems(menu)[0];
        const children = parent.getItems();

        expect(parent.getIcon()).toBe("images");
        expect(parent.getSection()).toBe("image-assistant");
        expect(children.map(item => item.getIcon())).toEqual([
            "cog",
            "cloud-upload",
            "download"
        ]);
        children.forEach(child => child.trigger());
        expect(fixture.launcher.open.mock.calls.map(([request]: any[]) => request))
            .toEqual([
                { scope: "note", target: fixture.note, mode: "local_process" },
                { scope: "note", target: fixture.note, mode: "upload" },
                { scope: "note", target: fixture.note, mode: "download" }
            ]);
    });

    it("falls back to the unified modal when submenu support is unavailable", () => {
        const fixture = createFixture();
        let click: (() => void) | undefined;
        const menu = {
            addItem(callback: (item: any) => void) {
                const item = {
                    setTitle: () => item,
                    setIcon: () => item,
                    onClick: (handler: () => void) => {
                        click = handler;
                        return item;
                    }
                };
                callback(item);
                return menu;
            }
        } as any;

        fixture.fileMenu.append(menu, fixture.note);
        click?.();

        expect(fixture.launcher.open).toHaveBeenCalledWith({
            scope: "note",
            target: fixture.note,
            mode: "local_process"
        });
    });

    it("does not append a second Image Assistant group to an owned menu", () => {
        const fixture = createFixture();
        const menu = new Menu();
        fixture.ownership.claim(menu);

        expect(fixture.fileMenu.append(menu, fixture.note)).toBe(false);
        expect(getMenuItems(menu)).toHaveLength(0);
    });

    it("releases ownership when a reused menu instance is closed", () => {
        const fixture = createFixture();
        const menu = new Menu();

        expect(fixture.fileMenu.append(menu, fixture.note)).toBe(true);
        menu.hide();
        expect(fixture.ownership.has(menu)).toBe(false);
        expect(fixture.fileMenu.append(menu, fixture.note)).toBe(true);
    });

    it.each(["loading", "degraded"] as const)(
        "does not append file or batch actions while the index is %s",
        readiness => {
            const fixture = createFixture(readiness);
            const imageMenu = new Menu();
            const noteMenu = new Menu();

            expect(fixture.fileMenu.append(imageMenu, fixture.image)).toBe(false);
            expect(fixture.fileMenu.append(noteMenu, fixture.note)).toBe(false);
            expect(getMenuItems(imageMenu)).toHaveLength(0);
            expect(getMenuItems(noteMenu)).toHaveLength(0);
        }
    );

    it("fails closed when index readiness cannot be read", () => {
        const fixture = createFixture();
        (fixture.fileMenu as any).plugin.referenceIndexService.getReadiness
            .mockImplementation(() => {
                throw new Error("service unloaded");
            });
        const menu = new Menu();

        expect(fixture.fileMenu.append(menu, fixture.image)).toBe(false);
        expect(getMenuItems(menu)).toHaveLength(0);
    });
});
