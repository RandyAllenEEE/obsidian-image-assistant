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
});
