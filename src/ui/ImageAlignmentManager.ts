import { App, Menu, TFile, EventRef, MarkdownView } from 'obsidian';
import { ImageAlignment, ImageAlignmentOptions } from './ImageAlignment';
import ImageConverterPlugin from '../main';
import { SupportedImageFormats } from '../local/SupportedImageFormats';
import { PipeSyntaxParser } from '../utils/PipeSyntaxParser';
import { RefinedImageUtils } from '../utils/RefinedImageUtils';

export interface ImagePositionData {
    position: 'left' | 'center' | 'right' | 'none';
    width?: string;
    height?: string;
    wrap: boolean;
}

export class ImageAlignmentManager {
    private imageAlignment: ImageAlignment; // Instance of the new class
    private pipeSyntaxParser: PipeSyntaxParser;
    private refinedImageUtils: RefinedImageUtils;
    private imageObserver: MutationObserver | null = null;
    private imageStates: Map<string, ImageAlignmentOptions> = new Map();
    private eventRefs: EventRef[] = [];

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private supportedImageFormats: SupportedImageFormats,
    ) {
        this.imageAlignment = new ImageAlignment(this.app, this.plugin, this);
        this.pipeSyntaxParser = new PipeSyntaxParser();
        this.refinedImageUtils = new RefinedImageUtils(this.app);
    }

    public async initialize() {
        this.registerEvents();
        this.setupImageObserver();
    }

    // Simple method for imageAlignment instance
    addAlignmentOptionsToContextMenu(menu: Menu, img: HTMLImageElement, file: TFile) {
        this.imageAlignment.addAlignmentOptionsToContextMenu(menu, img, file);
    }

    private registerEvents() {
        // 保留必要的事件监听,但移除缓存相关操作
        // 当前不需要监听文件删除/重命名,因为不再维护缓存
    }

    setupImageObserver() {
        if (this.imageObserver) {
            this.imageObserver.disconnect();
        }

        this.imageObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node instanceof HTMLImageElement) {
                            this.processImageElement(node);
                        } else if (node instanceof Element) {
                            node.findAll('img').forEach((img) =>
                                this.processImageElement(img as HTMLImageElement)
                            );
                        }
                    });
                }
            });
        });

        // 获取当前活动的 Markdown 视图
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!markdownView) return;

        // 仅观察编辑器内容元素
        this.imageObserver.observe(markdownView.contentEl, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'class']
        });
    }

    // 辅助方法：检查图片是否在编辑器中
    private isImageInEditor(img: HTMLImageElement): boolean {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!markdownView) return false;

        const editorElement = markdownView.contentEl;
        return editorElement.contains(img);
    }

    // 辅助方法：获取图片链接的原始文本
    private getImageLinkText(img: HTMLImageElement, file: TFile): string | null {
        return this.refinedImageUtils.getImageLinkText(img, file);
    }

    // 辅助方法：将 align 值映射到 position
    private mapAlignToPosition(align: string): 'left' | 'center' | 'right' | 'none' {
        if (align.includes('left')) return 'left';
        if (align.includes('center')) return 'center';
        if (align.includes('right')) return 'right';
        return 'none';
    }

    public cleanupObserver() {
        if (this.imageObserver) {
            this.imageObserver.disconnect();
            this.imageObserver = null;
        }
    }

    /**
     * 刷新当前视图中所有图片的对齐样式
     * 用于设置变更后或文件切换时重新应用样式
     */
    public refreshAllImages() {
        // 重新设置 Observer,会自动处理现有的所有图片
        this.setupImageObserver();

        // 手动处理当前视图中的所有图片
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!markdownView) return;

        const images = markdownView.contentEl.findAll('img');
        images.forEach((img) => {
            if (img instanceof HTMLImageElement) {
                this.processImageElement(img);
            }
        });
    }

    /**
     * 处理单个图片元素（提取为方法以便复用）
     */
    private processImageElement(img: HTMLImageElement) {
        // 跳过非编辑器中的图片
        if (!this.isImageInEditor(img)) return;

        const src = img.getAttr('src');
        if (!src) return;

        // 获取当前文件
        const currentFile = this.app.workspace.getActiveFile();
        if (!currentFile) return;

        // 获取图片链接的原始 Markdown 文本
        const linkText = this.getImageLinkText(img, currentFile);
        if (!linkText) return;

        // 使用 PipeSyntaxParser 解析
        const pipeSyntaxData = this.pipeSyntaxParser.parsePipeSyntax(linkText);

        // 确定要应用的对齐方式
        let alignToApply = pipeSyntaxData?.align;

        // 如果没有 align 属性，使用全局默认对齐
        if (!alignToApply) {
            alignToApply = this.plugin.settings.defaultImageAlignment;
        }

        // 应用对齐样式
        if (alignToApply) {
            const positionData: ImagePositionData = {
                position: this.mapAlignToPosition(alignToApply),
                wrap: alignToApply.includes('wrap'),
                width: pipeSyntaxData?.size?.width?.toString(),
                height: pipeSyntaxData?.size?.height?.toString()
            };
            this.imageAlignment.applyAlignmentToImage(img, positionData);
        }
    }

    onunload() {
        // 断开 MutationObserver
        this.cleanupObserver();

        // 取消注册所有事件
        this.eventRefs.forEach(eventRef => this.app.workspace.offref(eventRef));
        this.eventRefs = [];

        // 清理 imageAlignment 组件
        if (this.imageAlignment) {
            this.imageAlignment.onunload();
        }

        // 清理其他引用
        this.imageObserver = null;
        this.imageStates.clear();
    }
}