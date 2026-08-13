import { MarkdownView, Menu } from "obsidian";
import { DrawingModuleController } from "../../../src/drawing/DrawingModuleController";
import { DrawioEditorView } from "../../../src/drawing/drawio/DrawioEditorView";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";
import { fakeApp, fakeTFile, fakeVault, fakeWorkspace } from "../../factories/obsidian";

describe("DrawingModuleController file menu fallback", () => {
    afterEach(() => vi.useRealTimers());
    it("only owns the standalone file-menu action when general context menus are disabled", () => {
        const listeners: Record<string, (...args: any[]) => void> = {};
        const workspace = fakeWorkspace() as any;
        workspace.on = vi.fn((event: string, callback: (...args: any[]) => void) => {
            listeners[event] = callback;
            return { detach: vi.fn() };
        });
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.drawing.provider = "drawio";
        settings.global.enableContextMenu = true;
        const plugin = {
            app: fakeApp({ workspace }),
            settings,
            registerView: vi.fn(),
            addCommand: vi.fn(),
            registerEvent: vi.fn(),
            contextMenu: {}
        } as any;
        const controller = new DrawingModuleController(plugin);
        controller.register();
        const diagram = fakeTFile({
            path: "assets/Flow.drawio.svg",
            name: "Flow.drawio.svg"
        });

        const consolidated = new Menu();
        listeners["file-menu"](consolidated, diagram);
        expect((consolidated as any).getItems()).toHaveLength(0);

        settings.global.enableContextMenu = false;
        plugin.contextMenu = null;
        const fallback = new Menu();
        listeners["file-menu"](fallback, diagram);
        expect((fallback as any).getItems().map((item: any) => item.getTitle()))
            .toEqual(["Open in editor"]);

        settings.drawing.provider = "disabled";
        const disabled = new Menu();
        listeners["file-menu"](disabled, diagram);
        expect((disabled as any).getItems()).toHaveLength(0);
    });

    it("uses the provider dropdown only as the default creation engine", () => {
        const workspace = fakeWorkspace() as any;
        workspace.on = vi.fn(() => ({ detach: vi.fn() }));
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.drawing.provider = "drawio";
        const plugin = {
            app: fakeApp({ workspace }),
            settings,
            registerView: vi.fn(),
            addCommand: vi.fn(),
            registerEvent: vi.fn(),
            contextMenu: null
        } as any;
        const controller = new DrawingModuleController(plugin);
        controller.register();
        const view = new MarkdownView({} as any);
        (view as any).file = fakeTFile({ path: "notes/source.md", extension: "md" });
        const commands = new Map<string, any>(
            plugin.addCommand.mock.calls.map(([command]: any[]) => [command.id, command])
        );

        expect(commands.get("create-drawio-diagram").editorCheckCallback(true, null, view)).toBe(true);
        expect(commands.get("create-excalidraw-diagram").editorCheckCallback(true, null, view)).toBe(false);

        settings.drawing.provider = "excalidraw";
        expect(commands.get("create-drawio-diagram").editorCheckCallback(true, null, view)).toBe(false);
        expect(commands.get("create-excalidraw-diagram").editorCheckCallback(true, null, view)).toBe(true);
        expect(commands.get("edit-drawio-diagram-at-cursor").editorCheckCallback(true, null, view)).toBe(true);
    });

    it("tests Draw.io with the standard embed init handshake", async () => {
        const workspace = fakeWorkspace() as any;
        const plugin = {
            app: fakeApp({ workspace }),
            settings: structuredClone(DEFAULT_SETTINGS),
            registerView: vi.fn(),
            addCommand: vi.fn(),
            registerEvent: vi.fn(),
            contextMenu: null
        } as any;
        const controller = new DrawingModuleController(plugin);
        const mount = vi.fn(async (host: HTMLElement) => {
            expect(host.parentElement).toBe(document.body);
            expect(host.style.width).toBe("960px");
            expect(host.style.height).toBe("720px");
            expect(host.style.left).toBe("-10000px");
            expect(host.style.opacity).toBe("");
            expect(host.style.clipPath).toBe("");
            expect(host.getAttribute("aria-hidden")).toBe("true");
        });
        const port = {
            mount,
            load: vi.fn(),
            export: vi.fn(),
            destroy: vi.fn(),
            getViewMetadata: vi.fn(),
            onDirty: vi.fn()
        } as any;
        const createEditor = vi.spyOn(controller.provider, "createEditor")
            .mockReturnValue(port);

        await expect(controller.testDrawioConnection(document.body)).resolves.toBe(true);

        expect(createEditor).toHaveBeenCalledWith(document);
        expect(mount).toHaveBeenCalledOnce();
        expect(port.load).not.toHaveBeenCalled();
        expect(port.export).not.toHaveBeenCalled();
        expect(port.destroy).toHaveBeenCalledOnce();
        expect(document.querySelector(".image-assistant-drawing-connection-test")).toBeNull();
    });

    it("cancels and cleans an in-flight connection test when drawing is disabled", async () => {
        const workspace = fakeWorkspace() as any;
        workspace.getLeavesOfType = vi.fn(() => []);
        const plugin = {
            app: fakeApp({ workspace }),
            settings: structuredClone(DEFAULT_SETTINGS),
            registerView: vi.fn(),
            addCommand: vi.fn(),
            registerEvent: vi.fn(),
            contextMenu: null
        } as any;
        const controller = new DrawingModuleController(plugin);
        let rejectMount!: (error: Error) => void;
        const port = {
            mount: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectMount = reject; })),
            load: vi.fn(),
            export: vi.fn(),
            destroy: vi.fn(() => rejectMount?.(new Error("Draw.io editor was closed."))),
            getViewMetadata: vi.fn(),
            onDirty: vi.fn()
        } as any;
        vi.spyOn(controller.provider, "createEditor").mockReturnValue(port);

        const testing = controller.testDrawioConnection(document.body);
        await Promise.resolve();
        await controller.disable();

        await expect(testing).resolves.toBe(false);
        expect(port.destroy).toHaveBeenCalled();
        expect(port.load).not.toHaveBeenCalled();
        expect(document.querySelector(".image-assistant-drawing-connection-test")).toBeNull();
    });

    it("refreshes only a managed Excalidraw preview after the external plugin saves it", async () => {
        vi.useFakeTimers();
        const source = fakeTFile({ path: "assets/Sketch.excalidraw.md", extension: "md" });
        const preview = fakeTFile({ path: "assets/Sketch.excalidraw.svg", extension: "svg" });
        const ordinary = fakeTFile({ path: "assets/icon.svg", extension: "svg" });
        const vaultListeners: Record<string, (...args: any[]) => void> = {};
        const vault = fakeVault({ files: [source, preview, ordinary] }) as any;
        vault.on = vi.fn((event: string, callback: (...args: any[]) => void) => {
            vaultListeners[event] = callback;
            return { detach: vi.fn() };
        });
        const workspace = fakeWorkspace() as any;
        workspace.on = vi.fn(() => ({ detach: vi.fn() }));
        const refreshFile = vi.fn(async () => ({ matched: 1, refreshed: 1 }));
        const plugin = {
            app: fakeApp({ vault, workspace }),
            settings: structuredClone(DEFAULT_SETTINGS),
            registerView: vi.fn(),
            addCommand: vi.fn(),
            registerEvent: vi.fn(),
            contextMenu: null,
            imageResourceRefreshService: { refreshFile }
        } as any;
        const controller = new DrawingModuleController(plugin);
        controller.register();

        vaultListeners.modify(ordinary);
        vaultListeners.modify(preview);
        await vi.advanceTimersByTimeAsync(120);

        expect(refreshFile).toHaveBeenCalledOnce();
        expect(refreshFile).toHaveBeenCalledWith(preview);
        await controller.disable();
    });

    it("awaits managed Draw.io preparation before detach and never closes a foreign view", async () => {
        let finishPreparation!: () => void;
        const preparation = new Promise<void>(resolve => { finishPreparation = resolve; });
        const managedView = Object.create(DrawioEditorView.prototype) as DrawioEditorView;
        (managedView as any).prepareForDetach = vi.fn(() => preparation);
        const managedLeaf = { view: managedView, detach: vi.fn() };
        const foreignLeaf = { view: { getViewType: () => "excalidraw" }, detach: vi.fn() };
        const workspace = fakeWorkspace() as any;
        workspace.getLeavesOfType = vi.fn(() => [managedLeaf, foreignLeaf]);
        workspace.on = vi.fn(() => ({ detach: vi.fn() }));
        const plugin = {
            app: fakeApp({ workspace }),
            settings: structuredClone(DEFAULT_SETTINGS),
            registerView: vi.fn(),
            addCommand: vi.fn(),
            registerEvent: vi.fn(),
            contextMenu: null
        } as any;
        const controller = new DrawingModuleController(plugin);

        const disabling = controller.disable();
        await Promise.resolve();
        expect(managedLeaf.detach).not.toHaveBeenCalled();
        expect(foreignLeaf.detach).not.toHaveBeenCalled();

        finishPreparation();
        await disabling;
        expect((managedView as any).prepareForDetach).toHaveBeenCalledOnce();
        expect(managedLeaf.detach).toHaveBeenCalledOnce();
        expect(foreignLeaf.detach).not.toHaveBeenCalled();
    });

    it("retains a managed view when close preparation unexpectedly rejects", async () => {
        const managedView = Object.create(DrawioEditorView.prototype) as DrawioEditorView;
        (managedView as any).prepareForDetach = vi.fn(async () => {
            throw new Error("prepare failed");
        });
        const managedLeaf = { view: managedView, detach: vi.fn() };
        const workspace = fakeWorkspace() as any;
        workspace.getLeavesOfType = vi.fn(() => [managedLeaf]);
        workspace.on = vi.fn(() => ({ detach: vi.fn() }));
        const plugin = {
            app: fakeApp({ workspace }),
            settings: structuredClone(DEFAULT_SETTINGS),
            registerView: vi.fn(),
            addCommand: vi.fn(),
            registerEvent: vi.fn(),
            contextMenu: null
        } as any;
        const controller = new DrawingModuleController(plugin);
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await controller.disable();

        expect(managedLeaf.detach).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();
    });
});
