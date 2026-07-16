import { describe, expect, it, vi } from "vitest";
import ImageConverterPlugin from "../../../src/main";
import { PasteModeConfigModal } from "../../../src/ui/modals/PasteModeConfigModal";
import { fakeApp, fakeTFile } from "../../factories/obsidian";

async function createPlugin() {
    const app = fakeApp() as any;
    const plugin = new ImageConverterPlugin(app, { id: "image-assistant" } as any);
    vi.spyOn(plugin as any, "loadData").mockResolvedValue(undefined);
    await plugin.loadSettings();
    return { app, plugin };
}

describe("runtime feature lifecycle", () => {
    it("detaches resize listeners immediately when disabled", async () => {
        const { plugin } = await createPlugin();
        const imageResizer = {
            detachView: vi.fn(),
            updateSettings: vi.fn(),
            onActiveViewChange: vi.fn(),
        };
        (plugin as any).imageResizer = imageResizer;

        plugin.setInteractiveResizeEnabled(false);

        expect(imageResizer.updateSettings).toHaveBeenCalledOnce();
        expect(imageResizer.detachView).toHaveBeenCalledOnce();
    });

    it("attaches resize listeners to the active Markdown view when enabled", async () => {
        const { app, plugin } = await createPlugin();
        const activeView = { editor: {} };
        app.workspace.getActiveViewOfType = vi.fn(() => activeView);
        const imageResizer = {
            detachView: vi.fn(),
            updateSettings: vi.fn(),
            onActiveViewChange: vi.fn(),
        };
        (plugin as any).imageResizer = imageResizer;

        plugin.setInteractiveResizeEnabled(true);

        expect(imageResizer.onActiveViewChange).toHaveBeenCalledWith(activeView);
    });

    it("unloads an existing context menu immediately when disabled", async () => {
        const { plugin } = await createPlugin();
        const contextMenu = {};
        (plugin as any).contextMenu = contextMenu;
        const removeChild = vi.spyOn(plugin as any, "removeChild").mockImplementation(() => plugin);

        plugin.setContextMenuEnabled(false);

        expect(removeChild).toHaveBeenCalledWith(contextMenu);
        expect(plugin.contextMenu).toBeNull();
    });

    it("removes the edit-mode wrap class when the plugin unloads", async () => {
        const { plugin } = await createPlugin();
        document.body.addClass("image-assistant-wrap-in-edit-mode");

        await plugin.onunload();

        expect(document.body.hasClass("image-assistant-wrap-in-edit-mode")).toBe(false);
    });

    it("applies and cleans the edit-mode wrap class in main and popout documents", async () => {
        const { app, plugin } = await createPlugin();
        const popoutDocument = document.implementation.createHTMLDocument("popout");
        const popoutContainer = popoutDocument.createElement("div");
        popoutDocument.body.appendChild(popoutContainer);
        app.workspace.iterateAllLeaves = vi.fn(callback => callback({
            view: { containerEl: popoutContainer }
        }));
        plugin.settings.alignment.enableEditModeWrap = true;

        plugin.applyEditModeWrapClass();

        expect(document.body.hasClass("image-assistant-wrap-in-edit-mode")).toBe(true);
        expect(popoutDocument.body.hasClass("image-assistant-wrap-in-edit-mode")).toBe(true);

        await plugin.onunload();

        expect(document.body.hasClass("image-assistant-wrap-in-edit-mode")).toBe(false);
        expect(popoutDocument.body.hasClass("image-assistant-wrap-in-edit-mode")).toBe(false);
    });

    it("removes the edit-mode wrap class while image alignment is disabled", async () => {
        const { plugin } = await createPlugin();
        plugin.settings.alignment.enableEditModeWrap = true;
        plugin.settings.alignment.enabled = true;
        plugin.applyEditModeWrapClass();
        expect(document.body.hasClass("image-assistant-wrap-in-edit-mode")).toBe(true);

        plugin.settings.alignment.enabled = false;
        plugin.applyEditModeWrapClass();
        expect(document.body.hasClass("image-assistant-wrap-in-edit-mode")).toBe(false);
    });

    it("clears retained download undo backups when the plugin unloads", async () => {
        const { plugin } = await createPlugin();
        const destroy = vi.fn();
        (plugin as any).cloudImageHandler = { destroy };

        await plugin.onunload();

        expect(destroy).toHaveBeenCalledOnce();
    });

    it("accepts only Markdown and Canvas files as current-note batch sources", async () => {
        const { app, plugin } = await createPlugin();
        const markdown = fakeTFile({ path: "notes/a.md", extension: "md" });
        const canvas = fakeTFile({ path: "boards/a.canvas", extension: "canvas" });
        const image = fakeTFile({ path: "images/a.png", extension: "png" });
        app.workspace.getActiveFile = vi.fn()
            .mockReturnValueOnce(markdown)
            .mockReturnValueOnce(canvas)
            .mockReturnValueOnce(image);

        expect((plugin as any).getActiveBatchSourceFile()).toBe(markdown);
        expect((plugin as any).getActiveBatchSourceFile()).toBe(canvas);
        expect((plugin as any).getActiveBatchSourceFile()).toBeNull();
    });

    it("does not open per-note paste settings for non-Markdown files", async () => {
        const { app, plugin } = await createPlugin();
        app.workspace.getActiveFile = vi.fn(() => fakeTFile({ path: "images/a.png", extension: "png" }));
        const open = vi.spyOn(PasteModeConfigModal.prototype, "open");

        await (plugin as any).showPasteModeConfigModal();

        expect(open).not.toHaveBeenCalled();
    });

    it("keeps startup available when upload history initialization fails", async () => {
        const { plugin } = await createPlugin();
        const historyManager = {
            init: vi.fn(async () => { throw new Error("history disk failure"); })
        };
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

        await expect((plugin as any).initializeUploadHistory(historyManager)).resolves.toBeUndefined();

        expect(plugin.historyManager).toBe(historyManager);
        expect(errorSpy).toHaveBeenCalledWith(
            "[Image Assistant] Upload history is unavailable:",
            expect.any(Error)
        );
    });

    it("does not initialize layout components after the plugin has unloaded", async () => {
        const { plugin } = await createPlugin();
        const initializeComponents = vi.spyOn(plugin, "initializeComponents").mockResolvedValue(undefined);
        (plugin as any).runtimeUnloaded = true;

        (plugin as any).initializeAfterLayoutReady();
        await Promise.resolve();

        expect(initializeComponents).not.toHaveBeenCalled();
    });
});
