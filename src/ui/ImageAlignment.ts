import { App, Component } from 'obsidian';
import ImageConverterPlugin from '../main';
import type { HorizontalImageAlignment, ResolvedImageLayout } from './ImageLayoutResolver';

export const IMAGE_LAYOUT_OWNER_ATTRIBUTE = 'data-image-assistant-layout-owner';
export const IMAGE_LAYOUT_ALIGN_ATTRIBUTE = 'data-image-assistant-align';
export const IMAGE_LAYOUT_WRAP_ATTRIBUTE = 'data-image-assistant-wrap';

const ALIGNMENT_CLASSES = [
    'image-position-left',
    'image-position-center',
    'image-position-right',
    'image-wrap',
    'image-no-wrap',
    'image-converter-aligned'
] as const;

const LAYOUT_OWNER_SELECTOR = [
    '.image-resize-container',
    '.image-wrapper',
    '.internal-embed.image-embed',
    '.external-embed',
    '.cm-embed-block'
].join(', ');

export interface ImageAlignmentOptions {
    align: HorizontalImageAlignment | 'none';
    wrap: boolean;
}

export interface ImagePositionData {
    position: HorizontalImageAlignment | 'none';
    wrap: boolean;
}

/** Owns the DOM representation of resolved image layout. */
export class ImageAlignment extends Component {
    constructor(_app: App, _plugin: ImageConverterPlugin) {
        super();
    }

    /** Compatibility wrapper used by existing callers and context-menu tests. */
    applyAlignmentToImage(img: HTMLImageElement, positionData: ImagePositionData): void {
        if (!positionData) {
            console.error('No position data provided for image:', img.src);
            return;
        }

        this.applyLayout(img, {
            alignment: positionData.position === 'none' ? null : positionData.position,
            wrap: positionData.position === 'none' ? false : positionData.wrap,
            source: positionData.position === 'none' ? 'none' : 'pipe'
        });
    }

    applyLayout(
        img: HTMLImageElement,
        layout: ResolvedImageLayout
    ): HTMLElement | null {
        const owner = layout.alignment ? this.findPreferredOwner(img) : null;
        this.clearOtherOwners(img, owner);
        if (!owner || !layout.alignment) {
            this.clearPluginDisplay(img);
            return null;
        }

        this.applyOwnerState(owner, layout.alignment, layout.wrap);
        return owner;
    }

    clearImage(img: HTMLImageElement): void {
        this.clearOtherOwners(img, null);
        this.clearPluginDisplay(img);
    }

    cleanup(root: ParentNode = document): void {
        const owned = this.collectElements(root, `[${IMAGE_LAYOUT_OWNER_ATTRIBUTE}]`);
        owned.forEach(element => this.clearOwnerState(element));

        const legacy = this.collectElements(root, '.image-converter-aligned');
        legacy.forEach(element => this.clearOwnerState(element));

        this.collectElements(root, '[data-image-assistant-inline-display="true"]')
            .forEach(element => {
                element.style.removeProperty('display');
                element.removeAttribute('data-image-assistant-inline-display');
            });
    }

    getLayoutOwner(img: HTMLImageElement): HTMLElement | null {
        if (img.hasAttribute(IMAGE_LAYOUT_OWNER_ATTRIBUTE)) return img;
        const owner = img.closest(`[${IMAGE_LAYOUT_OWNER_ATTRIBUTE}]`);
        return isHTMLElement(owner) ? owner : null;
    }

    getResolvedLayout(img: HTMLImageElement): ResolvedImageLayout {
        const owner = this.getLayoutOwner(img) ?? img;
        const dataAlignment = owner.getAttribute(IMAGE_LAYOUT_ALIGN_ATTRIBUTE);
        const classAlignment = ALIGNMENT_CLASSES
            .find(className => className.startsWith('image-position-') && owner.classList.contains(className))
            ?.replace('image-position-', '');
        const alignment = isHorizontalAlignment(dataAlignment)
            ? dataAlignment
            : isHorizontalAlignment(classAlignment) ? classAlignment : null;

        return {
            alignment,
            wrap: alignment !== null && (
                owner.getAttribute(IMAGE_LAYOUT_WRAP_ATTRIBUTE) === 'true'
                || owner.classList.contains('image-wrap')
            ),
            source: alignment ? 'pipe' : 'none'
        };
    }

    /** Transfers ownership while Resize temporarily wraps an image. */
    transferLayoutOwner(img: HTMLImageElement, target: HTMLElement): void {
        const layout = this.getResolvedLayout(img);
        this.clearOtherOwners(img, null);
        if (layout.alignment) {
            this.applyOwnerState(target, layout.alignment, layout.wrap);
        }
    }

    /** Kept for compatibility; layout is now handled exclusively by the owner CSS. */
    ensureReadingModeLayout(img: HTMLImageElement, position: string): void {
        if (position === 'none') this.clearPluginDisplay(img);
    }

    getCurrentImageAlignment(img: HTMLImageElement): ImageAlignmentOptions {
        const layout = this.getResolvedLayout(img);
        return {
            align: layout.alignment ?? 'none',
            wrap: layout.wrap
        };
    }

    private findPreferredOwner(img: HTMLImageElement): HTMLElement {
        const container = img.closest(LAYOUT_OWNER_SELECTOR);
        if (isHTMLElement(container)) return container;

        const paragraph = img.parentElement;
        if (paragraph?.tagName === 'P' && Array.from(paragraph.childNodes).every(node =>
            node === img
            || node.nodeType === 3 && !node.textContent?.trim()
            || isHTMLElement(node)
                && node.getAttribute('data-image-assistant-caption-renderer') === 'dom'
        )) {
            return paragraph;
        }
        return img;
    }

    private clearOtherOwners(img: HTMLImageElement, retained: HTMLElement | null): void {
        const candidates = new Set<HTMLElement>([img]);
        let parent = img.parentElement;
        while (parent) {
            if (parent.hasAttribute(IMAGE_LAYOUT_OWNER_ATTRIBUTE)
                || parent.classList.contains('image-converter-aligned')) {
                candidates.add(parent);
            }
            parent = parent.parentElement;
        }

        for (const candidate of candidates) {
            if (candidate !== retained) this.clearOwnerState(candidate);
        }
    }

    private applyOwnerState(
        owner: HTMLElement,
        alignment: HorizontalImageAlignment,
        wrap: boolean
    ): void {
        setAttributeIfChanged(owner, IMAGE_LAYOUT_OWNER_ATTRIBUTE, 'true');
        setAttributeIfChanged(owner, IMAGE_LAYOUT_ALIGN_ATTRIBUTE, alignment);
        setAttributeIfChanged(owner, IMAGE_LAYOUT_WRAP_ATTRIBUTE, wrap ? 'true' : 'false');

        toggleClassIfChanged(owner, 'image-converter-aligned', true);
        for (const value of ['left', 'center', 'right'] as const) {
            toggleClassIfChanged(owner, `image-position-${value}`, value === alignment);
        }
        toggleClassIfChanged(owner, 'image-wrap', wrap);
        toggleClassIfChanged(owner, 'image-no-wrap', !wrap);

        const inlineMargins = getInlineMargins(alignment, wrap);
        setImportantPropertyIfChanged(owner, 'margin-inline-start', inlineMargins.start);
        setImportantPropertyIfChanged(owner, 'margin-inline-end', inlineMargins.end);
    }

    private clearOwnerState(owner: HTMLElement): void {
        const pluginOwned = owner.hasAttribute(IMAGE_LAYOUT_OWNER_ATTRIBUTE);
        const legacyOwned = owner.classList.contains('image-converter-aligned');
        const hasPluginState = pluginOwned
            || owner.hasAttribute(IMAGE_LAYOUT_ALIGN_ATTRIBUTE)
            || owner.hasAttribute(IMAGE_LAYOUT_WRAP_ATTRIBUTE)
            || ALIGNMENT_CLASSES.some(className => owner.classList.contains(className));
        if (!hasPluginState) return;
        owner.removeAttribute(IMAGE_LAYOUT_OWNER_ATTRIBUTE);
        owner.removeAttribute(IMAGE_LAYOUT_ALIGN_ATTRIBUTE);
        owner.removeAttribute(IMAGE_LAYOUT_WRAP_ATTRIBUTE);
        owner.removeAttribute('data-image-assistant-layout-positioned');
        owner.style.removeProperty('--image-assistant-layout-offset');
        ALIGNMENT_CLASSES.forEach(className => owner.classList.remove(className));

        if (pluginOwned || legacyOwned) {
            owner.style.removeProperty('float');
            owner.style.removeProperty('clear');
            owner.style.removeProperty('margin-left');
            owner.style.removeProperty('margin-right');
            owner.style.removeProperty('margin-inline-start');
            owner.style.removeProperty('margin-inline-end');
            if (owner.tagName === 'IMG' && owner.style.display === 'inline-block') {
                owner.style.removeProperty('display');
            }
        }
    }

    private clearPluginDisplay(img: HTMLImageElement): void {
        if (!img.hasAttribute('data-image-assistant-inline-display')) return;
        img.style.removeProperty('display');
        img.removeAttribute('data-image-assistant-inline-display');
    }

    private collectElements(root: ParentNode, selector: string): HTMLElement[] {
        const elements = Array.from(root.querySelectorAll?.(selector) ?? [])
            .filter(isHTMLElement);
        if (isHTMLElement(root) && root.matches(selector)) elements.unshift(root);
        return elements;
    }
}

function isHorizontalAlignment(value: string | null | undefined): value is HorizontalImageAlignment {
    return value === 'left' || value === 'center' || value === 'right';
}

function isHTMLElement(value: unknown): value is HTMLElement {
    return !!value && typeof value === 'object' && (value as Node).nodeType === 1;
}

function setAttributeIfChanged(element: Element, name: string, value: string): void {
    if (element.getAttribute(name) !== value) element.setAttribute(name, value);
}

function toggleClassIfChanged(element: Element, className: string, enabled: boolean): void {
    if (element.classList.contains(className) !== enabled) {
        element.classList.toggle(className, enabled);
    }
}

function getInlineMargins(
    alignment: HorizontalImageAlignment,
    wrap: boolean
): { start: string; end: string } {
    if (wrap) {
        return alignment === 'right'
            ? { start: '1.5rem', end: '0' }
            : { start: '0', end: '1.5rem' };
    }
    if (alignment === 'left') return { start: '0', end: 'auto' };
    if (alignment === 'right') return { start: 'auto', end: '0' };
    return { start: 'auto', end: 'auto' };
}

function setImportantPropertyIfChanged(
    element: HTMLElement,
    name: string,
    value: string
): void {
    if (element.style.getPropertyValue(name) === value
        && element.style.getPropertyPriority(name) === 'important') return;
    element.style.setProperty(name, value, 'important');
}
