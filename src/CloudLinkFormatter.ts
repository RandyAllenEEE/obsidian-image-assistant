import type { CloudUploadSettings } from "./ImageConverterSettings";

/**
 * CloudLinkFormatter - 处理图床链接的格式化
 * 
 * 职责:
 * 1. 根据图床配置生成 Markdown 格式链接
 * 2. 支持在链接中添加尺寸标记 (|WxH)
 * 3. Alt 文本固定为空格,以配合题注功能
 */
export class CloudLinkFormatter {
    /**
     * 生成图床链接
     * @param url 图床返回的 URL
     * @param settings 图床配置
     * @returns 格式化后的 Markdown 链接
     */
    static formatCloudLink(url: string, settings: CloudUploadSettings): string {
        // Alt 固定为空格,用于题注功能
        let alt = " ";
        
        // 根据配置生成尺寸标记
        const sizeParam = this.generateSizeParameter(settings);
        
        // 如果有尺寸标记,添加到 alt 后面
        if (sizeParam) {
            alt += sizeParam;
        }
        
        // 生成 Markdown 格式链接: ![alt](url)
        return `![${alt}](${url})`;
    }

    /**
     * 根据配置生成尺寸参数
     * @param settings 图床配置
     * @returns 尺寸参数字符串,如 "|300x200" 或空字符串
     */
    private static generateSizeParameter(settings: CloudUploadSettings): string {
        const { imageSizeWidth, imageSizeHeight } = settings;
        
        // 如果两者都未配置,返回空字符串
        if (imageSizeWidth === undefined && imageSizeHeight === undefined) {
            return "";
        }
        
        // 如果都配置了,返回 |WxH
        if (imageSizeWidth !== undefined && imageSizeHeight !== undefined) {
            return `|${imageSizeWidth}x${imageSizeHeight}`;
        }
        
        // 只配置了宽度,返回 |Wx
        if (imageSizeWidth !== undefined) {
            return `|${imageSizeWidth}x`;
        }
        
        // 只配置了高度,返回 |xH
        if (imageSizeHeight !== undefined) {
            return `|x${imageSizeHeight}`;
        }
        
        return "";
    }

    /**
     * 批量生成图床链接
     * @param urls 图床 URL 列表
     * @param settings 图床配置
     * @returns Markdown 链接数组
     */
    static formatCloudLinks(urls: string[], settings: CloudUploadSettings): string[] {
        return urls.map(url => this.formatCloudLink(url, settings));
    }
}
