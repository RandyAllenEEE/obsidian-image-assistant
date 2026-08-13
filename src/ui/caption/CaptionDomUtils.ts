/** Realm-agnostic DOM guards for Obsidian popout windows. */
export function isElementNode(value: unknown): value is Element {
    return !!value && typeof value === 'object'
        && (value as Node).nodeType === 1;
}

export function isHtmlElementNode(value: unknown): value is HTMLElement {
    return isElementNode(value) && 'style' in value;
}

export function isHtmlImageElement(value: unknown): value is HTMLImageElement {
    return isElementNode(value) && value.tagName.toUpperCase() === 'IMG';
}
