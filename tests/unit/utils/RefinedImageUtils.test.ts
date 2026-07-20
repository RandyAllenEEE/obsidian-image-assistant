import { RefinedImageUtils } from '../../../src/utils/RefinedImageUtils';
import { Editor } from 'obsidian';
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('RefinedImageUtils', () => {
    let utils: RefinedImageUtils;
    let mockEditor: Editor;

    beforeEach(() => {
        utils = new RefinedImageUtils();

        mockEditor = {
            getValue: vi.fn(),
            getLine: vi.fn((line: number) => ''),
            lineCount: vi.fn(() => 1),
        } as unknown as Editor;
    });

    it('should identify Wiki links correctly', () => {
        const content = 'Some text\n![[test-image.png]]\nMore text';
        const lines = content.split('\n');
        (mockEditor.getLine as any).mockImplementation((n: number) => lines[n]);
        (mockEditor.lineCount as any).mockReturnValue(lines.length);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/test-image.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![[test-image.png]]');
    });

    it('should identify Markdown links correctly', () => {
        const content = 'Some text\n![Alt text](test-image.png)\nMore text';
        const lines = content.split('\n');
        (mockEditor.getLine as any).mockImplementation((n: number) => lines[n]);
        (mockEditor.lineCount as any).mockReturnValue(lines.length);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/test-image.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![Alt text](test-image.png)');
    });

    it('should return null if image not found in editor', () => {
        const content = 'Some text\n![[other-image.png]]\nMore text';
        const lines = content.split('\n');
        (mockEditor.getLine as any).mockImplementation((n: number) => lines[n]);
        (mockEditor.lineCount as any).mockReturnValue(lines.length);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/test-image.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBeNull();
    });

    it('should handle images with spaces in name', () => {
        const content = '![[my image with spaces.png]]';
        const lines = content.split('\n');
        (mockEditor.getLine as any).mockImplementation((n: number) => lines[n]);
        (mockEditor.lineCount as any).mockReturnValue(lines.length);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/my%20image%20with%20spaces.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![[my image with spaces.png]]');
    });

    it('prefers an exact local path over an earlier same-basename link', () => {
        const content = [
            '![[other/pic.png|Other]]',
            '![[assets/pic.png|Target]]'
        ];
        (mockEditor.getLine as any).mockImplementation((n: number) => content[n]);
        (mockEditor.lineCount as any).mockReturnValue(content.length);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/assets/pic.png?mtime=123');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![[assets/pic.png|Target]]');
    });

    it('returns the exact editor range for the selected link', () => {
        const line = 'first ![[other/pic.png|Other]] then ![[assets/pic.png|Target]]';
        (mockEditor.getLine as any).mockImplementation((n: number) => [line][n]);
        (mockEditor.lineCount as any).mockReturnValue(1);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/assets/pic.png');

        const result = utils.getImageLinkMatchFromEditor(img, mockEditor);
        const target = '![[assets/pic.png|Target]]';
        expect(result).toMatchObject({
            linkText: target,
            line: 0,
            start: line.indexOf(target),
            end: line.indexOf(target) + target.length,
            score: 3
        });
    });

    it('uses the CodeMirror source offset to distinguish repeated embeds', () => {
        const content = [
            '![[assets/pic.png|First|100]]',
            '![[assets/pic.png|Second|200]]'
        ];
        (mockEditor.getLine as any).mockImplementation((n: number) => content[n]);
        (mockEditor.lineCount as any).mockReturnValue(content.length);

        const container = document.createElement('div');
        const first = document.createElement('img');
        const second = document.createElement('img');
        first.setAttribute('src', 'app://local/assets/pic.png');
        second.setAttribute('src', 'app://local/assets/pic.png');
        container.append(first, second);
        (mockEditor as any).cm = {
            posAtDOM: vi.fn((node: Node) => node === second ? content[0].length + 2 : 0)
        };

        expect(utils.getImageLinkMatchFromEditor(second, mockEditor)?.linkText)
            .toBe('![[assets/pic.png|Second|200]]');
    });

    it('resolves a virtualized repeated URL from its CodeMirror source offset', () => {
        const content = [
            '![First](https://example.com/image?id=1)',
            '![Second](https://example.com/image?id=1)'
        ];
        (mockEditor.getLine as any).mockImplementation((n: number) => content[n]);
        (mockEditor.lineCount as any).mockReturnValue(content.length);

        const img = document.createElement('img');
        img.setAttribute('src', 'https://example.com/image?id=1');
        (mockEditor as any).cm = {
            posAtDOM: vi.fn(() => content[0].length + 2)
        };

        expect(utils.getImageLinkMatchFromEditor(img, mockEditor)?.linkText)
            .toBe('![Second](https://example.com/image?id=1)');
    });

    it('refuses an ambiguous repeated embed without a source offset', () => {
        const content = [
            '![[assets/pic.png|First]]',
            '![[assets/pic.png|Second]]'
        ];
        (mockEditor.getLine as any).mockImplementation((n: number) => content[n]);
        (mockEditor.lineCount as any).mockReturnValue(content.length);

        const container = document.createElement('div');
        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/assets/pic.png');
        container.appendChild(img);

        expect(utils.getImageLinkMatchFromEditor(img, mockEditor)).toBeNull();
    });

    it('reuses an exact source key when CodeMirror cannot map the DOM node', () => {
        const content = [
            '![[assets/pic.png|First]]',
            '![[assets/pic.png|Second]]'
        ];
        (mockEditor.getLine as any).mockImplementation((n: number) => content[n]);
        (mockEditor.lineCount as any).mockReturnValue(content.length);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/assets/pic.png');
        (mockEditor as any).cm = {
            posAtDOM: vi.fn(() => content[0].length + 2)
        };

        const firstMatch = utils.getImageLinkMatchFromEditor(img, mockEditor);
        expect(firstMatch?.linkText).toBe('![[assets/pic.png|Second]]');

        delete (mockEditor as any).cm;
        expect(utils.getImageLinkMatchFromEditor(img, mockEditor)?.sourceKey)
            .toBe(firstMatch?.sourceKey);
    });

    it('prefers a current CodeMirror offset over a stale source key', () => {
        const content = [
            '![[assets/pic.png|First]]',
            '![[assets/pic.png|Second]]'
        ];
        (mockEditor.getLine as any).mockImplementation((n: number) => content[n]);
        (mockEditor.lineCount as any).mockReturnValue(content.length);
        const img = document.createElement('img');
        img.src = 'app://local/assets/pic.png';
        (mockEditor as any).cm = { posAtDOM: vi.fn(() => 0) };
        const first = utils.getImageLinkMatchFromEditor(img, mockEditor);
        expect(first?.linkText).toContain('First');

        (mockEditor as any).cm.posAtDOM.mockReturnValue(content[0].length + 2);
        expect(utils.getImageLinkMatchFromEditor(img, mockEditor)?.linkText).toContain('Second');
    });

    it('does not use a DOM offset from an unrelated source line', () => {
        const content = [
            'unrelated text',
            '![[assets/pic.png|First]]',
            '![[assets/pic.png|Second]]'
        ];
        (mockEditor.getLine as any).mockImplementation((n: number) => content[n]);
        (mockEditor.lineCount as any).mockReturnValue(content.length);
        const img = document.createElement('img');
        img.src = 'app://local/assets/pic.png';
        (mockEditor as any).cm = { posAtDOM: vi.fn(() => 0) };

        expect(utils.getImageLinkMatchFromEditor(img, mockEditor)).toBeNull();
    });

    it('matches decoded app-local paths before falling back to the basename', () => {
        const content = [
            '![Wrong](other/my image.png)',
            '![Right](<assets/my image.png> "Title")'
        ];
        (mockEditor.getLine as any).mockImplementation((n: number) => content[n]);
        (mockEditor.lineCount as any).mockReturnValue(content.length);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/assets/my%20image.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![Right](<assets/my image.png> "Title")');
    });

    it('matches vault-relative suffixes from generic app URLs', () => {
        const content = [
            '![[wrong/pic.png]]',
            '![[assets/pic.png]]'
        ];
        (mockEditor.getLine as any).mockImplementation((n: number) => content[n]);
        (mockEditor.lineCount as any).mockReturnValue(content.length);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://obsidian.md/C:/Vault/assets/pic.png?mtime=123');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![[assets/pic.png]]');
    });

    it('falls back to basename matching when the DOM source has no usable vault path', () => {
        const content = ['![[pic.png|Caption]]'];
        (mockEditor.getLine as any).mockImplementation((n: number) => content[n]);
        (mockEditor.lineCount as any).mockReturnValue(1);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/pic.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![[pic.png|Caption]]');
    });

    it('should handle online images with captions correctly', () => {
        const content = '![Online Caption](https://example.com/image.png)';
        const lines = content.split('\n');
        (mockEditor.getLine as any).mockImplementation((n: number) => lines[n]);
        (mockEditor.lineCount as any).mockReturnValue(lines.length);

        const img = document.createElement('img');
        img.setAttribute('src', 'https://example.com/image.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![Online Caption](https://example.com/image.png)');
    });

    it('should handle online images with encoded URLs', () => {
        const content = '![Encoded](https://example.com/image%20space.png)';
        const lines = content.split('\n');
        (mockEditor.getLine as any).mockImplementation((n: number) => lines[n]);
        (mockEditor.lineCount as any).mockReturnValue(lines.length);

        const img = document.createElement('img');
        img.setAttribute('src', 'https://example.com/image%20space.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![Encoded](https://example.com/image%20space.png)');
    });

    it('matches wiki-style online images exactly', () => {
        const content = [
            '![[https://example.com/other.png|Other]]',
            '![[https://example.com/image.png?size=large|Caption]]'
        ];
        (mockEditor.getLine as any).mockImplementation((n: number) => content[n]);
        (mockEditor.lineCount as any).mockReturnValue(content.length);

        const img = document.createElement('img');
        img.setAttribute('src', 'https://example.com/image.png?size=large');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![[https://example.com/image.png?size=large|Caption]]');
    });

    it('does not throw on malformed percent escapes in local image src', () => {
        const content = ['![[bad%image.png]]'];
        (mockEditor.getLine as any).mockImplementation((n: number) => content[n]);
        (mockEditor.lineCount as any).mockReturnValue(1);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/bad%image.png');

        const result = utils.getImageLinkTextFromEditor(img, mockEditor);
        expect(result).toBe('![[bad%image.png]]');
    });

    it('selects an Admonition image instead of an identical source-only code sample', () => {
        const content = [
            '```markdown',
            '![[photo.png|Code caption]]',
            '```',
            '```ad-note',
            '![[photo.png|Admonition caption]]',
            '```'
        ];
        (mockEditor.lineCount as any).mockReturnValue(content.length);
        (mockEditor.getLine as any).mockImplementation((n: number) => content[n]);

        const img = document.createElement('img');
        img.setAttribute('src', 'app://local/photo.png');

        expect(utils.getImageLinkTextFromEditor(img, mockEditor))
            .toBe('![[photo.png|Admonition caption]]');
    });

    it('shares one descriptor index per editor source across utility instances', () => {
        let content = '![[photo.png|Caption|right]]';
        (mockEditor.getValue as any).mockImplementation(() => content);
        const other = new RefinedImageUtils();

        const first = utils.getImageSourceIndex(mockEditor);
        const shared = other.getImageSourceIndex(mockEditor);
        expect(shared).toBe(first);
        expect(shared.descriptors[0].pipeData?.align).toBe('right');

        content = '![[photo.png|Updated|left]]';
        const updated = other.getImageSourceIndex(mockEditor);
        expect(updated).not.toBe(first);
        expect(updated.descriptors[0].pipeData?.align).toBe('left');
    });
});
