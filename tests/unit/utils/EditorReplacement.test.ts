import { describe, expect, it, vi } from "vitest";
import {
    createPlaceholderSession,
    createTrackedRangeSession
} from "../../../src/utils/EditorReplacement";

function makeEditor(initialValue = "0123456789\nabcdefghij\nABCDEFGHIJ", cursor = { line: 2, ch: 4 }) {
    let value = initialValue;
    let currentCursor = { ...cursor };

    const posToOffset = (position: { line: number; ch: number }): number => {
        const lines = value.split("\n");
        let offset = 0;
        for (let line = 0; line < position.line; line++) {
            offset += lines[line].length + 1;
        }
        return offset + position.ch;
    };

    const offsetToPos = (offset: number) => {
        const safeOffset = Math.max(0, Math.min(offset, value.length));
        const before = value.slice(0, safeOffset);
        const lines = before.split("\n");
        return { line: lines.length - 1, ch: lines.at(-1)?.length ?? 0 };
    };

    const editor = {
        getCursor: vi.fn(() => ({ ...currentCursor })),
        replaceRange: vi.fn((text: string, from: { line: number; ch: number }, to = from) => {
            const start = posToOffset(from);
            const end = posToOffset(to);
            value = `${value.slice(0, start)}${text}${value.slice(end)}`;
        }),
        setCursor: vi.fn((position: { line: number; ch: number }) => {
            currentCursor = { ...position };
        }),
        lineCount: vi.fn(() => value.split("\n").length),
        getLine: vi.fn((line: number) => value.split("\n")[line] ?? ""),
        getRange: vi.fn((from: { line: number; ch: number }, to: { line: number; ch: number }) =>
            value.slice(posToOffset(from), posToOffset(to))
        ),
        posToOffset: vi.fn(posToOffset),
        offsetToPos: vi.fn(offsetToPos),
        getValue: () => value,
    };

    return editor;
}

describe("EditorReplacement", () => {
    it("inserts a placeholder and replaces it with final text", () => {
        const editor = makeEditor();
        const session = createPlaceholderSession(editor as any, "loading");

        expect(session.inserted).toBe(true);
        expect(session.active).toBe(true);
        expect(session.replace("$x^2$")).toBe(true);
        expect(session.active).toBe(false);
        expect(editor.getValue()).toContain("ABCD$x^2$EFGHIJ");
    });

    it("removes a placeholder on failure cleanup", () => {
        const editor = makeEditor();
        const original = editor.getValue();
        const session = createPlaceholderSession(editor as any, "...");

        expect(session.remove()).toBe(true);
        expect(editor.getValue()).toBe(original);
        expect(editor.getCursor()).toEqual(session.start);
    });

    it("moves an unchanged cursor to the end of replacement text", () => {
        const editor = makeEditor("prefix suffix", { line: 0, ch: 7 });
        const session = createPlaceholderSession(editor as any, "loading");

        expect(session.replace("result-longer-than-loading")).toBe(true);
        expect(editor.getCursor()).toEqual({ line: 0, ch: 7 + "result-longer-than-loading".length });
    });

    it("does not steal the cursor when the user moved it during processing", () => {
        const editor = makeEditor("prefix suffix", { line: 0, ch: 7 });
        const session = createPlaceholderSession(editor as any, "loading");
        editor.setCursor({ line: 0, ch: 0 });

        expect(session.replace("result")).toBe(true);
        expect(editor.getCursor()).toEqual({ line: 0, ch: 0 });
    });

    it("uses an explicit start position without reading the current cursor", () => {
        const editor = makeEditor();
        createPlaceholderSession(editor as any, "...", { line: 1, ch: 1 });

        expect(editor.getCursor).not.toHaveBeenCalled();
        expect(editor.getValue()).toContain("a...bcdefghij");
    });

    it("does not insert if the requested line does not exist", () => {
        const editor = makeEditor();
        const session = createPlaceholderSession(editor as any, "...", { line: 9, ch: 1 });

        expect(session.inserted).toBe(false);
        expect(session.active).toBe(false);
        expect(editor.replaceRange).not.toHaveBeenCalled();
    });

    it("does not insert if the requested column is out of bounds", () => {
        const editor = makeEditor();
        const session = createPlaceholderSession(editor as any, "...", { line: 1, ch: 20 });

        expect(session.inserted).toBe(false);
        expect(editor.replaceRange).not.toHaveBeenCalled();
    });

    it("does not replace text if the placeholder content was externally edited", () => {
        const editor = makeEditor();
        const session = createPlaceholderSession(editor as any, "loading");
        editor.replaceRange("changed", session.start, editor.offsetToPos(editor.posToOffset(session.start) + session.length));
        editor.replaceRange.mockClear();

        expect(session.replace("result")).toBe(false);
        expect(session.active).toBe(false);
        expect(editor.replaceRange).not.toHaveBeenCalled();
        expect(editor.getValue()).toContain("changed");
    });

    it("does not read or replace a multiline placeholder when its end line was removed", () => {
        const editor = makeEditor("suffix", { line: 0, ch: 0 });
        const session = createPlaceholderSession(editor as any, "loading\nnext");
        editor.replaceRange("loading", { line: 0, ch: 0 }, { line: 1, ch: 4 });
        editor.replaceRange.mockClear();
        editor.getRange.mockClear();

        expect(session.replace("result")).toBe(false);
        expect(session.active).toBe(false);
        expect(editor.getRange).not.toHaveBeenCalled();
        expect(editor.replaceRange).not.toHaveBeenCalled();
    });

    it("tracks later placeholders when earlier sessions finish first", () => {
        const editor = makeEditor("prefix suffix", { line: 0, ch: 7 });
        const first = createPlaceholderSession(editor as any, "loading-a");
        const second = createPlaceholderSession(editor as any, "loading-b");

        expect(first.replace("A")).toBe(true);
        expect(second.replace("second-result")).toBe(true);
        expect(editor.getValue()).toBe("prefix Asecond-resultsuffix");
    });

    it("supports reverse completion order and multiline results", () => {
        const editor = makeEditor("prefix suffix", { line: 0, ch: 7 });
        const first = createPlaceholderSession(editor as any, "loading-a");
        const second = createPlaceholderSession(editor as any, "loading-b");

        expect(second.replace("B\nline-2")).toBe(true);
        expect(first.replace("A")).toBe(true);
        expect(editor.getValue()).toBe("prefix AB\nline-2suffix");
    });

    it("tracks an existing fallback range without inserting duplicate text", () => {
        const editor = makeEditor("prefix original suffix", { line: 0, ch: 0 });
        editor.replaceRange.mockClear();

        const session = createTrackedRangeSession(
            editor as any,
            "original",
            { line: 0, ch: 7 }
        );

        expect(session.inserted).toBe(false);
        expect(session.active).toBe(true);
        expect(editor.replaceRange).not.toHaveBeenCalled();
        expect(session.replace("updated")).toBe(true);
        expect(editor.getValue()).toBe("prefix updated suffix");
    });

    it("can release an existing fallback range while preserving its text", () => {
        const editor = makeEditor("prefix original suffix", { line: 0, ch: 0 });
        const session = createTrackedRangeSession(
            editor as any,
            "original",
            { line: 0, ch: 7 }
        );

        expect(session.release()).toBe(true);
        expect(session.status).toBe("completed");
        expect(session.release()).toBe(false);
        expect(session.remove()).toBe(false);
        expect(editor.getValue()).toBe("prefix original suffix");
    });

    it("returns an inactive session when an existing fallback range is stale", () => {
        const editor = makeEditor("prefix changed suffix", { line: 0, ch: 0 });
        const session = createTrackedRangeSession(
            editor as any,
            "original",
            { line: 0, ch: 7 }
        );

        expect(session.status).toBe("stale");
        expect(session.active).toBe(false);
        expect(session.replace("updated")).toBe(false);
        expect(session.remove()).toBe(false);
        expect(session.release()).toBe(false);
        expect(editor.getValue()).toBe("prefix changed suffix");
    });
});
