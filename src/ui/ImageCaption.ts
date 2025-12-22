import { MarkdownView } from "obsidian"
import ImageConverterPlugin from '../main';
import { RefinedImageUtils } from '../utils/RefinedImageUtils';
import { pipeSyntaxParser } from '../utils/PipeSyntaxParser';

export class ImageCaption {
    private processing = false;
    private refinedImageUtils: RefinedImageUtils;

    constructor(private plugin: ImageConverterPlugin) {
        // console.error('DEBUG: ImageCaption Constructor Called');
        this.refinedImageUtils = new RefinedImageUtils(this.plugin.app);
        this.applyCaptionStyles();
        this.applyCaptionClass();
    }

    /**
     * Applies caption logic to a specific image element.
     * Called by ImageStateManager.
     */
    public applyCaption(img: HTMLImageElement, captionText: string | undefined) {
        // 1. Determine the "Effective Container" for the caption
        // Priority:
        // A. Resize Wrapper (Highest priority as it wraps the image visually on resize)
        // B. Internal Embed (Standard Obsidian local image)
        // C. External Embed / Existing Container (Markdown standard or already wrapped)

        let container = img.closest('.image-resize-container, .internal-embed, .external-embed, .external-image-container') as HTMLElement;

        if (!container) {
            // Fallback for bare network images: Create a dedicated wrapper
            // We MUST create a dedicated wrapper instead of hijacking the parent (like a <p>)
            // to avoid display:flex affecting broad text content.
            if (img.parentElement) {
                const wrapper = document.createElement('span');
                wrapper.addClass('external-image-container');
                img.parentNode?.insertBefore(wrapper, img);
                wrapper.appendChild(img);
                container = wrapper;
            } else {
                return;
            }
        }

        if (!container) return;

        // Sync alignment classes from image to container if it's our dedicated wrapper
        // This ensures the wrapper handles the float/block behavior instead of the inner image.
        if (container.hasClass('external-image-container') || container.hasClass('image-resize-container')) {
            const alignClasses = ['image-position-left', 'image-position-center', 'image-position-right', 'image-wrap', 'image-no-wrap', 'image-converter-aligned'];
            alignClasses.forEach(cls => {
                if (img.hasClass(cls)) {
                    container.addClass(cls);
                } else {
                    container.removeClass(cls);
                }
            });
        }

        const { enableImageCaptions, skipCaptionExtensions } = this.plugin.settings;
        if (!enableImageCaptions) return;

        // Get the actual width of the image
        const imgWidth = img.width || img.getAttribute('width');
        if (imgWidth) {
            container.style.setProperty('--img-width', `${imgWidth}px`);
        }

        const embedSrc = container.getAttribute('src') || img.getAttribute('src') || '';
        const extension = embedSrc.split('.').pop()?.split('?')[0]?.toLowerCase() || '';
        const excludedExtensions = skipCaptionExtensions.split(',').map(ext => ext.trim().toLowerCase());

        // Get raw alt text
        let rawAlt = captionText || img.getAttribute('alt') || '';

        // Clean alt text using parser
        const parsedState = pipeSyntaxParser.parseAltText(rawAlt);
        const cleanAlt = parsedState.alt || '';

        // Handle caption visibility
        if (excludedExtensions.includes(extension)) {
            container.removeAttribute('alt');
            img.removeAttribute('alt'); // Remove from img to prevent double tooltip if browser native
            return;
        }

        const isFilename = cleanAlt.trim().toLowerCase() === embedSrc.split('/').pop()?.split('?')[0]?.toLowerCase();

        if (cleanAlt === ' ' || isFilename) {
            // Set to space to ensure container is rendered but empty (avoiding native tooltips)
            if (container.getAttribute('alt') !== ' ') container.setAttribute('alt', ' ');
        } else {
            // Genuine caption
            if (container.getAttribute('alt') !== cleanAlt) {
                container.setAttribute('alt', cleanAlt);
            }
            if (img.getAttribute('alt') !== cleanAlt) {
                img.setAttribute('alt', cleanAlt);
            }
        }

        if (container.closest('.callout')) {
            container.setAttribute('data-in-callout', 'true');
        }
    }

    applyCaptionClass() {
        const { enableImageCaptions, skipCaptionExtensions } = this.plugin.settings;
        const excludedExtensions = skipCaptionExtensions.split(',').map(ext => ext.trim().toLowerCase());

        if (enableImageCaptions) {
            document.body.classList.add('image-captions-enabled');
            // Initial sweep logic could remain here or be handled by Manager's refreshAllImages
        } else {
            document.body.classList.remove('image-captions-enabled');
        }
    }

    applyCaptionStyles() {
        const styleId = 'image-caption-styles';
        let styleElement = document.getElementById(styleId) as HTMLStyleElement;

        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = styleId;
            document.head.appendChild(styleElement);
        }

        const {
            captionFontSize,
            captionColor,
            captionFontStyle,
            captionBackgroundColor,
            captionPadding,
            captionBorderRadius,
            captionMarginTop,
            captionOpacity,
            captionFontWeight,
            captionTextTransform,
            captionLetterSpacing,
            captionBorder,
            captionAlignment
        } = this.plugin.settings;

        styleElement.textContent = `
            /* Container styling (covers internal, external, and tagged containers) */
            .image-captions-enabled .internal-embed.image-embed[alt],
            .image-captions-enabled .external-embed[alt],
            .image-captions-enabled .external-image-container[alt],
            .image-captions-enabled .image-resize-container[alt] {
                display: flex !important;
                flex-direction: column;
                align-items: ${captionAlignment === 'center' ? 'center' :
                captionAlignment === 'left' ? 'flex-start' :
                    'flex-end'};
                justify-content: center;
                width: fit-content;
            }
        
            /* Caption styling */
            .image-captions-enabled .image-embed[alt]:after,
            .image-captions-enabled .external-embed[alt]:after,
            .image-captions-enabled .external-image-container[alt]:after,
            .image-captions-enabled .image-resize-container[alt]:after {
                display: block;
                width: var(--img-width);
                font-family: var(--font-interface);
                font-size: ${captionFontSize || 'var(--font-smaller)'};
                color: ${captionColor || 'var(--text-gray)'};
                background-color: ${captionBackgroundColor || 'transparent'};
                opacity: ${captionOpacity || '1'};
                content: attr(alt);
                margin-top: ${captionMarginTop || '4px'};
                padding: ${captionPadding || '2px 4px'};
                border-radius: ${captionBorderRadius || '0'};
                font-style: ${captionFontStyle || 'italic'};
                font-weight: ${captionFontWeight || 'normal'};
                text-transform: ${captionTextTransform || 'none'};
                letter-spacing: ${captionLetterSpacing || 'normal'};
                border: ${captionBorder || 'none'};
                text-align: ${captionAlignment || 'center'};
                transition: all 0.2s ease;
                box-sizing: border-box;
            }
        
            /* Image styling */
            .image-captions-enabled .image-embed[alt] img,
            .image-captions-enabled .external-embed[alt] img,
            .image-captions-enabled .external-image-container[alt] img,
            .image-captions-enabled .image-resize-container[alt] img {
                display: block;
                max-width: 100%;
                height: auto;
            }
        `;
    }

    public refresh() {
        // Manager handles refreshing images
        this.applyCaptionClass();
        this.applyCaptionStyles();
    }

    public updateStyles() {
        this.applyCaptionStyles();
    }

    public cleanup() {
        // Styles cleanup if needed
    }
}
