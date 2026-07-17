import { describe, expect, it } from 'vitest';
import {
    MarkdownSourceContextIndex,
    containsAdmonitionBlock,
    getContextualImageLinks,
    getContextualReferenceLinks,
    getCaptionLinkDescriptors,
    getImageLayoutKey,
    getImageSourceKey,
    isAdmonitionFenceInfo,
    parseFenceOpening
} from '../../../src/utils/MarkdownSourceContext';

describe('MarkdownSourceContext', () => {
    it('keeps rendered prose, callouts, and fenced Admonitions', () => {
        const source = [
            '![prose](prose.png)',
            '> [!note]+ Caption',
            '> ![[callout.png|Callout|300]]',
            '````ad-warning extra-options',
            'title: Warning',
            '![admonition](<folder/admonition image.webp> "Title")',
            '````'
        ].join('\n');

        const links = getContextualImageLinks(source);

        expect(links.map(link => [link.path, link.context])).toEqual([
            ['prose.png', 'prose'],
            ['callout.png', 'callout'],
            ['folder/admonition image.webp', 'admonition']
        ]);
    });

    it('recognizes backtick and tilde ad-* fences case-insensitively', () => {
        expect(parseFenceOpening('```ad-note')?.admonition).toBe(true);
        expect(parseFenceOpening('> ~~~~AD-custom_type options')?.admonition).toBe(true);
        expect(isAdmonitionFenceInfo('ad-tip')).toBe(true);
        expect(isAdmonitionFenceInfo('ad-')).toBe(false);
        expect(isAdmonitionFenceInfo('typescript')).toBe(false);
        expect(containsAdmonitionBlock('```ad-note\ntext\n```')).toBe(true);
    });

    it('excludes frontmatter, ordinary fences, inline code, and HTML comments by default', () => {
        const source = [
            '---',
            'cover: "![[frontmatter.png]]"',
            '---',
            '```markdown',
            '![[fence.png]]',
            '```',
            '`![[inline.png]]` and ``![double](double.png)``',
            '<!-- ![[comment.png]] -->',
            '<!--',
            '![multiline](multiline.png)',
            '-->',
            '![[visible.png]]'
        ].join('\n');

        expect(getContextualImageLinks(source).map(link => link.path)).toEqual(['visible.png']);
    });

    it('can include ordinary fenced code without including other source-only contexts', () => {
        const source = [
            '---',
            'image: ![[frontmatter.png]]',
            '---',
            '~~~markdown',
            '![fence](fence.png)',
            '~~~~',
            '`![[inline.png]]`',
            '<!-- ![[comment.png]] -->'
        ].join('\n');

        expect(getContextualReferenceLinks(source, { includeFencedCode: true })
            .map(link => [link.path, link.context])).toEqual([
                ['fence.png', 'fenced-code']
            ]);
    });

    it('does not let comment or inline-code markers leak into following lines', () => {
        const source = [
            '`<!--` ![[first.png]]',
            '<!-- ![[hidden.png]]',
            '--> ![[second.png]]'
        ].join('\n');

        expect(getContextualImageLinks(source).map(link => link.path)).toEqual([
            'first.png',
            'second.png'
        ]);
    });

    it('requires matching fence marker and sufficient closing length', () => {
        const source = [
            '````ad-note',
            '![[one.png]]',
            '```',
            '![[two.png]]',
            '~~~~',
            '![[three.png]]',
            '`````',
            '![[outside.png]]'
        ].join('\n');

        expect(getContextualImageLinks(source).map(link => link.path)).toEqual([
            'one.png',
            'two.png',
            'three.png',
            'outside.png'
        ]);
    });

    it('reports literal contexts for exact source offsets', () => {
        const source = '`![[inline.png]]` <!-- ![[comment.png]] -->';
        const index = MarkdownSourceContextIndex.create(source);
        const inlineOffset = source.indexOf('![[inline.png]]');
        const commentOffset = source.indexOf('![[comment.png]]');

        expect(index.contextAt(inlineOffset, inlineOffset + 10)).toBe('inline-code');
        expect(index.contextAt(commentOffset, commentOffset + 10)).toBe('html-comment');
        expect(index.includes(inlineOffset, inlineOffset + 10)).toBe(false);
    });

    it('keeps ad-* fence content when ordinary fence indexing is disabled', () => {
        const source = [
            '```ad-custom-note',
            '![legacy admonition](https://cdn.example.com/ad.png)',
            '```',
            '```markdown',
            '![sample](https://cdn.example.com/code.png)',
            '```'
        ].join('\n');

        expect(getContextualImageLinks(source).map(link => [link.path, link.context])).toEqual([
            ['https://cdn.example.com/ad.png', 'admonition']
        ]);
    });

    it('excludes multiline inline-code spans without leaking into later prose', () => {
        const source = [
            '``![[hidden.png]]',
            'still inline``',
            '![[visible.png]]'
        ].join('\n');

        expect(getContextualImageLinks(source).map(link => link.path)).toEqual(['visible.png']);
    });

    it('creates stable source descriptors for repeated image paths', () => {
        const source = '![[folder/photo.png|First]]\n![[folder/photo.png|Second]]';
        const descriptors = getCaptionLinkDescriptors(source);

        expect(descriptors.map(descriptor => ({
            ordinal: descriptor.ordinal,
            line: descriptor.line,
            end: descriptor.end
        }))).toEqual([
            { ordinal: 0, line: 0, end: 27 },
            { ordinal: 1, line: 1, end: source.length }
        ]);
    });

    it('keeps the layout key stable when source offsets move', () => {
        const first = getCaptionLinkDescriptors('![[photo.png|Caption]]')[0];
        const moved = getCaptionLinkDescriptors('intro\n![[photo.png|Caption]]')[0];

        expect(getImageSourceKey(moved)).not.toBe(getImageSourceKey(first));
        expect(getImageLayoutKey(moved)).toBe(getImageLayoutKey(first));
    });

    it('classifies standalone images through quote, list, task, callout, and Admonition prefixes', () => {
        const source = [
            '> - [ ] ![[task.png|Task caption]]',
            '> [!tip]',
            '> ![[callout.png|Callout caption]]',
            '```ad-note',
            '![Ad caption](ad.png)',
            '```',
            '- ![[inline.png|Inline caption]] trailing text',
            '![[first.png|First]] ![[second.png|Second]]'
        ].join('\n');

        expect(getCaptionLinkDescriptors(source).map(descriptor => [
            descriptor.path,
            descriptor.context,
            descriptor.standalone
        ])).toEqual([
            ['task.png', 'prose', true],
            ['callout.png', 'callout', true],
            ['ad.png', 'admonition', true],
            ['inline.png', 'prose', false],
            ['first.png', 'prose', false],
            ['second.png', 'prose', false]
        ]);
    });

    it('does not use bare Tab indentation as the image alignment scope', () => {
        const source = [
            '\t![[tab.png|center|300]]',
            '    ![[spaces.png|right|300]]',
            '-\t![[list.png|left|300]]',
            '>\t![[quote.png|center|300]]'
        ].join('\n');

        expect(getCaptionLinkDescriptors(source).map(descriptor => [
            descriptor.path,
            descriptor.standalone,
            descriptor.layoutScope
        ])).toEqual([
            ['tab.png', true, 'root'],
            ['spaces.png', true, 'root'],
            ['list.png', true, 'semantic'],
            ['quote.png', true, 'semantic']
        ]);
    });

    it('exposes stable input and output lexical state for incremental consumers', () => {
        const source = '<!--\n![[hidden.png]]\n-->\n![[visible.png]]';
        const lines = MarkdownSourceContextIndex.create(source).getLineStates();

        expect(lines).toHaveLength(4);
        expect(lines[1].input.htmlComment).toBe(true);
        expect(lines[1].output.htmlComment).toBe(true);
        expect(lines[3].input.htmlComment).toBe(false);
        expect(lines[3].context).toBe('prose');
    });
});
