import { App, TFile } from "obsidian";
import {
    inferLocalReferenceSyntax,
    LocalImageTargetResolver
} from "../../../utils/LocalImageTargetResolver";
import { isHttpUrl } from "../../../utils/NetworkPolicy";
import type {
    ImageContextMenuContext,
    ImageContextMenuSourceKind,
    ImageContextResolution,
    ImageDataReferenceContext,
    OfficialImageMenuHint
} from "../types";
import { ImageMatchFinder } from "./ImageMatchFinder";
import { ImageViewContextResolver } from "./ImageViewContextResolver";

/** Resolves one rendered image once for every context-menu consumer. */
export class ImageContextMenuResolver {
    private readonly localTargetResolver: LocalImageTargetResolver;

    constructor(
        private readonly app: App,
        private readonly viewResolver: ImageViewContextResolver,
        private readonly imageMatchFinder: ImageMatchFinder
    ) {
        this.localTargetResolver = new LocalImageTargetResolver(app);
    }

    resolve(image: HTMLImageElement): ImageContextMenuContext {
        return this.resolveInternal(image);
    }

    resolveForOfficialMenu(
        image: HTMLImageElement,
        hint: OfficialImageMenuHint,
        previous?: ImageContextMenuContext
    ): ImageContextMenuContext {
        const urlHint = hint.kind === "url" && isHttpUrl(hint.url)
            ? hint.url
            : null;
        const resolved = this.resolveInternal(image, urlHint);
        if (resolved.resolution === "resolved") return resolved;

        if (previous?.resolution === "resolved"
            && previous.viewContext
            && this.viewResolver.isContextCurrent(image, previous.viewContext)) {
            return previous;
        }

        if (!urlHint) return resolved;
        return Object.freeze({
            ...resolved,
            sourceKind: "url",
            resolution: "pending",
            url: urlHint,
            localFile: null,
            dataReference: null
        });
    }

    private resolveInternal(
        image: HTMLImageElement,
        urlHint?: string | null
    ): ImageContextMenuContext {
        const ownerDocument = image.ownerDocument ?? document;
        const renderedSrc = image.getAttribute("src")?.trim() ?? "";
        const owner = this.viewResolver.resolveOwner(image);
        const detailed = urlHint
            ? this.viewResolver.resolveWithUrlHint(image, urlHint, owner)
            : this.viewResolver.resolveDetailed(image, undefined, owner);
        const viewContext = detailed.status === "resolved" ? detailed.context : null;
        const descriptor = viewContext?.match.descriptor ?? null;
        const sourceTarget = descriptor?.path.trim() ?? "";
        const sourceKind = classifySource(
            sourceTarget || urlHint || renderedSrc,
            !!descriptor
        );
        let resolution: ImageContextResolution = viewContext
            ? "resolved"
            : detailed.status === "pending"
                ? "pending"
                : "unresolved";
        let localFile: TFile | null = null;
        let url: string | null = null;
        let dataReference: ImageDataReferenceContext | null = null;

        if (sourceKind === "local" && owner && sourceTarget) {
            const target = this.localTargetResolver.resolve(sourceTarget, owner.file, {
                syntax: inferLocalReferenceSyntax(viewContext?.match.linkText ?? "")
            });
            if (target.status === "resolved" && target.file instanceof TFile) {
                localFile = target.file;
            } else {
                resolution = target.status === "unresolved" ? "unresolved" : "pending";
            }
        } else if (sourceKind === "url") {
            url = isHttpUrl(sourceTarget)
                ? sourceTarget
                : urlHint
                    ?? (isHttpUrl(renderedSrc) ? renderedSrc : null);
            if (!viewContext) resolution = detailed.status === "pending" ? "pending" : "unresolved";
        } else if (sourceKind === "data") {
            if (viewContext && owner) {
                dataReference = {
                    owner,
                    match: {
                        lineNumber: viewContext.match.line,
                        line: owner.editor.getLine(viewContext.match.line),
                        fullMatch: viewContext.match.linkText,
                        index: viewContext.match.start
                    }
                };
            } else if (owner && renderedSrc) {
                const matches = this.imageMatchFinder.findBase64ImageMatches(
                    owner.editor,
                    renderedSrc
                );
                if (matches.length === 1) {
                    dataReference = { owner, match: matches[0] };
                    resolution = "resolved";
                } else {
                    resolution = matches.length > 1 ? "pending" : "unresolved";
                }
            }
        }

        if (sourceKind === "local" && !localFile) {
            resolution = resolution === "resolved" ? "unresolved" : resolution;
        }

        return Object.freeze({
            image,
            ownerDocument,
            ownerWindow: ownerDocument.defaultView,
            renderedSrc,
            sourceKind,
            resolution,
            owner,
            viewContext,
            descriptor,
            localFile,
            url,
            dataReference
        });
    }
}

function classifySource(value: string, hasDescriptor: boolean): ImageContextMenuSourceKind {
    const trimmed = value.trim();
    if (!trimmed) return "unresolved";
    if (/^data:image\//i.test(trimmed)) return "data";
    if (/^blob:/i.test(trimmed)) return "blob";
    if (isHttpUrl(trimmed)) return "url";
    return hasDescriptor ? "local" : "unresolved";
}
