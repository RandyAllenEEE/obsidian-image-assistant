import { App, MarkdownView, type MarkdownViewModeType } from "obsidian";

/** Runtime guard for markdown leaves that may be transitioning between view types. */
export function isUsableMarkdownView(value: unknown): value is MarkdownView {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<MarkdownView> & Record<string, unknown>;
    if (typeof candidate.getMode !== "function"
        || !candidate.editor
        || !candidate.contentEl
        || typeof candidate.contentEl.querySelectorAll !== "function") return false;
    try {
        const mode = candidate.getMode();
        return mode === "source" || mode === "preview";
    } catch {
        return false;
    }
}

export function getMarkdownViewMode(view: MarkdownView): MarkdownViewModeType | null {
    try {
        const mode = typeof view.getMode === "function" ? view.getMode() : null;
        return mode === "source" || mode === "preview" ? mode : null;
    } catch {
        return null;
    }
}

export function collectUsableMarkdownViews(app: App): MarkdownView[] {
    const views: MarkdownView[] = [];
    const workspace = app?.workspace;
    if (!workspace) return views;
    const add = (candidate: unknown): void => {
        if (isUsableMarkdownView(candidate) && !views.includes(candidate)) views.push(candidate);
    };

    try {
        for (const leaf of workspace.getLeavesOfType?.("markdown") ?? []) add(leaf?.view);
    } catch {
        // A workspace transition can temporarily make leaf enumeration unavailable.
    }
    try {
        add(workspace.getActiveViewOfType?.(MarkdownView));
    } catch {
        // The next workspace event will retry the refresh.
    }
    return views;
}
