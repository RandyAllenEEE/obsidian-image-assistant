import { describe, it, expect } from 'vitest';
import { PipeSyntaxParser } from '../../../src/utils/PipeSyntaxParser';

describe('PipeSyntaxParser Exhaustive Tests', () => {
    const parser = new PipeSyntaxParser();

    // Helper for assertions
    const verify = (input: string, expected: any) => {
        const result = parser.parsePipeSyntax(input);
        expect(result).toBeTruthy();
        if (result) {
            expect(result.path).toBe(expected.path);
            if (expected.alt !== undefined) expect(result.alt).toBe(expected.alt);
            if (expected.align !== undefined) expect(result.align).toBe(expected.align);
            if (expected.size !== undefined) expect(result.size).toEqual(expected.size);
        }
    };

    const onlineUrl = 'http://example.com/img.png';
    const localPath = 'img.png';
    const alt = 'MyAlt';
    const align = 'left';
    const sizeStr = '100x100';
    const sizeObj = { width: 100, height: 100, format: 'WxH' };

    describe('1. Online Images (Wiki Syntax)', () => {
        it('[[url|alt|align|size]]', () => verify(`![[${onlineUrl}|${alt}|${align}|${sizeStr}]]`, { path: onlineUrl, alt, align, size: sizeObj }));
        it('[[url|alt|size|align]]', () => verify(`![[${onlineUrl}|${alt}|${sizeStr}|${align}]]`, { path: onlineUrl, alt, align, size: sizeObj }));
        it('[[url|align|alt|size]]', () => verify(`![[${onlineUrl}|${align}|${alt}|${sizeStr}]]`, { path: onlineUrl, alt, align, size: sizeObj }));
        it('[[url|align|size|alt]]', () => verify(`![[${onlineUrl}|${align}|${sizeStr}|${alt}]]`, { path: onlineUrl, alt, align, size: sizeObj }));
        it('[[url|size|align|alt]]', () => verify(`![[${onlineUrl}|${sizeStr}|${align}|${alt}]]`, { path: onlineUrl, alt, align, size: sizeObj }));
        it('[[url|size|alt|align]]', () => verify(`![[${onlineUrl}|${sizeStr}|${alt}|${align}]]`, { path: onlineUrl, alt, align, size: sizeObj }));

        it('[[url|alt|size]]', () => verify(`![[${onlineUrl}|${alt}|${sizeStr}]]`, { path: onlineUrl, alt, size: sizeObj }));
        it('[[url|size|alt]]', () => verify(`![[${onlineUrl}|${sizeStr}|${alt}]]`, { path: onlineUrl, alt, size: sizeObj }));
        it('[[url|alt|align]]', () => verify(`![[${onlineUrl}|${alt}|${align}]]`, { path: onlineUrl, alt, align }));
        it('[[url|align|alt]]', () => verify(`![[${onlineUrl}|${align}|${alt}]]`, { path: onlineUrl, alt, align }));
        it('[[url|size|align]]', () => verify(`![[${onlineUrl}|${sizeStr}|${align}]]`, { path: onlineUrl, size: sizeObj, align, alt: ' ' }));
        it('[[url|align|size]]', () => verify(`![[${onlineUrl}|${align}|${sizeStr}]]`, { path: onlineUrl, size: sizeObj, align, alt: ' ' }));

        it('[[url|align]]', () => verify(`![[${onlineUrl}|${align}]]`, { path: onlineUrl, align, alt: ' ' }));
        it('[[url|size]]', () => verify(`![[${onlineUrl}|${sizeStr}]]`, { path: onlineUrl, size: sizeObj, alt: ' ' }));
        it('[[url|alt]]', () => verify(`![[${onlineUrl}|${alt}]]`, { path: onlineUrl, alt }));

        it('[[url]]', () => verify(`![[${onlineUrl}]]`, { path: onlineUrl, alt: ' ' }));
    });

    describe('1. Online Images (Markdown Syntax)', () => {
        // Markdown syntax: ![alt|align|size](url)
        it('![alt|align|size](url)', () => verify(`![${alt}|${align}|${sizeStr}](${onlineUrl})`, { path: onlineUrl, alt, align, size: sizeObj }));
        it('![alt|size|align](url)', () => verify(`![${alt}|${sizeStr}|${align}](${onlineUrl})`, { path: onlineUrl, alt, align, size: sizeObj }));
        it('![alt|size](url)', () => verify(`![${alt}|${sizeStr}](${onlineUrl})`, { path: onlineUrl, alt, size: sizeObj }));
        it('![alt|align](url)', () => verify(`![${alt}|${align}](${onlineUrl})`, { path: onlineUrl, alt, align }));
        it('![|align](url)', () => verify(`![|${align}](${onlineUrl})`, { path: onlineUrl, align, alt: ' ' }));
        it('![|size](url)', () => verify(`![|${sizeStr}](${onlineUrl})`, { path: onlineUrl, size: sizeObj, alt: ' ' }));
        it('![alt](url)', () => verify(`![${alt}](${onlineUrl})`, { path: onlineUrl, alt }));
    });

    describe('2. Local Images (Wiki Syntax)', () => {
        it('[[path|alt|align|size]]', () => verify(`![[${localPath}|${alt}|${align}|${sizeStr}]]`, { path: localPath, alt, align, size: sizeObj }));
        it('[[path|alt|size|align]]', () => verify(`![[${localPath}|${alt}|${sizeStr}|${align}]]`, { path: localPath, alt, align, size: sizeObj }));
        it('[[path|align|alt|size]]', () => verify(`![[${localPath}|${align}|${alt}|${sizeStr}]]`, { path: localPath, alt, align, size: sizeObj }));
        it('[[path|align|size|alt]]', () => verify(`![[${localPath}|${align}|${sizeStr}|${alt}]]`, { path: localPath, alt, align, size: sizeObj }));
        it('[[path|size|align|alt]]', () => verify(`![[${localPath}|${sizeStr}|${align}|${alt}]]`, { path: localPath, alt, align, size: sizeObj }));
        it('[[path|size|alt|align]]', () => verify(`![[${localPath}|${sizeStr}|${alt}|${align}]]`, { path: localPath, alt, align, size: sizeObj }));

        it('[[path|alt|size]]', () => verify(`![[${localPath}|${alt}|${sizeStr}]]`, { path: localPath, alt, size: sizeObj }));
        it('[[path|size|alt]]', () => verify(`![[${localPath}|${sizeStr}|${alt}]]`, { path: localPath, alt, size: sizeObj }));
        it('[[path|alt|align]]', () => verify(`![[${localPath}|${alt}|${align}]]`, { path: localPath, alt, align }));
        it('[[path|align|alt]]', () => verify(`![[${localPath}|${align}|${alt}]]`, { path: localPath, alt, align }));
        it('[[path|size|align]]', () => verify(`![[${localPath}|${sizeStr}|${align}]]`, { path: localPath, size: sizeObj, align, alt: ' ' }));
        it('[[path|align|size]]', () => verify(`![[${localPath}|${align}|${sizeStr}]]`, { path: localPath, size: sizeObj, align, alt: ' ' }));

        it('[[path|align]]', () => verify(`![[${localPath}|${align}]]`, { path: localPath, align, alt: ' ' }));
        it('[[path|size]]', () => verify(`![[${localPath}|${sizeStr}]]`, { path: localPath, size: sizeObj, alt: ' ' }));
        it('[[path|alt]]', () => verify(`![[${localPath}|${alt}]]`, { path: localPath, alt }));

        it('[[path]]', () => verify(`![[${localPath}]]`, { path: localPath, alt: ' ' }));
    });

    describe('2. Local Images (Markdown Syntax)', () => {
        it('![alt|align|size](path)', () => verify(`![${alt}|${align}|${sizeStr}](${localPath})`, { path: localPath, alt, align, size: sizeObj }));
        it('![alt|size|align](path)', () => verify(`![${alt}|${sizeStr}|${align}](${localPath})`, { path: localPath, alt, align, size: sizeObj }));
        it('![alt|size](path)', () => verify(`![${alt}|${sizeStr}](${localPath})`, { path: localPath, alt, size: sizeObj }));
        it('![alt|align](path)', () => verify(`![${alt}|${align}](${localPath})`, { path: localPath, alt, align }));
        it('![|align](path)', () => verify(`![|${align}](${localPath})`, { path: localPath, align, alt: ' ' }));
        it('![|size](path)', () => verify(`![|${sizeStr}](${localPath})`, { path: localPath, size: sizeObj, alt: ' ' }));
        it('![alt](path)', () => verify(`![${alt}](${localPath})`, { path: localPath, alt }));
    });

    describe('Robustness Checks', () => {
        it('Align Attribute Variants', () => {
            verify(`![[img.png|left]]`, { path: 'img.png', align: 'left' });
            verify(`![[img.png|center]]`, { path: 'img.png', align: 'center' });
            verify(`![[img.png|right]]`, { path: 'img.png', align: 'right' });
            verify(`![[img.png|left-wrap]]`, { path: 'img.png', align: 'left-wrap' });
            verify(`![[img.png|right-wrap]]`, { path: 'img.png', align: 'right-wrap' });
        });

        it('Size Attribute Variants', () => {
            // |length x width
            verify(`![[img.png|300x200]]`, { path: 'img.png', size: { width: 300, height: 200, format: 'WxH' } });
            // |length
            verify(`![[img.png|300]]`, { path: 'img.png', size: { width: 300, format: 'W' } });
            // |length x
            verify(`![[img.png|300x]]`, { path: 'img.png', size: { width: 300, format: 'Wx' } });
            // |x width
            verify(`![[img.png|x200]]`, { path: 'img.png', size: { height: 200, format: 'xH' } });
        });

        it('Alt containing keywords', () => {
            // "left" in alt
            verify(`![[img.png|image aligned left]]`, { path: 'img.png', alt: 'image aligned left', align: null });
            // "300x" in alt
            verify(`![[img.png|image 300x resolution]]`, { path: 'img.png', alt: 'image 300x resolution', size: undefined });
            // Mixed keywords
            verify(`![[img.png|right|image at right|200x]]`, { path: 'img.png', align: 'right', alt: 'image at right', size: { width: 200, format: 'Wx' } });
        });
    });

    describe('4. parsePipeAttributes & Reading Mode Simulations', () => {
        it('should parse raw attributes (Markdown style)', () => {
            const res = parser.parsePipeAttributes('My Caption|left-wrap|300', true);
            expect(res.alt).toBe('My Caption');
            expect(res.align).toBe('left-wrap');
            expect(res.size).toEqual({ width: 300, format: 'W' });
        });

        it('should parse raw attributes (Wiki style)', () => {
            const res = parser.parsePipeAttributes('My Caption|right|x200', false);
            expect(res.alt).toBe('My Caption');
            expect(res.align).toBe('right');
            expect(res.size).toEqual({ height: 200, format: 'xH' });
        });

        it('should handle missing alt in attributes (Markdown style)', () => {
            const res = parser.parsePipeAttributes('|center|400x300', true);
            expect(res.alt).toBe(' ');
            expect(res.align).toBe('center');
            expect(res.size).toEqual({ width: 400, height: 300, format: 'WxH' });
        });

        it('should handle only size/align in attributes (Wiki style)', () => {
            // This simulates what Obsidian often does in Reading Mode for ![[img.png|100]]
            const res = parser.parsePipeAttributes('100', false);
            expect(res.alt).toBe(' ');
            expect(res.size).toEqual({ width: 100, format: 'W' });
        });

        it('should handle mixed order in Markdown style attributes', () => {
            const res = parser.parsePipeAttributes('Caption|300|right', true);
            expect(res.alt).toBe('Caption');
            expect(res.align).toBe('right');
            expect(res.size).toEqual({ width: 300, format: 'W' });
        });

        it('should support display-mode Markdown attributes in any order', () => {
            const res = parser.parsePipeAttributes('right|300|Caption', true, 'display');
            expect(res.alt).toBe('Caption');
            expect(res.align).toBe('right');
            expect(res.size).toEqual({ width: 300, format: 'W' });
        });

        it('should preserve plain one-part Markdown alt text in display mode', () => {
            const res = parser.parsePipeAttributes('left', true, 'display');
            expect(res.alt).toBe('left');
            expect(res.align).toBeNull();
        });

        it('should treat one-part Wiki align text as an attribute in display mode', () => {
            const res = parser.parsePipeAttributes('left', false, 'display');
            expect(res.alt).toBe(' ');
            expect(res.align).toBe('left');
        });

        it('should unescape pipes when extracting display captions', () => {
            const res = parser.parsePipeAttributes('Caption\\|with pipe|300', true, 'display');
            expect(res.alt).toBe('Caption|with pipe');
            expect(res.size).toEqual({ width: 300, format: 'W' });
        });
    });

    describe('Source-preserving size updates', () => {
        it.each([
            {
                name: 'keeps Wiki attributes in their original order',
                input: '![[assets/image.png|right-wrap|Caption\\|with pipe| 320x200 ]]',
                update: { width: 500 },
                expected: '![[assets/image.png|right-wrap|Caption\\|with pipe| 500x200 ]]'
            },
            {
                name: 'keeps a Wiki size before its caption and alignment',
                input: '![[assets/image.png|320x|Caption|left]]',
                update: { width: 500 },
                expected: '![[assets/image.png|500|Caption|left]]'
            },
            {
                name: 'appends a Wiki height without changing existing attributes',
                input: '![[assets/image.png|Caption|center]]',
                update: { height: 240 },
                expected: '![[assets/image.png|Caption|center|x240]]'
            },
            {
                name: 'keeps Markdown display-order attributes and its quoted title',
                input: '![right|320|Caption](<images/a b.png> "A title")',
                update: { width: 500 },
                expected: '![right|500|Caption](<images/a b.png> "A title")'
            },
            {
                name: 'keeps escaped Markdown caption pipes and updates the missing width',
                input: '![Caption\\|with pipe|right-wrap|x200](https://example.com/image?x=1#part \'single title\')',
                update: { width: 500 },
                expected: '![Caption\\|with pipe|right-wrap|500x200](https://example.com/image?x=1#part \'single title\')'
            },
            {
                name: 'preserves a numeric one-part Markdown caption and appends a size',
                input: '![300](img.png)',
                update: { width: 500 },
                expected: '![300|500](img.png)'
            },
            {
                name: 'removes only the existing size segment',
                input: '![Caption | 320x200 |right](img.png "Title")',
                update: { width: null, height: null },
                expected: '![Caption |right](img.png "Title")'
            }
        ])('$name', ({ input, update, expected }) => {
            const result = parser.updateSizePreservingSyntax(input, update);

            expect(result).toEqual({ status: 'updated', linkText: expected });
        });

        it.each([
            ['![[img.png|Caption|left|320]]', '![[img.png|Caption|left|500]]'],
            ['![[img.png|320|left|Caption]]', '![[img.png|500|left|Caption]]'],
            ['![[img.png|Caption|320x200|right]]', '![[img.png|Caption|500x200|right]]'],
            ['![[img.png|right|x200|Caption]]', '![[img.png|right|500x200|Caption]]'],
            ['![Caption|left|320](img.png)', '![Caption|left|500](img.png)'],
            ['![Caption|320|right](img.png)', '![Caption|500|right](img.png)'],
            ['![Caption|320x200|right](img.png)', '![Caption|500x200|right](img.png)'],
            ['![Caption|right|x200](img.png)', '![Caption|right|500x200](img.png)']
        ])('updates width across supported attribute positions: %s', (input, expected) => {
            expect(parser.updateSizePreservingSyntax(input, { width: 500 })).toEqual({
                status: 'updated',
                linkText: expected
            });
        });

        it.each([
            ['![[img.png|Caption|320x200|right]]', '![[img.png|Caption|320|right]]'],
            ['![Caption|right|320x200](img.png)', '![Caption|right|320](img.png)'],
            ['![[img.png|Caption|320]]', '![[img.png|Caption|x240]]'],
            ['![Caption|320](img.png)', '![Caption|x240](img.png)']
        ])('handles single-side dimension transitions without retaining stale values: %s', (input, expected) => {
            const updates = expected.includes('x240')
                ? { width: null, height: 240 }
                : { height: null };

            expect(parser.updateSizePreservingSyntax(input, updates)).toEqual({
                status: 'updated',
                linkText: expected
            });
        });

        it('does not mistake a numeric Wiki target path for a size attribute', () => {
            const result = parser.updateSizePreservingSyntax('![[300|Caption]]', { width: 500 });

            expect(result).toEqual({
                status: 'updated',
                linkText: '![[300|Caption|500]]'
            });
        });

        it.each([
            '![300|right](img.png)',
            '![Caption|320|640](img.png)',
            '![[img.png|Caption|320|640]]'
        ])('refuses ambiguous size syntax without changing %s', (input) => {
            const result = parser.updateSizePreservingSyntax(input, { width: 500 });

            expect(result).toEqual({ status: 'ambiguous', linkText: input });
        });

        it('rejects invalid dimensions without changing the link', () => {
            const input = '![[img.png|Caption|320]]';

            expect(parser.updateSizePreservingSyntax(input, { width: 0 })).toEqual({
                status: 'invalid',
                linkText: input
            });
            expect(parser.updateSizePreservingSyntax(input, { height: 12.5 })).toEqual({
                status: 'invalid',
                linkText: input
            });
        });
    });

    describe('5. Markdown destinations', () => {
        it('should parse angle-bracketed paths with spaces', () => {
            const res = parser.parsePipeSyntax('![Caption](<images/my photo.png>)');
            expect(res?.path).toBe('images/my photo.png');
            expect(parser.buildPipeSyntax(res!)).toBe('![Caption](<images/my photo.png>)');
        });

        it('should parse and preserve Markdown titles', () => {
            const res = parser.parsePipeSyntax('![Caption|right|300](https://example.com/a.png "A title")');
            expect(res?.path).toBe('https://example.com/a.png');
            expect(res?.title).toBe('A title');
            expect(parser.buildPipeSyntax(res!)).toBe('![Caption|right|300](https://example.com/a.png "A title")');
        });

        it('should parse Markdown display links with size, align, and caption in any order', () => {
            const res = parser.parsePipeSyntax(`![${align}|${sizeStr}|${alt}](${onlineUrl})`, {
                attributeMode: 'display'
            });
            expect(res?.path).toBe(onlineUrl);
            expect(res?.alt).toBe(alt);
            expect(res?.align).toBe(align);
            expect(res?.size).toEqual(sizeObj);
        });
    });

    describe('6. Link extraction positions', () => {
        it('should keep distinct indexes for repeated identical links on one line', () => {
            const text = '![[a.png]] text ![[a.png]]';
            const links = parser.extractAllLinks(text);

            expect(links).toHaveLength(2);
            expect(links.map(link => link.index)).toEqual([
                0,
                text.lastIndexOf('![[a.png]]')
            ]);
        });
    });
});
