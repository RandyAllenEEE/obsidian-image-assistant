import type { CloudUploadSettings } from "../settings/ImageAssistantSettings";

/**
 * CloudLinkFormatter - 处理图床链接的格式化
 * 
 * 职责:
 * 1. 根据图床配置生成 Markdown 格式链接
 * 2. 支持在链接中添加尺寸标记 (|WxH)
 * 3. 优先保留原始链接的题注和尺寸
 * 4. Alt 文本默认为空格(如果原始链接没有题注),以配合题注功能
 */
export class CloudLinkFormatter {
    /**
     * 生成图床链接
     * @param cloudUrl 图床返回的 URL (可能是纯 URL 也可能是 Markdown 链接)
     * @param settings 图床配置
     * @param originalLink 原始链接文本 (可选,用于提取题注和尺寸)
     * @returns 格式化后的 Markdown 链接
     */
    static formatCloudLink(cloudUrl: string, settings: CloudUploadSettings, originalLink?: string): string {
        // 1. 确保获取纯 URL (防止重复包裹)
        const rawUrl = this.extractUrlFromMarkdown(cloudUrl);

        // 2. 提取原始链接的题注和尺寸信息
        const metadata = originalLink ? this.parseOriginalLink(originalLink) : null;
        
        let alt = "";
        let sizeParam = "";

        // 3. 处理题注 (Alt Text)
        if (metadata && metadata.alt) {
            alt = metadata.alt;
        } else {
            // 如果没有原始题注，使用空格(配合题注插件)
            alt = " ";
        }

        // 4. 处理尺寸参数
        if (metadata && metadata.size) {
            // 优先使用原始链接中的尺寸
            sizeParam = `|${metadata.size}`;
        } else {
            // 否则使用全局设置
            sizeParam = this.generateSizeParameter(settings);
        }

        // 5. 组装最终的 Alt 部分
        let finalAlt = alt;
        // 如果有尺寸参数，且 Alt 末尾不是该尺寸参数(防止重复)，则追加
        // 注意：metadata.alt 应该是不包含尺寸部分的纯文本
        if (sizeParam) {
            finalAlt += sizeParam;
        }
        
        // 6. 生成 Markdown 格式链接: ![alt](url)
        return `![${finalAlt}](${rawUrl})`;
    }

    /**
     * 从可能被包裹的 Markdown 链接中提取纯 URL
     * 例如: "![alt](http://example.com/img.png)" -> "http://example.com/img.png"
     */
    private static extractUrlFromMarkdown(text: string): string {
        // 匹配 Markdown 链接的 URL 部分
        // 简单匹配 () 中的内容
        const markdownRegex = /!\[.*?\]\((.*?)\)/;
        const match = text.match(markdownRegex);
        if (match && match[1]) {
            // 递归清理，防止多重包裹
            return this.extractUrlFromMarkdown(match[1].split(' ')[0]); // split(' ')[0] 去除可能的 title
        }
        // 如果不是 Markdown 链接，假设也是纯 URL
        return text;
    }

    /**
     * 解析原始链接，提取题注和尺寸
     * 支持格式:
     * - ![caption|size](path)
     * - ![[path|caption|size]] (Wiki Links)
     */
    private static parseOriginalLink(link: string): { alt: string, size: string | null } | null {
        try {
            // 1. 处理 Markdown 链接: ![alt](url)
            const mdMatch = link.match(/!\[(.*?)\]\(.*?\)/);
            if (mdMatch) {
                const fullAlt = mdMatch[1];
                return this.parseAltText(fullAlt);
            }

            // 2. 处理 Wiki 链接: ![[path|alt]]
            const wikiMatch = link.match(/!\[\[(.*?)\]\]/);
            if (wikiMatch) {
                const content = wikiMatch[1];
                const parts = content.split('|');
                // Wiki 链接第一部分是路径
                if (parts.length > 1) {
                    // 取最后一部分作为 potential size or alt
                    // 这种简单的分割可能不够，通常 Wiki 链接是 path|alt text
                    // 而 alt text 内部可能包含 |size
                    // 让我们假设 | 分隔的最后一部分可能是尺寸，如果符合尺寸格式
                    
                    // 重新策略: 把 | 后的所有内容当作 Alt 处理
                    const altPart = parts.slice(1).join('|');
                     return this.parseAltText(altPart);
                }
                return { alt: "", size: null };
            }

            return null;
        } catch (error) {
            console.error("Error parsing original link:", error);
            return null;
        }
    }

    /**
     * 解析 Alt 文本，分离纯文本和尺寸参数
     * 例如: "caption|300" -> { alt: "caption", size: "300" }
     */
    private static parseAltText(fullAlt: string): { alt: string, size: string | null } {
        // 匹配末尾的尺寸参数
        // 支持: |100, |x100, |100x100
        const sizeRegex = /\|(\d+(?:x\d+)?|x\d+)$/;
        const match = fullAlt.match(sizeRegex);

        if (match) {
            const size = match[1];
            // 移除尺寸部分的 alt
            const alt = fullAlt.replace(sizeRegex, '');
            return { alt, size };
        }

        return { alt: fullAlt, size: null };
    }

    /**
     * 根据配置生成尺寸参数
     * @param settings 图床配置
     * @returns 尺寸参数字符串,如 "|300x200"、"|500"、"|x300" 或空字符串
     */
    private static generateSizeParameter(settings: CloudUploadSettings): string {
        const { imageSizeWidth, imageSizeHeight } = settings;
        
        // 检查是否有有效的宽度值
        const hasWidth = imageSizeWidth !== undefined && imageSizeWidth !== null;
        // 检查是否有有效的高度值
        const hasHeight = imageSizeHeight !== undefined && imageSizeHeight !== null;
        
        // 如果两者都没有配置,返回空字符串(不添加尺寸参数)
        if (!hasWidth && !hasHeight) {
            return "";
        }
        
        // 如果都配置了,返回 |WxH
        if (hasWidth && hasHeight) {
            return `|${imageSizeWidth}x${imageSizeHeight}`;
        }
        
        // 只配置了宽度,返回 |W
        if (hasWidth) {
            return `|${imageSizeWidth}`;
        }
        
        // 只配置了高度,返回 |xH
        return `|x${imageSizeHeight}`;
    }

    /**
     * 批量生成图床链接 (已弃用，建议单独调用以保留原始信息)
     */
    static formatCloudLinks(urls: string[], settings: CloudUploadSettings): string[] {
        return urls.map(url => this.formatCloudLink(url, settings));
    }
}
