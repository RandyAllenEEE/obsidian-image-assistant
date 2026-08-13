import type { AlignType } from "../../utils/PipeSyntaxParser";

export interface ExcalidrawRenderedEmbed {
    readonly element: HTMLElement;
    readonly image: HTMLImageElement | null;
    readonly svg: SVGSVGElement | null;
    readonly fileSource: string;
}

const RENDERED_SOURCE_SELECTOR = "[fileSource].excalidraw-embedded-img";
const MARKDOWN_VIEW_SELECTOR = ".markdown-preview-view, .markdown-source-view";

/**
 * Resolves only Excalidraw's rendered Markdown embed, never its editor canvas.
 * `fileSource` is an upstream public DOM contract used by its own open handler.
 */
export function findExcalidrawRenderedEmbed(
    target: Element
): ExcalidrawRenderedEmbed | null {
    const direct = target.closest<HTMLElement>(RENDERED_SOURCE_SELECTOR);
    const host = direct ? null : target.closest<HTMLElement>('.image-embed');
    const hostedMarkers = host
        ? Array.from(host.querySelectorAll<HTMLElement>(RENDERED_SOURCE_SELECTOR))
        : [];
    const element = direct ?? (hostedMarkers.length === 1 ? hostedMarkers[0] : null);
    if (!element || !element.closest(MARKDOWN_VIEW_SELECTOR)) return null;

    const image = element.tagName.toLowerCase() === "img"
        ? element as HTMLImageElement
        : null;
    const svgCandidate = image
        ? null
        : element.matches("svg.excalidraw-svg")
            ? element
            : element.querySelector("svg.excalidraw-svg");
    const svg = svgCandidate?.tagName.toLowerCase() === "svg"
        ? svgCandidate as SVGSVGElement
        : null;
    if (!image && !svg) return null;

    const fileSource = element.getAttribute("fileSource")?.trim() ?? "";
    if (!fileSource) return null;
    return Object.freeze({ element, image, svg, fileSource });
}

export function collectExcalidrawRenderedEmbeds(
    root: ParentNode
): readonly ExcalidrawRenderedEmbed[] {
    const elements: HTMLElement[] = [];
    if (isElement(root) && root.matches(RENDERED_SOURCE_SELECTOR)) {
        elements.push(root as HTMLElement);
    }
    root.querySelectorAll<HTMLElement>(RENDERED_SOURCE_SELECTOR)
        .forEach(element => elements.push(element));
    return Object.freeze(elements
        .map(element => findExcalidrawRenderedEmbed(element))
        .filter((value): value is ExcalidrawRenderedEmbed => value !== null));
}

/** Reads the explicit alignment class emitted by Excalidraw's alias parser. */
export function getExcalidrawRenderedAlignment(
    element: HTMLElement
): AlignType | undefined {
    const classes = element.classList;
    if (classes.contains("excalidraw-svg-left-wrap")) return "left-wrap";
    if (classes.contains("excalidraw-svg-right-wrap")) return "right-wrap";
    if (classes.contains("excalidraw-svg-left")) return "left";
    if (classes.contains("excalidraw-svg-right")) return "right";
    if (classes.contains("excalidraw-svg-center")) return "center";
    return undefined;
}

function isElement(value: unknown): value is Element {
    return !!value && typeof value === "object"
        && (value as Node).nodeType === 1;
}
