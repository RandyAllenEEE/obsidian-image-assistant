import {
    StateEffect,
    StateField,
    type EditorState,
    type Range
} from '@codemirror/state';
import {
    Decoration,
    type DecorationSet,
    EditorView,
    WidgetType
} from '@codemirror/view';
import { editorLivePreviewField } from 'obsidian';
import { syntaxTree } from '@codemirror/language';
import type ImageConverterPlugin from '../../main';
import {
    getImageLayoutKey,
    getImageSourceKey,
    type ImageSourceDescriptor
} from '../../utils/MarkdownSourceContext';
import { IMAGE_LAYOUT_KEY_ATTRIBUTE } from '../../utils/RefinedImageUtils';
import { CaptionRenderPolicy } from './CaptionRenderPolicy';
import {
    CaptionSourceScanner,
    type CaptionSourceChange,
    type CaptionSourceScan
} from './CaptionSourceScanner';
import { CaptionResolver } from './CaptionResolver';
import type { CaptionWidthMode } from './types';
import type { CaptionAlignment, CaptionSettings } from '../../settings/types';
import {
    resolveCaptionLayout,
    type HorizontalImageAlignment
} from '../ImageLayoutResolver';

export const refreshLivePreviewCaptionsEffect = StateEffect.define<void>();
export const setLivePreviewCaptionModeEffect = StateEffect.define<boolean | null>();

export interface CaptionDecorationState {
    decorations: DecorationSet;
    scan: CaptionSourceScan;
    livePreview: boolean;
    modeEnabled: boolean | null;
    settingsSignature: string;
    incremental: boolean;
}

const DEFAULT_CAPTION_FONT_SIZE = 12;
const DEFAULT_CAPTION_WIDTH = 640;
const CAPTION_LINE_HEIGHT = 1.4;
const CAPTION_CHARACTER_WIDTH_FACTOR = 0.56;
const MAX_ESTIMATED_CAPTION_LINES = 100;

function isLivePreview(state: EditorState): boolean {
    try {
        return state.field(editorLivePreviewField, false) === true;
    } catch {
        return false;
    }
}

class CaptionWidget extends WidgetType {
    constructor(
        private readonly caption: string,
        private readonly width: number | undefined,
        private readonly widthMode: CaptionWidthMode,
        private readonly maxLines: number,
        private readonly placement: HorizontalImageAlignment | null,
        private readonly textAlignment: CaptionAlignment,
        private readonly wrap: boolean,
        private readonly standalone: boolean,
        private readonly sourceKey: string,
        private readonly layoutKey: string,
        private readonly heightEstimate: number
    ) {
        super();
    }

    eq(other: CaptionWidget): boolean {
        return this.caption === other.caption
            && this.width === other.width
            && this.widthMode === other.widthMode
            && this.maxLines === other.maxLines
            && this.placement === other.placement
            && this.textAlignment === other.textAlignment
            && this.wrap === other.wrap
            && this.standalone === other.standalone
            && this.sourceKey === other.sourceKey
            && this.layoutKey === other.layoutKey
            && this.heightEstimate === other.heightEstimate;
    }

    get estimatedHeight(): number {
        return this.heightEstimate;
    }

    toDOM(view: EditorView): HTMLElement {
        const caption = view.dom.ownerDocument.createElement('span');
        caption.className = 'image-assistant-caption image-assistant-live-preview-caption';
        caption.setAttribute('data-image-assistant-caption-node', 'true');
        caption.setAttribute('data-image-assistant-caption-renderer', 'codemirror');
        caption.setAttribute('data-image-assistant-caption-width', this.widthMode);
        caption.setAttribute('data-image-assistant-caption-text-align', this.textAlignment);
        if (this.placement) {
            caption.setAttribute('data-image-assistant-caption-placement', this.placement);
        }
        caption.setAttribute('data-image-assistant-caption-wrap', this.wrap ? 'true' : 'false');
        caption.setAttribute('data-image-assistant-caption-standalone', this.standalone ? 'true' : 'false');
        caption.setAttribute('data-image-assistant-source-key', this.sourceKey);
        caption.setAttribute(IMAGE_LAYOUT_KEY_ATTRIBUTE, this.layoutKey);
        caption.setAttribute('aria-hidden', 'true');
        caption.textContent = this.caption;

        if (this.widthMode === 'auto' && this.width) {
            caption.style.setProperty('--img-width', `${this.width}px`);
        } else {
            caption.style.setProperty('--img-width', '100%');
        }
        applyLineClamp(caption, this.caption, this.maxLines);
        return caption;
    }

    ignoreEvent(): boolean {
        return true;
    }
}

export function createLivePreviewCaptionExtension(plugin: ImageConverterPlugin) {
    const resolver = new CaptionResolver();
    const scanner = new CaptionSourceScanner();
    const renderPolicy = new CaptionRenderPolicy();
    const getImageAlignmentSettings = () => plugin.settings.alignment ?? {
        enabled: false,
        default: 'center' as const
    };

    const getSettingsSignature = (): string => {
        const settings = plugin.settings.captions;
        return JSON.stringify([
            settings.enabled,
            settings.showInLivePreview,
            settings.inlinePolicy,
            settings.widthMode,
            settings.maxLines,
            settings.skipExtensions,
            settings.alignment,
            getImageAlignmentSettings().enabled,
            getImageAlignmentSettings().default
        ]);
    };

    const buildRanges = (
        descriptors: readonly ImageSourceDescriptor[],
        from = 0,
        to = Number.POSITIVE_INFINITY
    ): Range<Decoration>[] => {
        const settings = plugin.settings.captions;
        const ranges: Range<Decoration>[] = [];
        for (const link of descriptors) {
            const position = link.end;
            if (position < from || position > to) continue;
            if (!renderPolicy.shouldRender({
                settings,
                mode: 'live-preview',
                standalone: link.standalone
            })) continue;

            const resolved = resolver.resolveFromDescriptor(link, {
                enabled: true,
                skipExtensions: settings.skipExtensions
            });
            if (!resolved?.shouldRender || !resolved.caption) continue;

            const layout = resolveCaptionLayout(
                resolved.align,
                getImageAlignmentSettings(),
                settings.alignment,
                link.standalone
            );
            const safeWrap = layout.wrap
                && resolved.size?.width !== undefined
                && (settings.widthMode ?? 'auto') === 'auto';

            ranges.push(Decoration.widget({
                widget: new CaptionWidget(
                    resolved.caption,
                    resolved.size?.width,
                    settings.widthMode ?? 'auto',
                    settings.maxLines ?? 0,
                    layout.placement,
                    layout.textAlignment,
                    safeWrap,
                    link.standalone,
                    getImageSourceKey(link),
                    getImageLayoutKey(link),
                    estimateCaptionWidgetHeight(
                        resolved.caption,
                        resolved.size?.width,
                        settings.widthMode ?? 'auto',
                        settings.maxLines ?? 0,
                        settings
                    )
                ),
                side: 10_000,
                block: true
            }).range(position));
        }
        return ranges;
    };

    const buildState = (
        state: EditorState,
        modeEnabled: boolean | null = null
    ): CaptionDecorationState => {
        const scan = scanner.scan(state.doc.toString());
        const livePreview = modeEnabled ?? isLivePreview(state);
        return {
            decorations: livePreview
                ? Decoration.set(buildRanges(scan.descriptors), true)
                : Decoration.none,
            scan,
            livePreview,
            modeEnabled,
            settingsSignature: getSettingsSignature(),
            incremental: false
        };
    };

    return StateField.define<CaptionDecorationState>({
        create: buildState,
        update(value, transaction) {
            const refreshRequested = transaction.effects.some(effect =>
                effect.is(refreshLivePreviewCaptionsEffect)
            );
            const modeEffect = transaction.effects.find(effect =>
                effect.is(setLivePreviewCaptionModeEffect)
            );
            const modeEnabled = modeEffect
                ? modeEffect.value
                : value.modeEnabled;
            const livePreview = modeEnabled ?? isLivePreview(transaction.state);
            const settingsSignature = getSettingsSignature();
            if (refreshRequested
                || livePreview !== value.livePreview
                || modeEnabled !== value.modeEnabled
                || settingsSignature !== value.settingsSignature) {
                return buildState(transaction.state, modeEnabled);
            }

            if (!transaction.docChanged) return value;

            const changes: CaptionSourceChange[] = [];
            transaction.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
                changes.push({
                    fromA,
                    toA,
                    fromB,
                    toB,
                    inserted: inserted.toString()
                });
            });
            const update = touchesStructuralSyntax(transaction.state, changes)
                ? {
                    scan: scanner.scan(transaction.state.doc.toString()),
                    changedFrom: 0,
                    changedTo: transaction.state.doc.length,
                    incremental: false
                }
                : scanner.update(value.scan, transaction.state.doc.toString(), changes);

            if (!livePreview || !plugin.settings.captions.enabled
                || !plugin.settings.captions.showInLivePreview) {
                return {
                    decorations: Decoration.none,
                    scan: update.scan,
                    livePreview,
                    modeEnabled,
                    settingsSignature,
                    incremental: update.incremental
                };
            }

            if (!update.incremental) {
                return {
                    decorations: Decoration.set(buildRanges(update.scan.descriptors), true),
                    scan: update.scan,
                    livePreview,
                    modeEnabled,
                    settingsSignature,
                    incremental: false
                };
            }

            const decorations = value.decorations
                .map(transaction.changes)
                .update({
                    filterFrom: update.changedFrom,
                    filterTo: update.changedTo,
                    filter: () => false,
                    add: buildRanges(
                        update.scan.descriptors,
                        update.changedFrom,
                        update.changedTo
                    ),
                    sort: true
                });
            return {
                decorations,
                scan: update.scan,
                livePreview,
                modeEnabled,
                settingsSignature,
                incremental: true
            };
        },
        provide: field => [
            EditorView.decorations.from(field, value => value.decorations),
            EditorView.updateListener.of(update => {
                const modeChanged = update.transactions.some(transaction =>
                    transaction.effects.some(effect =>
                        effect.is(setLivePreviewCaptionModeEffect)
                    ));
                if (!update.docChanged
                    && !update.viewportChanged
                    && !update.geometryChanged
                    && !modeChanged) return;
                const imageUpdate = {
                    reconcileSource: update.docChanged || update.viewportChanged || modeChanged,
                    geometryChanged: update.geometryChanged || modeChanged,
                    ...(modeChanged ? { modeChanged: true } : {})
                };
                if (modeChanged) {
                    scheduleAfterEditorMeasure(update.view, () => {
                        plugin.imageStateManager?.handleLivePreviewEditorUpdate(
                            update.view.dom,
                            imageUpdate
                        );
                    });
                    return;
                }
                plugin.imageStateManager?.handleLivePreviewEditorUpdate(
                    update.view.dom,
                    imageUpdate
                );
            })
        ]
    });
}

function estimateCaptionWidgetHeight(
    caption: string,
    explicitWidth: number | undefined,
    widthMode: CaptionWidthMode,
    maxLines: number,
    settings: CaptionSettings
): number {
    const fontSize = parsePixelValue(settings.fontSize) ?? DEFAULT_CAPTION_FONT_SIZE;
    const width = widthMode === 'auto' && explicitWidth && explicitWidth > 0
        ? explicitWidth
        : DEFAULT_CAPTION_WIDTH;
    const horizontalPadding = parseBoxVerticalOrHorizontal(settings.padding, 'horizontal');
    const contentWidth = Math.max(fontSize * 4, width - horizontalPadding);
    const charactersPerLine = Math.max(
        1,
        Math.floor(contentWidth / (fontSize * CAPTION_CHARACTER_WIDTH_FACTOR))
    );
    const estimatedLines = caption.split(/\r?\n/u).reduce((total, line) =>
        total + Math.max(1, Math.ceil(Array.from(line).length / charactersPerLine)), 0);
    const visibleLines = Math.min(
        maxLines > 0 ? maxLines : MAX_ESTIMATED_CAPTION_LINES,
        estimatedLines
    );
    const verticalPadding = parseBoxVerticalOrHorizontal(settings.padding, 'vertical');
    const border = (parsePixelValue(settings.border) ?? 0) * 2;
    return Math.max(
        1,
        Math.ceil(visibleLines * fontSize * CAPTION_LINE_HEIGHT
            + verticalPadding
            + border)
    );
}

function parseBoxVerticalOrHorizontal(
    value: string,
    axis: 'vertical' | 'horizontal'
): number {
    const parts = value.trim().split(/\s+/u).filter(Boolean);
    if (parts.length === 0 || parts.length > 4) return 0;
    const pixels = parts.map(parsePixelValue);
    if (pixels.some(part => part === undefined)) return 0;
    const [first = 0, second = first, third = first, fourth = second] = pixels as number[];
    return axis === 'vertical'
        ? first + third
        : second + fourth;
}

function parsePixelValue(value: string): number | undefined {
    const match = /^\s*(-?(?:\d+\.?\d*|\.\d+))px(?:\s|$)/u.exec(value);
    if (!match) return undefined;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function scheduleAfterEditorMeasure(view: EditorView, callback: () => void): void {
    const ownerWindow = view.dom.ownerDocument.defaultView;
    const run = () => {
        if (!view.dom.isConnected) return;
        callback();
    };
    if (ownerWindow?.requestAnimationFrame) {
        ownerWindow.requestAnimationFrame(run);
        return;
    }
    setTimeout(run, 0);
}

function touchesStructuralSyntax(
    state: EditorState,
    changes: readonly CaptionSourceChange[]
): boolean {
    const tree = syntaxTree(state);
    return changes.some(change => {
        const positions = [change.fromB, Math.max(change.fromB, change.toB - 1)];
        return positions.some(position => {
            let node: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(
                Math.min(position, state.doc.length),
                -1
            );
            while (node) {
                if (/(?:frontmatter|yaml|comment|fencedcode|codeblock|inlinecode|codetext)/i.test(node.name)) {
                    return true;
                }
                node = node.parent;
            }
            return false;
        });
    });
}

function applyLineClamp(element: HTMLElement, caption: string, maxLines: number): void {
    if (maxLines > 0) {
        element.setAttribute('data-image-assistant-caption-clamped', 'true');
        element.style.setProperty('--image-assistant-caption-max-lines', maxLines.toString());
        element.title = caption;
        return;
    }

    element.removeAttribute('data-image-assistant-caption-clamped');
    element.style.removeProperty('--image-assistant-caption-max-lines');
    element.removeAttribute('title');
}
