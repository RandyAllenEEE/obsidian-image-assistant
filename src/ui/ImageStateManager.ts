
import { App, MarkdownView, TFile, Notice } from 'obsidian';
import ImageConverterPlugin from '../main';
import { ImageAlignment, ImagePositionData } from './ImageAlignment';
import { ImageResizer } from './ImageResizer';
import { ImageCaption } from './ImageCaption';
import { pipeSyntaxParser, AlignType, PipeSyntaxData } from '../utils/PipeSyntaxParser';
import { RefinedImageUtils } from '../utils/RefinedImageUtils';
import { debounce } from 'obsidian';


export interface ImageState {
    align: 'left' | 'center' | 'right' | 'left-wrap' | 'right-wrap' | 'none';
    wrap: boolean;
    width?: number | null;
    height?: number | null;
    caption?: string;
}

export class ImageStateManager {
    private observer: MutationObserver | null = null;
    private refinedImageUtils: RefinedImageUtils;

    // Delegates
    public alignment: ImageAlignment;
    public resizer: ImageResizer | null;
    public caption: ImageCaption;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
    ) {
        this.refinedImageUtils = new RefinedImageUtils(this.app);

        // Initialize delegates
        // Dependencies are injected via initialize() to avoid circular references during plugin load.
    }

    public initialize(alignment: ImageAlignment, resizer: ImageResizer | null, caption: ImageCaption) {
        this.alignment = alignment;
        this.resizer = resizer;
        this.caption = caption;

        this.setupObserver();
    }

    private processingImages = new Set<HTMLImageElement>();

    private setupObserver() {
        if (this.observer) this.observer.disconnect();

        this.observer = new MutationObserver((mutations) => {
            // Check if we are already processing this specific image to prevent loops
            // Global lock is removed to allow parallel processing of different images

            mutations.forEach((mutation) => {
                if (mutation.type === 'childList') {
                    mutation.addedNodes.forEach((node) => {
                        if (node instanceof HTMLImageElement) {
                            this.processImage(node);
                        } else if (node instanceof Element) {
                            node.findAll('img').forEach((img) =>
                                this.processImage(img as HTMLImageElement)
                            );
                        }
                    });
                } else if (mutation.type === 'attributes' && mutation.target instanceof HTMLImageElement) {
                    const img = mutation.target as HTMLImageElement;
                    if (!this.processingImages.has(img) && !img.hasClass('is-resizing')) {
                        this.processImage(img);
                    }
                }
            });
        });

        // Observe active view
        this.startObserving();

        // Handle view switching
        this.plugin.registerEvent(
            this.app.workspace.on('active-leaf-change', () => {
                // Determine if we need a longer delay on startup
                // @ts-ignore
                if (!this.app.workspace.layoutReady) return;

                // Add a small delay to allow other plugins/Obsidian to settle state
                setTimeout(() => {
                    this.startObserving();
                    this.refreshAllImages();
                }, 200);
            })
        );
    }

    private startObserving() {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!markdownView || !this.observer) return;

        // Disconnect first to avoid duplicates
        this.observer.disconnect();

        this.observer.observe(markdownView.contentEl, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['src', 'class', 'alt'] // Watch specific attributes
        });
    }

    public refreshAllImages = debounce(() => {
        console.log('[ImageStateManager] refreshAllImages called');
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!markdownView) {
            console.log('[ImageStateManager] No markdown view found');
            return;
        }

        // Extra safety check for layout readiness
        // @ts-ignore
        if (this.app.workspace.layoutReady === false) return;

        const images = markdownView.contentEl.findAll('img');
        console.log('[ImageStateManager] Found', images.length, 'images to process');
        images.forEach((img) => {
            if (img instanceof HTMLImageElement) {
                this.processImage(img);
            }
        });
    }, 300, true);

    /**
     * Coordinator method: Gets state from markdown and calls delegates to apply it.
     */
    public processImage(img: HTMLImageElement) {
        if (this.processingImages.has(img)) return;

        // 1. Check for conflicts
        if (img.hasClass('is-resizing')) return;

        try {
            this.processingImages.add(img);

            // 2. Get State
            const state = this.getImageState(img);
            if (!state) return;

            // 2.5 Clean alt text immediately for all images
            if (state.caption) {
                const currentAlt = img.getAttribute('alt') || '';
                if (currentAlt !== state.caption && currentAlt.includes('|')) {
                    img.setAttribute('alt', state.caption);
                }
            }

            // 3. Delegate: Alignment
            // Extract base position and wrap from combined align value (e.g., 'left-wrap' -> 'left' + wrap=true)
            let alignPosition = state.align === 'none' ? this.plugin.settings.alignment.default : state.align;
            let wrap = state.wrap;

            // Handle combined values like 'left-wrap', 'right-wrap'
            if (alignPosition.includes('-wrap')) {
                alignPosition = alignPosition.replace('-wrap', '') as typeof alignPosition;
                wrap = true;
            }

            const positionData: any = {
                position: alignPosition,
                wrap: wrap,
                width: state.width?.toString(),
                height: state.height?.toString()
            };
            this.alignment.applyAlignmentToImage(img, positionData);

            // 4. Delegate: Size
            if ((state.width || state.height) && this.resizer) {
                this.resizer.applySize(img, state.width ?? undefined, state.height ?? undefined);
            }

            if (state.caption) {
                this.caption.applyCaption(img, state.caption);
            }
        } finally {
            // Short timeout to allow DOM updates to settle before re-enabling observer
            // This prevents immediate re-trigger by the very changes we just made
            setTimeout(() => {
                this.processingImages.delete(img);
            }, 0);
        }
    }

    /**
     * Specialized processor for Reading Mode (MarkdownPostProcessor).
     * Reads directly from parsed DOM attributes (alt text) instead of Editor lookup.
     */
    public processReadingModeImage(img: HTMLImageElement) {
        // 1. Check for conflicts
        if (img.hasClass('is-resizing')) return;

        // 2. Parse State from Alt Text (Source of Truth in Reading Mode)
        const altText = img.getAttribute('alt') || '';

        // Obsidian's Reading Mode 'alt' attribute varies based on link type:
        // Wiki: ![[img.png|left|100]] -> alt="100" (Wait, actually it depends on the LAST attribute that is not a size/align?)
        // Markdown: ![alt|left|100](img.png) -> alt="alt|left|100"

        // Robust strategy: Try parsing as Markdown style first (common for external/local md links).
        // If it looks like Wiki style (path is actually an attribute), the parser handles it.
        // We use 'true' for firstPartIsAlt because Obsidian's DOM 'alt' usually strips the path and starts with attributes.
        const parsed = pipeSyntaxParser.parsePipeAttributes(altText, true);

        // 3. Map to State
        const state = this.mapPipeDataToState(parsed as any);

        // 3.5 Immediately clean the alt attribute to prevent raw pipe text from showing
        if (state.caption && state.caption !== altText) {
            img.setAttribute('alt', state.caption);
        } else if (!state.caption && altText.includes('|')) {
            // If no caption but altText contains pipes, clear it (it's all attributes)
            img.setAttribute('alt', '');
        }

        // 4. Delegate: Alignment & Layout Fix
        // For Reading Mode, we MUST ensure the image has correct layout (inline-block) 
        // to allow side-by-side positioning when aligned.
        let alignPosition = state.align === 'none' ? this.plugin.settings.alignment.default : state.align;
        let wrap = state.wrap;

        // Handle combined values like 'left-wrap', 'right-wrap'
        if (alignPosition.includes('-wrap')) {
            alignPosition = alignPosition.replace('-wrap', '') as typeof alignPosition;
            wrap = true;
        }

        const positionData = {
            position: alignPosition,
            wrap: wrap,
            width: state.width?.toString(),
            height: state.height?.toString()
        };
        this.alignment.applyAlignmentToImage(img, positionData as any);
        this.alignment.ensureReadingModeLayout(img, alignPosition);

        // 5. Delegate: Size
        if ((state.width || state.height) && this.resizer) {
            this.resizer.applySize(img, state.width ?? undefined, state.height ?? undefined);
        }

        if (state.caption) {
            this.caption.applyCaption(img, state.caption);
        }
    }

    /**
     * Helper to map raw PipeSyntaxData to ImageState
     */
    private mapPipeDataToState(parsed: PipeSyntaxData): ImageState {
        let align: ImageState['align'] = 'none';
        let wrap = false;

        if (parsed.align) {
            const baseAlign = parsed.align.includes('left') ? 'left'
                : parsed.align.includes('right') ? 'right'
                    : parsed.align.includes('center') ? 'center'
                        : 'none';

            wrap = parsed.align.includes('wrap');

            // Combine base and wrap into single align value for UI
            if (baseAlign !== 'none' && baseAlign !== 'center' && wrap) {
                align = `${baseAlign}-wrap` as ImageState['align'];
            } else {
                align = baseAlign;
            }
        }

        return {
            align,
            wrap,
            width: parsed.size?.width,
            height: parsed.size?.height,
            caption: parsed.alt ? parsed.alt.replace(/\\\|/g, '|') : undefined
        };
    }

    /**
     * Reads the current state of the image from the Markdown source.
     */
    public getImageState(img: HTMLImageElement): ImageState | null {
        const file = this.app.workspace.getActiveFile();
        if (!file) return null;

        const linkText = this.refinedImageUtils.getImageLinkText(img, file);
        if (!linkText) return null; // Can't resolve link

        const parsed = pipeSyntaxParser.parsePipeSyntax(linkText);
        if (!parsed) return null;

        return this.mapPipeDataToState(parsed);
    }

    /**
     * The Central Writer. Updates the markdown file with new state.
     */
    public async updateState(img: HTMLImageElement, changes: Partial<ImageState>) {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!activeView) return;
        const editor = activeView.editor;

        const linkText = this.refinedImageUtils.getImageLinkTextFromEditor(img, editor);
        if (!linkText) return;

        const parsed = pipeSyntaxParser.parsePipeSyntax(linkText);
        if (!parsed) return;

        // Merge Changes
        // 1. Align & Wrap
        if (changes.align !== undefined || changes.wrap !== undefined) {
            let newAlignStr = changes.align ?? 'none';

            // If align is 'none', no alignment attribute needed
            if (newAlignStr === 'none') {
                parsed.align = null;
            } else {
                // For combined values like 'left-wrap', use directly
                // For simple values like 'left', check if wrap should be appended
                if (!newAlignStr.includes('wrap') && changes.wrap === true) {
                    newAlignStr = `${newAlignStr}-wrap` as typeof newAlignStr;
                }
                parsed.align = newAlignStr as AlignType;
            }
        }

        // 2. Size
        if (changes.width !== undefined || changes.height !== undefined) {
            if (!parsed.size) parsed.size = { width: undefined, height: undefined, format: 'W' };

            if (changes.width !== undefined) parsed.size.width = changes.width === null ? undefined : changes.width;
            if (changes.height !== undefined) parsed.size.height = changes.height === null ? undefined : changes.height;

            // Update format logic
            if (parsed.size.width && parsed.size.height) parsed.size.format = 'WxH';
            else if (parsed.size.width) parsed.size.format = 'W';
            else if (parsed.size.height) parsed.size.format = 'xH';
        }

        // 3. Caption
        if (changes.caption !== undefined) {
            // Escape pipes to prevent breaking the pipe syntax
            parsed.alt = changes.caption.replace(/\|/g, '\\|');
        }

        // Rebuild and Write
        // Rebuild and Write
        const newLinkText = pipeSyntaxParser.buildPipeSyntax(parsed);

        // Use findLinkRange for surgical replacement to avoid "Eating Next Line" issues
        // and ensure we only touch the exact characters of the link.
        const range = this.refinedImageUtils.findLinkRange(editor, linkText);

        if (range) {
            // Check if content actually changed to avoid unnecessary writes
            if (linkText !== newLinkText) {
                this.app.workspace.onLayoutReady(() => {
                    editor.replaceRange(
                        newLinkText,
                        { line: range.line, ch: range.start },
                        { line: range.line, ch: range.end }
                    );
                });
            }

            // Mark as processed to help observer ignore strict echoes if needed
            img.setAttribute('data-state-processed', 'true');
        } else {
            new Notice("Could not find image link in editor to update.");
        }
    }

    public onunload() {
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
    }
}
