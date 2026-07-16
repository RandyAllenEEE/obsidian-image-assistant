import { Component } from 'obsidian';
import type ImageConverterPlugin from '../main';
import { CaptionDomRenderer, type CaptionRenderContext } from './caption/CaptionDomRenderer';
import { CaptionRenderPolicy } from './caption/CaptionRenderPolicy';
import { CaptionResolver, type CaptionResolverOptions } from './caption/CaptionResolver';
import { refreshLivePreviewCaptionsEffect } from './caption/LivePreviewCaptionExtension';
import type { ReadingImageContext } from './caption/types';
import { resolveCaptionLayout } from './ImageLayoutResolver';
import { getImageSourceKey } from '../utils/MarkdownSourceContext';
import {
    isHtmlElementNode,
    isHtmlImageElement,
    isTextNode
} from './caption/CaptionDomUtils';
import { collectUsableMarkdownViews, getMarkdownViewMode } from './MarkdownViewRegistry';

type ReadingCaptionContext = CaptionRenderContext & ReadingImageContext & {
    captionText?: string | null;
};

export class ImageCaption extends Component {
    private readonly resolver = new CaptionResolver();
    private readonly renderer = new CaptionDomRenderer();
    private readonly renderPolicy = new CaptionRenderPolicy();
    private readonly documents = new Set<Document>();

    constructor(private readonly plugin: ImageConverterPlugin) {
        super();
        this.ensureDocument(document);
    }

    onload(): void {
        this.registerEvent(
            this.plugin.app.workspace.on('window-open' as never, (_workspaceWindow: unknown, win: Window) => {
                if (win?.document) this.ensureDocument(win.document);
            })
        );
        this.registerEvent(
            this.plugin.app.workspace.on('window-close' as never, (_workspaceWindow: unknown, win: Window) => {
                if (win?.document) this.cleanupDocument(win.document);
            })
        );
        this.plugin.app.workspace.iterateAllLeaves?.(leaf => {
            const ownerDocument = leaf.view?.containerEl?.ownerDocument;
            if (ownerDocument) this.ensureDocument(ownerDocument);
        });
    }

    applyCaption(
        img: HTMLImageElement,
        captionText: string | undefined,
        context: CaptionRenderContext = {}
    ): HTMLElement | null {
        return this.renderImage(img, { ...context, captionText });
    }

    renderImage(
        img: HTMLImageElement,
        context: ReadingCaptionContext = {}
    ): HTMLElement | null {
        const ownerDocument = context.document ?? img.ownerDocument ?? document;
        this.ensureDocument(ownerDocument);

        const resolved = context.descriptor
            ? this.resolver.resolveFromDescriptor(context.descriptor, this.getResolverOptions())
                ?? this.resolver.resolveFromImage(img, {
                    ...this.getResolverOptions(),
                    linkText: context.linkText,
                    captionText: context.captionText
                })
            : this.resolver.resolveFromImage(img, {
                ...this.getResolverOptions(),
                linkText: context.linkText,
                captionText: context.captionText
            });
        const standalone = context.descriptor?.standalone ?? this.isStandaloneDomImage(img);
        const layout = resolveCaptionLayout(
            resolved.align,
            this.plugin.settings.alignment,
            this.plugin.settings.captions.alignment,
            standalone
        );
        const sourceKey = context.descriptor
            ? getImageSourceKey(context.descriptor)
            : context.sourceKey;
        if (!this.renderPolicy.shouldRender({
            settings: this.plugin.settings.captions,
            mode: 'reading',
            standalone
        })) {
            resolved.caption = null;
            resolved.shouldRender = false;
        }

        return this.renderer.render(img, resolved, {
            ...context,
            document: ownerDocument,
            sourceKey,
            layout,
            standalone,
            widthMode: this.plugin.settings.captions.widthMode,
            maxLines: this.plugin.settings.captions.maxLines
        });
    }

    removeImage(img: HTMLImageElement): void {
        this.renderer.removeImage(img);
    }

    cleanup(root?: ParentNode): void {
        this.renderer.cleanup(root);
    }

    ensureDocument(targetDocument: Document): void {
        if (!this.isOpenDocument(targetDocument)) return;
        this.documents.add(targetDocument);
        targetDocument.body.classList.toggle(
            'image-captions-enabled',
            this.plugin.settings.captions.enabled
        );
        if (this.plugin.settings.captions.enabled) {
            this.applyCaptionStyles(targetDocument);
        } else {
            this.renderer.cleanup(targetDocument);
            targetDocument.getElementById('image-caption-styles')?.remove();
        }
    }

    cleanupDocument(targetDocument: Document): void {
        this.renderer.cleanup(targetDocument);
        targetDocument.body?.classList.remove('image-captions-enabled');
        targetDocument.getElementById('image-caption-styles')?.remove();
        this.documents.delete(targetDocument);
    }

    applyCaptionClass(): void {
        for (const targetDocument of this.getOpenDocuments()) {
            targetDocument.body.classList.toggle(
                'image-captions-enabled',
                this.plugin.settings.captions.enabled
            );
            if (!this.plugin.settings.captions.enabled) {
                this.renderer.cleanup(targetDocument);
                targetDocument.getElementById('image-caption-styles')?.remove();
            }
        }
    }

    applyCaptionStyles(targetDocument: Document = document): void {
        if (!this.isOpenDocument(targetDocument)) return;
        this.documents.add(targetDocument);
        const styleId = 'image-caption-styles';
        let styleElement = targetDocument.getElementById(styleId) as HTMLStyleElement | null;
        if (!styleElement) {
            styleElement = targetDocument.createElement('style');
            styleElement.id = styleId;
            targetDocument.head.appendChild(styleElement);
        }

        const settings = this.plugin.settings.captions;
        const cssText = `
            .image-captions-enabled .has-image-assistant-caption,
            .image-captions-enabled [data-image-assistant-caption-owner="true"]:not(img):not(.image-wrapper) {
                display: inline-flex !important;
                flex-direction: column;
                justify-content: center;
                width: fit-content;
                max-width: 100%;
                min-width: 0;
            }

            .image-captions-enabled [data-image-assistant-caption-owner="true"][data-image-assistant-layout-owner="true"]:not(img):not(.image-wrapper) {
                display: flex !important;
            }

            .image-captions-enabled [data-image-assistant-caption-align="left"] {
                --image-assistant-caption-inline-start: 0;
                --image-assistant-caption-inline-end: auto;
                --image-assistant-caption-text-align: left;
            }

            .image-captions-enabled [data-image-assistant-caption-align="center"] {
                --image-assistant-caption-inline-start: auto;
                --image-assistant-caption-inline-end: auto;
                --image-assistant-caption-text-align: center;
            }

            .image-captions-enabled [data-image-assistant-caption-align="right"] {
                --image-assistant-caption-inline-start: auto;
                --image-assistant-caption-inline-end: 0;
                --image-assistant-caption-text-align: right;
            }

            .image-captions-enabled [data-image-assistant-caption-owner="true"][data-image-assistant-caption-align="left"] {
                align-items: flex-start;
            }

            .image-captions-enabled [data-image-assistant-caption-owner="true"][data-image-assistant-caption-align="center"] {
                align-items: center;
            }

            .image-captions-enabled [data-image-assistant-caption-owner="true"][data-image-assistant-caption-align="right"] {
                align-items: flex-end;
            }

            .image-captions-enabled .has-image-assistant-caption > .image-wrapper {
                width: 100%;
            }

            .image-captions-enabled .image-assistant-caption {
                display: block;
                width: var(--img-width, 100%);
                max-width: 100%;
                min-width: 0;
                overflow-wrap: anywhere;
                white-space: normal;
                font-family: var(--font-interface);
                font-size: ${settings.fontSize || 'var(--font-smaller)'};
                color: ${settings.color || 'var(--text-muted)'};
                background-color: ${settings.backgroundColor || 'transparent'};
                opacity: ${settings.opacity || '1'};
                margin-top: ${settings.marginTop || '4px'};
                padding: ${settings.padding || '2px 4px'};
                border-radius: ${settings.borderRadius || '0'};
                font-style: ${settings.fontStyle || 'italic'};
                font-weight: ${settings.fontWeight || 'normal'};
                text-transform: ${settings.textTransform || 'none'};
                letter-spacing: ${settings.letterSpacing || 'normal'};
                border: ${settings.border || 'none'};
                text-align: var(--image-assistant-caption-text-align, center);
                margin-left: var(--image-assistant-caption-inline-start, auto);
                margin-right: var(--image-assistant-caption-inline-end, auto);
                line-height: 1.4;
                box-sizing: border-box;
                pointer-events: none;
            }

            .image-captions-enabled .image-assistant-caption[data-image-assistant-caption-clamped="true"] {
                display: -webkit-box;
                overflow: hidden;
                -webkit-box-orient: vertical;
                -webkit-line-clamp: var(--image-assistant-caption-max-lines);
                pointer-events: auto;
            }

            .image-captions-enabled .image-assistant-caption[data-image-assistant-caption-width="container"] {
                width: 100%;
            }

            .image-captions-enabled img[data-image-assistant-caption-owner="true"] +
                .image-assistant-caption[data-image-assistant-caption-renderer="dom"],
            .image-captions-enabled .image-wrapper +
                .image-assistant-caption[data-image-assistant-caption-renderer="dom"] {
                width: var(--img-width, 100%);
            }

            .image-captions-enabled .has-image-assistant-caption img,
            .image-captions-enabled [data-image-assistant-caption-owner="true"] img {
                display: block;
                max-width: 100%;
                height: auto;
            }

            .image-captions-enabled .cm-editor .image-assistant-live-preview-caption {
                box-sizing: border-box;
                max-width: 100%;
            }
        `;
        if (styleElement.textContent !== cssText) styleElement.textContent = cssText;
    }

    refresh(): void {
        this.applyCaptionClass();
        this.refreshAllViews();
        this.updateStyles();
    }

    refreshAllViews(): void {
        for (const view of collectUsableMarkdownViews(this.plugin.app)) {
            const contentEl = view.contentEl;
            this.ensureDocument(contentEl.ownerDocument);

            const mode = getMarkdownViewMode(view);
            if (!mode) continue;
            if (mode === 'preview') {
                if (!this.plugin.settings.captions.enabled
                    || !this.plugin.settings.captions.showInReadingMode) {
                    this.renderer.cleanup(contentEl);
                    continue;
                }
                contentEl.querySelectorAll('img').forEach(img => {
                    if (!isHtmlImageElement(img)) return;
                    if (this.plugin.imageStateManager) {
                        this.plugin.imageStateManager.processReadingModeImage(img);
                    } else {
                        this.renderImage(img, { document: img.ownerDocument });
                    }
                });
                continue;
            }

            this.renderer.cleanup(contentEl);
            const editorView = (view.editor as unknown as {
                cm?: { dispatch(spec: { effects: unknown }): void };
            })?.cm;
            editorView?.dispatch({ effects: refreshLivePreviewCaptionsEffect.of(undefined) });
        }
    }

    updateStyles(): void {
        for (const targetDocument of this.getOpenDocuments()) {
            if (this.plugin.settings.captions.enabled) {
                this.applyCaptionStyles(targetDocument);
            } else {
                targetDocument.getElementById('image-caption-styles')?.remove();
            }
        }
    }

    cleanupStyles(): void {
        for (const targetDocument of this.getOpenDocuments()) {
            targetDocument.getElementById('image-caption-styles')?.remove();
        }
    }

    destroy(): void {
        for (const targetDocument of this.getOpenDocuments()) {
            this.cleanupDocument(targetDocument);
        }
        this.documents.clear();
    }

    onunload(): void {
        this.destroy();
        super.onunload();
    }

    private getResolverOptions(): CaptionResolverOptions {
        return {
            enabled: this.plugin.settings.captions.enabled,
            skipExtensions: this.plugin.settings.captions.skipExtensions
        };
    }

    private getOpenDocuments(): Document[] {
        for (const targetDocument of [...this.documents]) {
            if (!this.isOpenDocument(targetDocument)) this.documents.delete(targetDocument);
        }
        return [...this.documents];
    }

    private isOpenDocument(targetDocument: Document): boolean {
        return !!targetDocument.body && targetDocument.defaultView?.closed !== true;
    }

    private isStandaloneDomImage(img: HTMLImageElement): boolean {
        const host = img.closest('.image-wrapper, .image-embed, .external-embed') ?? img;
        const parent = host.parentElement;
        if (!parent) return true;
        return Array.from(parent.childNodes).every(node =>
            node === host
            || isTextNode(node) && !node.textContent?.trim()
            || isHtmlElementNode(node)
                && node.getAttribute('data-image-assistant-caption-renderer') === 'dom'
        );
    }
}
