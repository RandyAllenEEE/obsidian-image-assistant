import { RefinedImageUtils } from '../../../src/utils/RefinedImageUtils';
import { App, Editor, MarkdownView, TFile } from 'obsidian';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('RefinedImageUtils', () => {
    let app: App;
    let utils: RefinedImageUtils;
    let mockEditor: Editor;

    beforeEach(() => {
        app = {} as App;
        utils = new RefinedImageUtils(app);

        mockEditor = {
            getValue: vi.fn(),
            getLine: vi.fn(),
            lineCount: vi.fn(),
        } as unknown as Editor;
    });

    it('should identify Wiki links correctly', () => {
        const content = 'Some text\n![[test-image.png]]\nMore text';
        (mockEditor.getValue as any).mockReturnValue(content);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/test-image.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![[test-image.png]]');
    });

    it('should identify Markdown links correctly', () => {
        const content = 'Some text\n![Alt text](test-image.png)\nMore text';
        (mockEditor.getValue as any).mockReturnValue(content);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/test-image.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![Alt text](test-image.png)');
    });

    it('should return null if image not found in editor', () => {
        const content = 'Some text\n![[other-image.png]]\nMore text';
        (mockEditor.getValue as any).mockReturnValue(content);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/test-image.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBeNull();
    });

    it('should handle images with spaces in name', () => {
        const content = '![[my image with spaces.png]]';
        (mockEditor.getValue as any).mockReturnValue(content);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/my%20image%20with%20spaces.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![[my image with spaces.png]]');
    });

    it('should handle online images with captions correctly', () => {
        const content = '![Online Caption](https://example.com/image.png)';
        (mockEditor.getValue as any).mockReturnValue(content);

        const img = document.createElement('img');
        img.setAttribute('src', 'https://example.com/image.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![Online Caption](https://example.com/image.png)');
    });

    it('should handle online images with encoded URLs', () => {
        const content = '![Encoded](https://example.com/image%20space.png)';
        (mockEditor.getValue as any).mockReturnValue(content);

        const img = document.createElement('img');
        img.setAttribute('src', 'https://example.com/image%20space.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![Encoded](https://example.com/image%20space.png)');
    });

    it('should find line number correctly', () => {
        const content = [
            'Line 0',
            'Line 1: ![[test.png]]',
            'Line 2'
        ];
        (mockEditor.lineCount as any).mockReturnValue(content.length);
        (mockEditor.getLine as any).mockImplementation((n: number) => content[n]);

        const line = utils.findLinkLineNumber(mockEditor, '![[test.png]]');
        expect(line).toBe(1);
    });
});
