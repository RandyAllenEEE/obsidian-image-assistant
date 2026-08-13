import { App, TFile, normalizePath } from "obsidian";
import type ImageConverterPlugin from "../../../main";
import {
    findExcalidrawRenderedEmbed,
    type ExcalidrawRenderedEmbed
} from "../../../drawing/excalidraw/ExcalidrawRenderedEmbed";
import { inspectDrawingFile } from "../../../drawing/DrawingFileSemantics";
import {
    getImageLayoutKey,
    getImageSourceKey,
    type ImageSourceDescriptor
} from "../../../utils/MarkdownSourceContext";
import type { ImageContextMenuContext } from "../types";
import {
    ImageViewContextResolver,
    type ImageViewContext,
    type ImageViewOwnerContext
} from "./ImageViewContextResolver";

/** Resolves an upstream inline SVG back to a verified Vault drawing and source link. */
export class ExcalidrawRenderedContextResolver {
    constructor(
        private readonly app: App,
        private readonly plugin: ImageConverterPlugin,
        private readonly viewResolver: ImageViewContextResolver
    ) {}

    resolve(target: Element): ImageContextMenuContext | null {
        const render = findExcalidrawRenderedEmbed(target);
        if (!render) return null;
        const owner = this.viewResolver.resolveElementOwner(render.element);
        const file = this.resolveSourceFile(render, owner);
        const semantics = file ? inspectDrawingFile(this.plugin, file) : null;
        if (!file || semantics?.providerId !== "excalidraw") return null;

        const viewContext = owner
            ? this.resolveExactReference(render, file, owner)
            : null;
        const renderedSrc = render.image?.currentSrc
            || render.image?.src
            || "";
        return Object.freeze({
            image: render.image,
            mediaElement: render.element,
            ownerDocument: render.element.ownerDocument,
            ownerWindow: render.element.ownerDocument.defaultView,
            renderedSrc,
            sourceKind: "local",
            resolution: viewContext ? "resolved" : "unresolved",
            owner: owner ?? null,
            viewContext,
            descriptor: viewContext?.match.descriptor ?? null,
            localFile: file,
            url: null,
            dataReference: null
        });
    }

    private resolveSourceFile(
        render: ExcalidrawRenderedEmbed,
        owner: ImageViewOwnerContext | null
    ): TFile | null {
        const linkpath = render.fileSource.split("#", 1)[0]?.trim() ?? "";
        if (!linkpath) return null;
        const direct = this.app.vault.getAbstractFileByPath(normalizePath(linkpath));
        if (direct instanceof TFile) return direct;
        if (!owner) return null;
        const resolved = this.app.metadataCache.getFirstLinkpathDest(
            linkpath,
            owner.file.path
        );
        return resolved instanceof TFile ? resolved : null;
    }

    private resolveExactReference(
        render: ExcalidrawRenderedEmbed,
        file: TFile,
        owner: ImageViewOwnerContext
    ): ImageViewContext | null {
        const index = this.viewResolver.prepareEditor(owner.editor);
        const candidates = index.descriptors.filter(descriptor =>
            this.descriptorTargetsFile(descriptor, owner, file));
        if (candidates.length === 0) return null;

        const offset = readEditorOffset(owner, render.element);
        const descriptor = offset === null
            ? candidates.length === 1 ? candidates[0] : null
            : selectDescriptorAtOffset(candidates, offset, index.lineStarts);
        if (!descriptor) return null;

        const line = getLineForOffset(index.lineStarts, descriptor.index);
        const start = descriptor.index - index.lineStarts[line];
        return Object.freeze({
            ...owner,
            match: Object.freeze({
                linkText: descriptor.source,
                line,
                start,
                end: start + descriptor.source.length,
                score: 4,
                descriptor,
                sourceKey: getImageSourceKey(descriptor),
                layoutKey: getImageLayoutKey(descriptor)
            })
        });
    }

    private descriptorTargetsFile(
        descriptor: ImageSourceDescriptor,
        owner: ImageViewOwnerContext,
        file: TFile
    ): boolean {
        const resolved = this.app.metadataCache.getFirstLinkpathDest(
            descriptor.path,
            owner.file.path
        );
        return resolved instanceof TFile && resolved.path === file.path;
    }
}

function readEditorOffset(
    owner: ImageViewOwnerContext,
    element: Element
): number | null {
    const cm = (owner.editor as unknown as {
        cm?: { posAtDOM(node: Node, offset?: number): number };
    }).cm;
    if (!cm?.posAtDOM) return null;
    for (const node of [element, element.closest(".cm-embed-block, .cm-line")]) {
        if (!node) continue;
        try {
            const offset = cm.posAtDOM(node, 0);
            if (Number.isInteger(offset) && offset >= 0) return offset;
        } catch {
            // CodeMirror does not always expose positions for async embed descendants.
        }
    }
    return null;
}

function selectDescriptorAtOffset(
    candidates: readonly ImageSourceDescriptor[],
    offset: number,
    lineStarts: readonly number[]
): ImageSourceDescriptor | null {
    const containing = candidates.filter(candidate =>
        offset >= candidate.index && offset <= candidate.end);
    if (containing.length === 1) return containing[0];
    if (containing.length > 1) return null;

    const line = getLineForOffset(lineStarts, offset);
    const sameLine = candidates.filter(candidate => candidate.line === line);
    if (sameLine.length !== 1) return null;
    return sameLine[0];
}

function getLineForOffset(lineStarts: readonly number[], offset: number): number {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
        const middle = (low + high) >>> 1;
        if (lineStarts[middle] <= offset) low = middle + 1;
        else high = middle - 1;
    }
    return Math.max(0, high);
}
