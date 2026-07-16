/**
 * Pipe Syntax Parser for Obsidian Image Links
 * 
 * Supports both Wiki and Markdown link formats with attributes:
 * - Wiki: ![[path|alt|align|size]]
 * - Markdown: ![alt|align|size](path)
 * 
 * Attributes:
 * - align: left, center, right, left-wrap, right-wrap
 * - size: 300x200, 300, 300x, x200
 * - alt: any text (caption)
 */

import {
    PIPE_SIZE_PATTERN,
    PIPE_ALIGN_PATTERN,
    REGEX_WIKI_LINK_VALIDATE,
    REGEX_MD_LINK_VALIDATE,
    getAllImageLinks
} from './RegexPatterns';

export type AlignType = 'left' | 'center' | 'right' | 'left-wrap' | 'right-wrap' | null;

export interface SizeData {
    width?: number;   // 宽度（像素）
    height?: number;  // 高度（像素）
    format: 'WxH' | 'W' | 'Wx' | 'xH';  // 尺寸格式
}

export interface PipeSyntaxData {
    path: string;                       // 图片路径或 URL
    alt?: string;                       // 题注文本（缺省时为空格 ' '）
    align?: AlignType;                  // 对齐方式
    size?: SizeData;                    // 尺寸信息
    title?: string;                     // Markdown title, if present
    linkType: 'wiki' | 'markdown';      // 链接类型
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

    // Markdown 链接正则
    private static readonly MARKDOWN_LINK_PATTERN = REGEX_MD_LINK_VALIDATE;

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

        const { alt, align, size } = this.parsePipeAttributes(attrContent, false, options.attributeMode);

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

        const { alt, align, size } = this.parsePipeAttributes(bracketContent, true, options.attributeMode);

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

        // 第一个位置是 alt
        if (data.alt && data.alt !== ' ') {
            parts.push(data.alt);
        } else {
            parts.push(''); // alt 缺省时留空
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
        const path = /\s/.test(data.path) ? `<${data.path}>` : data.path;
        const title = data.title ? ` "${data.title.replace(/"/g, '\\"')}"` : '';
        return `![${bracketContent}](${path}${title})`;
    }

    /**
     * Parse the alt text content to strip size and align attributes.
     * Effectively treats the input as the content inside ![...].
     * @param altText The raw alt text (e.g. "Title|100")
     */
    public parseAltText(altText: string, mode: PipeAttributeParseMode = 'storage'): PipeSyntaxData {
        const { alt, align, size } = this.parsePipeAttributes(altText, true, mode);

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
     * @param firstPartIsAlt 是否强制首个片段为 alt (Markdown 风格)
     */
    public parsePipeAttributes(content: string, firstPartIsAlt: boolean, mode: PipeAttributeParseMode = 'storage'): {
        alt?: string;
        align?: AlignType;
        size?: SizeData;
    } {
        if (!content || content.trim() === '') {
            return { alt: ' ' };
        }

        const parts = this.splitByUnescapedPipe(content);
        let segments = [...parts];

        let alt: string | undefined;
        let size: SizeData | undefined;
        let align: AlignType = null;

        if (mode === 'display') {
            const containsPipe = parts.length > 1;
            const remaining: string[] = [];

            for (const segment of segments) {
                const trimmed = segment.trim();
                const canTreatAsAttribute = containsPipe || !firstPartIsAlt;

                if (canTreatAsAttribute && this.isSizeAttribute(trimmed) && !size) {
                    size = this.parseSizeAttribute(trimmed);
                } else if (canTreatAsAttribute && this.isAlignAttribute(trimmed) && !align) {
                    align = trimmed as AlignType;
                } else {
                    remaining.push(segment);
                }
            }

            const caption = remaining.join('|').replace(/\\\|/g, '|').trim();
            return { alt: caption || ' ', align, size };
        }

        if (firstPartIsAlt) {
            // Markdown 风格：首位是 alt
            if (segments[0].trim() === '') {
                alt = ' ';
            } else {
                alt = segments[0];
            }
            segments = segments.slice(1);

            // 后续属性顺序不限制
            for (const segment of segments) {
                const trimmed = segment.trim();
                if (this.isSizeAttribute(trimmed) && !size) {
                    size = this.parseSizeAttribute(trimmed);
                } else if (this.isAlignAttribute(trimmed) && !align) {
                    align = trimmed as AlignType;
                }
            }
        } else {
            // Wiki 风格：从后向前识别 size 和 align，剩余合并为 alt
            // 步骤1：从后向前识别 size (最多一个)
            for (let i = segments.length - 1; i >= 0; i--) {
                const trimmed = segments[i].trim();
                if (this.isSizeAttribute(trimmed)) {
                    size = this.parseSizeAttribute(trimmed);
                    segments.splice(i, 1);
                    break;
                }
            }

            // 步骤2：从后向前识别 align (最多一个)
            for (let i = segments.length - 1; i >= 0; i--) {
                const trimmed = segments[i].trim();
                if (this.isAlignAttribute(trimmed)) {
                    align = trimmed as AlignType;
                    segments.splice(i, 1);
                    break;
                }
            }

            // 步骤3：剩余片段合并
            if (segments.length > 0) {
                alt = segments.join('|');
            } else {
                alt = ' ';
            }
        }

        return { alt, align, size };
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

        // 匹配 x200 格式
        if (match[4]) {
            return {
                height: parseInt(match[4], 10),
                format: 'xH'
            };
        }

        const width = match[1] ? parseInt(match[1], 10) : undefined;
        const height = match[3] ? parseInt(match[3], 10) : undefined;

        if (width && height) {
            return { width, height, format: 'WxH' };
        } else if (width && match[2]) {
            // 300x 格式
            return { width, format: 'Wx' };
        } else if (width) {
            // 300 格式
            return { width, format: 'W' };
        }

        return undefined;
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
            case 'Wx':
                return `${size.width}x`;
            case 'xH':
                return `x${size.height}`;
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
