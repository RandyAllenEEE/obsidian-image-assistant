import { App, Component, Menu, TFile, MarkdownView } from 'obsidian';
import ImageConverterPlugin from '../main';
import { ImageAlignmentManager, ImagePositionData } from './ImageAlignmentManager';
import { t } from '../lang/helpers';
import { pipeSyntaxParser, AlignType } from '../utils/PipeSyntaxParser';
import { RefinedImageUtils } from '../utils/RefinedImageUtils';

export interface ImageAlignmentOptions {
    align: 'left' | 'center' | 'right' | 'none';
    wrap: boolean;
}

export class ImageAlignment extends Component {
    private refinedImageUtils: RefinedImageUtils;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
        private imageAlignmentManager: ImageAlignmentManager
    ) {
        super();
        this.refinedImageUtils = new RefinedImageUtils(this.app);
    }

    /**
     * Adds image alignment options to the context menu.
     * @param menu - The context menu instance.
     * @param img - The target image element.
     * @param activeFile - The currently active file.
     */
    addAlignmentOptionsToContextMenu(menu: Menu, img: HTMLImageElement, activeFile: TFile) {
        menu.addItem((item) => {
            item
                .setTitle(t("MENU_ALIGN_IMAGE"))
                .setIcon('align-justify')
                .setSubmenu()
                .addItem((subItem) => {
                    const currentAlignment = this.getCurrentImageAlignment(img);
                    subItem
                        .setTitle(t("ALIGN_LEFT"))
                        .setIcon('align-left')
                        .setChecked(currentAlignment.align === 'left')
                        .onClick(async () => {
                            await this.updateImageAlignment(img, { align: currentAlignment.align === 'left' ? 'none' : 'left', wrap: currentAlignment.wrap });
                        });
                })
                .addItem((subItem) => {
                    const currentAlignment = this.getCurrentImageAlignment(img);
                    subItem
                        .setTitle(t("ALIGN_CENTER"))
                        .setIcon('align-center')
                        .setChecked(currentAlignment.align === 'center')
                        .onClick(async () => {
                            await this.updateImageAlignment(img, { align: currentAlignment.align === 'center' ? 'none' : 'center', wrap: currentAlignment.wrap });
                        });
                })
                .addItem((subItem) => {
                    const currentAlignment = this.getCurrentImageAlignment(img);
                    subItem
                        .setTitle(t("ALIGN_RIGHT"))
                        .setIcon('align-right')
                        .setChecked(currentAlignment.align === 'right')
                        .onClick(async () => {
                            await this.updateImageAlignment(img, { align: currentAlignment.align === 'right' ? 'none' : 'right', wrap: currentAlignment.wrap });
                        });
                });

            // 仅在左/右对齐时显示文字环绕选项
            const currentAlignment = this.getCurrentImageAlignment(img);
            if (currentAlignment.align === 'left' || currentAlignment.align === 'right') {
                item
                    .addSeparator()
                    .addItem((subItem) => {
                        subItem
                            .setTitle(t("ALIGN_WRAP"))
                            .setChecked(currentAlignment.wrap)
                            .onClick(async () => {
                                await this.updateImageAlignment(img, {
                                    align: currentAlignment.align,
                                    wrap: !currentAlignment.wrap
                                });
                            });
                    });
            }
        });
    }

    /**
     * Applies alignment styles to an image based on cached data. THIS is called from ImageAlignmentManager!
     * @param img - The target image element.
     * @param positionData - The cached alignment data.
     */
    public applyAlignmentToImage(img: HTMLImageElement, positionData: ImagePositionData) {
        if (!positionData) {
            console.error("No position data provided for image:", img.src);
            return;
        }

        // Always apply alignment, do not skip based on current alignment
        // Parent embed handling
        const parentEmbed = img.matchParent('.internal-embed.image-embed'); // Use matchParent
        if (parentEmbed) {
            // Remove each class token individually to match DOMTokenList semantics
            parentEmbed.removeClass('image-position-left');
            parentEmbed.removeClass('image-position-center');
            parentEmbed.removeClass('image-position-right');
            parentEmbed.removeClass('image-wrap');
            parentEmbed.removeClass('image-no-wrap');
            parentEmbed.removeClass('image-converter-aligned');

            if (positionData.position !== 'none') {
                parentEmbed.addClass(`image-position-${positionData.position}`);
                parentEmbed.addClass('image-converter-aligned');
                parentEmbed.addClass(positionData.wrap ? 'image-wrap' : 'image-no-wrap');
            }
        }

        // Remove existing alignment classes first
        img.removeClass('image-position-left');
        img.removeClass('image-position-center');
        img.removeClass('image-position-right');
        img.removeClass('image-wrap');
        img.removeClass('image-no-wrap');
        img.removeClass('image-converter-aligned');

        // Re-apply alignment unconditionally
        if (positionData.position !== 'none') {
            img.addClass('image-converter-aligned');
            img.addClass(`image-position-${positionData.position}`);
            img.addClass(positionData.wrap ? 'image-wrap' : 'image-no-wrap');

            // Ensure width is applied
            if (positionData.width) {
                img.setCssStyles({ width: positionData.width });
            }
            if (positionData.height) {
                img.setCssStyles({ height: positionData.height });
            }

            // console.log("Alignment applied. New classes:", img.className);
        }

    }

    /**
     * Updates the alignment of an image via contextmenu
     * @param img - The target image element.
     * @param options - The alignment options.
     */
    async updateImageAlignment(img: HTMLImageElement, options: ImageAlignmentOptions) {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return;

        const src = img.getAttribute('src');
        if (!src) return;

        // 获取当前编辑器视图
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!markdownView) {
            // 如果无法获取编辑器，仅更新 DOM
            this.applyAlignmentVisualChanges(img, options);
            return;
        }

        const editor = markdownView.editor;
        if (!editor) {
            this.applyAlignmentVisualChanges(img, options);
            return;
        }

        // 尝试获取图片链接文本
        const linkText = this.refinedImageUtils.getImageLinkTextFromEditor(img, editor);
        if (!linkText) {
            // 如果无法获取链接文本，仅更新 DOM
            this.applyAlignmentVisualChanges(img, options);
            return;
        }

        // 使用 PipeSyntaxParser 解析链接
        const parsed = pipeSyntaxParser.parsePipeSyntax(linkText);
        if (!parsed) {
            // 解析失败，仅更新 DOM
            this.applyAlignmentVisualChanges(img, options);
            return;
        }

        // 更新 align 属性
        let newAlign: AlignType = null;
        if (options.align !== 'none') {
            newAlign = options.wrap ? `${options.align}-wrap` as AlignType : options.align as AlignType;
        }
        parsed.align = newAlign;

        // 构建新链接
        const newLinkText = pipeSyntaxParser.buildPipeSyntax(parsed);

        // 在编辑器中查找并替换链接
        const lineNumber = this.refinedImageUtils.findLinkLineNumber(editor, linkText);
        if (lineNumber !== -1) {
            const line = editor.getLine(lineNumber);
            const newLine = line.replace(linkText, newLinkText);
            editor.setLine(lineNumber, newLine);
        }

        // 立即更新 DOM（不等待 MutationObserver）
        this.applyAlignmentVisualChanges(img, options);

        // 标记为已处理，避免 MutationObserver 重复处理
        img.setAttribute('data-alignment-processed', 'true');
    }

    /**
     * 应用对齐的视觉变化到 DOM
     * @param img - The target image element.
     * @param options - The alignment options.
     */
    private applyAlignmentVisualChanges(img: HTMLImageElement, options: ImageAlignmentOptions) {
        // --- Apply Visual Changes to IMG ---
        img.removeClass('image-position-left');
        img.removeClass('image-position-center');
        img.removeClass('image-position-right');
        img.removeClass('image-wrap');
        img.removeClass('image-no-wrap');
        img.removeClass('image-converter-aligned');
        if (options.align !== 'none') {
            img.addClass(`image-position-${options.align}`);
            img.addClass('image-converter-aligned');
            img.addClass(options.wrap ? 'image-wrap' : 'image-no-wrap');
        }

        // --- Apply Visual Changes to PARENT SPAN ---
        const parentEmbed = img.matchParent('.internal-embed.image-embed');
        if (parentEmbed) {
            parentEmbed.removeClass('image-position-left');
            parentEmbed.removeClass('image-position-center');
            parentEmbed.removeClass('image-position-right');
            parentEmbed.removeClass('image-wrap');
            parentEmbed.removeClass('image-no-wrap');
            parentEmbed.removeClass('image-converter-aligned');
            if (options.align !== 'none') {
                parentEmbed.addClass(`image-position-${options.align}`);
                parentEmbed.addClass(options.wrap ? 'image-wrap' : 'image-no-wrap');
            }
        }
    }



    /**
     * Gets the current alignment of an image. 从 CSS 类检测对齐信息（不再使用缓存）
     * @param img - The target image element.
     * @returns The current alignment options.
     */
    public getCurrentImageAlignment(img: HTMLImageElement): ImageAlignmentOptions {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return { align: 'none', wrap: false };

        const src = img.getAttr('src'); // Use getAttr instead of getAttribute
        if (!src) return { align: 'none', wrap: false };

        // 注：由于我们不再使用缓存，直接从 CSS 类检测
        /* 
        // First, try to get alignment from cache
        const cachedAlignment = this.imageAlignmentManager.getImageAlignment(
            activeFile.path,
            src
        );

        if (cachedAlignment) {
            return {
                align: cachedAlignment.position,
                wrap: cachedAlignment.wrap
            };
        }
        */

        // Fallback to CSS class detection
        const alignClass = Array.from(img.classList).find(className => className.startsWith('image-position-'));
        const align = alignClass
            ? (alignClass.replace('image-position-', '') as 'left' | 'center' | 'right')
            : 'none';
        const wrap = img.hasClass('image-wrap'); // Use hasClass instead of classList.contains
        return { align, wrap };
    }

}