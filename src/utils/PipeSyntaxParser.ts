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
    REGEX_MD_LINK_VALIDATE
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
    linkType: 'wiki' | 'markdown';      // 链接类型
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
    public parsePipeSyntax(linkText: string): PipeSyntaxData | null {
        if (!linkText || linkText.trim() === '') {
            return null;
        }

        const trimmedLink = linkText.trim();

        // 判断链接类型
        if (trimmedLink.startsWith('![[')) {
            return this.parseWikiLink(trimmedLink);
        } else if (trimmedLink.startsWith('![')) {
            return this.parseMarkdownLink(trimmedLink);
        }

        return null;
    }

    /**
     * 解析 Wiki 格式链接：![[path|attr1|attr2|...]]
     * 从后向前识别 size 和 align，剩余片段合并为 alt
     */
    private parseWikiLink(linkText: string): PipeSyntaxData | null {
        const match = linkText.match(PipeSyntaxParser.WIKI_LINK_PATTERN);
        if (!match) {
            return null;
        }

        const content = match[1]; // path|attr1|attr2|...
        const parts = content.split('|');

        if (parts.length === 0) {
            return null;
        }

        // 第一个片段是路径
        const path = parts[0].trim();
        let segments = parts.slice(1); // 不要对片段 trim，保留原始空格

        let size: SizeData | undefined;
        let align: AlignType = null;
        let alt: string | undefined;

        // 步骤1：从后向前识别 size（最多一个）
        for (let i = segments.length - 1; i >= 0; i--) {
            if (this.isSizeAttribute(segments[i].trim())) {
                size = this.parseSizeAttribute(segments[i].trim());
                segments.splice(i, 1);
                break;
            }
        }

        // 步骤2：从后向前识别 align（最多一个）
        for (let i = segments.length - 1; i >= 0; i--) {
            if (this.isAlignAttribute(segments[i].trim())) {
                align = segments[i].trim() as AlignType;
                segments.splice(i, 1);
                break;
            }
        }

        // 步骤3：剩余所有片段用 | 连接作为 alt
        if (segments.length > 0) {
            alt = segments.join('|');
        } else {
            alt = ' '; // 缺省时为空格
        }

        return {
            path,
            alt,
            align,
            size,
            linkType: 'wiki'
        };
    }

    /**
     * 解析 Markdown 格式链接：![alt|attr1|attr2](path)
     * 首位是 alt（或缺省），后续识别 size 和 align
     */
    private parseMarkdownLink(linkText: string): PipeSyntaxData | null {
        const match = linkText.match(PipeSyntaxParser.MARKDOWN_LINK_PATTERN);
        if (!match) {
            return null;
        }

        const bracketContent = match[1]; // alt|attr1|attr2
        const path = match[2].trim();

        let alt: string | undefined;
        let size: SizeData | undefined;
        let align: AlignType = null;

        if (!bracketContent || bracketContent.trim() === '') {
            // 完全缺省：![](path)
            alt = ' ';
        } else {
            const parts = bracketContent.split('|');

            if (parts.length === 1 && parts[0].trim() === '') {
                // 单个 | 的情况：![|...](path)
                alt = ' ';
            } else if (parts[0].trim() === '') {
                // 首位是 |，说明 alt 缺省：![|attr1|attr2](path)
                alt = ' ';
                // 从第二个片段开始识别
                for (let i = 1; i < parts.length; i++) {
                    const segment = parts[i].trim();
                    if (this.isSizeAttribute(segment) && !size) {
                        size = this.parseSizeAttribute(segment);
                    } else if (this.isAlignAttribute(segment) && !align) {
                        align = segment as AlignType;
                    }
                }
            } else {
                // 首位不是 |，首个片段是 alt
                alt = parts[0];
                // 从第二个片段开始识别
                for (let i = 1; i < parts.length; i++) {
                    const segment = parts[i].trim();
                    if (this.isSizeAttribute(segment) && !size) {
                        size = this.parseSizeAttribute(segment);
                    } else if (this.isAlignAttribute(segment) && !align) {
                        align = segment as AlignType;
                    }
                }
            }
        }

        return {
            path,
            alt,
            align,
            size,
            linkType: 'markdown'
        };
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
        const parts: string[] = [data.path];

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
        return `![${bracketContent}](${data.path})`;
    }

    /**
     * Parse the alt text content to strip size and align attributes.
     * Effectively treats the input as the content inside ![...].
     * @param altText The raw alt text (e.g. "Title|100")
     */
    public parseAltText(altText: string): PipeSyntaxData {
        if (!altText || altText.trim() === '') {
            return { path: '', alt: ' ', linkType: 'markdown' };
        }

        // Truncate at the first pipe |
        const pipeIndex = altText.indexOf('|');
        let cleanAlt = (pipeIndex !== -1 ? altText.substring(0, pipeIndex) : altText).trim();

        // Robustness fallback: if empty/missing (e.g. "![|100]"), use a space
        if (cleanAlt === '') {
            cleanAlt = ' ';
        }

        return {
            path: '',
            alt: cleanAlt,
            linkType: 'markdown' // arbitrary
        };
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

        // 1. 匹配 Wiki 链接
        // 匹配 ![[...]]
        const wikiRegex = /!\[\[([^\]]+?)\]\]/g;
        let wikiMatch;
        while ((wikiMatch = wikiRegex.exec(text)) !== null) {
            const parsed = this.parseWikiLink(wikiMatch[0]);
            if (parsed) {
                results.push({
                    fullMatch: wikiMatch[0],
                    index: wikiMatch.index,
                    data: parsed
                });
            }
        }

        // 2. 匹配 Markdown 链接
        // 匹配 ![...](...)
        // 支持一层嵌套括号，例如 ![alt](url(1).png)
        const mdRegex = /!\[([^\]]*)\]\(((?:[^)(]+|\((?:[^)(]+|\([^)(]*\))*\))*)\)/g;
        let mdMatch;
        while ((mdMatch = mdRegex.exec(text)) !== null) {
            const parsed = this.parseMarkdownLink(mdMatch[0]);
            if (parsed) {
                results.push({
                    fullMatch: mdMatch[0],
                    index: mdMatch.index,
                    data: parsed
                });
            }
        }

        return results.sort((a, b) => a.index - b.index);
    }
}

// 导出单例实例
export const pipeSyntaxParser = new PipeSyntaxParser();
