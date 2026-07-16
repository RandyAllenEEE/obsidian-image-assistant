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
    getImageSourceKey,
    type CaptionLinkDescriptor
} from '../../utils/MarkdownSourceContext';
import { CaptionRenderPolicy } from './CaptionRenderPolicy';
import {
    CaptionSourceScanner,
    type CaptionSourceChange,
    type CaptionSourceScan
} from './CaptionSourceScanner';
import { CaptionResolver } from './CaptionResolver';
import type { CaptionWidthMode } from './types';
import {
    resolveCaptionLayout,
    type HorizontalImageAlignment
} from '../ImageLayoutResolver';
import {
    CAPTION_EXPLICIT_WIDTH_ATTRIBUTE,
    syncLivePreviewCaptionWidget
} from './LivePreviewCaptionGeometry';

export const refreshLivePreviewCaptionsEffect = StateEffect.define<void>();

export interface CaptionDecorationState {
    decorations: DecorationSet;
    scan: CaptionSourceScan;
    livePreview: boolean;
    settingsSignature: string;
    incremental: boolean;
}

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
        private readonly alignment: HorizontalImageAlignment,
        private readonly wrap: boolean,
        private readonly standalone: boolean,
        private readonly sourceKey: string
    ) {
        super();
    }

    eq(other: CaptionWidget): boolean {
        return this.caption === other.caption
            && this.width === other.width
            && this.widthMode === other.widthMode
            && this.maxLines === other.maxLines
            && this.alignment === other.alignment
            && this.wrap === other.wrap
            && this.standalone === other.standalone
            && this.sourceKey === other.sourceKey;
    }

    toDOM(view: EditorView): HTMLElement {
        const caption = view.dom.ownerDocument.createElement('span');
        caption.className = 'image-assistant-caption image-assistant-live-preview-caption';
        caption.setAttribute('data-image-assistant-caption-node', 'true');
        caption.setAttribute('data-image-assistant-caption-renderer', 'codemirror');
        caption.setAttribute('data-image-assistant-caption-width', this.widthMode);
        caption.setAttribute('data-image-assistant-caption-align', this.alignment);
        caption.setAttribute('data-image-assistant-caption-wrap', this.wrap ? 'true' : 'false');
        caption.setAttribute('data-image-assistant-caption-standalone', this.standalone ? 'true' : 'false');
        caption.setAttribute('data-image-assistant-source-key', this.sourceKey);
        caption.setAttribute(CAPTION_EXPLICIT_WIDTH_ATTRIBUTE, this.width ? 'true' : 'false');
        caption.setAttribute('aria-hidden', 'true');
        caption.textContent = this.caption;

        if (this.widthMode === 'auto' && this.width) {
            caption.style.setProperty('--img-width', `${this.width}px`);
        } else {
            caption.style.setProperty('--img-width', '100%');
        }
        applyLineClamp(caption, this.caption, this.maxLines);
        queueMicrotask(() => {
            if (caption.isConnected) {
                syncLivePreviewCaptionWidget(view.dom, caption, this.sourceKey);
            }
        });
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
        descriptors: readonly CaptionLinkDescriptor[],
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
                    layout.alignment,
                    safeWrap,
                    link.standalone,
                    getImageSourceKey(link)
                ),
                side: 10_000,
                block: true
            }).range(position));
        }
        return ranges;
    };

    const buildState = (state: EditorState): CaptionDecorationState => {
        const scan = scanner.scan(state.doc.toString());
        const livePreview = isLivePreview(state);
        return {
            decorations: livePreview
                ? Decoration.set(buildRanges(scan.descriptors), true)
                : Decoration.none,
            scan,
            livePreview,
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
            const livePreview = isLivePreview(transaction.state);
            const settingsSignature = getSettingsSignature();
            if (refreshRequested
                || livePreview !== value.livePreview
                || settingsSignature !== value.settingsSignature) {
                return buildState(transaction.state);
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
                    settingsSignature,
                    incremental: update.incremental
                };
            }

            if (!update.incremental) {
                return {
                    decorations: Decoration.set(buildRanges(update.scan.descriptors), true),
                    scan: update.scan,
                    livePreview,
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
                settingsSignature,
                incremental: true
            };
        },
        provide: field => EditorView.decorations.from(field, value => value.decorations)
    });
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
