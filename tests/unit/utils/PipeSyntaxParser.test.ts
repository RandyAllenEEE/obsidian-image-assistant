import { describe, expect, it } from 'vitest';
import { PipeSyntaxParser } from '../../../src/utils/PipeSyntaxParser';

describe('PipeSyntaxParser canonical Obsidian image attributes', () => {
    const parser = new PipeSyntaxParser();

    it.each([
        ['![[img.png|Caption|left|300]]', 'wiki', 'Caption', 'left', { width: 300, format: 'W' }],
        ['![[img.png|Caption|300x200]]', 'wiki', 'Caption', null, { width: 300, height: 200, format: 'WxH' }],
        ['![Caption|right-wrap|300](img.png)', 'markdown', 'Caption', 'right-wrap', { width: 300, format: 'W' }],
        ['![300](https://example.com/image.png)', 'markdown', ' ', null, { width: 300, format: 'W' }],
        ['![|center|300](img.png)', 'markdown', ' ', 'center', { width: 300, format: 'W' }]
    ] as const)('parses canonical tail attributes in %s', (
        source,
        linkType,
        alt,
        align,
        size
    ) => {
        expect(parser.parsePipeSyntax(source)).toMatchObject({
            linkType,
            alt,
            align,
            size
        });
    });

    it.each([
        ['![[img.png|Caption|x200]]', 'Caption|x200'],
        ['![[img.png|Caption|300x]]', 'Caption|300x'],
        ['![[img.png|Caption|300X200]]', 'Caption|300X200'],
        ['![[img.png|Caption|300|left]]', 'Caption|300'],
        ['![Caption|300|left](img.png)', 'Caption|300'],
        ['![Caption|300|Other](img.png)', 'Caption|300|Other']
    ])('does not recognize height-only, open-axis, or non-tail sizes in %s', (
        source,
        expectedAlt
    ) => {
        const parsed = parser.parsePipeSyntax(source);
        expect(parsed?.size).toBeUndefined();
        expect(parsed?.alt).toBe(expectedAlt);
    });

    it('only consumes the final size when repeated numeric tokens exist', () => {
        expect(parser.parsePipeSyntax('![Caption|320|640](img.png)')).toMatchObject({
            alt: 'Caption|320',
            size: { width: 640, format: 'W' }
        });
    });

    it('requires positive safe integers', () => {
        for (const source of [
            '![[img.png|0]]',
            '![[img.png|-1]]',
            '![[img.png|1.5]]',
            '![[img.png|999999999999999999999999]]'
        ]) {
            expect(parser.parsePipeSyntax(source)?.size).toBeUndefined();
        }
    });

    it('unescapes caption pipes only for display consumers', () => {
        const source = '![Caption\\|with pipe|left|300](img.png)';
        expect(parser.parsePipeSyntax(source)?.alt).toBe('Caption\\|with pipe');
        expect(parser.parsePipeSyntax(source, { attributeMode: 'display' })?.alt)
            .toBe('Caption|with pipe');
    });

    it('builds size-only Markdown without an empty leading attribute', () => {
        expect(parser.buildPipeSyntax({
            path: 'https://example.com/image.png',
            alt: ' ',
            align: null,
            size: { width: 300, format: 'W' },
            linkType: 'markdown'
        })).toBe('![300](https://example.com/image.png)');
    });

    it('always builds caption, alignment, then final size', () => {
        expect(parser.buildPipeSyntax({
            path: 'img.png',
            alt: 'Caption',
            align: 'center',
            size: { width: 640, height: 360, format: 'WxH' },
            linkType: 'wiki'
        })).toBe('![[img.png|Caption|center|640x360]]');
    });

    it('rewrites explicit attributes without changing the Markdown destination or title', () => {
        const source = '![Old](<images/a b(1).png> \'single title\')';
        expect(parser.rewritePipeAttributes(source, {
            alt: 'New',
            align: 'right',
            size: { width: 500, format: 'W' }
        })).toBe('![New|right|500](<images/a b(1).png> \'single title\')');
    });

    it('rewrites explicit Wiki attributes while preserving the escaped raw path', () => {
        expect(parser.rewritePipeAttributes(
            '![[folder/a\\|b.png|Old|x200]]',
            { alt: 'New', align: 'left', size: { width: 400, format: 'W' } }
        )).toBe('![[folder/a\\|b.png|New|left|400]]');
    });

    it('source-preserving size updates only replace or append a final canonical token', () => {
        expect(parser.updateSizePreservingSyntax(
            '![Caption|left|320x200](img.png "Title")',
            { width: 500 }
        )).toEqual({
            status: 'updated',
            linkText: '![Caption|left|500x200](img.png "Title")'
        });
        expect(parser.updateSizePreservingSyntax(
            '![Caption|300|left](img.png)',
            { width: 500 }
        )).toEqual({
            status: 'ambiguous',
            linkText: '![Caption|300|left](img.png)'
        });
        expect(parser.updateSizePreservingSyntax(
            '![Caption](img.png)',
            { height: 200 }
        )).toEqual({ status: 'invalid', linkText: '![Caption](img.png)' });
    });

    it('parses and rebuilds Markdown paths and titles safely', () => {
        const source = '![Caption|300](<images/my photo(1).png> "A title")';
        const parsed = parser.parsePipeSyntax(source);
        expect(parsed).toMatchObject({
            path: 'images/my photo(1).png',
            title: 'A title',
            size: { width: 300, format: 'W' }
        });
        expect(parser.buildPipeSyntax(parsed!)).toBe(source);
    });

    it('keeps distinct indexes for repeated links', () => {
        const text = '![[a.png]] text ![[a.png]]';
        expect(parser.extractAllLinks(text).map(link => link.index)).toEqual([
            0,
            text.lastIndexOf('![[a.png]]')
        ]);
    });
});
