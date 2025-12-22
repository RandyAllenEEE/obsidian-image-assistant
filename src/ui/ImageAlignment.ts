import { App, Component, Menu, TFile, MarkdownView } from 'obsidian';
import ImageConverterPlugin from '../main';
import { t } from '../lang/helpers';
import { pipeSyntaxParser, AlignType } from '../utils/PipeSyntaxParser';
import { RefinedImageUtils } from '../utils/RefinedImageUtils';

export interface ImageAlignmentOptions {
    align: 'left' | 'center' | 'right' | 'none';
    wrap: boolean;
}

export interface ImagePositionData {
    position: 'left' | 'center' | 'right' | 'none';
    wrap: boolean;
    width?: string;
    height?: string;
}

export class ImageAlignment extends Component {
    private refinedImageUtils: RefinedImageUtils;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
    ) {
        super();
        this.refinedImageUtils = new RefinedImageUtils(this.app);
    }

    // Context menu registration moved to ContextMenu.ts

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

        // Idempotency check: Check if image already has the correct classes
        const currentAlignClass = Array.from(img.classList).find(c => c.startsWith('image-position-'));
        const currentAlign = currentAlignClass ? currentAlignClass.replace('image-position-', '') : 'none';
        const currentWrap = img.hasClass('image-wrap');
        const hasAlignedClass = img.hasClass('image-converter-aligned');

        // Check if width/height styles match (if provided)
        const currentWidth = img.style.width;
        const currentHeight = img.style.height;

        // helper to normalize (strip px)
        const normalize = (val: string | undefined | null) => val ? val.replace('px', '') : '';

        const widthMatch = !positionData.width || normalize(currentWidth) === normalize(positionData.width);
        const heightMatch = !positionData.height || normalize(currentHeight) === normalize(positionData.height);

        if (currentAlign === positionData.position &&
            currentWrap === positionData.wrap &&
            hasAlignedClass === (positionData.position !== 'none') &&
            widthMatch &&
            heightMatch) {
            return; // No changes needed
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
                // Ensure we set with px if missing, or however browser prefers.
                // Ideally StateManager sends numbers or string with unit.
                // If string has no unit, browser might ignore it if we don't add px.
                // Best practice: if it looks like a number, add px.
                const w = positionData.width;
                img.style.width = /^\d+$/.test(w) ? `${w}px` : w;
            }
            if (positionData.height) {
                const h = positionData.height;
                img.style.height = /^\d+$/.test(h) ? `${h}px` : h;
            }

            // console.log("Alignment applied. New classes:", img.className);
        }

    }



    /**
     * Ensures proper layout for Reading Mode images (specifically Local Markdown links).
     * Prevents them from rendering as block elements if alignment is requested.
     */
    public ensureReadingModeLayout(img: HTMLImageElement, position: string) {
        // Only target images that are NOT internal embeds (Obsidian handles those well)
        if (img.closest('.internal-embed')) return;

        // If alignment is requested, force inline-block to allow side-by-side
        if (position !== 'none') {
            img.style.display = 'inline-block';

            // Check parent: if it's a P or DIV with only this image, we might need to adjust it
            // ensuring it doesn't force a break. But often inline-block on img is enough 
            // if the parent P allows flow. 
            // For now, minimal intervention: just fix the img.
        }
    }

    // updateImageAlignment removed - handled by ImageStateManager

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