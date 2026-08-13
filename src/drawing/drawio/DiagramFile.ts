import { normalizePath, TFile } from "obsidian";

export const DRAWIO_SVG_SUFFIX = ".drawio.svg";
export const DRAWIO_XML_SUFFIX = ".drawio";

export const EMPTY_DRAWIO_XML = '<mxfile host="Image Assistant"><diagram id="image-assistant-page-1" name="Page-1"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

const MAX_COMPARABLE_DRAWIO_XML_CHARS = 16 * 1024 * 1024;

export const EMPTY_DRAWIO_SVG = [
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"',
    ' version="1.1" width="100px" height="100px" viewBox="0 0 100 100"',
    ` content="${escapeXmlAttribute(EMPTY_DRAWIO_XML)}">`,
    '<rect x="0" y="0" width="100" height="100" fill="transparent"/>',
    '</svg>'
].join("");

export function isDrawioDiagramPath(path: string): boolean {
    const lower = normalizePath(path).toLowerCase();
    return lower.endsWith(DRAWIO_SVG_SUFFIX) || lower.endsWith(DRAWIO_XML_SUFFIX);
}

export function isDrawioSvgPath(path: string): boolean {
    return normalizePath(path).toLowerCase().endsWith(DRAWIO_SVG_SUFFIX);
}

export function isDrawioDiagramFile(file: TFile | null | undefined): boolean {
    return file instanceof TFile && isDrawioDiagramPath(file.path);
}

export function stripDrawioDiagramSuffix(value: string): string {
    return value.replace(/\.drawio(?:\.svg)?$/i, "");
}

export function getDrawioDiagramSuffix(file: TFile | null | undefined): string | null {
    if (!file || !isDrawioDiagramFile(file)) return null;
    return isDrawioSvgPath(file.path) ? DRAWIO_SVG_SUFFIX : DRAWIO_XML_SUFFIX;
}

export function assertValidDiagramXml(value: string): void {
    const xml = value.trim();
    if (!xml) {
        throw new Error("The response does not contain a Draw.io diagram model.");
    }
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    if (parsed.querySelector("parsererror")) {
        throw new Error("The Draw.io diagram XML is malformed.");
    }
    const root = parsed.documentElement;
    if (root.localName === "mxGraphModel") return;
    if (root.localName !== "mxfile") {
        throw new Error("The Draw.io diagram has no mxfile or mxGraphModel root.");
    }
    const diagrams = Array.from(root.children).filter(child => child.localName === "diagram");
    if (diagrams.length === 0 || diagrams.some(diagram =>
        !diagram.querySelector("mxGraphModel") && !diagram.textContent?.trim()
    )) {
        throw new Error("The Draw.io mxfile has no diagram data.");
    }
}

export function assertUncompressedDiagramXml(value: string): void {
    assertValidDiagramXml(value);
    const parsed = new DOMParser().parseFromString(value.trim(), "application/xml");
    if (!parsed.querySelector("mxGraphModel")
        && parsed.documentElement.localName !== "mxGraphModel") {
        throw new Error("Draw.io returned compressed XML; reopen the editor and retry.");
    }
}

/**
 * Returns whether two uncompressed Draw.io models are semantically equivalent.
 * `null` means the comparison cannot be performed safely (for example a
 * compressed page or an excessively large model).
 */
export function areDrawioModelsEquivalent(left: string, right: string): boolean | null {
    const leftSignature = createModelSignature(left);
    const rightSignature = createModelSignature(right);
    if (!leftSignature || !rightSignature) return null;

    if (leftSignature.kind === "model" && rightSignature.kind === "model") {
        return leftSignature.model === rightSignature.model;
    }
    if (leftSignature.kind === "model" && rightSignature.kind === "file") {
        return rightSignature.pages.length === 1
            && leftSignature.model === rightSignature.pages[0]?.model;
    }
    if (leftSignature.kind === "file" && rightSignature.kind === "model") {
        return leftSignature.pages.length === 1
            && leftSignature.pages[0]?.model === rightSignature.model;
    }
    if (leftSignature.kind !== "file" || rightSignature.kind !== "file") return false;
    return JSON.stringify(leftSignature.pages) === JSON.stringify(rightSignature.pages);
}

export function assertValidDrawioSvg(value: string): void {
    extractDrawioModelFromSvg(value);
}

/** Returns the editable model while keeping the original SVG as the Vault baseline. */
export function extractDrawioModelFromSvg(value: string): string {
    const parsed = parseSvg(value);
    const embedded = parsed.documentElement.getAttribute("content") ?? "";
    try {
        assertValidDiagramXml(embedded);
        return embedded;
    } catch {
        throw new Error("The SVG does not contain an editable Draw.io model.");
    }
}

export function assertValidSvg(value: string): void {
    parseSvg(value);
}

function parseSvg(value: string): Document {
    const svg = value.trim();
    const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
    if (parsed.querySelector("parsererror") || parsed.documentElement.localName !== "svg") {
        throw new Error("Draw.io returned malformed SVG data.");
    }
    return parsed;
}

type DrawioModelSignature =
    | { readonly kind: "model"; readonly model: string }
    | {
        readonly kind: "file";
        readonly pages: ReadonlyArray<{
            readonly attributes: string;
            readonly model: string;
        }>;
    };

function createModelSignature(value: string): DrawioModelSignature | null {
    if (value.length > MAX_COMPARABLE_DRAWIO_XML_CHARS) return null;
    const parsed = new DOMParser().parseFromString(value.trim(), "application/xml");
    if (parsed.querySelector("parsererror")) return null;
    const root = parsed.documentElement;
    if (root.localName === "mxGraphModel") {
        return { kind: "model", model: canonicalizeElement(root) };
    }
    if (root.localName !== "mxfile") return null;
    const diagrams = Array.from(root.children).filter(child => child.localName === "diagram");
    if (diagrams.length === 0) return null;
    const pages: Array<{ attributes: string; model: string }> = [];
    for (const diagram of diagrams) {
        const model = Array.from(diagram.children)
            .find(child => child.localName === "mxGraphModel");
        // Compressed diagram text cannot be compared without duplicating the
        // Draw.io compression implementation. Require a real load event instead.
        if (!model) return null;
        pages.push({
            attributes: canonicalizeAttributes(diagram),
            model: canonicalizeElement(model)
        });
    }
    return { kind: "file", pages };
}

function canonicalizeElement(element: Element): string {
    const children: Array<string> = [];
    for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === Node.ELEMENT_NODE) {
            children.push(canonicalizeElement(child as Element));
        } else if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
            children.push(JSON.stringify(child.textContent));
        }
    }
    return JSON.stringify([
        element.localName,
        canonicalizeAttributes(element),
        children
    ]);
}

function canonicalizeAttributes(element: Element): string {
    const ignored = element.localName === "mxGraphModel"
        ? new Set(["dx", "dy"])
        : new Set<string>();
    return JSON.stringify(Array.from(element.attributes)
        .filter(attribute => !ignored.has(attribute.name))
        .map(attribute => [attribute.name, attribute.value] as const)
        .sort(([left], [right]) => left.localeCompare(right)));
}

export function decodeDrawioDataUri(value: string): string {
    const comma = value.indexOf(",");
    if (!value.startsWith("data:") || comma < 0) {
        assertValidDrawioSvg(value);
        return value;
    }
    const header = value.slice(0, comma).toLowerCase();
    const payload = value.slice(comma + 1);
    let decoded: string;
    if (header.includes(";base64")) {
        const binary = atob(payload);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        decoded = new TextDecoder().decode(bytes);
    } else {
        decoded = decodeURIComponent(payload);
    }
    assertValidDrawioSvg(decoded);
    return decoded;
}

export function buildCompoundFilename(stem: string, index = 0): string {
    const base = stripDrawioDiagramSuffix(stem).trim() || "Drawing";
    return `${base}${index > 0 ? `-${index}` : ""}${DRAWIO_SVG_SUFFIX}`;
}

function escapeXmlAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}
