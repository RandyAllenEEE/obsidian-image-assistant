import {
    isMarkdownSourceContextIncluded,
    MarkdownSourceContextIndex,
    type MarkdownSourceContext
} from "../MarkdownSourceContext";
import {
    getAllReferenceLinks,
    type ReferenceLink
} from "../RegexPatterns";
import { canonicalizeHttpUrl } from "../HttpUrlIdentity";

export const REFERENCE_INDEX_VERSION = 3;

export interface ReferenceIndexStoredLink {
    readonly path: string;
    readonly source: string;
    readonly index: number;
    readonly line: number;
    readonly syntax: ReferenceLink["syntax"];
    readonly context: MarkdownSourceContext;
}

export interface ReferenceIndexStoredUnparsedUrl {
    readonly canonicalUrl: string;
    readonly context: MarkdownSourceContext;
}

export interface ReferenceIndexDocumentDTO {
    readonly path: string;
    readonly kind: "markdown" | "canvas";
    readonly mtime: number;
    readonly size: number;
    readonly links: readonly ReferenceIndexStoredLink[];
    readonly nativeFiles: readonly string[];
    readonly nativeUrls: readonly string[];
    readonly unparsedUrls: readonly ReferenceIndexStoredUnparsedUrl[];
}

export interface PersistedReferenceIndexV3 {
    readonly version: 3;
    readonly documents: readonly ReferenceIndexDocumentDTO[];
}

export interface ReferenceIndexDocumentMetadata {
    readonly path: string;
    readonly kind: "markdown" | "canvas";
    readonly mtime: number;
    readonly size: number;
}

interface CanvasReferenceNodeDTO {
    readonly type?: unknown;
    readonly file?: unknown;
    readonly url?: unknown;
    readonly text?: unknown;
}

interface CanvasDocumentDTO {
    readonly nodes: readonly CanvasReferenceNodeDTO[];
}

const SAFETY_CONTEXT_OPTIONS = Object.freeze({ includeFencedCode: true });

export function parseReferenceIndexDocument(
    metadata: ReferenceIndexDocumentMetadata,
    content: string
): ReferenceIndexDocumentDTO {
    return metadata.kind === "markdown"
        ? parseMarkdownDocument(metadata, content)
        : parseCanvasDocument(metadata, content);
}

export function parsePersistedReferenceIndexV3(
    value: unknown
): PersistedReferenceIndexV3 | null {
    if (!value || typeof value !== "object") return null;
    const candidate = value as Partial<PersistedReferenceIndexV3>;
    if (candidate.version !== REFERENCE_INDEX_VERSION
        || !Array.isArray(candidate.documents)
        || !candidate.documents.every(isReferenceIndexDocumentDTO)) {
        return null;
    }
    return {
        version: REFERENCE_INDEX_VERSION,
        documents: candidate.documents
    };
}

export function isReferenceIndexDocumentDTO(
    value: unknown
): value is ReferenceIndexDocumentDTO {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<ReferenceIndexDocumentDTO>;
    return typeof candidate.path === "string"
        && (candidate.kind === "markdown" || candidate.kind === "canvas")
        && Number.isFinite(candidate.mtime)
        && Number.isFinite(candidate.size)
        && Array.isArray(candidate.links)
        && candidate.links.every(isStoredLink)
        && Array.isArray(candidate.nativeFiles)
        && candidate.nativeFiles.every(item => typeof item === "string")
        && Array.isArray(candidate.nativeUrls)
        && candidate.nativeUrls.every(item => typeof item === "string")
        && Array.isArray(candidate.unparsedUrls)
        && candidate.unparsedUrls.every(isStoredUnparsedUrl);
}

export function getReferenceLocalBasename(
    referencePath: string,
    syntax: ReferenceLink["syntax"] | "native"
): string {
    let raw = referencePath.trim();
    if (raw.startsWith("<") && raw.endsWith(">")) raw = raw.slice(1, -1);
    const hashIndex = raw.indexOf("#");
    raw = hashIndex < 0 ? raw : raw.slice(0, hashIndex);
    if (syntax === "markdown") {
        try {
            raw = decodeURIComponent(raw.replace(/%(?![0-9a-f]{2})/gi, "%25"));
        } catch {
            return "";
        }
    }
    const normalized = raw.replace(/\\/g, "/").replace(/\/+$/, "");
    return normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
}

function parseMarkdownDocument(
    metadata: ReferenceIndexDocumentMetadata,
    content: string
): ReferenceIndexDocumentDTO {
    const contextIndex = MarkdownSourceContextIndex.create(content);
    const links = getContextualLinks(content, contextIndex);
    return {
        ...metadata,
        links: toStoredLinks(links, content),
        nativeFiles: [],
        nativeUrls: [],
        unparsedUrls: getUnparsedUrls(content, links, contextIndex)
    };
}

function parseCanvasDocument(
    metadata: ReferenceIndexDocumentMetadata,
    content: string
): ReferenceIndexDocumentDTO {
    const parsed = JSON.parse(content) as Partial<CanvasDocumentDTO> | null;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.nodes)) {
        throw new Error("Canvas document does not contain a valid nodes array");
    }

    const links: ReferenceIndexStoredLink[] = [];
    const nativeFiles: string[] = [];
    const nativeUrls: string[] = [];
    const unparsedUrls: ReferenceIndexStoredUnparsedUrl[] = [];
    for (const node of parsed.nodes) {
        if (node.type === "file" && typeof node.file === "string") {
            nativeFiles.push(node.file);
        }
        if (typeof node.url === "string" && canonicalizeHttpUrl(node.url)) {
            nativeUrls.push(node.url);
        }
        if (typeof node.text !== "string") continue;
        const contextIndex = MarkdownSourceContextIndex.create(node.text);
        const nodeLinks = getContextualLinks(node.text, contextIndex);
        links.push(...toStoredLinks(nodeLinks, node.text));
        unparsedUrls.push(...getUnparsedUrls(node.text, nodeLinks, contextIndex));
    }
    return {
        ...metadata,
        links,
        nativeFiles: unique(nativeFiles),
        nativeUrls: unique(nativeUrls),
        unparsedUrls: uniqueUnparsedUrls(unparsedUrls)
    };
}

function getContextualLinks(
    content: string,
    contextIndex: MarkdownSourceContextIndex
): Array<ReferenceLink & { context: MarkdownSourceContext }> {
    return getAllReferenceLinks(content)
        .map(link => ({
            ...link,
            context: contextIndex.contextAt(link.index, link.index + link.source.length)
        }))
        .filter(link => isMarkdownSourceContextIncluded(
            link.context,
            SAFETY_CONTEXT_OPTIONS
        ));
}

function toStoredLinks(
    links: readonly (ReferenceLink & { context: MarkdownSourceContext })[],
    content: string
): ReferenceIndexStoredLink[] {
    const sorted = [...links].sort((left, right) => left.index - right.index);
    const stored: ReferenceIndexStoredLink[] = [];
    let cursor = 0;
    let line = 0;
    for (const link of sorted) {
        const target = Math.max(cursor, Math.min(link.index, content.length));
        while (cursor < target) {
            if (content.charCodeAt(cursor) === 10) line++;
            cursor++;
        }
        stored.push({
            path: link.path,
            source: link.source,
            index: link.index,
            line,
            syntax: link.syntax,
            context: link.context
        });
    }
    return stored;
}

function getUnparsedUrls(
    content: string,
    links: readonly (ReferenceLink & { context: MarkdownSourceContext })[],
    contextIndex: MarkdownSourceContextIndex
): ReferenceIndexStoredUnparsedUrl[] {
    const parsedRanges = links
        .map(link => ({ start: link.index, end: link.index + link.source.length }))
        .sort((left, right) => left.start - right.start);
    const values: ReferenceIndexStoredUnparsedUrl[] = [];
    const pattern = /https?:\/\/[^\s<>"'`\])]+/gi;
    let rangeIndex = 0;
    for (const match of content.matchAll(pattern)) {
        const start = match.index ?? -1;
        if (start < 0) continue;
        while (rangeIndex < parsedRanges.length
            && parsedRanges[rangeIndex].end <= start) {
            rangeIndex++;
        }
        const parsed = parsedRanges[rangeIndex];
        if (parsed && parsed.start <= start && start < parsed.end) continue;
        const value = match[0];
        const context = contextIndex.contextAt(start, start + value.length);
        if (!isMarkdownSourceContextIncluded(context, SAFETY_CONTEXT_OPTIONS)) continue;
        const canonicalUrl = canonicalizeHttpUrl(value);
        if (canonicalUrl) values.push({ canonicalUrl, context });
    }
    return uniqueUnparsedUrls(values);
}

function isStoredLink(value: unknown): value is ReferenceIndexStoredLink {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<ReferenceIndexStoredLink>;
    return typeof candidate.path === "string"
        && typeof candidate.source === "string"
        && Number.isSafeInteger(candidate.index)
        && Number.isSafeInteger(candidate.line)
        && (candidate.syntax === "markdown"
            || candidate.syntax === "wiki"
            || candidate.syntax === "autolink")
        && isMarkdownSourceContext(candidate.context);
}

function isStoredUnparsedUrl(
    value: unknown
): value is ReferenceIndexStoredUnparsedUrl {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<ReferenceIndexStoredUnparsedUrl>;
    return typeof candidate.canonicalUrl === "string"
        && isMarkdownSourceContext(candidate.context);
}

function isMarkdownSourceContext(value: unknown): value is MarkdownSourceContext {
    return value === "prose"
        || value === "callout"
        || value === "admonition"
        || value === "frontmatter"
        || value === "fenced-code"
        || value === "inline-code"
        || value === "html-comment";
}

function unique(values: readonly string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}

function uniqueUnparsedUrls(
    values: readonly ReferenceIndexStoredUnparsedUrl[]
): ReferenceIndexStoredUnparsedUrl[] {
    const seen = new Set<string>();
    return values.filter(value => {
        const key = `${value.context}:${value.canonicalUrl}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
