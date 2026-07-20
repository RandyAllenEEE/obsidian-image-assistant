import { EditorView } from "@codemirror/view";
import type { Editor, EditorPosition, MarkdownView } from "obsidian";
import { afterEach, describe, expect, it } from "vitest";
import {
    createMappedExistingRangeSession,
    createMappedInsertionSession,
    trackedEditorRangeField
} from "../../../src/utils/TrackedEditorRange";
import { fakeTFile } from "../../factories/obsidian";

interface Fixture {
    editor: Editor;
    parent: HTMLElement;
    view: EditorView;
    ownerView: MarkdownView;
    getCursor(): EditorPosition;
}

function createFixture(doc: string, cursor: EditorPosition): Fixture {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
        doc,
        extensions: [trackedEditorRangeField],
        parent
    });
    const toOffset = (position: EditorPosition) =>
        view.state.doc.line(position.line + 1).from + position.ch;
    const toPosition = (offset: number) => {
        const line = view.state.doc.lineAt(offset);
        return { line: line.number - 1, ch: offset - line.from };
    };
    view.dispatch({ selection: { anchor: toOffset(cursor) } });
    const editor = {
        cm: view,
        getCursor: () => toPosition(view.state.selection.main.head),
        setCursor: (position: EditorPosition) => {
            view.dispatch({ selection: { anchor: toOffset(position) } });
        },
        getValue: () => view.state.doc.toString(),
        lineCount: () => view.state.doc.lines,
        getLine: (line: number) => view.state.doc.line(line + 1).text,
        posToOffset: toOffset,
        offsetToPos: toPosition,
        getRange: (from: EditorPosition, to: EditorPosition) =>
            view.state.doc.sliceString(
                view.state.doc.line(from.line + 1).from + from.ch,
                view.state.doc.line(to.line + 1).from + to.ch
            ),
        replaceRange: (
            text: string,
            from: EditorPosition,
            to: EditorPosition = from
        ) => {
            view.dispatch({
                changes: {
                    from: view.state.doc.line(from.line + 1).from + from.ch,
                    to: view.state.doc.line(to.line + 1).from + to.ch,
                    insert: text
                }
            });
        }
    } as unknown as Editor;
    const file = fakeTFile({ path: "notes/owner.md", extension: "md" });
    const ownerView = {
        contentEl: parent,
        containerEl: parent,
        editor,
        file
    } as unknown as MarkdownView;
    return {
        editor,
        parent,
        view,
        ownerView,
        getCursor: () => toPosition(view.state.selection.main.head)
    };
}

describe("TrackedEditorRange", () => {
    const fixtures: Fixture[] = [];

    afterEach(() => {
        for (const fixture of fixtures.splice(0)) fixture.view.destroy();
        document.body.empty();
    });

    it("maps an inserted placeholder through ordinary edits before its range", () => {
        const fixture = createFixture("before", { line: 0, ch: 6 });
        fixtures.push(fixture);
        const session = createMappedInsertionSession(
            fixture.editor,
            "loading",
            { line: 0, ch: 6 },
            { view: fixture.ownerView, file: fixture.ownerView.file }
        )!;

        fixture.view.dispatch({ changes: { from: 0, insert: "prefix " } });

        expect(session.start).toEqual({ line: 0, ch: 13 });
        expect(session.replace("done")).toBe(true);
        expect(fixture.view.state.doc.toString()).toBe("prefix beforedone");
        expect(fixture.getCursor()).toEqual({ line: 0, ch: 17 });
    });

    it("resolves the EditorView from the owner DOM when editor.cm is unavailable", () => {
        const fixture = createFixture("before", { line: 0, ch: 6 });
        fixtures.push(fixture);
        delete (fixture.editor as Editor & { cm?: EditorView }).cm;

        const session = createMappedInsertionSession(
            fixture.editor,
            "loading",
            { line: 0, ch: 6 },
            { view: fixture.ownerView, file: fixture.ownerView.file }
        );

        expect(session).not.toBeNull();
        expect(session?.replace("done")).toBe(true);
        expect(fixture.view.state.doc.toString()).toBe("beforedone");
    });

    it("maps concurrent ranges independently across multiline edits", () => {
        const fixture = createFixture("A B", { line: 0, ch: 1 });
        fixtures.push(fixture);
        const first = createMappedExistingRangeSession(
            fixture.editor,
            "A",
            { line: 0, ch: 0 },
            { view: fixture.ownerView }
        )!;
        const second = createMappedExistingRangeSession(
            fixture.editor,
            "B",
            { line: 0, ch: 2 },
            { view: fixture.ownerView }
        )!;

        fixture.view.dispatch({ changes: { from: 1, insert: "\nnew\n" } });

        expect(first.replace("first")).toBe(true);
        expect(second.replace("second")).toBe(true);
        expect(fixture.view.state.doc.toString()).toBe("first\nnew\n second");
    });

    it("preserves user content when the managed range itself is edited", () => {
        const fixture = createFixture("loading", { line: 0, ch: 7 });
        fixtures.push(fixture);
        const session = createMappedExistingRangeSession(
            fixture.editor,
            "loading",
            { line: 0, ch: 0 },
            { view: fixture.ownerView }
        )!;

        fixture.view.dispatch({ changes: { from: 2, to: 4, insert: "XX" } });

        expect(session.status).toBe("modified");
        expect(session.remove()).toBe(false);
        expect(fixture.view.state.doc.toString()).toBe("loXXing");
    });

    it("detaches when the owner file changes or its view is removed", () => {
        const fixture = createFixture("loading", { line: 0, ch: 7 });
        fixtures.push(fixture);
        const changedFileSession = createMappedExistingRangeSession(
            fixture.editor,
            "loading",
            { line: 0, ch: 0 },
            { view: fixture.ownerView, file: fixture.ownerView.file }
        )!;
        fixture.ownerView.file = fakeTFile({ path: "notes/other.md", extension: "md" });

        expect(changedFileSession.replace("done")).toBe(false);
        expect(changedFileSession.status).toBe("detached");

        fixture.ownerView.file = fakeTFile({ path: "notes/owner.md", extension: "md" });
        const removedViewSession = createMappedExistingRangeSession(
            fixture.editor,
            "loading",
            { line: 0, ch: 0 },
            { view: fixture.ownerView, file: fixture.ownerView.file }
        )!;
        fixture.parent.remove();

        expect(removedViewSession.remove()).toBe(false);
        expect(removedViewSession.status).toBe("detached");
        expect(fixture.view.state.doc.toString()).toBe("loading");
    });
});
