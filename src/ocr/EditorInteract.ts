import { Editor, EditorPosition, MarkdownView, Notice } from "obsidian";

const loadingText = `Loading latex...`;

export default class EditorInteract {
	view: MarkdownView;
	editor: Editor;
	// 缓存光标位置,参考 ocrlatex 的成功模式
	cursor: EditorPosition;
	private loadingTextLength: number = loadingText.length;

	constructor(view: MarkdownView) {
		this.view = view;
		this.editor = view.editor;
		// 立即缓存光标位置,避免 quiet-outline 等插件后续修改
		this.cursor = view.editor.getCursor();
	}

	/**
	 * 插入 loading text
	 */
	insertLoadingText(): void {
		// 使用缓存的光标位置
		this.editor.replaceRange(loadingText, this.cursor);
		this.editor.setCursor({
			line: this.cursor.line,
			ch: this.cursor.ch + this.loadingTextLength,
		});
	}

	/**
	 * 插入 OCR 结果到编辑器
	 * @param res OCR 结果文本
	 */
	insertResponseToEditor(res: string): void {
		// 使用缓存的光标位置计算结束位置
		this.editor.replaceRange(res, this.cursor, {
			line: this.cursor.line,
			ch: this.cursor.ch + this.loadingTextLength,
		});
	}


}
