import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Editor, MarkdownView, EditorPosition } from 'obsidian';
import EditorInteract from '../../../src/ocr/EditorInteract';

describe('EditorInteract', () => {
    let mockEditor: Editor;
    let mockView: MarkdownView;
    let editorInteract: EditorInteract;
    let cursorPosition: EditorPosition;

    beforeEach(() => {
        cursorPosition = { line: 5, ch: 10 };

        mockEditor = {
            getCursor: vi.fn().mockReturnValue(cursorPosition),
            replaceRange: vi.fn(),
            setCursor: vi.fn(),
        } as any;

        mockView = {
            editor: mockEditor,
        } as any;

        editorInteract = new EditorInteract(mockView);
    });

    describe('构造函数行为', () => {
        it('Given 创建 EditorInteract 实例, When 初始化, Then 立即缓存当前光标位置', () => {
            expect(mockEditor.getCursor).toHaveBeenCalledTimes(1);
            expect((editorInteract as any).cursor).toEqual(cursorPosition);
        });

        it('Given 构造后光标被其他插件修改, When 使用缓存的光标, Then 不受影响', () => {
            // 模拟其他插件修改了光标位置
            mockEditor.getCursor = vi.fn().mockReturnValue({ line: 100, ch: 0 });

            // EditorInteract 应该使用缓存的旧位置
            editorInteract.insertLoadingText();

            expect(mockEditor.replaceRange).toHaveBeenCalledWith(
                expect.any(String),
                cursorPosition
            );
        });
    });

    describe('insertLoadingText 方法', () => {
        it('Given 调用 insertLoadingText, When 执行, Then 在缓存的光标位置插入加载文本', () => {
            editorInteract.insertLoadingText();

            expect(mockEditor.replaceRange).toHaveBeenCalledTimes(1);
            expect(mockEditor.replaceRange).toHaveBeenCalledWith(
                expect.stringContaining('...'),
                cursorPosition
            );
        });

        it('Given 多次调用 insertLoadingText, When 执行, Then 每次都在相同的缓存位置插入', () => {
            editorInteract.insertLoadingText();
            editorInteract.insertLoadingText();

            expect(mockEditor.replaceRange).toHaveBeenCalledTimes(2);
            expect(mockEditor.replaceRange).toHaveBeenNthCalledWith(
                1,
                expect.any(String),
                cursorPosition
            );
            expect(mockEditor.replaceRange).toHaveBeenNthCalledWith(
                2,
                expect.any(String),
                cursorPosition
            );
        });
    });

    describe('insertResponseToEditor 方法', () => {
        it('Given OCR 结果文本, When insertResponseToEditor, Then 替换加载文本为结果', () => {
            const ocrResult = '$x^2 + y^2 = z^2$';
            editorInteract.insertResponseToEditor(ocrResult);

            expect(mockEditor.replaceRange).toHaveBeenCalledTimes(1);
            expect(mockEditor.replaceRange).toHaveBeenCalledWith(
                ocrResult,
                cursorPosition,
                expect.objectContaining({
                    line: cursorPosition.line,
                    ch: expect.any(Number)
                })
            );
        });

        it('Given 多行 LaTeX 结果, When insertResponseToEditor, Then 正确替换加载文本', () => {
            const multilineResult = '$$\n\\int_0^1 x^2 dx\n$$';
            editorInteract.insertResponseToEditor(multilineResult);

            expect(mockEditor.replaceRange).toHaveBeenCalledWith(
                multilineResult,
                cursorPosition,
                expect.any(Object)
            );
        });

        it('Given 空字符串结果, When insertResponseToEditor, Then 也能正确替换', () => {
            editorInteract.insertResponseToEditor('');

            expect(mockEditor.replaceRange).toHaveBeenCalledWith(
                '',
                cursorPosition,
                expect.any(Object)
            );
        });

        it('Given insertResponseToEditor 调用, When 计算结束位置, Then 使用 loadingTextLength 偏移', () => {
            const result = 'test';
            editorInteract.insertResponseToEditor(result);

            const endPosition = (mockEditor.replaceRange as any).mock.calls[0][2];
            expect(endPosition.line).toBe(cursorPosition.line);
            expect(endPosition.ch).toBe(cursorPosition.ch + (editorInteract as any).loadingTextLength);
        });
    });

    describe('removeLoadingText 方法', () => {
        it('Given 调用 removeLoadingText, When 执行, Then 删除加载文本范围的内容', () => {
            editorInteract.removeLoadingText();

            expect(mockEditor.replaceRange).toHaveBeenCalledTimes(1);
            expect(mockEditor.replaceRange).toHaveBeenCalledWith(
                '',
                cursorPosition,
                expect.objectContaining({
                    line: cursorPosition.line,
                    ch: expect.any(Number)
                })
            );
        });

        it('Given removeLoadingText 调用, When 计算结束位置, Then 使用 loadingTextLength 偏移', () => {
            editorInteract.removeLoadingText();

            const endPosition = (mockEditor.replaceRange as any).mock.calls[0][2];
            expect(endPosition.line).toBe(cursorPosition.line);
            expect(endPosition.ch).toBe(cursorPosition.ch + (editorInteract as any).loadingTextLength);
        });

        it('Given removeLoadingText 调用, When 执行, Then 用空字符串替换', () => {
            editorInteract.removeLoadingText();

            const replacementText = (mockEditor.replaceRange as any).mock.calls[0][0];
            expect(replacementText).toBe('');
        });
    });

    describe('完整工作流程', () => {
        it('Given 典型 OCR 工作流, When 依次调用方法, Then 所有操作使用相同的光标位置', () => {
            // 1. 插入加载文本
            editorInteract.insertLoadingText();
            expect(mockEditor.replaceRange).toHaveBeenLastCalledWith(
                expect.any(String),
                cursorPosition
            );

            // 2. 插入结果（替换加载文本）
            editorInteract.insertResponseToEditor('$result$');
            expect(mockEditor.replaceRange).toHaveBeenLastCalledWith(
                '$result$',
                cursorPosition,
                expect.any(Object)
            );

            expect(mockEditor.replaceRange).toHaveBeenCalledTimes(2);
        });

        it('Given OCR 失败场景, When 需要移除加载文本, Then 使用 removeLoadingText', () => {
            editorInteract.insertLoadingText();
            editorInteract.removeLoadingText();

            expect(mockEditor.replaceRange).toHaveBeenCalledTimes(2);
            expect(mockEditor.replaceRange).toHaveBeenLastCalledWith(
                '',
                cursorPosition,
                expect.any(Object)
            );
        });
    });

    describe('边界情况和注意事项', () => {
        it('Given 光标在文档开头 (0,0), When 操作, Then 正常工作', () => {
            const startPosition = { line: 0, ch: 0 };
            mockEditor.getCursor = vi.fn().mockReturnValue(startPosition);
            const interact = new EditorInteract(mockView);

            interact.insertLoadingText();

            expect(mockEditor.replaceRange).toHaveBeenCalledWith(
                expect.any(String),
                startPosition
            );
        });

        it('Given 光标在很大的位置, When 操作, Then 正常工作', () => {
            const largePosition = { line: 1000, ch: 500 };
            mockEditor.getCursor = vi.fn().mockReturnValue(largePosition);
            const interact = new EditorInteract(mockView);

            interact.insertResponseToEditor('test');

            expect(mockEditor.replaceRange).toHaveBeenCalledWith(
                'test',
                largePosition,
                expect.any(Object)
            );
        });

        it('Given 包含特殊字符的结果, When insertResponseToEditor, Then 正确处理', () => {
            const specialChars = '$\\frac{1}{2} \\times \\sqrt{3}$';
            editorInteract.insertResponseToEditor(specialChars);

            expect(mockEditor.replaceRange).toHaveBeenCalledWith(
                specialChars,
                expect.any(Object),
                expect.any(Object)
            );
        });
    });
});
