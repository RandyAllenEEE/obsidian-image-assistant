import {
    App,
    Editor,
    MarkdownView,
    TFile,
    type MarkdownFileInfo
} from "obsidian";
import {
    collectUsableMarkdownViews,
    isUsableMarkdownView
} from "../ui/MarkdownViewRegistry";

export interface EditorImageInsertionContext {
    readonly editor: Editor;
    readonly file: TFile;
    readonly view: MarkdownView | null;
    readonly ownerDocument: Document;
}

export function resolveEditorImageInsertionContext(
    app: App,
    editor: Editor,
    info: MarkdownView | MarkdownFileInfo
): EditorImageInsertionContext | null {
    const file = info?.file;
    if (!(file instanceof TFile)) return null;

    const directView = isUsableMarkdownView(info)
        && info.editor === editor
        && info.file?.path === file.path
        ? info
        : null;
    const view = directView ?? collectUsableMarkdownViews(app).find(candidate =>
        candidate.editor === editor && candidate.file?.path === file.path
    ) ?? null;
    const ownerDocument = view?.contentEl.ownerDocument
        ?? app.workspace.containerEl?.ownerDocument
        ?? document;

    return Object.freeze({
        editor,
        file,
        view,
        ownerDocument
    });
}
