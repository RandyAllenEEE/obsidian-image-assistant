
import { App, MarkdownView, TFile, Notice } from 'obsidian';
import ImageConverterPlugin from '../main';
import { ImageAlignment, ImagePositionData } from './ImageAlignment';
import { ImageResizer } from './ImageResizer';
import { ImageCaption } from './ImageCaption';
import { pipeSyntaxParser, AlignType, PipeSyntaxData } from '../utils/PipeSyntaxParser';
import { RefinedImageUtils } from '../utils/RefinedImageUtils';


export interface ImageState {
    align: 'left' | 'center' | 'right' | 'none';
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
    public resizer: ImageResizer;
    public caption: ImageCaption;

    constructor(
        private app: App,
        private plugin: ImageConverterPlugin,
    ) {
        this.refinedImageUtils = new RefinedImageUtils(this.app);

        // Initialize delegates
        // Dependencies are injected via initialize() to avoid circular references during plugin load.
    }

    public initialize(alignment: ImageAlignment, resizer: ImageResizer, caption: ImageCaption) {
        this.alignment = alignment;
        this.resizer = resizer;
        this.caption = caption;

        this.setupObserver();
    }

    private isProcessing = false;

    private setupObserver() {
        if (this.observer) this.observer.disconnect();

        this.observer = new MutationObserver((mutations) => {
            if (this.isProcessing) return; // Prevent recursive loops

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
                    // Re-process on attribute change (like src change), but be careful of infinite loops
                    const img = mutation.target as HTMLImageElement;
                    if (!img.hasClass('is-resizing')) {
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
                this.startObserving();
                this.refreshAllImages();
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

    public refreshAllImages() {
        const markdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!markdownView) return;

        markdownView.contentEl.findAll('img').forEach((img) => {
            if (img instanceof HTMLImageElement) {
                this.processImage(img);
            }
        });
    }

    /**
     * Coordinator method: Gets state from markdown and calls delegates to apply it.
     */
    public processImage(img: HTMLImageElement) {
        if (this.isProcessing) return;

        // 1. Check for conflicts
        if (img.hasClass('is-resizing')) return;

        try {
            this.isProcessing = true;

            // 2. Get State
            const state = this.getImageState(img);
            if (!state) return;

            // 3. Delegate: Alignment
            const alignPosition = state.align === 'none' ? this.plugin.settings.defaultImageAlignment : state.align;
            const positionData: any = {
                position: alignPosition,
                wrap: state.wrap,
                width: state.width?.toString(),
                height: state.height?.toString()
            };
            this.alignment.applyAlignmentToImage(img, positionData);

            // 4. Delegate: Size
            if (state.width || state.height) {
                this.resizer.applySize(img, state.width ?? undefined, state.height ?? undefined);
            }

            if (state.caption) {
                this.caption.applyCaption(img, state.caption);
            }
        } finally {
            // Short timeout to allow DOM updates to settle before re-enabling observer
            // This prevents immediate re-trigger by the very changes we just made
            setTimeout(() => {
                this.isProcessing = false;
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
        const parsed = pipeSyntaxParser.parsePipeSyntax(altText);

        if (!parsed) return;

        // 3. Construct Data for Delegates
        // Align
        let align: 'left' | 'center' | 'right' | 'none' = 'none';
        let wrap = false;
        if (parsed.align) {
            if (parsed.align.includes('left')) align = 'left';
            else if (parsed.align.includes('right')) align = 'right';
            else if (parsed.align.includes('center')) align = 'center';
            if (parsed.align.includes('wrap')) wrap = true;
        }

        const positionData = {
            position: align,
            wrap: wrap,
            width: parsed.size?.width?.toString(),
            height: parsed.size?.height?.toString()
        };

        // 4. Delegate: Alignment & Layout Fix
        this.alignment.applyAlignmentToImage(img, positionData as any);
        this.alignment.ensureReadingModeLayout(img, align);

        // 5. Delegate: Size
        // IMPORTANT: Native Obsidian fails to resize URL images in Markdown links.
        // We explicitly apply it here.
        if (parsed.size?.width || parsed.size?.height) {
            this.resizer.applySize(img, parsed.size.width, parsed.size.height);
        }

        // 6. Delegate: Caption (Optional - Obsidian usually handles alt text, but we might want style)
        // For now, we trust Obsidian's native alt-text display or our CSS for captions.
        // We do typically hide the raw pipe syntax from the alt text visually via CSS or
        // by modifying the alt attribute (but that changes source of truth for next run?).
        // Better to NOT modify the alt attribute in Reading Mode to preserve idempotency 
        // unless we store original in data attribute.
        // Let's rely on CSS to hide pipe syntax if possible, or just leave it for now.
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

        // Map parsed data to ImageState
        // Align
        let align: 'left' | 'center' | 'right' | 'none' = 'none';
        let wrap = false;

        if (parsed.align) {
            if (parsed.align.includes('left')) align = 'left';
            else if (parsed.align.includes('right')) align = 'right';
            else if (parsed.align.includes('center')) align = 'center';

            if (parsed.align.includes('wrap')) wrap = true;
        }

        return {
            align,
            wrap,
            width: parsed.size?.width,
            height: parsed.size?.height,
            caption: parsed.alt
        };
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
            const currentAlignStr = parsed.align || '';
            let newAlignStr = changes.align || (currentAlignStr.includes('left') ? 'left' : currentAlignStr.includes('right') ? 'right' : currentAlignStr.includes('center') ? 'center' : 'none');

            if (newAlignStr !== 'none') {
                // Determine wrap state: use new wrap if provided, else keep existing wrap if present
                const shouldWrap = changes.wrap !== undefined ? changes.wrap : currentAlignStr.includes('wrap');
                if (shouldWrap) newAlignStr += '-wrap';
                parsed.align = newAlignStr as AlignType;
            } else {
                parsed.align = null;
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
            parsed.alt = changes.caption;
        }

        // Rebuild and Write
        const newLinkText = pipeSyntaxParser.buildPipeSyntax(parsed);
        const lineNumber = this.refinedImageUtils.findLinkLineNumber(editor, linkText);

        if (lineNumber !== -1) {
            const line = editor.getLine(lineNumber);
            const newLine = line.replace(linkText, newLinkText);
            editor.setLine(lineNumber, newLine);

            // Mark as processed to help observer ignore strict echoes if needed, 
            // though our logic is robust enough to re-process identicals safely.
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
