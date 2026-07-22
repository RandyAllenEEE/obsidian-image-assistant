import {
    getReferenceLocalBasename,
    parsePersistedReferenceIndexV3,
    parseReferenceIndexDocument,
    REFERENCE_INDEX_VERSION,
    type ReferenceIndexDocumentDTO,
    type ReferenceIndexDocumentMetadata,
    type ReferenceIndexStoredLink
} from "./ReferenceIndexDocument";
import { canonicalizeHttpUrl } from "../HttpUrlIdentity";

export interface ReferenceIndexCandidateDTO {
    readonly documentPath: string;
    readonly documentKind: "markdown" | "canvas";
    readonly value: string;
    readonly line: number;
    readonly link?: ReferenceIndexStoredLink;
}

export interface ReferenceIndexCandidateQueryResult {
    readonly references: readonly ReferenceIndexCandidateDTO[];
    readonly uncertainDocuments: readonly string[];
}

export interface ReferenceIndexDocumentHeader {
    readonly path: string;
    readonly kind: "markdown" | "canvas";
    readonly mtime: number;
    readonly size: number;
}

interface DocumentContributions {
    readonly local: Array<{ key: string; value: ReferenceIndexCandidateDTO }>;
    readonly urls: Array<{ key: string; value: ReferenceIndexCandidateDTO }>;
    readonly uncertainUrls: Array<{ key: string; documentPath: string; context: string }>;
}

export class ReferenceIndexWorkerCore {
    private readonly documents = new Map<string, ReferenceIndexDocumentDTO>();
    private readonly overlays = new Map<string, ReferenceIndexDocumentDTO>();
    private readonly overlayContributions = new Map<string, DocumentContributions>();
    private readonly localBuckets = new Map<string, ReferenceIndexCandidateDTO[]>();
    private readonly urlBuckets = new Map<string, ReferenceIndexCandidateDTO[]>();
    private readonly uncertainUrls = new Map<string, Array<{
        documentPath: string;
        context: string;
    }>>();
    private readonly contributions = new Map<string, DocumentContributions>();
    private generation = 0;

    hydrate(buffer: ArrayBuffer): {
        accepted: boolean;
        generation: number;
        headers: ReferenceIndexDocumentHeader[];
    } {
        const raw = new TextDecoder().decode(new Uint8Array(buffer));
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            return { accepted: false, generation: this.generation, headers: [] };
        }
        const persisted = parsePersistedReferenceIndexV3(parsed);
        if (!persisted) {
            return { accepted: false, generation: this.generation, headers: [] };
        }
        this.clear();
        persisted.documents.forEach(document => this.setDocument(document));
        this.generation++;
        return {
            accepted: true,
            generation: this.generation,
            headers: this.getHeaders()
        };
    }

    upsertDocument(
        metadata: ReferenceIndexDocumentMetadata,
        content: string
    ): ReferenceIndexDocumentHeader {
        const document = parseReferenceIndexDocument(metadata, content);
        this.setDocument(document);
        this.generation++;
        return toHeader(document);
    }

    deleteDocument(path: string): boolean {
        this.removeContributions(path);
        const deleted = this.documents.delete(path);
        if (deleted) this.generation++;
        return deleted;
    }

    upsertOverlay(
        metadata: ReferenceIndexDocumentMetadata,
        content: string
    ): void {
        const document = parseReferenceIndexDocument(metadata, content);
        this.overlays.set(metadata.path, document);
        this.overlayContributions.set(metadata.path, createContributions(document));
    }

    deleteOverlay(path: string): void {
        this.overlays.delete(path);
        this.overlayContributions.delete(path);
    }

    getHeaders(): ReferenceIndexDocumentHeader[] {
        return [...this.documents.values()]
            .map(toHeader)
            .sort((left, right) => left.path.localeCompare(right.path));
    }

    getGeneration(): number {
        return this.generation;
    }

    queryLocal(
        basenames: readonly string[],
        includeFencedCode: boolean,
        overlayPaths: readonly string[]
    ): Record<string, ReferenceIndexCandidateQueryResult> {
        const overlaySet = new Set(overlayPaths);
        const result: Record<string, ReferenceIndexCandidateQueryResult> = {};
        for (const rawBasename of basenames) {
            const basename = rawBasename.toLowerCase();
            const references = (this.localBuckets.get(basename) ?? [])
                .filter(reference => !overlaySet.has(reference.documentPath))
                .filter(reference => isCandidateMutable(reference, includeFencedCode));
            for (const path of overlaySet) {
                const contribution = this.overlayContributions.get(path);
                if (!contribution) continue;
                references.push(...contribution.local
                    .filter(item => item.key === basename)
                    .map(item => item.value)
                    .filter(reference => isCandidateMutable(reference, includeFencedCode)));
            }
            result[rawBasename] = {
                references: references.sort(compareCandidates),
                uncertainDocuments: []
            };
        }
        return result;
    }

    queryUrl(
        url: string,
        includeFencedCode: boolean,
        overlayPaths: readonly string[]
    ): ReferenceIndexCandidateQueryResult {
        const canonical = canonicalizeHttpUrl(url);
        if (!canonical) return { references: [], uncertainDocuments: [url] };
        const overlaySet = new Set(overlayPaths);
        const references = (this.urlBuckets.get(canonical) ?? [])
            .filter(reference => !overlaySet.has(reference.documentPath))
            .filter(reference => isCandidateMutable(reference, includeFencedCode));
        const uncertain = new Set(
            (this.uncertainUrls.get(canonical) ?? [])
                .filter(item => !overlaySet.has(item.documentPath))
                .filter(item => includeFencedCode || item.context !== "fenced-code")
                .map(item => item.documentPath)
        );
        for (const path of overlaySet) {
            const contribution = this.overlayContributions.get(path);
            if (!contribution) continue;
            references.push(...contribution.urls
                .filter(item => item.key === canonical)
                .map(item => item.value)
                .filter(reference => isCandidateMutable(reference, includeFencedCode)));
            contribution.uncertainUrls
                .filter(item => item.key === canonical)
                .filter(item => includeFencedCode || item.context !== "fenced-code")
                .forEach(item => uncertain.add(item.documentPath));
        }
        return {
            references: references.sort(compareCandidates),
            uncertainDocuments: [...uncertain].sort()
        };
    }

    serialize(): ArrayBuffer {
        const documents = [...this.documents.values()]
            .sort((left, right) => left.path.localeCompare(right.path));
        const raw = JSON.stringify({
            version: REFERENCE_INDEX_VERSION,
            documents
        });
        return new TextEncoder().encode(raw).buffer;
    }

    private clear(): void {
        this.documents.clear();
        this.overlays.clear();
        this.overlayContributions.clear();
        this.localBuckets.clear();
        this.urlBuckets.clear();
        this.uncertainUrls.clear();
        this.contributions.clear();
    }

    private setDocument(document: ReferenceIndexDocumentDTO): void {
        this.removeContributions(document.path);
        this.documents.set(document.path, document);
        const contribution = createContributions(document);
        contribution.local.forEach(item => addToBucket(this.localBuckets, item.key, item.value));
        contribution.urls.forEach(item => addToBucket(this.urlBuckets, item.key, item.value));
        contribution.uncertainUrls.forEach(item => {
            const values = this.uncertainUrls.get(item.key) ?? [];
            values.push({ documentPath: item.documentPath, context: item.context });
            this.uncertainUrls.set(item.key, values);
        });
        this.contributions.set(document.path, contribution);
    }

    private removeContributions(path: string): void {
        const contribution = this.contributions.get(path);
        if (!contribution) return;
        contribution.local.forEach(item => removeFromBucket(this.localBuckets, item.key, item.value));
        contribution.urls.forEach(item => removeFromBucket(this.urlBuckets, item.key, item.value));
        contribution.uncertainUrls.forEach(item => {
            const values = this.uncertainUrls.get(item.key);
            if (!values) return;
            const index = values.findIndex(value =>
                value.documentPath === item.documentPath && value.context === item.context);
            if (index >= 0) values.splice(index, 1);
            if (values.length === 0) this.uncertainUrls.delete(item.key);
        });
        this.contributions.delete(path);
    }
}

function createContributions(document: ReferenceIndexDocumentDTO): DocumentContributions {
    const local: DocumentContributions["local"] = [];
    const urls: DocumentContributions["urls"] = [];
    const uncertainUrls: DocumentContributions["uncertainUrls"] = [];
    for (const link of document.links) {
        const candidate = toCandidate(document, link.path, link.line, link);
        const canonical = canonicalizeHttpUrl(link.path);
        if (canonical) urls.push({ key: canonical, value: candidate });
        else {
            const basename = getReferenceLocalBasename(link.path, link.syntax);
            if (basename) local.push({ key: basename, value: candidate });
        }
    }
    if (document.kind === "canvas") {
        document.nativeFiles.forEach(path => {
            const basename = getReferenceLocalBasename(path, "native");
            if (basename) local.push({
                key: basename,
                value: toCandidate(document, path, 0)
            });
        });
        document.nativeUrls.forEach(url => {
            const canonical = canonicalizeHttpUrl(url);
            if (canonical) urls.push({
                key: canonical,
                value: toCandidate(document, url, 0)
            });
        });
    }
    document.unparsedUrls.forEach(item => uncertainUrls.push({
        key: item.canonicalUrl,
        documentPath: document.path,
        context: item.context
    }));
    return { local, urls, uncertainUrls };
}

function toCandidate(
    document: ReferenceIndexDocumentDTO,
    value: string,
    line: number,
    link?: ReferenceIndexStoredLink
): ReferenceIndexCandidateDTO {
    return {
        documentPath: document.path,
        documentKind: document.kind,
        value,
        line,
        link
    };
}

function toHeader(document: ReferenceIndexDocumentDTO): ReferenceIndexDocumentHeader {
    return {
        path: document.path,
        kind: document.kind,
        mtime: document.mtime,
        size: document.size
    };
}

function isCandidateMutable(
    candidate: ReferenceIndexCandidateDTO,
    includeFencedCode: boolean
): boolean {
    const context = candidate.link?.context;
    return context !== "fenced-code" || includeFencedCode;
}

function addToBucket(
    map: Map<string, ReferenceIndexCandidateDTO[]>,
    key: string,
    value: ReferenceIndexCandidateDTO
): void {
    const values = map.get(key) ?? [];
    values.push(value);
    map.set(key, values);
}

function removeFromBucket(
    map: Map<string, ReferenceIndexCandidateDTO[]>,
    key: string,
    value: ReferenceIndexCandidateDTO
): void {
    const values = map.get(key);
    if (!values) return;
    const index = values.indexOf(value);
    if (index >= 0) values.splice(index, 1);
    if (values.length === 0) map.delete(key);
}

function compareCandidates(
    left: ReferenceIndexCandidateDTO,
    right: ReferenceIndexCandidateDTO
): number {
    return left.documentPath.localeCompare(right.documentPath)
        || (left.link?.index ?? left.line) - (right.link?.index ?? right.line)
        || left.value.localeCompare(right.value);
}
