import { App, normalizePath, TFile } from "obsidian";
import type { LocalLinkSettings } from "../settings/types";
import {
    LocalImageTargetResolver,
    type LocalReferenceSyntax
} from "./LocalImageTargetResolver";

export interface ImageReferenceSyntaxModel {
    syntax: "markdown" | "wiki";
    embedded: boolean;
    hasAttributeSeparator: boolean;
    attributes: string;
    path: string;
    titleSuffix: string;
}

export interface SerializeLocalImageReferenceOptions {
    target: TFile;
    sourceFile: TFile;
    settings: LocalLinkSettings;
    originalLink?: string;
    attributes?: string;
}

export class LocalImageReferenceSerializationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "LocalImageReferenceSerializationError";
    }
}

/** Formats and validates plugin-generated local image references. */
export class LocalImageReferenceSerializer {
    private readonly resolver: LocalImageTargetResolver;

    constructor(private readonly app: App) {
        this.resolver = new LocalImageTargetResolver(app);
    }

    serialize(options: SerializeLocalImageReferenceOptions): string {
        const model = options.originalLink
            ? parseImageReferenceSyntax(options.originalLink)
            : null;
        if (options.originalLink && !model) {
            throw new LocalImageReferenceSerializationError("Unsupported image reference syntax");
        }

        let targetSyntax: "markdown" | "wiki" = options.settings.linkFormat === "wikilink"
            ? "wiki"
            : "markdown";
        if (model?.titleSuffix && targetSyntax === "wiki") targetSyntax = "markdown";

        const path = this.formatPath(options.target, options.sourceFile, options.settings);
        const attributes = model?.attributes ?? options.attributes ?? "";
        const embedded = model?.embedded ?? true;
        const titleSuffix = targetSyntax === "markdown" ? model?.titleSuffix ?? "" : "";
        const serialized = targetSyntax === "wiki"
            ? buildWikiReference(path, attributes, embedded, model?.hasAttributeSeparator ?? false)
            : buildMarkdownReference(path, attributes, embedded, titleSuffix);

        this.assertResolvesTo(serialized, options.target, options.sourceFile);
        return serialized;
    }

    formatPath(target: TFile, sourceFile: TFile, settings: LocalLinkSettings): string {
        switch (settings.pathFormat) {
            case "absolute":
                return `/${normalizePath(target.path)}`;
            case "relative": {
                const relative = getRelativeVaultPath(sourceFile.path, target.path);
                if (settings.prependCurrentDir
                    && !relative.startsWith("../")
                    && !relative.startsWith("./")) {
                    return `./${relative}`;
                }
                return relative;
            }
            case "shortest":
                return this.getShortestUnambiguousPath(target, sourceFile);
            default:
                throw new LocalImageReferenceSerializationError("Unsupported local path format");
        }
    }

    private getShortestUnambiguousPath(target: TFile, sourceFile: TFile): string {
        try {
            const linkText = this.app.metadataCache?.fileToLinktext?.(target, sourceFile.path, false);
            if (typeof linkText === "string" && linkText.trim()) return linkText;
        } catch {
            // Fall through to a deterministic vault scan.
        }

        const sameName = (this.app.vault.getFiles?.() ?? [])
            .filter(file => file instanceof TFile && file.name === target.name);
        return sameName.length === 1 ? target.name : normalizePath(target.path);
    }

    private assertResolvesTo(reference: string, target: TFile, sourceFile: TFile): void {
        const parsed = parseImageReferenceSyntax(reference);
        if (!parsed) throw new LocalImageReferenceSerializationError("Generated reference could not be parsed");
        const resolution = this.resolver.resolve(parsed.path, sourceFile, { syntax: parsed.syntax });
        if (resolution.status !== "resolved" || resolution.file?.path !== target.path) {
            throw new LocalImageReferenceSerializationError(
                `Generated reference does not resolve to ${target.path}`
            );
        }
    }
}

export function parseImageReferenceSyntax(source: string): ImageReferenceSyntaxModel | null {
    const trimmed = source.trim();
    const wikiMatch = trimmed.match(/^(!?)\[\[([\s\S]*)\]\]$/);
    if (wikiMatch) {
        const inside = wikiMatch[2];
        const pipe = findFirstUnescapedPipe(inside);
        const rawPath = pipe < 0 ? inside : inside.slice(0, pipe);
        return {
            syntax: "wiki",
            embedded: wikiMatch[1] === "!",
            hasAttributeSeparator: pipe >= 0,
            attributes: pipe < 0 ? "" : inside.slice(pipe + 1),
            path: unescapeWikiPath(rawPath.trim()),
            titleSuffix: ""
        };
    }

    const markdownMatch = trimmed.match(/^(!?)\[([^\]]*)\]\(([\s\S]*)\)$/);
    if (!markdownMatch) return null;
    const destination = splitMarkdownDestination(markdownMatch[3]);
    if (!destination.path) return null;
    return {
        syntax: "markdown",
        embedded: markdownMatch[1] === "!",
        hasAttributeSeparator: true,
        attributes: markdownMatch[2],
        path: destination.path,
        titleSuffix: destination.titleSuffix
    };
}

export function encodeMarkdownLocalPath(path: string): string {
    const prefix = path.startsWith("/") ? "/" : "";
    const segments = path.slice(prefix.length).split("/");
    return prefix + segments.map(segment => {
        if (segment === "." || segment === "..") return segment;
        // Paths reaching the serializer come from TFile.path/fileToLinktext,
        // which are native vault paths. A literal `%20` in a filename must
        // therefore become `%2520`, not be mistaken for an encoded space.
        return encodeURIComponent(segment).replace(/[!'()*]/g, character =>
            `%${character.charCodeAt(0).toString(16).toUpperCase()}`
        );
    }).join("/");
}

function buildWikiReference(
    path: string,
    attributes: string,
    embedded: boolean,
    hasAttributeSeparator: boolean
): string {
    const escapedPath = path.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
    const suffix = attributes || hasAttributeSeparator ? `|${attributes}` : "";
    return `${embedded ? "!" : ""}[[${escapedPath}${suffix}]]`;
}

function buildMarkdownReference(
    path: string,
    attributes: string,
    embedded: boolean,
    titleSuffix: string
): string {
    return `${embedded ? "!" : ""}[${attributes}](${encodeMarkdownLocalPath(path)}${titleSuffix})`;
}

function splitMarkdownDestination(destinationValue: string): { path: string; titleSuffix: string } {
    const destination = destinationValue.trim();
    if (!destination) return { path: "", titleSuffix: "" };
    if (destination.startsWith("<")) {
        const close = findClosingAngle(destination);
        if (close > 0) {
            return {
                path: destination.slice(1, close),
                titleSuffix: destination.slice(close + 1)
            };
        }
    }
    const title = destination.match(/^(.+?)(\s+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\([^)]*\)))$/);
    return title
        ? { path: title[1], titleSuffix: title[2] }
        : { path: destination, titleSuffix: "" };
}

function findClosingAngle(destination: string): number {
    let escaped = false;
    for (let index = 1; index < destination.length; index++) {
        const character = destination[index];
        if (escaped) {
            escaped = false;
        } else if (character === "\\") {
            escaped = true;
        } else if (character === ">") {
            return index;
        }
    }
    return -1;
}

function findFirstUnescapedPipe(text: string): number {
    for (let index = 0; index < text.length; index++) {
        if (text[index] !== "|") continue;
        let slashCount = 0;
        for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor--) slashCount++;
        if (slashCount % 2 === 0) return index;
    }
    return -1;
}

function unescapeWikiPath(path: string): string {
    return path.replace(/\\\|/g, "|").replace(/\\\\/g, "\\");
}

function getRelativeVaultPath(sourcePath: string, targetPath: string): string {
    const from = normalizePath(sourcePath).split("/").slice(0, -1);
    const to = normalizePath(targetPath).split("/");
    let common = 0;
    while (common < from.length && common < to.length && from[common] === to[common]) common++;
    const parentSegments = new Array(from.length - common).fill("..");
    const relative = [...parentSegments, ...to.slice(common)].join("/");
    if (!relative) throw new LocalImageReferenceSerializationError("Target path cannot equal source file path");
    return relative;
}

export function getReferenceSyntax(model: ImageReferenceSyntaxModel): LocalReferenceSyntax {
    return model.syntax;
}
