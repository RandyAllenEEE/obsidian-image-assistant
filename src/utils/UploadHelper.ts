import { App, Editor, MarkdownView } from "obsidian";

export interface ImageLink {
    path: string;
    name: string;
    source: string;
}

// 匹配图片链接的正则表达式
// 支持: ![](./path/image.png), ![](<./path/image.png>), ![](image.png "alt"), ![](https://example.com/image.png)
const REGEX_FILE =
    /!\[(.*?)\]\(<(\S+\.\w+)>\)|!\[(.*?)\]\((\S+\.\w+)(?:\s+"[^"]*")?\)|!\[(.*?)\]\((https?:\/\/.*?)\)/g;

// 匹配 Wiki 链接的正则表达式
// 支持: ![[image.png]], ![[image.png|alt text]]
const REGEX_WIKI_FILE = /!\[\[(.*?)(\s*?\|.*?)?\]\]/g;

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
        const fileArray: ImageLink[] = [];

        // 匹配 Markdown 格式的图片链接
        const matches = value.matchAll(REGEX_FILE);
        for (const match of matches) {
            const source = match[0];
            
            let name = match[1];
            let path = match[2];
            
            // 处理多种匹配组
            if (name === undefined) {
                name = match[3];
            }
            if (path === undefined) {
                path = match[4];
            }
            if (path === undefined) {
                path = match[6]; // 处理 URL 的情况
            }

            if (path) {
                fileArray.push({
                    path: path,
                    name: name || "",
                    source: source,
                });
            }
        }

        // 匹配 Wiki 链接格式的图片
        const wikiMatches = value.matchAll(REGEX_WIKI_FILE);
        for (const match of wikiMatches) {
            const source = match[0];
            const path = match[1];
            let name = path;
            
            // 如果有自定义显示名称
            if (match[2]) {
                name = `${name}${match[2]}`;
            }

            fileArray.push({
                path: path,
                name: name,
                source: source,
            });
        }

        return fileArray;
    }
}
