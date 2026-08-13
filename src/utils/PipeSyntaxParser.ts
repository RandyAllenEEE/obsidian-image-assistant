/**
 * Pipe Syntax Parser for Obsidian Image Links
 * 
 * Supports both Wiki and Markdown link formats with attributes:
 * - Wiki: ![[path|alt|align|size]]
 * - Markdown: ![alt|align|size](path)
 * 
 * Attributes:
 * - align: left, center, right, left-wrap, right-wrap
 * - size: 300x200 or 300, as the final pipe token
 * - alt: any text (caption)
 */

import {
    PIPE_SIZE_PATTERN,
    PIPE_ALIGN_PATTERN,
    REGEX_WIKI_LINK_VALIDATE,
    getAllImageLinks
} from './RegexPatterns';

export type AlignType = 'left' | 'center' | 'right' | 'left-wrap' | 'right-wrap' | null;

export type SizeData =
    | { width: number; height?: never; format: 'W' }
    | { width: number; height: number; format: 'WxH' };

export interface PipeSyntaxData {
    path: string;                       // 图片路径或 URL
    alt?: string;                       // 题注文本（缺省时为空格 ' '）
    align?: AlignType;                  // 对齐方式
    size?: SizeData;                    // 尺寸信息
    title?: string;                     // Markdown title, if present
    linkType: 'wiki' | 'markdown';      // 链接类型
}

/** A dimension-only update used by reference and property edit workflows. */
export interface PipeSyntaxSizeUpdate {
    readonly width?: number | null;
    readonly height?: number | null;
}

export type PipeSyntaxSizePatchStatus =
    | 'updated'
    | 'unchanged'
    | 'ambiguous'
    | 'invalid';

/** Result of a source-preserving size update. */
export interface PipeSyntaxSizePatchResult {
    readonly status: PipeSyntaxSizePatchStatus;
    readonly linkText: string;
}

export type PipeAttributeParseMode = 'storage' | 'display';

export interface PipeSyntaxParseOptions {
    attributeMode?: PipeAttributeParseMode;
}

/**
 * Pipe Syntax 解析器
 */
export class PipeSyntaxParser {
    // // 对齐关键字集合 -> Now using Regex Test or we can keep set if faster, but let's use regex to be strict to patterns file
    // private static readonly ALIGN_KEYWORDS = new Set([
    //     'left', 'center', 'right', 'left-wrap', 'right-wrap'
    // ]);

    // 尺寸格式正则
    private static readonly SIZE_PATTERN = PIPE_SIZE_PATTERN;

    // Wiki 链接正则
    private static readonly WIKI_LINK_PATTERN = REGEX_WIKI_LINK_VALIDATE;

    /**
     * 解析图片链接的 Pipe Syntax
     * @param linkText 完整的图片链接字符串
     * @returns PipeSyntaxData 对象
     */
    public parsePipeSyntax(linkText: string, options: PipeSyntaxParseOptions = {}): PipeSyntaxData | null {
        if (!linkText || linkText.trim() === '') {
            return null;
        }

        const trimmedLink = linkText.trim();

        // 判断链接类型
        if (trimmedLink.startsWith('![[')) {
            return this.parseWikiLink(trimmedLink, options);
        } else if (trimmedLink.startsWith('![')) {
            return this.parseMarkdownLink(trimmedLink, options);
        }

        return null;
    }

    /**
     * 解析 Wiki 格式链接：![[path|attr1|attr2|...]]
     *
     * Obsidian 转义约定：
     *   `\\`  = 字面反斜杠（所以 `\\\\` = 两个反斜杠）
     *   `\|`  = 字面管道符（出现在路径中时）
     *
     * 分拆策略：遇到未被转义的 `|` 才分割。
     * "被转义" = 前面有奇数个反斜杠。
     */
    private parseWikiLink(linkText: string, options: PipeSyntaxParseOptions): PipeSyntaxData | null {
        const match = linkText.match(PipeSyntaxParser.WIKI_LINK_PATTERN);
        if (!match) {
            return null;
        }

        const content = match[1]; // path|attr1|attr2|...
        const parts = this.wikiSplitByUnescapedPipe(content);

        if (parts.length === 0) {
            return null;
        }

        // 第一个片段是路径（需要去掉转义还原为字面字符）
        const path = this.unescapeWikiPath(parts[0].trim());
        const attrContent = parts.slice(1).join('|');

        const { alt, align, size } = this.parsePipeAttributes(attrContent, options.attributeMode);

        return {
            path,
            alt: alt || ' ',
            align,
            size,
            linkType: 'wiki'
        };
    }

    /**
     * 按未被转义的管道符分拆 wiki link 内容。
     * "被转义的管道" = 前面有奇数个反斜杠。
     */
    private wikiSplitByUnescapedPipe(text: string): string[] {
        const result: string[] = [];
        let i = 0;
        let start = 0;

        while (i < text.length) {
            if (text[i] === "\\") {
                // 跳过转义序列（\\ 或 \\\\| 或 \\\\ 等）
                while (i < text.length && text[i] === "\\") { i++; }
                // 遇到 `\\|` 时，bsCount 是偶数 => 这里的 | 是字面管道；
                // 遇到 `\|` 时，bsCount 是奇数 => 这里的 | 是转义管道，应作为内容而非分隔符。
                // 直接继续即可，下次循环看下一个字符。
                continue;
            }

            if (text[i] === "|") {
                // 奇数个反斜杠在前的管道 = 转义管道 => 跳过
                let bsCount = 0;
                let j = i - 1;
                while (j >= 0 && text[j] === "\\") { bsCount++; j--; }
                if (bsCount % 2 !== 0) { i++; continue; }

                // 未被转义的管道 => 分隔符
                result.push(text.slice(start, i));
                start = i + 1;
            }
            i++;
        }

        result.push(text.slice(start));
        return result;
    }

    /**
     * 将 wiki link 路径中的转义序列还原为字面字符：
     *   `\\`  -> `\`
     *   `\|`  -> `|`
     */
    private unescapeWikiPath(text: string): string {
        let result = "";
        let i = 0;
        while (i < text.length) {
            if (text[i] === "\\") {
                let bsCount = 0;
                while (i < text.length && text[i] === "\\") { bsCount++; i++; }
                // 每两个反斜杠还原为一个字面反斜杠
                result += "\\".repeat(bsCount / 2);
                if (bsCount % 2 !== 0 && i < text.length && text[i] === "|") {
                    // 奇数个 + 后面是 | => 这个 | 是转义的字面管道
                    result += "|";
                    i++;
                }
                continue;
            }
            result += text[i];
            i++;
        }
        return result;
    }

    /**
     * 将字面字符转义为 wiki link 路径存储格式：
     *   `\` -> `\\`
     *   `|` -> `\|`
     */
    private escapeWikiPathForBuild(text: string): string {
        return text.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
    }

    /**
     * 解析 Markdown 格式链接：![alt|attr1|attr2](path)
     */
    private parseMarkdownLink(linkText: string, options: PipeSyntaxParseOptions): PipeSyntaxData | null {
        const match = linkText.match(/^!\[([^\]]*)\]\((.*)\)$/);
        if (!match) {
            return null;
        }

        const bracketContent = match[1]; // alt|attr1|attr2
        const destination = this.parseMarkdownDestination(match[2].trim());

        const { alt, align, size } = this.parsePipeAttributes(bracketContent, options.attributeMode);

        return {
            path: destination.path,
            alt: alt || ' ',
            align,
            size,
            title: destination.title,
            linkType: 'markdown'
        };
    }

    private parseMarkdownDestination(destination: string): { path: string; title?: string } {
        if (!destination) {
            return { path: '' };
        }

        if (destination.startsWith('<')) {
            const closing = destination.indexOf('>');
            if (closing !== -1) {
                return {
                    path: destination.slice(1, closing),
                    title: this.parseMarkdownTitle(destination.slice(closing + 1).trim())
                };
            }
        }

        const titleMatch = destination.match(/^(\S+)\s+(?:"([^"]*)"|'([^']*)'|\(([^)]*)\))$/);
        if (titleMatch) {
            return {
                path: titleMatch[1],
                title: titleMatch[2] ?? titleMatch[3] ?? titleMatch[4]
            };
        }

        return { path: destination };
    }

    private parseMarkdownTitle(titleText: string): string | undefined {
        if (!titleText) {
            return undefined;
        }

        const match = titleText.match(/^(?:"([^"]*)"|'([^']*)'|\(([^)]*)\))$/);
        return match ? match[1] ?? match[2] ?? match[3] : undefined;
    }

    /**
     * 根据 PipeSyntaxData 构建完整的图片链接字符串
     * @param data PipeSyntaxData 对象
     * @returns 完整的图片链接字符串
     */
    public buildPipeSyntax(data: PipeSyntaxData): string {
        if (data.linkType === 'wiki') {
            return this.buildWikiLink(data);
        } else {
            return this.buildMarkdownLink(data);
        }
    }

    /**
     * 构建 Wiki 格式链接
     */
    private buildWikiLink(data: PipeSyntaxData): string {
        const parts: string[] = [this.escapeWikiPathForBuild(data.path)];

        // 添加 alt（如果不是空格）
        if (data.alt && data.alt !== ' ') {
            parts.push(data.alt);
        }

        // 添加 align
        if (data.align) {
            parts.push(data.align);
        }

        // 添加 size
        if (data.size) {
            parts.push(this.formatSizeAttribute(data.size));
        }

        return `![[${parts.join('|')}]]`;
    }

    /**
     * 构建 Markdown 格式链接
     */
    private buildMarkdownLink(data: PipeSyntaxData): string {
        const parts: string[] = [];

        // A numeric-only Markdown alt is Obsidian's canonical width syntax:
        // `![300](image.png)`. Do not force an empty leading segment.
        if (data.alt && data.alt !== ' ') {
            parts.push(data.alt);
        }

        // 添加 align
        if (data.align) {
            parts.push(data.align);
        }

        // 添加 size
        if (data.size) {
            parts.push(this.formatSizeAttribute(data.size));
        }

        const bracketContent = parts.join('|');
        const path = /[\s()]/.test(data.path)
            ? `<${data.path.replace(/>/g, '%3E')}>`
            : data.path;
        const title = data.title ? ` "${data.title.replace(/"/g, '\\"')}"` : '';
        return `![${bracketContent}](${path}${title})`;
    }

    /** Formats only the canonical caption/alignment/size attribute sequence. */
    public formatPipeAttributes(
        data: Pick<PipeSyntaxData, 'alt' | 'align' | 'size'>
    ): string {
        const parts: string[] = [];
        if (data.alt && data.alt !== ' ') parts.push(data.alt);
        if (data.align) parts.push(data.align);
        if (data.size) parts.push(this.formatSizeAttribute(data.size));
        return parts.join('|');
    }

    /**
     * Replaces only the Wiki alias or Markdown alt portion. The path, title,
     * angle wrapping, escaping and embed shell remain byte-for-byte unchanged.
     * Use this for explicit property edits; path-only workflows must continue
     * using their raw-attribute-preserving serializers.
     */
    public rewritePipeAttributes(
        linkText: string,
        data: Pick<PipeSyntaxData, 'alt' | 'align' | 'size'>
    ): string | null {
        const attributes = this.formatPipeAttributes(data);
        if (linkText.startsWith('![[') && linkText.endsWith(']]')) {
            const inside = linkText.slice(3, -2);
            const pathEnd = this.findFirstUnescapedPipe(inside);
            const rawPath = pathEnd < 0 ? inside : inside.slice(0, pathEnd);
            return `![[${rawPath}${attributes ? `|${attributes}` : ''}]]`;
        }

        const markdown = linkText.match(/^!\[([^\]]*)\]\(([\s\S]*)\)$/);
        if (!markdown) return null;
        return `![${attributes}](${markdown[2]})`;
    }

    /**
     * Parse the alt text content to strip size and align attributes.
     * Effectively treats the input as the content inside ![...].
     * @param altText The raw alt text (e.g. "Title|100")
     */
    public parseAltText(altText: string, mode: PipeAttributeParseMode = 'storage'): PipeSyntaxData {
        const { alt, align, size } = this.parsePipeAttributes(altText, mode);

        return {
            path: '',
            alt: alt || ' ',
            align,
            size,
            linkType: 'markdown' // arbitrary
        };
    }

    /**
     * 核心解析逻辑：从 Pipe Syntax 字符串中提取 alt, align, size
     * @param content 管道符分隔的内容片段 (不含 ![[ ]] 或 ![ ]() 外壳)
     */
    public parsePipeAttributes(content: string, mode: PipeAttributeParseMode = 'storage'): {
        alt?: string;
        align?: AlignType;
        size?: SizeData;
    } {
        if (!content || content.trim() === '') {
            return { alt: ' ' };
        }

        // Both Markdown and Wiki attributes follow the same tail grammar. A
        // sole numeric token is intentionally a size, matching Obsidian.
        const segments = this.splitByUnescapedPipe(content);
        let size: SizeData | undefined;
        let align: AlignType = null;

        const lastSize = this.parseSizeAttribute(
            segments.length > 0 ? segments[segments.length - 1].trim() : ''
        );
        if (lastSize) {
            size = lastSize;
            segments.pop();
        }

        const lastAttribute = segments.length > 0
            ? segments[segments.length - 1].trim()
            : '';
        if (this.isAlignAttribute(lastAttribute)) {
            align = lastAttribute as AlignType;
            segments.pop();
        }

        const rawCaption = segments.join('|').trim();
        const alt = mode === 'display'
            ? rawCaption.replace(/\\\|/g, '|')
            : rawCaption;
        return { alt: alt || ' ', align, size };
    }

    private splitByUnescapedPipe(text: string): string[] {
        const result: string[] = [];
        let start = 0;

        for (let i = 0; i < text.length; i++) {
            if (text[i] !== '|') {
                continue;
            }

            let slashCount = 0;
            for (let j = i - 1; j >= 0 && text[j] === '\\'; j--) {
                slashCount++;
            }

            if (slashCount % 2 !== 0) {
                continue;
            }

            result.push(text.slice(start, i));
            start = i + 1;
        }

        result.push(text.slice(start));
        return result;
    }

    private findFirstUnescapedPipe(text: string): number {
        for (let index = 0; index < text.length; index++) {
            if (text[index] !== '|') continue;
            let slashCount = 0;
            for (let cursor = index - 1;
                cursor >= 0 && text[cursor] === '\\';
                cursor--) {
                slashCount++;
            }
            if (slashCount % 2 === 0) return index;
        }
        return -1;
    }

    /**
     * 更新图片链接中的特定属性
     * @param linkText 原始链接字符串
     * @param updates 要更新的属性对象
     * @returns 更新后的链接字符串
     */
    public updatePipeSyntax(
        linkText: string,
        updates: Partial<Pick<PipeSyntaxData, 'alt' | 'align' | 'size'>>
    ): string | null {
        const parsed = this.parsePipeSyntax(linkText);
        if (!parsed) {
            return null;
        }

        // 合并更新
        const updated: PipeSyntaxData = {
            ...parsed,
            ...updates
        };

        return this.buildPipeSyntax(updated);
    }

    /**
     * Updates only the size token while retaining the original link shell and
     * every non-size pipe segment verbatim. This is intentionally stricter
     * than buildPipeSyntax(): a reference patch must not reorder or discard a
     * caption, title, escaped pipe, or an extension-owned segment.
     */
    public updateSizePreservingSyntax(
        linkText: string,
        updates: PipeSyntaxSizeUpdate
    ): PipeSyntaxSizePatchResult {
        const target = this.getSizePatchTarget(linkText);
        if (!target) return { status: 'invalid', linkText };

        const segments = this.splitByUnescapedPipe(target.attributes);
        const sizeIndexes = this.getSizeTokenIndexes(target.linkType, segments);
        if (sizeIndexes === null || sizeIndexes.length > 1) {
            return { status: 'ambiguous', linkText };
        }

        const existingSize = sizeIndexes.length === 1
            ? this.parseSizeAttribute(segments[sizeIndexes[0]].trim())
            : undefined;
        const nextSize = this.resolveSizeUpdate(existingSize, updates);
        if (nextSize === null) return { status: 'invalid', linkText };

        if (sizeIndexes.length === 1) {
            const index = sizeIndexes[0];
            if (!nextSize) {
                segments.splice(index, 1);
            } else {
                const nextValue = this.formatSizeAttribute(nextSize);
                segments[index] = this.replaceSegmentValue(segments[index], nextValue);
            }
        } else if (nextSize) {
            if (target.linkType === 'markdown'
                && segments.length === 1
                && segments[0] === '') {
                segments.length = 0;
            }
            segments.push(this.formatSizeAttribute(nextSize));
        }

        const nextLinkText = `${target.prefix}${segments.join('|')}${target.suffix}`;
        return {
            status: nextLinkText === linkText ? 'unchanged' : 'updated',
            linkText: nextLinkText
        };
    }

    private getSizePatchTarget(linkText: string): {
        readonly linkType: PipeSyntaxData['linkType'];
        readonly prefix: string;
        readonly attributes: string;
        readonly suffix: string;
    } | null {
        if (linkText.startsWith('![[') && linkText.endsWith(']]')) {
            return {
                linkType: 'wiki',
                prefix: '![[',
                attributes: linkText.slice(3, -2),
                suffix: ']]'
            };
        }

        const markdownMatch = linkText.match(/^!\[([^\]]*)\]\(([\s\S]*)\)$/);
        if (!markdownMatch) return null;
        return {
            linkType: 'markdown',
            prefix: '![',
            attributes: markdownMatch[1],
            suffix: `](${markdownMatch[2]})`
        };
    }

    private getSizeTokenIndexes(
        linkType: PipeSyntaxData['linkType'],
        segments: readonly string[]
    ): number[] | null {
        const lastIndex = segments.length - 1;
        if (lastIndex < 0) return [];
        const firstAttributeIndex = linkType === 'wiki' ? 1 : 0;
        const sizeIndexes: number[] = [];
        for (let index = firstAttributeIndex; index <= lastIndex; index++) {
            if (this.isSizeAttribute(segments[index].trim())) {
                sizeIndexes.push(index);
            }
        }

        // A size-like token before the final unescaped pipe segment is legacy
        // or ambiguous content. Automatic workflows must preserve it exactly
        // instead of appending another size or silently migrating its order.
        if (sizeIndexes.some(index => index !== lastIndex)) return null;
        return sizeIndexes;
    }

    private resolveSizeUpdate(
        existing: SizeData | undefined,
        updates: PipeSyntaxSizeUpdate
    ): SizeData | undefined | null {
        const width = updates.width === undefined
            ? existing?.width
            : updates.width ?? undefined;
        const height = updates.height === undefined
            ? existing?.height
            : updates.height ?? undefined;

        if (!this.isValidDimension(width) || !this.isValidDimension(height)) {
            return null;
        }
        if (width === undefined && height === undefined) return undefined;
        if (width === undefined) return null;
        return height === undefined
            ? { width, format: 'W' }
            : { width, height, format: 'WxH' };
    }

    private isValidDimension(value: number | undefined): boolean {
        return value === undefined || (Number.isInteger(value) && value > 0);
    }

    private replaceSegmentValue(rawSegment: string, value: string): string {
        const leadingWhitespace = rawSegment.match(/^\s*/)?.[0] ?? '';
        const trailingWhitespace = rawSegment.match(/\s*$/)?.[0] ?? '';
        return `${leadingWhitespace}${value}${trailingWhitespace}`;
    }

    /**
     * 判断是否为尺寸属性
     */
    private isSizeAttribute(segment: string): boolean {
        return PipeSyntaxParser.SIZE_PATTERN.test(segment);
    }

    /**
     * 判断是否为对齐属性
     */
    private isAlignAttribute(segment: string): boolean {
        return PIPE_ALIGN_PATTERN.test(segment);
    }

    /**
     * 解析尺寸属性字符串为 SizeData
     */
    private parseSizeAttribute(sizeStr: string): SizeData | undefined {
        const match = sizeStr.match(PipeSyntaxParser.SIZE_PATTERN);
        if (!match) {
            return undefined;
        }

        const width = Number(match[1]);
        const height = match[2] ? Number(match[2]) : undefined;
        if (!Number.isSafeInteger(width) || width <= 0
            || (height !== undefined && (!Number.isSafeInteger(height) || height <= 0))) {
            return undefined;
        }
        return height === undefined
            ? { width, format: 'W' }
            : { width, height, format: 'WxH' };
    }

    /**
     * 格式化 SizeData 为字符串
     */
    private formatSizeAttribute(size: SizeData): string {
        switch (size.format) {
            case 'WxH':
                return `${size.width}x${size.height}`;
            case 'W':
                return `${size.width}`;
            default:
                return '';
        }
    }
    /**
     * 解析文本中的所有图片链接
     * @param text 包含图片链接的文本
     * @returns 解析后的链接数据数组
     */
    public extractAllLinks(text: string): {
        fullMatch: string;
        index: number;
        data: PipeSyntaxData;
    }[] {
        const results: { fullMatch: string; index: number; data: PipeSyntaxData }[] = [];

        // Use the centralized getAllImageLinks to ensure consistent regex matching
        // with the rest of the codebase (RegexPatterns.ts)
        const allLinks = getAllImageLinks(text);

        for (const link of allLinks) {
            const parsed = this.parsePipeSyntax(link.source);
            if (parsed) {
                results.push({
                    fullMatch: link.source,
                    index: link.index,
                    data: parsed
                });
            }
        }

        return results.sort((a, b) => a.index - b.index);
    }
}

// 导出单例实例
export const pipeSyntaxParser = new PipeSyntaxParser();
