import { describe, expect, it, vi } from "vitest";
import {
    collectUsableMarkdownViews,
    getMarkdownViewMode,
    isUsableMarkdownView
} from "../../../src/ui/MarkdownViewRegistry";

function makeView(mode: "source" | "preview") {
    return {
        contentEl: document.createElement("div"),
        editor: {},
        getMode: vi.fn(() => mode)
    };
}

describe("MarkdownViewRegistry", () => {
    it("skips transition leaves without a callable mode or editor", () => {
        const valid = makeView("source");
        const noMode = { contentEl: document.createElement("div"), editor: {} };
        const noEditor = { contentEl: document.createElement("div"), getMode: () => "preview" };
        const app = {
            workspace: {
                getLeavesOfType: vi.fn(() => [
                    { view: noMode },
                    { view: valid },
                    { view: noEditor }
                ]),
                getActiveViewOfType: vi.fn(() => noMode)
            }
        } as any;

        expect(collectUsableMarkdownViews(app)).toEqual([valid]);
        expect(isUsableMarkdownView(noMode)).toBe(false);
    });

    it("contains a throwing getMode and lets other leaves continue", () => {
        const throwing = {
            contentEl: document.createElement("div"),
            editor: {},
            getMode: () => { throw new Error("transition"); }
        } as any;
        const valid = makeView("preview");
        const app = {
            workspace: {
                getLeavesOfType: vi.fn(() => [{ view: throwing }, { view: valid }]),
                getActiveViewOfType: vi.fn(() => null)
            }
        } as any;

        expect(() => collectUsableMarkdownViews(app)).not.toThrow();
        expect(collectUsableMarkdownViews(app)).toEqual([valid]);
        expect(getMarkdownViewMode(throwing)).toBeNull();
    });
});
