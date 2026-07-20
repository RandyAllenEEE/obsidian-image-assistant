import type { StateField } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { Editor, MarkdownView } from "obsidian";

let fallbackWarningShown = false;

export function resolveEditorView(
    editor: Editor,
    ownerView?: MarkdownView | null,
    requiredField?: StateField<unknown>
): EditorView | null {
    const internal = (editor as Editor & { cm?: EditorView }).cm;
    if (isCompatibleView(internal, editor, requiredField)) return internal;

    const editorElement = ownerView?.contentEl?.querySelector<HTMLElement>(".cm-editor");
    const fromDom = editorElement ? EditorView.findFromDOM(editorElement) : null;
    if (isCompatibleView(fromDom, editor, requiredField)) return fromDom;

    if (!fallbackWarningShown) {
        fallbackWarningShown = true;
        console.warn(
            "[Image Assistant] CodeMirror EditorView could not be resolved; "
            + "asynchronous editor ranges will use strict fixed-position fallback."
        );
    }
    return null;
}

function isCompatibleView(
    view: EditorView | null | undefined,
    editor: Editor,
    requiredField?: StateField<unknown>
): view is EditorView {
    if (!view || typeof view.dispatch !== "function") return false;
    if (requiredField && !view.state.field(requiredField, false)) return false;
    const editorValue = editor.getValue?.();
    return typeof editorValue !== "string"
        || view.state.doc.toString() === editorValue;
}
