import { describe, expect, it, vi } from "vitest";
import ImageConverterPlugin from "../../../src/main";
import { PasteModeConfigModal } from "../../../src/ui/modals/PasteModeConfigModal";
import { BatchOperationLauncher } from "../../../src/ui/contextMenu/batch/BatchOperationLauncher";
import { fakeApp, fakeTFile } from "../../factories/obsidian";
import { TEST_PLUGIN_ID } from "../../helpers/plugin-manifest";

async function createPlugin() {
    const app = fakeApp() as any;
    const plugin = new ImageConverterPlugin(app, { id: TEST_PLUGIN_ID } as any);
    vi.spyOn(plugin as any, "loadData").mockResolvedValue(undefined);
    await plugin.loadSettings();
    return { app, plugin };
}

describe("runtime feature lifecycle", () => {
    it("finishes shared DOM cleanup synchronously during a hot reload", async () => {
        const { plugin } = await createPlugin();
        const calls: string[] = [];
        (plugin as any).drawingModule = {
            disable: vi.fn(() => calls.push("drawing"))
        };
        (plugin as any).imageStateManager = {
            onunload: vi.fn(() => calls.push("state"))
        };
        (plugin as any).imageAlignment = {
            cleanup: vi.fn(() => calls.push("alignment"))
        };
        const result = plugin.onunload();

        expect(result).toBeUndefined();
        expect(calls).toEqual(["drawing", "state", "alignment"]);
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
        const launcher = new BatchOperationLauncher(app, plugin);
        const open = vi.spyOn(launcher, "open").mockImplementation(() => undefined);

        launcher.openCurrentNote("local_process");
        launcher.openCurrentNote("upload");
        launcher.openCurrentNote("download");

        expect(open).toHaveBeenNthCalledWith(1, {
            scope: "note", target: markdown, mode: "local_process"
        });
        expect(open).toHaveBeenNthCalledWith(2, {
            scope: "note", target: canvas, mode: "upload"
        });
        expect(open).toHaveBeenCalledTimes(2);
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
