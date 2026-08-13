import { App, Component } from 'obsidian';
import ImageConverterPlugin from '../main';
import type { HorizontalImageAlignment, ResolvedImageLayout } from './ImageLayoutResolver';
import {
    resolveRenderedMediaLayoutTarget,
    type RenderedMediaLayoutTarget,
    type RenderedMediaSizing
} from './RenderedMediaLayoutTarget';

export const IMAGE_LAYOUT_OWNER_ATTRIBUTE = 'data-image-assistant-layout-owner';
export const IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE = 'data-image-assistant-layout-placement';
export const IMAGE_LAYOUT_ALIGN_ATTRIBUTE = 'data-image-assistant-align';
export const IMAGE_LAYOUT_WRAP_ATTRIBUTE = 'data-image-assistant-wrap';
export const IMAGE_LAYOUT_SIZING_ATTRIBUTE = 'data-image-assistant-layout-sizing';
export const IMAGE_LAYOUT_FLOW_ATTRIBUTE = 'data-image-assistant-layout-flow';

export type ImageLayoutFlow = 'block' | 'float-start' | 'float-end';

const LEGACY_ALIGNMENT_CLASSES = [
    'image-position-left',
    'image-position-center',
    'image-position-right',
    'image-wrap',
    'image-no-wrap',
    'image-converter-aligned'
] as const;

const LEGACY_DIMENSION_OWNER_ATTRIBUTE = 'data-image-assistant-dimension-owner';
const LEGACY_DIMENSION_MODE_ATTRIBUTE = 'data-image-assistant-dimension-mode';

/**
 * Short-lived layout experiments from pre-6.0 development builds. They were
 * written to CodeMirror containers and must be removed when the replacement
 * plugin instance first sees a document.
 */
const LEGACY_EXPERIMENTAL_LAYOUT_ATTRIBUTES = [
    'data-image-assistant-layout-context',
    'data-image-assistant-layout-context-align',
    'data-image-assistant-layout-context-candidate',
    'data-image-assistant-layout-direct-widget',
    'data-image-assistant-layout-direct-widget-align',
    'data-image-assistant-layout-visual',
    'data-image-assistant-layout-positioned'
] as const;

const COORDINATOR_OFFSET_PROPERTY = '--image-assistant-layout-offset';

const CODE_MIRROR_LAYOUT_CONTAINER_SELECTOR = '.cm-line, .cm-embed-block, .cm-content';

/** Applies semantic layout state to one stable media owner and placement. */
export class ImageAlignment extends Component {
    private readonly cleanedLegacyDocuments = new WeakSet<Document>();

    constructor(_app: App, private readonly plugin: ImageConverterPlugin) {
        super();
    }

    applyLayout(
        img: HTMLImageElement,
        layout: ResolvedImageLayout
    ): HTMLElement | null {
        const target = resolveRenderedMediaLayoutTarget(img);
        if (!target) {
            this.clearImage(img);
            return null;
        }
        return this.applyLayoutTarget(target, layout);
    }

    applyLayoutTarget(
        target: RenderedMediaLayoutTarget,
        layout: ResolvedImageLayout
    ): HTMLElement | null {
        this.cleanupLegacyExperimentalStateOnce(target.owner.ownerDocument);
        this.clearLegacyDimensionState(target.owner);
        this.clearCompetingOwners(target.owner);
        this.clearCompetingPlacements(target.owner, target.placement);

        if (!layout.alignment || isCodeMirrorLayoutContainer(target.owner)
            || isCodeMirrorLayoutContainer(target.placement)) {
            this.clearTargetState(target);
            return null;
        }

        const effectiveWrap = this.resolveEffectiveWrap(target.owner, layout);
        const flow = resolveFlow(layout.alignment, effectiveWrap);
        this.applyOwnerState(
            target.owner,
            layout.alignment,
            effectiveWrap,
            target.sizing,
            flow
        );
        this.applyPlacementState(target.placement);
        return target.owner;
    }

    clearImage(img: HTMLImageElement): void {
        const target = resolveRenderedMediaLayoutTarget(img);
        this.cleanupLegacyExperimentalStateOnce(img.ownerDocument);
        this.clearLegacyDimensionState(target?.owner ?? img);
        if (target) {
            this.clearTargetState(target);
            this.clearCompetingOwners(target.owner);
            this.clearCompetingPlacements(target.owner, null);
        } else {
            this.clearOwnerState(img);
            this.clearPlacementState(img);
            this.clearCompetingOwners(img);
            this.clearCompetingPlacements(img, null);
        }
    }

    cleanup(root: ParentNode = document): void {
        this.collectElements(root, `[${IMAGE_LAYOUT_OWNER_ATTRIBUTE}], .image-converter-aligned`)
            .forEach(element => this.clearOwnerState(element));
        this.collectElements(root, `[${IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE}]`)
            .forEach(element => this.clearPlacementState(element));
        this.collectElements(root, `[${LEGACY_DIMENSION_OWNER_ATTRIBUTE}]`)
            .forEach(element => this.clearLegacyDimensionElement(element));
        this.cleanupLegacyExperimentalState(root);
    }

    private resolveEffectiveWrap(owner: HTMLElement, layout: ResolvedImageLayout): boolean {
        if (!layout.wrap || layout.alignment === 'center') return false;
        const livePreview = !!owner.closest('.markdown-source-view');
        return !livePreview || !!this.plugin.settings.alignment.enableEditModeWrap;
    }

    private clearTargetState(target: RenderedMediaLayoutTarget): void {
        this.clearOwnerState(target.owner);
        this.clearPlacementState(target.placement);
    }

    private clearCompetingOwners(retained: HTMLElement): void {
        const candidates = new Set<HTMLElement>();
        if (hasOwnerState(retained)) candidates.add(retained);
        retained.querySelectorAll<HTMLElement>(
            `[${IMAGE_LAYOUT_OWNER_ATTRIBUTE}], .image-converter-aligned`
        ).forEach(candidate => candidates.add(candidate));
        let parent = retained.parentElement;
        while (parent) {
            if (hasOwnerState(parent)) candidates.add(parent);
            parent = parent.parentElement;
        }
        for (const candidate of candidates) {
            if (candidate !== retained) this.clearOwnerState(candidate);
        }
    }

    private clearCompetingPlacements(
        owner: HTMLElement,
        retained: HTMLElement | null
    ): void {
        const candidates = new Set<HTMLElement>();
        if (owner.hasAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE)) candidates.add(owner);
        owner.querySelectorAll<HTMLElement>(`[${IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE}]`)
            .forEach(candidate => candidates.add(candidate));
        let parent = owner.parentElement;
        while (parent) {
            if (parent.hasAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE)) candidates.add(parent);
            parent = parent.parentElement;
        }
        for (const candidate of candidates) {
            if (candidate !== retained) this.clearPlacementState(candidate);
        }
    }

    private applyOwnerState(
        owner: HTMLElement,
        alignment: HorizontalImageAlignment,
        wrap: boolean,
        sizing: RenderedMediaSizing,
        flow: ImageLayoutFlow
    ): void {
        const clearLegacyInline = hasLegacyInlineLayoutOwnership(owner);
        setAttributeIfChanged(owner, IMAGE_LAYOUT_OWNER_ATTRIBUTE, 'true');
        setAttributeIfChanged(owner, IMAGE_LAYOUT_ALIGN_ATTRIBUTE, alignment);
        setAttributeIfChanged(owner, IMAGE_LAYOUT_WRAP_ATTRIBUTE, wrap ? 'true' : 'false');
        setAttributeIfChanged(owner, IMAGE_LAYOUT_SIZING_ATTRIBUTE, sizing);
        setAttributeIfChanged(owner, IMAGE_LAYOUT_FLOW_ATTRIBUTE, flow);
        if (clearLegacyInline) {
            clearLegacyInlineLayout(owner);
            clearLegacyOwnerMarker(owner);
        }
        LEGACY_ALIGNMENT_CLASSES.forEach(className => {
            if (owner.classList.contains(className)) owner.classList.remove(className);
        });
    }

    private applyPlacementState(placement: HTMLElement): void {
        setAttributeIfChanged(placement, IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE, 'true');
    }

    private clearOwnerState(owner: HTMLElement): void {
        const clearLegacyInline = hasLegacyInlineLayoutOwnership(owner);
        const hasPluginState = hasOwnerState(owner)
            || owner.hasAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE)
            || clearLegacyInline;
        if (!hasPluginState) return;

        owner.removeAttribute(IMAGE_LAYOUT_OWNER_ATTRIBUTE);
        owner.removeAttribute(IMAGE_LAYOUT_ALIGN_ATTRIBUTE);
        owner.removeAttribute(IMAGE_LAYOUT_WRAP_ATTRIBUTE);
        owner.removeAttribute(IMAGE_LAYOUT_SIZING_ATTRIBUTE);
        owner.removeAttribute(IMAGE_LAYOUT_FLOW_ATTRIBUTE);
        owner.removeAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE);
        clearLegacyOwnerMarker(owner);
        LEGACY_ALIGNMENT_CLASSES.forEach(className => {
            if (owner.classList.contains(className)) owner.classList.remove(className);
        });
        if (clearLegacyInline) clearLegacyInlineLayout(owner);
    }

    private clearPlacementState(placement: Element): void {
        placement.removeAttribute(IMAGE_LAYOUT_PLACEMENT_ATTRIBUTE);
    }

    private clearLegacyDimensionState(root: Element): void {
        if (root.hasAttribute(LEGACY_DIMENSION_OWNER_ATTRIBUTE)) {
            this.clearLegacyDimensionElement(root);
        }
        root.querySelectorAll<HTMLElement>(`[${LEGACY_DIMENSION_OWNER_ATTRIBUTE}]`)
            .forEach(element => this.clearLegacyDimensionElement(element));
    }

    private clearLegacyDimensionElement(element: Element): void {
        element.removeAttribute(LEGACY_DIMENSION_OWNER_ATTRIBUTE);
        element.removeAttribute(LEGACY_DIMENSION_MODE_ATTRIBUTE);
        if (isHTMLElement(element)) {
            element.style.removeProperty('width');
            element.style.removeProperty('height');
        }
    }

    private cleanupLegacyExperimentalStateOnce(ownerDocument: Document): void {
        if (this.cleanedLegacyDocuments.has(ownerDocument)) return;
        this.cleanedLegacyDocuments.add(ownerDocument);
        this.cleanupLegacyExperimentalState(ownerDocument);
    }

    private cleanupLegacyExperimentalState(root: ParentNode): void {
        const stalePositioned = this.collectElements(
            root,
            `[data-image-assistant-layout-positioned], [style*="${COORDINATOR_OFFSET_PROPERTY}"]`
        );
        for (const attribute of LEGACY_EXPERIMENTAL_LAYOUT_ATTRIBUTES) {
            this.collectElements(root, `[${attribute}]`)
                .forEach(element => element.removeAttribute(attribute));
        }
        stalePositioned.forEach(element => {
            element.style.removeProperty(COORDINATOR_OFFSET_PROPERTY);
        });
    }

    private collectElements(root: ParentNode, selector: string): HTMLElement[] {
        const elements = Array.from(root.querySelectorAll?.(selector) ?? [])
            .filter(isHTMLElement);
        if (isHTMLElement(root) && root.matches(selector)) elements.unshift(root);
        return elements;
    }
}

function resolveFlow(
    alignment: HorizontalImageAlignment,
    wrap: boolean
): ImageLayoutFlow {
    if (!wrap) return 'block';
    return alignment === 'right' ? 'float-end' : 'float-start';
}

function hasOwnerState(owner: HTMLElement): boolean {
    return owner.hasAttribute(IMAGE_LAYOUT_OWNER_ATTRIBUTE)
        || owner.hasAttribute(IMAGE_LAYOUT_ALIGN_ATTRIBUTE)
        || owner.hasAttribute(IMAGE_LAYOUT_WRAP_ATTRIBUTE)
        || owner.hasAttribute(IMAGE_LAYOUT_SIZING_ATTRIBUTE)
        || owner.hasAttribute(IMAGE_LAYOUT_FLOW_ATTRIBUTE)
        || LEGACY_ALIGNMENT_CLASSES.some(className => owner.classList.contains(className));
}

function clearLegacyInlineLayout(owner: HTMLElement): void {
    for (const property of [
        'float',
        'clear',
        'margin-left',
        'margin-right',
        'margin-inline-start',
        'margin-inline-end'
    ]) {
        if (owner.style.getPropertyValue(property)) owner.style.removeProperty(property);
    }
    if (owner.style.display === 'inline-block') owner.style.removeProperty('display');
}

function hasLegacyInlineLayoutOwnership(owner: HTMLElement): boolean {
    return LEGACY_ALIGNMENT_CLASSES.some(className => owner.classList.contains(className))
        || owner.hasAttribute('data-image-assistant-layout-host');
}

function clearLegacyOwnerMarker(owner: HTMLElement): void {
    owner.removeAttribute('data-image-assistant-layout-host');
}

function isCodeMirrorLayoutContainer(element: Element): boolean {
    return element.matches(CODE_MIRROR_LAYOUT_CONTAINER_SELECTOR);
}

function isHTMLElement(value: unknown): value is HTMLElement {
    return !!value && typeof value === 'object' && (value as Node).nodeType === 1;
}

function setAttributeIfChanged(element: Element, name: string, value: string): void {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}
