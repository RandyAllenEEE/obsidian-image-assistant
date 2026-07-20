import { describe, expect, it, vi } from "vitest";
import { resolveEditorImageInsertionContext } from "../../../src/core/EditorImageInsertionContext";
import { fakeTFile } from "../../factories/obsidian";

describe("EditorImageInsertionContext", () => {
    it("uses the event file and matching non-active view", () => {
        const eventFile = fakeTFile({
            path: "notes/right.md",
            name: "right.md",
            extension: "md"
        });
        const activeFile = fakeTFile({
            path: "notes/wrong.md",
            name: "wrong.md",
            extension: "md"
        });
        const editor = {};
        const ownerDocument = document.implementation.createHTMLDocument();
        const view = {
            file: eventFile,
            editor,
            contentEl: ownerDocument.createElement("div"),
            getMode: vi.fn(() => "source")
        };
        const app = {
            workspace: {
                getLeavesOfType: vi.fn(() => [{ view }]),
                getActiveFile: vi.fn(() => activeFile),
                containerEl: document.body
            }
        } as any;

        const context = resolveEditorImageInsertionContext(
            app,
            editor as any,
            { file: eventFile } as any
        );

        expect(context).toMatchObject({
            editor,
            file: eventFile,
            view
        });
        expect(context?.ownerDocument).toBe(ownerDocument);
        expect(app.workspace.getActiveFile).not.toHaveBeenCalled();
    });

    it("fails closed when the event does not identify a TFile", () => {
        const app = {
            workspace: {
                getLeavesOfType: vi.fn(() => []),
                containerEl: document.body
            }
        } as any;

        expect(resolveEditorImageInsertionContext(
            app,
            {} as any,
            { file: null } as any
        )).toBeNull();
    });
});
