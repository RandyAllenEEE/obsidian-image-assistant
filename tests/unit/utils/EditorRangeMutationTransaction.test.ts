import { describe, expect, it, vi } from "vitest";
import { EditorRangeMutationTransaction } from "../../../src/utils/EditorRangeMutationTransaction";

class MemoryEditor {
    constructor(public value: string) {}

    getValue() { return this.value; }
    lineCount() { return this.value.split("\n").length; }
    getLine(line: number) { return this.value.split("\n")[line] ?? ""; }
    posToOffset(position: { line: number; ch: number }) {
        return this.value.split("\n").slice(0, position.line)
            .reduce((sum, text) => sum + text.length + 1, 0) + position.ch;
    }
    replaceRange(
        text: string,
        from: { line: number; ch: number },
        to = from
    ) {
        const start = this.posToOffset(from);
        const end = this.posToOffset(to);
        this.value = `${this.value.slice(0, start)}${text}${this.value.slice(end)}`;
    }
}

function createContext(value: string) {
    const editor = new MemoryEditor(value);
    const file = { path: "notes/current.md" };
    const view = {
        file,
        editor,
        save: vi.fn().mockResolvedValue(undefined)
    };
    return { editor, file, view };
}

describe("EditorRangeMutationTransaction", () => {
    it("removes a standalone final line without addressing a missing next line", async () => {
        const fixture = createContext("before\n![[image.png]]");
        const result = await new EditorRangeMutationTransaction().run(
            fixture as any,
            {
                line: 1,
                start: 0,
                end: 14,
                expectedText: "![[image.png]]",
                replacement: "",
                removeStandaloneLine: true
            }
        );

        expect(result.saved).toBe(true);
        expect(fixture.editor.value).toBe("before");
    });

    it("rolls back when save fails and no later edit occurred", async () => {
        const fixture = createContext("![old](a.png)");
        fixture.view.save.mockRejectedValueOnce(new Error("disk full"));
        const result = await new EditorRangeMutationTransaction().run(
            fixture as any,
            {
                line: 0,
                start: 0,
                end: 13,
                expectedText: "![old](a.png)",
                replacement: "![new](b.png)"
            }
        );

        expect(result.rolledBack).toBe(true);
        expect(result.rollbackSaved).toBe(true);
        expect(result.uncertain).toBe(false);
        expect(fixture.view.save).toHaveBeenCalledTimes(2);
        expect(fixture.editor.value).toBe("![old](a.png)");
    });

    it("reports uncertainty when persisting the rollback also fails", async () => {
        const fixture = createContext("![old](a.png)");
        fixture.view.save
            .mockRejectedValueOnce(new Error("first save failed"))
            .mockRejectedValueOnce(new Error("rollback save failed"));

        const result = await new EditorRangeMutationTransaction().run(
            fixture as any,
            {
                line: 0,
                start: 0,
                end: 13,
                expectedText: "![old](a.png)",
                replacement: "![new](b.png)"
            }
        );

        expect(result.rolledBack).toBe(true);
        expect(result.rollbackSaved).toBe(false);
        expect(result.uncertain).toBe(true);
        expect(result.error).toContain("rollback save failed");
        expect(fixture.editor.value).toBe("![old](a.png)");
    });

    it("does not overwrite a later user edit when save fails", async () => {
        const fixture = createContext("![old](a.png)");
        fixture.view.save.mockImplementation(async () => {
            fixture.editor.value += " user edit";
            throw new Error("disk full");
        });
        const result = await new EditorRangeMutationTransaction().run(
            fixture as any,
            {
                line: 0,
                start: 0,
                end: 13,
                expectedText: "![old](a.png)",
                replacement: "![new](b.png)"
            }
        );

        expect(result.rolledBack).toBe(false);
        expect(result.uncertain).toBe(true);
        expect(fixture.view.save).toHaveBeenCalledOnce();
        expect(fixture.editor.value).toBe("![new](b.png) user edit");
    });
});
