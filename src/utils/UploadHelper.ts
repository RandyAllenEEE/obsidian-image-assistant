import { App, Editor, MarkdownView } from "obsidian";

import { getAllImageLinks, ImageLink } from "./RegexPatterns";

export type { ImageLink }; // Re-export for compatibility

export class UploadHelper {
    app: App;

    constructor(app: App) {
        this.app = app;
    }

    getEditor(): Editor | null {
        const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (mdView) {
            return mdView.editor;
        }
        return null;
    }

    getValue(): string {
        const editor = this.getEditor();
        if (!editor) return "";
        return editor.getValue();
    }

    setValue(value: string): void {
        const editor = this.getEditor();
        if (!editor) return;

        const { left, top } = editor.getScrollInfo();
        const position = editor.getCursor();

        editor.setValue(value);
        editor.scrollTo(left, top);
        editor.setCursor(position);
    }

    // 获取当前笔记中的所有图片链接
    getAllImageLinks(): ImageLink[] {
        const editor = this.getEditor();
        if (!editor) return [];

        const value = editor.getValue();
        return this.parseImageLinks(value);
    }

    // 解析文本中的图片链接
    parseImageLinks(value: string): ImageLink[] {
        return getAllImageLinks(value);
    }
}
