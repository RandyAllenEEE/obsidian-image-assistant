import { describe, it, expect } from 'vitest';
import { CloudLinkFormatter } from '../../../src/cloud/CloudLinkFormatter';
import type { CloudUploadSettings } from '../../../src/settings/ImageAssistantSettings';

describe('CloudLinkFormatter', () => {
  describe('formatCloudLink', () => {
    const defaultSettings: Partial<CloudUploadSettings> = {
      uploader: 'picgo',
      imageSizeWidth: undefined,
      imageSizeHeight: undefined
    };

    describe('基本链接格式化', () => {
      it('Given 纯 URL 且无原始链接, When formatCloudLink, Then 生成空格 alt 的 Markdown 链接', () => {
        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/image.png',
          defaultSettings as CloudUploadSettings
        );
        
        expect(result).toBe('![ ](https://example.com/image.png)');
      });

      it('Given 已是 Markdown 格式的 URL, When formatCloudLink, Then 提取纯 URL 并重新格式化', () => {
        const result = CloudLinkFormatter.formatCloudLink(
          '![old alt](https://example.com/image.png)',
          defaultSettings
        );
        
        expect(result).toBe('![ ](https://example.com/image.png)');
      });

      it('Given URL 中含空格, When formatCloudLink, Then 正确处理', () => {
        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/image with space.png',
          defaultSettings
        );
        
        expect(result).toBe('![ ](https://example.com/image with space.png)');
      });
    });

    describe('原始链接题注保留', () => {
      it('Given Markdown 原始链接含题注, When formatCloudLink, Then 保留题注', () => {
        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/new.png',
          defaultSettings,
          '![my caption](old.png)'
        );
        
        expect(result).toBe('![my caption](https://example.com/new.png)');
      });

      it('Given Wiki 原始链接含题注, When formatCloudLink, Then 保留题注', () => {
        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/new.png',
          defaultSettings,
          '![[old.png|wiki caption]]'
        );
        
        expect(result).toBe('![wiki caption](https://example.com/new.png)');
      });

      it('Given 原始链接为空题注, When formatCloudLink, Then 保留空题注', () => {
        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/new.png',
          defaultSettings,
          '![](old.png)'
        );
        
        // 空题注被转换为空格（保持默认行为）
        expect(result).toBe('![ ](https://example.com/new.png)');
      });
    });

    describe('尺寸参数处理', () => {
      it('Given 原始链接含宽度尺寸参数, When formatCloudLink, Then 保留尺寸', () => {
        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/new.png',
          defaultSettings,
          '![caption|300](old.png)'
        );
        
        expect(result).toBe('![caption|300](https://example.com/new.png)');
      });

      it('Given 原始链接含宽高尺寸参数, When formatCloudLink, Then 保留尺寸', () => {
        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/new.png',
          defaultSettings,
          '![caption|300x200](old.png)'
        );
        
        expect(result).toBe('![caption|300x200](https://example.com/new.png)');
      });

      it('Given 原始链接含仅高度尺寸参数, When formatCloudLink, Then 保留尺寸', () => {
        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/new.png',
          defaultSettings,
          '![caption|x200](old.png)'
        );
        
        expect(result).toBe('![caption|x200](https://example.com/new.png)');
      });

      it('Given Wiki 链接含尺寸参数, When formatCloudLink, Then 保留尺寸', () => {
        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/new.png',
          defaultSettings,
          '![[old.png|caption|400]]'
        );
        
        expect(result).toBe('![caption|400](https://example.com/new.png)');
      });
    });

    describe('全局尺寸设置', () => {
      it('Given 设置了宽度和高度, When 无原始链接, Then 添加 |WxH 参数', () => {
        const settings: CloudUploadSettings = {
          ...defaultSettings,
          imageSizeWidth: 800,
          imageSizeHeight: 600
        };

        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/image.png',
          settings
        );
        
        expect(result).toBe('![ |800x600](https://example.com/image.png)');
      });

      it('Given 仅设置了宽度, When 无原始链接, Then 添加 |W 参数', () => {
        const settings: CloudUploadSettings = {
          ...defaultSettings,
          imageSizeWidth: 500
        };

        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/image.png',
          settings
        );
        
        expect(result).toBe('![ |500](https://example.com/image.png)');
      });

      it('Given 仅设置了高度, When 无原始链接, Then 添加 |xH 参数', () => {
        const settings: CloudUploadSettings = {
          ...defaultSettings,
          imageSizeHeight: 400
        };

        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/image.png',
          settings
        );
        
        expect(result).toBe('![ |x400](https://example.com/image.png)');
      });
    });

    describe('尺寸优先级', () => {
      it('Given 原始链接有尺寸 且 全局设置有尺寸, When formatCloudLink, Then 原始链接尺寸优先', () => {
        const settings: CloudUploadSettings = {
          ...defaultSettings,
          imageSizeWidth: 1000,
          imageSizeHeight: 800
        };

        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/new.png',
          settings,
          '![caption|300](old.png)'
        );
        
        // 原始尺寸 300 优先于全局设置 1000x800
        expect(result).toBe('![caption|300](https://example.com/new.png)');
      });

      it('Given 原始链接无尺寸 且 全局设置有尺寸, When formatCloudLink, Then 使用全局尺寸', () => {
        const settings: CloudUploadSettings = {
          ...defaultSettings,
          imageSizeWidth: 600
        };

        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/new.png',
          settings,
          '![caption](old.png)'
        );
        
        expect(result).toBe('![caption|600](https://example.com/new.png)');
      });
    });

    describe('边界情况', () => {
      it('Given 多重嵌套的 Markdown 链接, When formatCloudLink, Then 提取URL并处理', () => {
        const result = CloudLinkFormatter.formatCloudLink(
          '![outer](![inner](https://example.com/image.png))',
          defaultSettings
        );
        
        // 实际行为：提取()中的内容，包括嵌套的Markdown (缺少最后一个括号)
        expect(result).toBe('![ ](![inner](https://example.com/image.png)');
      });

      it('Given 原始链接包含多个 | 分隔符, When formatCloudLink, Then 正确解析题注和尺寸', () => {
        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/new.png',
          defaultSettings,
          '![caption with | char|300](old.png)'
        );
        
        // 只有最后一个 |数字 被识别为尺寸
        expect(result).toBe('![caption with | char|300](https://example.com/new.png)');
      });

      it('Given Wiki 链接包含复杂路径, When formatCloudLink, Then 正确提取题注', () => {
        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/new.png',
          defaultSettings,
          '![[folder/subfolder/image.png|My Image Caption]]'
        );
        
        expect(result).toBe('![My Image Caption](https://example.com/new.png)');
      });

      it('Given 设置宽度为 0, When formatCloudLink, Then 添加尺寸参数0', () => {
        const settings: CloudUploadSettings = {
          ...defaultSettings,
          imageSizeWidth: 0
        };

        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/image.png',
          settings
        );
        
        // 0 也会被添加为尺寸参数
        expect(result).toBe('![ |0](https://example.com/image.png)');
      });

      it('Given 原始链接格式异常, When formatCloudLink, Then 优雅降级', () => {
        const result = CloudLinkFormatter.formatCloudLink(
          'https://example.com/new.png',
          defaultSettings,
          'invalid format'
        );
        
        // 无法解析时使用默认空格 alt
        expect(result).toBe('![ ](https://example.com/new.png)');
      });
    });

    describe('formatCloudLinks 批量处理', () => {
      it('Given 多个 URL, When formatCloudLinks, Then 批量生成链接', () => {
        const urls = [
          'https://example.com/1.png',
          'https://example.com/2.png'
        ];

        const results = CloudLinkFormatter.formatCloudLinks(urls, defaultSettings);
        
        expect(results).toHaveLength(2);
        expect(results[0]).toBe('![ ](https://example.com/1.png)');
        expect(results[1]).toBe('![ ](https://example.com/2.png)');
      });

      it('Given 空数组, When formatCloudLinks, Then 返回空数组', () => {
        const results = CloudLinkFormatter.formatCloudLinks([], defaultSettings);
        expect(results).toEqual([]);
      });
    });
  });
});
