import { Component } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type ImageConverterPlugin from '../main';
import { CaptionDomRenderer, type CaptionRenderContext } from './caption/CaptionDomRenderer';
import { CaptionRenderPolicy } from './caption/CaptionRenderPolicy';
import { CaptionResolver, type CaptionResolverOptions } from './caption/CaptionResolver';
import {
    refreshLivePreviewCaptionsEffect,
    setLivePreviewCaptionModeEffect
} from './caption/LivePreviewCaptionExtension';
import type { ReadingImageContext } from './caption/types';
import { resolveCaptionLayout } from './ImageLayoutResolver';
import { getImageSourceKey } from '../utils/MarkdownSourceContext';
import {
    isHtmlImageElement
} from './caption/CaptionDomUtils';
import { collectUsableMarkdownViews, getMarkdownViewMode } from './MarkdownViewRegistry';
import { resolveEditorView } from '../utils/EditorViewResolver';
import {
    isStandaloneRenderedMediaTarget,
    resolveRenderedMediaLayoutTarget
} from './RenderedMediaLayoutTarget';

type ReadingCaptionContext = CaptionRenderContext & ReadingImageContext & {
    captionText?: string | null;
};

export class ImageCaption extends Component {
    private readonly resolver = new CaptionResolver();
    private readonly renderer = new CaptionDomRenderer();
    private readonly renderPolicy = new CaptionRenderPolicy();
    private readonly documents = new Set<Document>();
    private readonly editorModeStates = new WeakMap<EditorView, boolean | null>();
    private modeSyncTimer: ReturnType<typeof setTimeout> | null = null;

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
        this.registerEvent(
            this.plugin.app.workspace.on('layout-change', () => this.scheduleViewModeSync())
        );
        this.registerEvent(
            this.plugin.app.workspace.on('active-leaf-change', () => this.scheduleViewModeSync())
        );
        this.registerEvent(
            this.plugin.app.workspace.on('file-open', () => this.scheduleViewModeSync())
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

    renderExternalMedia(
        media: Element,
        context: ReadingCaptionContext = {}
    ): HTMLElement | null {
        const target = resolveRenderedMediaLayoutTarget(media);
        if (!target || target.kind !== 'excalidraw-source' || target.image) {
            return null;
        }
        const ownerDocument = context.document ?? media.ownerDocument ?? document;
        this.ensureDocument(ownerDocument);
        const options = this.getResolverOptions();
        const resolved = context.descriptor
            ? this.resolver.resolveFromDescriptor(context.descriptor, options)
            : context.linkText
                ? this.resolver.resolveFromLinkText(context.linkText, options)
                : null;
        if (!resolved) {
            this.renderer.removeTarget(target.visual);
            return null;
        }
        const standalone = context.descriptor?.standalone
            ?? isStandaloneRenderedMediaTarget(target);
        const layout = resolveCaptionLayout(
            resolved.align,
            this.plugin.settings.alignment,
            this.plugin.settings.captions.alignment,
            standalone
        );
        if (!this.renderPolicy.shouldRender({
            settings: this.plugin.settings.captions,
            mode: 'reading',
            standalone
        })) {
            resolved.caption = null;
            resolved.shouldRender = false;
        }
        return this.renderer.renderTarget(target, resolved, {
            ...context,
            document: ownerDocument,
            sourceKey: context.descriptor
                ? getImageSourceKey(context.descriptor)
                : context.sourceKey,
            layout,
            standalone,
            widthMode: this.plugin.settings.captions.widthMode,
            maxLines: this.plugin.settings.captions.maxLines
        });
    }

    removeImage(img: HTMLImageElement): void {
        this.renderer.removeImage(img);
    }

    removeExternalMedia(media: Element): void {
        this.renderer.removeTarget(media);
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
            .image-captions-enabled .has-image-assistant-caption:not([data-image-assistant-layout-sizing="external-renderer"]),
            .image-captions-enabled [data-image-assistant-caption-owner="true"]:not([data-image-assistant-layout-sizing="external-renderer"]):not(img) {
                display: inline-flex !important;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                width: fit-content;
                max-width: 100%;
                min-width: 0;
            }

            .image-captions-enabled [data-image-assistant-caption-owner="true"][data-image-assistant-layout-owner="true"]:not([data-image-assistant-layout-sizing="external-renderer"]):not(img) {
                display: flex !important;
            }

            .image-captions-enabled :is(.markdown-reading-view, .markdown-preview-view:not(.markdown-source-view))
                [data-image-assistant-caption-owner="true"][data-image-assistant-layout-owner="true"][data-image-assistant-layout-sizing="external-renderer"]:not(img) {
                display: flex !important;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                max-width: 100%;
                min-width: 0;
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
                text-align: center;
                margin-left: auto;
                margin-right: auto;
                line-height: 1.4;
                box-sizing: border-box;
                pointer-events: none;
            }

            .image-captions-enabled .image-assistant-caption[data-image-assistant-caption-text-align="left"] {
                text-align: left;
            }

            .image-captions-enabled .image-assistant-caption[data-image-assistant-caption-text-align="center"] {
                text-align: center;
            }

            .image-captions-enabled .image-assistant-caption[data-image-assistant-caption-text-align="right"] {
                text-align: right;
            }

            .image-captions-enabled .image-assistant-caption[data-image-assistant-caption-renderer="dom"][data-image-assistant-caption-positioned="true"] {
                position: relative;
                left: var(--image-assistant-caption-offset, 0px);
                margin-left: 0 !important;
                margin-right: 0 !important;
                margin-inline-start: 0 !important;
                margin-inline-end: 0 !important;
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

            .image-captions-enabled .cm-editor .image-assistant-live-preview-caption {
                box-sizing: border-box;
                max-width: 100%;
                margin-top: 0 !important;
                margin-bottom: 0 !important;
            }

            .image-captions-enabled .cm-editor .image-assistant-live-preview-caption[data-image-assistant-caption-positioned="true"] {
                margin-left: 0 !important;
                margin-right: 0 !important;
                margin-inline-start: 0 !important;
                margin-inline-end: 0 !important;
            }

            .image-captions-enabled .cm-editor .image-assistant-live-preview-caption:not([data-image-assistant-caption-positioned="true"])[data-image-assistant-caption-placement="left"] {
                margin-inline-start: 0 !important;
                margin-inline-end: auto !important;
            }

            .image-captions-enabled .cm-editor .image-assistant-live-preview-caption:not([data-image-assistant-caption-positioned="true"])[data-image-assistant-caption-placement="center"] {
                margin-inline-start: auto !important;
                margin-inline-end: auto !important;
            }

            .image-captions-enabled .cm-editor .image-assistant-live-preview-caption:not([data-image-assistant-caption-positioned="true"])[data-image-assistant-caption-placement="right"] {
                margin-inline-start: auto !important;
                margin-inline-end: 0 !important;
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
        this.refreshViews();
    }

    refreshFiles(paths: ReadonlySet<string>): void {
        if (paths.size === 0) return;
        this.refreshViews(paths);
    }

    private refreshViews(paths?: ReadonlySet<string>): void {
        for (const view of collectUsableMarkdownViews(this.plugin.app)) {
            if (paths && (!view.file || !paths.has(view.file.path))) continue;
            const contentEl = view.contentEl;
            this.ensureDocument(contentEl.ownerDocument);

            const mode = getMarkdownViewMode(view);
            if (!mode) continue;
            const editorView = resolveEditorView(view.editor, view);
            const modeChange = this.getEditorModeChange(editorView, mode === 'source');
            if (mode === 'preview') {
                if (editorView && modeChange !== undefined) {
                    editorView.dispatch({
                        effects: setLivePreviewCaptionModeEffect.of(modeChange)
                    });
                }
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
            if (editorView) {
                editorView.dispatch({ effects: [
                    ...(modeChange === undefined
                        ? []
                        : [setLivePreviewCaptionModeEffect.of(modeChange)]),
                    refreshLivePreviewCaptionsEffect.of(undefined)
                ] });
            }
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
        if (this.modeSyncTimer !== null) {
            clearTimeout(this.modeSyncTimer);
            this.modeSyncTimer = null;
        }
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
        const target = resolveRenderedMediaLayoutTarget(img);
        return target ? isStandaloneRenderedMediaTarget(target) : true;
    }

    private scheduleViewModeSync(): void {
        if (this.modeSyncTimer !== null) return;
        this.modeSyncTimer = setTimeout(() => {
            this.modeSyncTimer = null;
            this.syncViewModes();
        }, 0);
    }

    private syncViewModes(): void {
        for (const view of collectUsableMarkdownViews(this.plugin.app)) {
            const mode = getMarkdownViewMode(view);
            if (!mode) continue;
            this.syncEditorMode(resolveEditorView(view.editor, view), mode === 'source');
        }
    }

    private syncEditorMode(editorView: EditorView | null, sourceMode: boolean): void {
        const modeChange = this.getEditorModeChange(editorView, sourceMode);
        if (!editorView || modeChange === undefined) return;
        editorView.dispatch({ effects: setLivePreviewCaptionModeEffect.of(modeChange) });
    }

    private getEditorModeChange(
        editorView: EditorView | null,
        sourceMode: boolean
    ): boolean | null | undefined {
        if (!editorView) return undefined;
        const enabled = sourceMode ? null : false;
        if (this.editorModeStates.has(editorView)
            && this.editorModeStates.get(editorView) === enabled) return undefined;
        this.editorModeStates.set(editorView, enabled);
        return enabled;
    }
}
