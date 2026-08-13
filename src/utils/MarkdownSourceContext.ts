import {
    getAllImageLinks,
    getAllReferenceLinks,
    type ImageLink,
    type ReferenceLink
} from './RegexPatterns';
import { pipeSyntaxParser, type PipeSyntaxData } from './PipeSyntaxParser';

export type MarkdownSourceContext =
    | 'prose'
    | 'callout'
    | 'admonition'
    | 'frontmatter'
    | 'fenced-code'
    | 'inline-code'
    | 'html-comment';

export interface MarkdownSourceScanOptions {
    includeFencedCode?: boolean;
    includeFrontmatter?: boolean;
    includeInlineCode?: boolean;
    includeHtmlComments?: boolean;
}

export interface ContextualImageLink extends ImageLink {
    context: MarkdownSourceContext;
}

export interface ContextualReferenceLink extends ReferenceLink {
    context: MarkdownSourceContext;
}

/**
 * A source-order image record shared by editor, renderer, and reference tools.
 * `ordinal` is stable within a document for identical normalized paths.
 */
export interface ImageSourceDescriptor extends ContextualImageLink {
    end: number;
    line: number;
    lineStart: number;
    lineEnd: number;
    ordinal: number;
    normalizedTarget: string;
    standalone: boolean;
    layoutScope: 'root' | 'semantic';
    pipeData: PipeSyntaxData | null;
}

interface SourceRange {
    from: number;
    to: number;
    context: MarkdownSourceContext;
}

interface FenceState {
    marker: '`' | '~';
    length: number;
    admonition: boolean;
}

interface FenceOpening extends FenceState {
    info: string;
}

interface LiteralScannerState {
    htmlComment: boolean;
    inlineBacktickLength: number | null;
}

export interface MarkdownSourceLexicalState {
    frontmatter: boolean;
    fence: {
        marker: '`' | '~';
        length: number;
        admonition: boolean;
    } | null;
    htmlComment: boolean;
    inlineBacktickLength: number | null;
    callout: boolean;
}

export interface MarkdownSourceLineState {
    line: number;
    from: number;
    to: number;
    text: string;
    context: MarkdownSourceContext;
    input: MarkdownSourceLexicalState;
    output: MarkdownSourceLexicalState;
}

const DEFAULT_SCAN_OPTIONS: Required<MarkdownSourceScanOptions> = {
    includeFencedCode: false,
    includeFrontmatter: false,
    includeInlineCode: false,
    includeHtmlComments: false
};

/**
 * Classifies Markdown offsets without changing the source text. Admonition
 * fences are treated as rendered Markdown while ordinary fences remain
 * source-only unless a caller explicitly opts into them.
 */
export class MarkdownSourceContextIndex {
    private constructor(
        private readonly baseRanges: SourceRange[],
        private readonly literalRanges: SourceRange[],
        private readonly lineStates: MarkdownSourceLineState[]
    ) { }

    static create(text: string): MarkdownSourceContextIndex {
        const baseRanges: SourceRange[] = [];
        const literalRanges: SourceRange[] = [];
        const lineStates: MarkdownSourceLineState[] = [];
        let fence: FenceState | null = null;
        let inFrontmatter = false;
        let literalState: LiteralScannerState = {
            htmlComment: false,
            inlineBacktickLength: null
        };
        let inCallout = false;
        let offset = 0;
        let lineNumber = 0;

        while (offset < text.length || (text.length === 0 && lineNumber === 0)) {
            const newline = text.indexOf('\n', offset);
            const fullEnd = newline >= 0 ? newline + 1 : text.length;
            const contentEnd = newline >= 0 && text[newline - 1] === '\r'
                ? newline - 1
                : newline >= 0 ? newline : text.length;
            const line = text.slice(offset, contentEnd);
            const rangeEnd = fullEnd;
            const normalizedLine = lineNumber === 0 ? line.replace(/^\uFEFF/, '') : line;
            const input = snapshotLexicalState(
                inFrontmatter,
                fence,
                literalState,
                inCallout
            );
            let lineContext: MarkdownSourceContext;

            if (lineNumber === 0 && normalizedLine.trim() === '---') {
                inFrontmatter = true;
                lineContext = 'frontmatter';
                baseRanges.push({ from: offset, to: rangeEnd, context: lineContext });
            } else if (inFrontmatter) {
                lineContext = 'frontmatter';
                baseRanges.push({ from: offset, to: rangeEnd, context: lineContext });
                if (/^\s*(?:---|\.\.\.)\s*$/.test(line)) {
                    inFrontmatter = false;
                }
            } else if (fence) {
                if (isFenceClosing(line, fence)) {
                    lineContext = 'fenced-code';
                    baseRanges.push({ from: offset, to: rangeEnd, context: lineContext });
                    fence = null;
                    literalState = { htmlComment: false, inlineBacktickLength: null };
                } else {
                    lineContext = fence.admonition
                        ? 'admonition'
                        : 'fenced-code';
                    baseRanges.push({ from: offset, to: rangeEnd, context: lineContext });
                    if (lineContext === 'admonition') {
                        literalState = scanLiteralRanges(
                            line,
                            offset,
                            literalState,
                            literalRanges
                        );
                    }
                }
            } else {
                if (inCallout && !isBlockquoteLine(line)) inCallout = false;
                if (isObsidianCalloutStart(line)) inCallout = true;

                const opening = !literalState.htmlComment && !literalState.inlineBacktickLength
                    ? parseFenceOpening(line)
                    : null;
                if (opening) {
                    fence = opening;
                    lineContext = 'fenced-code';
                    baseRanges.push({ from: offset, to: rangeEnd, context: lineContext });
                    literalState = { htmlComment: false, inlineBacktickLength: null };
                } else {
                    lineContext = inCallout && isBlockquoteLine(line)
                        ? 'callout'
                        : 'prose';
                    baseRanges.push({ from: offset, to: rangeEnd, context: lineContext });
                    literalState = scanLiteralRanges(
                        line,
                        offset,
                        literalState,
                        literalRanges
                    );
                }
            }

            lineStates.push({
                line: lineNumber,
                from: offset,
                to: rangeEnd,
                text: line,
                context: lineContext,
                input,
                output: snapshotLexicalState(
                    inFrontmatter,
                    fence,
                    literalState,
                    inCallout
                )
            });

            if (newline < 0) break;
            offset = fullEnd;
            lineNumber++;
        }

        return new MarkdownSourceContextIndex(baseRanges, literalRanges, lineStates);
    }

    contextAt(from: number, to = from + 1): MarkdownSourceContext {
        const literal = findOverlappingRange(this.literalRanges, from, to);
        if (literal) return literal.context;

        return findContainingRange(this.baseRanges, from)?.context ?? 'prose';
    }

    includes(from: number, to: number, options: MarkdownSourceScanOptions = {}): boolean {
        return isMarkdownSourceContextIncluded(this.contextAt(from, to), options);
    }

    getLineStates(): readonly MarkdownSourceLineState[] {
        return this.lineStates;
    }
}

export function getContextualImageLinks(
    text: string,
    options: MarkdownSourceScanOptions = {}
): ContextualImageLink[] {
    const index = MarkdownSourceContextIndex.create(text);
    return getAllImageLinks(text)
        .map(link => ({
            ...link,
            context: index.contextAt(link.index, link.index + link.source.length)
        }))
        .filter(link => isMarkdownSourceContextIncluded(link.context, options))
        .sort((left, right) => left.index - right.index);
}

export function getImageSourceDescriptors(
    text: string,
    options: MarkdownSourceScanOptions = {}
): ImageSourceDescriptor[] {
    const descriptors: ImageSourceDescriptor[] = [];
    const occurrences = new Map<string, number>();
    const contextIndex = MarkdownSourceContextIndex.create(text);
    const links = getAllImageLinks(text)
        .map(link => ({
            ...link,
            context: contextIndex.contextAt(link.index, link.index + link.source.length)
        }))
        .filter(link => isMarkdownSourceContextIncluded(link.context, options))
        .sort((left, right) => left.index - right.index);

    for (const link of links) {
        const key = normalizeDescriptorPath(link.path);
        const ordinal = occurrences.get(key) ?? 0;
        occurrences.set(key, ordinal + 1);
        const lineStart = text.lastIndexOf('\n', Math.max(0, link.index - 1)) + 1;
        const newline = text.indexOf('\n', link.index + link.source.length);
        const lineEnd = newline < 0 ? text.length : newline;
        descriptors.push({
            ...link,
            end: link.index + link.source.length,
            line: countLinesBefore(text, link.index),
            lineStart,
            lineEnd,
            ordinal,
            normalizedTarget: key,
            standalone: false,
            layoutScope: getDescriptorLayoutScope(
                text.slice(lineStart, link.index),
                link.context
            ),
            pipeData: pipeSyntaxParser.parsePipeSyntax(link.source, { attributeMode: 'display' })
        });
    }

    for (const descriptor of descriptors) {
        descriptor.standalone = isStandaloneDescriptor(
            text,
            descriptor,
            descriptors,
            contextIndex
        );
    }

    return descriptors;
}

function getDescriptorLayoutScope(
    prefix: string,
    context: MarkdownSourceContext
): ImageSourceDescriptor['layoutScope'] {
    if (context === 'callout' || context === 'admonition') return 'semantic';
    if (/^\s*>/.test(prefix)) return 'semantic';
    if (/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/.test(prefix)) return 'semantic';
    return 'root';
}

export function getCaptionLinkDescriptors(
    text: string,
    options: MarkdownSourceScanOptions = {}
): ImageSourceDescriptor[] {
    return getImageSourceDescriptors(text, options);
}

export function getImageSourceKey(descriptor: ImageSourceDescriptor): string {
    return [
        descriptor.index,
        descriptor.end,
        descriptor.ordinal,
        descriptor.normalizedTarget
    ].join(':');
}

export type ImageLayoutKey = string;

/** Stable across edits before an image; used only for non-destructive DOM layout binding. */
export function getImageLayoutKey(descriptor: ImageSourceDescriptor): ImageLayoutKey {
    return `${descriptor.ordinal}:${descriptor.normalizedTarget}`;
}

export function getContextualReferenceLinks(
    text: string,
    options: MarkdownSourceScanOptions = {}
): ContextualReferenceLink[] {
    const index = MarkdownSourceContextIndex.create(text);
    return getAllReferenceLinks(text)
        .map(link => ({
            ...link,
            context: index.contextAt(link.index, link.index + link.source.length)
        }))
        .filter(link => isMarkdownSourceContextIncluded(link.context, options));
}

export function isMarkdownSourceContextIncluded(
    context: MarkdownSourceContext,
    options: MarkdownSourceScanOptions = {}
): boolean {
    const resolved = { ...DEFAULT_SCAN_OPTIONS, ...options };
    switch (context) {
        case 'fenced-code':
            return resolved.includeFencedCode;
        case 'frontmatter':
            return resolved.includeFrontmatter;
        case 'inline-code':
            return resolved.includeInlineCode;
        case 'html-comment':
            return resolved.includeHtmlComments;
        case 'prose':
        case 'callout':
        case 'admonition':
            return true;
    }
}

export function parseFenceOpening(line: string): FenceOpening | null {
    const candidate = stripBlockquotePrefixes(line);
    const match = candidate.match(/^\s*(`{3,}|~{3,})(.*)$/);
    if (!match) return null;

    const marker = match[1][0] as '`' | '~';
    const info = match[2].trim();
    if (marker === '`' && info.includes('`')) return null;

    return {
        marker,
        length: match[1].length,
        info,
        admonition: isAdmonitionFenceInfo(info)
    };
}

export function isFenceClosing(line: string, fence: FenceState): boolean {
    const candidate = stripBlockquotePrefixes(line);
    const marker = fence.marker === '`' ? '`' : '~';
    const match = candidate.match(/^\s*(`+|~+)\s*$/);
    return !!match
        && match[1][0] === marker
        && match[1].length >= fence.length;
}

export function isAdmonitionFenceInfo(info: string): boolean {
    const language = info.trim().split(/\s+/, 1)[0] ?? '';
    return /^ad-[a-z0-9][a-z0-9_-]*$/i.test(language);
}

export function containsAdmonitionBlock(text: string): boolean {
    const index = MarkdownSourceContextIndex.create(text);
    return getAllImageLinks(text).some(link =>
        index.contextAt(link.index, link.index + link.source.length) === 'admonition'
    ) || text.split(/\r?\n/).some(line => parseFenceOpening(line)?.admonition === true);
}

function scanLiteralRanges(
    line: string,
    lineOffset: number,
    initialState: LiteralScannerState,
    ranges: SourceRange[]
): LiteralScannerState {
    let htmlComment = initialState.htmlComment;
    let inlineBacktickLength = initialState.inlineBacktickLength;
    let index = 0;

    while (index < line.length) {
        if (htmlComment) {
            const close = line.indexOf('-->', index);
            const end = close >= 0 ? close + 3 : line.length;
            ranges.push({
                from: lineOffset + index,
                to: lineOffset + end,
                context: 'html-comment'
            });
            if (close < 0) return { htmlComment: true, inlineBacktickLength: null };
            htmlComment = false;
            index = end;
            continue;
        }

        if (inlineBacktickLength) {
            const close = findMatchingBacktickRun(line, index, inlineBacktickLength);
            const end = close >= 0 ? close + inlineBacktickLength : line.length;
            ranges.push({
                from: lineOffset + index,
                to: lineOffset + end,
                context: 'inline-code'
            });
            if (close < 0) {
                return { htmlComment: false, inlineBacktickLength };
            }
            inlineBacktickLength = null;
            index = end;
            continue;
        }

        if (line.startsWith('<!--', index)) {
            htmlComment = true;
            continue;
        }

        if (line[index] === '`' && isFenceLikeBacktickRun(line, index)) {
            index += countRun(line, index, '`');
            continue;
        }

        if (line[index] === '`') {
            const runLength = countRun(line, index, '`');
            const close = findMatchingBacktickRun(line, index + runLength, runLength);
            if (close >= 0) {
                ranges.push({
                    from: lineOffset + index,
                    to: lineOffset + close + runLength,
                    context: 'inline-code'
                });
                index = close + runLength;
                continue;
            }
            ranges.push({
                from: lineOffset + index,
                to: lineOffset + line.length,
                context: 'inline-code'
            });
            return { htmlComment: false, inlineBacktickLength: runLength };
        }

        index++;
    }

    return { htmlComment, inlineBacktickLength };
}

function findMatchingBacktickRun(line: string, from: number, length: number): number {
    let index = from;
    while (index < line.length) {
        if (line[index] !== '`') {
            index++;
            continue;
        }

        const runLength = countRun(line, index, '`');
        if (runLength === length) return index;
        index += runLength;
    }
    return -1;
}

function countRun(text: string, from: number, character: string): number {
    let end = from;
    while (end < text.length && text[end] === character) end++;
    return end - from;
}

function isFenceLikeBacktickRun(line: string, index: number): boolean {
    return countRun(line, index, '`') >= 3
        && /^\s*(?:>\s*)*$/.test(line.slice(0, index));
}

function stripBlockquotePrefixes(line: string): string {
    let remaining = line;
    while (true) {
        const match = remaining.match(/^\s{0,3}>[ \t]?/);
        if (!match) return remaining;
        remaining = remaining.slice(match[0].length);
    }
}

function isObsidianCalloutStart(line: string): boolean {
    return /^\s*(?:>\s*)+\[![^\]]+\][+-]?/.test(line);
}

function isBlockquoteLine(line: string): boolean {
    return /^\s*>/.test(line);
}

function findContainingRange(ranges: SourceRange[], offset: number): SourceRange | null {
    let low = 0;
    let high = ranges.length - 1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        const range = ranges[middle];
        if (offset < range.from) {
            high = middle - 1;
        } else if (offset >= range.to) {
            low = middle + 1;
        } else {
            return range;
        }
    }
    return null;
}

function findOverlappingRange(ranges: SourceRange[], from: number, to: number): SourceRange | null {
    for (const range of ranges) {
        if (range.to <= from) continue;
        if (range.from >= to) break;
        return range;
    }
    return null;
}

function normalizeDescriptorPath(path: string): string {
    return path.trim().replace(/\\/g, '/').toLowerCase();
}

function isStandaloneDescriptor(
    text: string,
    descriptor: ImageSourceDescriptor,
    descriptors: ImageSourceDescriptor[],
    contextIndex: MarkdownSourceContextIndex
): boolean {
    const lineDescriptors = descriptors.filter(candidate =>
        candidate.lineStart === descriptor.lineStart && candidate.lineEnd === descriptor.lineEnd
    );
    if (lineDescriptors.length !== 1) return false;

    const lineText = text.slice(descriptor.lineStart, descriptor.lineEnd);
    const relativeFrom = descriptor.index - descriptor.lineStart;
    const relativeTo = descriptor.end - descriptor.lineStart;
    let visibleRemainder = '';

    for (let index = 0; index < lineText.length; index++) {
        const absolute = descriptor.lineStart + index;
        if (index >= relativeFrom && index < relativeTo) continue;
        const context = contextIndex.contextAt(absolute, absolute + 1);
        if (context === 'inline-code' || context === 'html-comment') continue;
        visibleRemainder += lineText[index];
    }

    return stripContainerPrefixes(visibleRemainder).trim().length === 0;
}

function stripContainerPrefixes(value: string): string {
    let remaining = value;
    let previous = '';
    while (remaining !== previous) {
        previous = remaining;
        remaining = remaining
            .replace(/^\s*>[ \t]?/, '')
            .replace(/^\s*(?:[-+*]|\d+[.)])[ \t]+/, '')
            .replace(/^\s*\[[ xX]\][ \t]+/, '');
    }
    return remaining;
}

function countLinesBefore(text: string, offset: number): number {
    let line = 0;
    for (let index = 0; index < offset; index++) {
        if (text[index] === '\n') line++;
    }
    return line;
}

function snapshotLexicalState(
    frontmatter: boolean,
    fence: FenceState | null,
    literalState: LiteralScannerState,
    callout: boolean
): MarkdownSourceLexicalState {
    return {
        frontmatter,
        fence: fence ? { ...fence } : null,
        htmlComment: literalState.htmlComment,
        inlineBacktickLength: literalState.inlineBacktickLength,
        callout
    };
}
