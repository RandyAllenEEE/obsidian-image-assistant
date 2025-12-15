import { Editor, EditorPosition, MarkdownView } from "obsidian";

const loadingText = `Loading latex...`;
export class EditorInteract {
    view: MarkdownView;
    cursor: EditorPosition;
    editor: Editor;

    constructor(view: MarkdownView) {
        this.view = view;
        this.cursor = view.editor.getCursor();
        this.editor = view.editor;
    }

    insertLoadingText() {
        // 确保光标位置在文档范围内
        this.validateCursorPosition();
        
        this.editor.replaceRange(loadingText, this.cursor);
        // 更新光标位置到插入文本之后
        this.cursor = {
            line: this.cursor.line,
            ch: this.cursor.ch + loadingText.length
        };
        this.editor.setCursor(this.cursor);
    }

    insertResponseToEditor(res: string) {
        // 确保光标位置在文档范围内
        this.validateCursorPosition();
        
        // 计算结束位置
        const endPos = {
            line: this.cursor.line,
            ch: this.cursor.ch + loadingText.length
        };
        
        // 确保结束位置不超过当前行的长度
        const lineLength = this.editor.getLine(this.cursor.line).length;
        if (endPos.ch > lineLength) {
            endPos.ch = lineLength;
        }
        
        this.view.editor.replaceRange(res, this.cursor, endPos);
    }
    
    /**
     * 验证并修正光标位置，确保它在文档有效范围内
     */
    private validateCursorPosition() {
        const docLineCount = this.editor.lineCount();
        
        // 如果文档为空，初始化光标位置
        if (docLineCount === 0) {
            this.cursor = { line: 0, ch: 0 };
            return;
        }
        
        // 确保行号在有效范围内
        if (this.cursor.line < 0) {
            this.cursor.line = 0;
        } else if (this.cursor.line >= docLineCount) {
            this.cursor.line = docLineCount - 1;
        }
        
        // 确保列号在有效范围内
        const lineLength = this.editor.getLine(this.cursor.line).length;
        if (this.cursor.ch < 0) {
            this.cursor.ch = 0;
        } else if (this.cursor.ch > lineLength) {
            this.cursor.ch = lineLength;
        }
    }
}