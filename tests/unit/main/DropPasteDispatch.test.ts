import { describe, expect, it, vi } from "vitest";
import ImageConverterPlugin from "../../../src/main";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";
import { fakeApp, fakePluginManifest, fakeTFile } from "../../factories/obsidian";

function makeClipboardEvent(defaultPrevented = false) {
    const evt: any = {
        defaultPrevented,
        clipboardData: {
            items: [
                {
                    kind: "file",
                    type: "image/png",
                    getAsFile: () => new File(["image"], "image.png", { type: "image/png" }),
                },
            ],
            getData: vi.fn(() => ""),
        },
        preventDefault: vi.fn(() => {
            evt.defaultPrevented = true;
        }),
    };
    return evt as ClipboardEvent;
}

function makeDropEvent(defaultPrevented = false) {
    const evt: any = {
        defaultPrevented,
        dataTransfer: {
            files: [new File(["image"], "image.png", { type: "image/png" })],
        },
        preventDefault: vi.fn(() => {
            evt.defaultPrevented = true;
        }),
    };
    return evt as DragEvent;
}

function makePlugin(mode: "local" | "cloud" | "disabled" = "local") {
    const handlers = new Map<string, Function>();
    const note = fakeTFile({
        path: "notes/owner.md",
        name: "owner.md",
        extension: "md"
    });
    const app = fakeApp({
        workspace: {
            on: vi.fn((eventName: string, callback: Function) => {
                handlers.set(eventName, callback);
                return { eventName, callback };
            }),
            getActiveFile: vi.fn(() => null),
        } as any,
    });
    const plugin = new ImageConverterPlugin(app as any, fakePluginManifest({ id: "obsidian-image-assistant" })) as any;
    plugin.settings = structuredClone(DEFAULT_SETTINGS);
    plugin.settings.pasteHandling.mode = mode;
    plugin.supportedImageFormats = { isSupported: vi.fn(() => true) };
    plugin.folderAndFilenameManagement = { matchesPatterns: vi.fn(() => false) };
    plugin.localImageHandler = {
        handlePaste: vi.fn(),
        handleDrop: vi.fn(),
    };
    plugin.cloudImageHandler = {
        handlePaste: vi.fn(),
        handleDrop: vi.fn(),
        handlePasteText: vi.fn(),
    };

    plugin.dropPasteRegisterEvents();
    return { plugin, handlers, note };
}

describe("drop/paste dispatch", () => {
    it("passes local image paste events to the local handler before preventDefault", async () => {
        const { plugin, handlers, note } = makePlugin("local");
        const evt = makeClipboardEvent();
        const editor = { getCursor: vi.fn(() => ({ line: 0, ch: 0 })) };

        await handlers.get("editor-paste")!(evt, editor, { file: note, editor });

        expect(evt.preventDefault).not.toHaveBeenCalled();
        expect(plugin.localImageHandler.handlePaste).toHaveBeenCalledWith(
            evt,
            editor,
            expect.objectContaining({ file: note, editor })
        );
        expect((plugin.localImageHandler.handlePaste as any).mock.calls[0][0].defaultPrevented).toBe(false);
    });

    it("does not intercept image paste when paste handling is disabled", async () => {
        const { plugin, handlers, note } = makePlugin("disabled");
        const evt = makeClipboardEvent();
        const editor = { getCursor: vi.fn(() => ({ line: 0, ch: 0 })) };

        await handlers.get("editor-paste")!(evt, editor, { file: note, editor });

        expect(evt.preventDefault).not.toHaveBeenCalled();
        expect(plugin.localImageHandler.handlePaste).not.toHaveBeenCalled();
        expect(plugin.cloudImageHandler.handlePaste).not.toHaveBeenCalled();
    });

    it("ignores paste events already handled by another plugin", async () => {
        const { plugin, handlers, note } = makePlugin("local");
        const evt = makeClipboardEvent(true);
        const editor = { getCursor: vi.fn(() => ({ line: 0, ch: 0 })) };

        await handlers.get("editor-paste")!(evt, editor, { file: note, editor });

        expect(plugin.localImageHandler.handlePaste).not.toHaveBeenCalled();
    });

    it("passes local image drop events to the local handler before preventDefault", async () => {
        const { plugin, handlers, note } = makePlugin("local");
        const evt = makeDropEvent();
        const editor = {
            posAtMouse: vi.fn(() => ({ line: 1, ch: 2 })),
        };

        await handlers.get("editor-drop")!(evt, editor, { file: note, editor });

        expect(evt.preventDefault).not.toHaveBeenCalled();
        expect(plugin.localImageHandler.handleDrop).toHaveBeenCalledWith(
            evt,
            editor,
            expect.objectContaining({ file: note, editor })
        );
        expect((plugin.localImageHandler.handleDrop as any).mock.calls[0][0].defaultPrevented).toBe(false);
    });

    it("does not auto-upload network text when the clipboard also contains an unsupported file", async () => {
        const { plugin, handlers, note } = makePlugin("cloud");
        plugin.supportedImageFormats.isSupported.mockReturnValue(false);
        const evt: any = {
            defaultPrevented: false,
            clipboardData: {
                items: [{
                    kind: "file",
                    type: "application/pdf",
                    getAsFile: () => new File(["pdf"], "document.pdf", { type: "application/pdf" })
                }],
                getData: vi.fn(() => "![remote](https://example.com/image.png)")
            },
            preventDefault: vi.fn()
        };
        const editor = { getCursor: vi.fn(() => ({ line: 0, ch: 0 })) };

        await handlers.get("editor-paste")!(evt, editor, { file: note, editor });

        expect(plugin.cloudImageHandler.handlePasteText).not.toHaveBeenCalled();
        expect(evt.preventDefault).not.toHaveBeenCalled();
    });
});
