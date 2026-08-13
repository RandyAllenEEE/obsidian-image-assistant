import type { CloudUploadSettings } from "../settings/types";
import { ImageLinkPathReplacer } from "../utils/ImageLinkPathReplacer";
import {
    pipeSyntaxParser,
    type PipeSyntaxData,
    type SizeData
} from "../utils/PipeSyntaxParser";
import { resolveCanonicalImageSize } from "../utils/CanonicalImageSize";

/**
 * CloudLinkFormatter - 处理图床链接的格式化
 * 
 * 职责:
 * 1. 根据图床配置生成 Markdown 格式链接
 * 2. 支持在链接中添加尺寸标记 (|WxH)
 * 3. 优先保留原始链接的题注和尺寸
 * 4. 无原始题注时生成标准空 alt
 */
export class CloudLinkFormatter {
    /**
     * 生成图床链接
     * @param cloudUrl 图床返回的 URL (可能是纯 URL 也可能是 Markdown 链接)
     * @param settings 图床配置
     * @param originalLink 原始链接文本 (可选,用于提取题注和尺寸)
     * @returns 格式化后的 Markdown 链接
     */
    static formatCloudLink(
        cloudUrl: string,
        settings: CloudUploadSettings,
        originalLink?: string,
        resolvedSize?: SizeData
    ): string {
        // 1. 确保获取纯 URL (防止重复包裹)
        const rawUrl = this.extractUrlFromMarkdown(cloudUrl);

        // 2. Parse attributes through the same strict W/WxH grammar used by
        // local links. An existing canonical size wins over cloud defaults.
        const original = originalLink
            ? pipeSyntaxParser.parsePipeSyntax(originalLink)
            : null;
        const data: PipeSyntaxData = {
            path: rawUrl,
            alt: original?.alt ?? " ",
            align: original?.align ?? null,
            size: original?.size ?? resolvedSize ?? this.generateSize(settings),
            linkType: settings.cloudLinkFormat === "wikilink"
                ? "wiki"
                : "markdown"
        };
        return pipeSyntaxParser.buildPipeSyntax(data);
    }

    /**
     * 从可能被包裹的 Markdown 链接中提取纯 URL
     * 例如: "![alt](http://example.com/img.png)" -> "http://example.com/img.png"
     */
    private static extractUrlFromMarkdown(text: string): string {
        return ImageLinkPathReplacer.extractPureUrlFromPossibleMarkdown(text);
    }

    /**
     * 根据配置生成尺寸参数
     * @param settings 图床配置
     * @returns 严格的 W 或 WxH 尺寸数据；缺少宽度时不输出尺寸
     */
    private static generateSize(settings: CloudUploadSettings): SizeData | undefined {
        if (settings.imageSizeSource !== "settings") return undefined;

        return resolveCanonicalImageSize({
            width: settings.imageSizeWidth,
            height: settings.imageSizeHeight
        });
    }

    /**
     * 批量生成图床链接 (已弃用，建议单独调用以保留原始信息)
     */
    static formatCloudLinks(urls: string[], settings: CloudUploadSettings): string[] {
        return urls.map(url => this.formatCloudLink(url, settings));
    }
}
