import { App, TFile, normalizePath } from "obsidian";
import { ImageLinkPathReplacer } from "./ImageLinkPathReplacer";
import { isHttpUrl, isSameHttpUrl } from "./NetworkPolicy";
import {
    getContextualReferenceLinks,
    MarkdownSourceContextIndex,
    type ContextualReferenceLink,
    type MarkdownSourceScanOptions
} from "./MarkdownSourceContext";
import {
    getComparableLocalBasename,
    LocalImageTargetResolver,
    type LocalReferenceSyntax
} from "./LocalImageTargetResolver";
import { getSharedVaultFileLookupService } from "./VaultFileLookupService";

export interface CanvasFileReference {
    canvasFile: TFile;
    nodeFile: string;
    lineNumber: number;
}

export interface CanvasReferenceUpdateResult {
    found: number;
    replaced: number;
    complete: boolean;
    files: CanvasReferenceFileResult[];
    failedFiles: string[];
    uncertainFiles: string[];
}

export interface CanvasReferenceFileResult {
    filePath: string;
    found: number;
    replaced: number;
    error?: string;
}

export interface CanvasReferenceScanResult {
    references: Map<string, CanvasFileReference[]>;
    complete: boolean;
    uncertainFiles: string[];
}

export interface CanvasUrlReferenceScanResult {
    references: CanvasFileReference[];
    complete: boolean;
    uncertainFiles: string[];
}

export interface CanvasReferenceNode {
    type?: unknown;
    file?: unknown;
    url?: unknown;
    text?: unknown;
}

interface CanvasDocument {
    nodes: CanvasReferenceNode[];
    [key: string]: unknown;
}

interface LocalReferenceResolution {
    targetPath?: string;
    uncertain: boolean;
}

export interface CanvasReferenceMutationOptions {
    allowedCanvasPaths?: ReadonlySet<string>;
    includeFencedCode?: boolean;
    formatLocalTextReference?: (originalLink: string, newFile: TFile, canvasFile: TFile) => string;
}

export interface CanvasReferenceScanOptions extends MarkdownSourceScanOptions { }

type CanvasReferenceMutation =
    | { source: "file"; oldFile: TFile; target: "file"; newFile: TFile }
    | { source: "file"; oldFile: TFile; target: "url"; newUrl: string }
    | { source: "url"; oldUrl: string; target: "file"; newFile: TFile }
    | { source: "file"; oldFile: TFile; target: "remove" }
    | { source: "url"; oldUrl: string; target: "remove" };

export async function getCanvasFileReferences(
    app: App,
    targetFile: TFile,
    options: CanvasReferenceScanOptions = {}
): Promise<CanvasFileReference[]> {
    return (await getCanvasFileReferenceIndex(app, [targetFile], options)).get(targetFile.path) ?? [];
}

export async function getCanvasFileReferenceIndex(
    app: App,
    targetFiles: TFile[],
    options: CanvasReferenceScanOptions = {}
): Promise<Map<string, CanvasFileReference[]>> {
    return (await getCanvasFileReferenceIndexDetailed(app, targetFiles, options)).references;
}

export async function getCanvasFileReferenceIndexDetailed(
    app: App,
    targetFiles: TFile[],
    options: CanvasReferenceScanOptions = {}
): Promise<CanvasReferenceScanResult> {
    const references = new Map<string, CanvasFileReference[]>();
    const uncertainFiles = new Set<string>();
    const targets = new Map(targetFiles.map(file => [normalizePath(file.path), file.path]));
    const targetBasenames = new Set(targetFiles.map(file => getLocalReferenceBasename(file.path)));
    targetFiles.forEach(file => references.set(file.path, []));
    const canvasFiles = app.vault.getFiles().filter(candidate => candidate.extension === "canvas");
    const resolver = new LocalImageTargetResolver(app);
    await getSharedVaultFileLookupService(app).ensureReady();

    for (const canvasFile of canvasFiles) {
        try {
            const content = await app.vault.read(canvasFile);
            const { nodes } = parseCanvasReferenceDocument(content);

            for (const node of nodes) {
                if (node.type === "file" && typeof node.file === "string") {
                    const resolution = resolveLocalReference(
                        resolver,
                        node.file,
                        canvasFile,
                        targets,
                        targetBasenames,
                        "native"
                    );
                    if (resolution.targetPath) {
                        references.get(resolution.targetPath)?.push({
                            canvasFile,
                            nodeFile: node.file,
                            lineNumber: findLineNumber(content, node.file)
                        });
                    } else if (resolution.uncertain) {
                        uncertainFiles.add(canvasFile.path);
                    }
                }

                if (typeof node.text !== "string") continue;
                for (const link of getContextualReferenceLinks(node.text, options)) {
                    if (isHttpUrl(link.path)) continue;
                    const resolution = resolveLocalReference(
                        resolver,
                        link.path,
                        canvasFile,
                        targets,
                        targetBasenames,
                        link.syntax === "markdown" ? "markdown" : "wiki"
                    );
                    if (resolution.targetPath) {
                        references.get(resolution.targetPath)?.push({
                            canvasFile,
                            nodeFile: link.path,
                            lineNumber: findLineNumber(content, link.source)
                        });
                    } else if (resolution.uncertain) {
                        uncertainFiles.add(canvasFile.path);
                    }
                }
            }
        } catch (error) {
            console.warn(`Error reading canvas file ${canvasFile.path}:`, error);
            uncertainFiles.add(canvasFile.path);
        }
    }

    return {
        references,
        complete: uncertainFiles.size === 0,
        uncertainFiles: [...uncertainFiles]
    };
}

export async function getCanvasUrlReferencesDetailed(
    app: App,
    targetUrl: string,
    options: CanvasReferenceScanOptions = {}
): Promise<CanvasUrlReferenceScanResult> {
    const references: CanvasFileReference[] = [];
    const uncertainFiles = new Set<string>();
    const canvasFiles = app.vault.getFiles().filter(candidate => candidate.extension === "canvas");

    for (const canvasFile of canvasFiles) {
        try {
            const content = await app.vault.read(canvasFile);
            const { nodes } = parseCanvasReferenceDocument(content);
            for (const node of nodes) {
                if (typeof node.url === "string" && isSameHttpUrl(node.url, targetUrl)) {
                    references.push({
                        canvasFile,
                        nodeFile: node.url,
                        lineNumber: findLineNumber(content, node.url)
                    });
                }

                if (typeof node.text !== "string") continue;
                const links = getContextualReferenceLinks(node.text, options);
                for (const link of links) {
                    if (!isSameHttpUrl(link.path, targetUrl)) continue;
                    references.push({
                        canvasFile,
                        nodeFile: link.path,
                        lineNumber: findLineNumber(content, link.source)
                    });
                }
                if (hasUnparsedUrlCandidate(node.text, targetUrl, links, options)) {
                    uncertainFiles.add(canvasFile.path);
                }
            }
        } catch (error) {
            console.warn(`Error reading canvas file ${canvasFile.path}:`, error);
            uncertainFiles.add(canvasFile.path);
        }
    }

    return {
        references,
        complete: uncertainFiles.size === 0,
        uncertainFiles: [...uncertainFiles]
    };
}

export async function replaceCanvasFileReferences(
    app: App,
    oldFile: TFile,
    newFile: TFile,
    options: CanvasReferenceMutationOptions = {}
): Promise<CanvasReferenceUpdateResult> {
    return replaceCanvasReferences(app, {
        source: "file",
        oldFile,
        target: "file",
        newFile
    }, options);
}

export async function replaceCanvasFileReferencesWithUrl(
    app: App,
    oldFile: TFile,
    newUrl: string,
    options: CanvasReferenceMutationOptions = {}
): Promise<CanvasReferenceUpdateResult> {
    return replaceCanvasReferences(app, {
        source: "file",
        oldFile,
        target: "url",
        newUrl
    }, options);
}

export async function replaceCanvasUrlReferencesWithFile(
    app: App,
    oldUrl: string,
    newFile: TFile,
    options: CanvasReferenceMutationOptions = {}
): Promise<CanvasReferenceUpdateResult> {
    return replaceCanvasReferences(app, {
        source: "url",
        oldUrl,
        target: "file",
        newFile
    }, options);
}

export async function removeCanvasFileReferences(
    app: App,
    oldFile: TFile,
    options: CanvasReferenceMutationOptions = {}
): Promise<CanvasReferenceUpdateResult> {
    return replaceCanvasReferences(app, {
        source: "file",
        oldFile,
        target: "remove"
    }, options);
}

export async function removeCanvasUrlReferences(
    app: App,
    oldUrl: string,
    options: CanvasReferenceMutationOptions = {}
): Promise<CanvasReferenceUpdateResult> {
    return replaceCanvasReferences(app, {
        source: "url",
        oldUrl,
        target: "remove"
    }, options);
}

async function replaceCanvasReferences(
    app: App,
    mutation: CanvasReferenceMutation,
    options: CanvasReferenceMutationOptions
): Promise<CanvasReferenceUpdateResult> {
    let found = 0;
    let replaced = 0;
    const files: CanvasReferenceFileResult[] = [];
    const failedFiles = new Set<string>();
    const uncertainFiles = new Set<string>();
    const oldFilePath = mutation.source === "file" ? mutation.oldFile.path : null;
    const oldPath = oldFilePath ? normalizePath(oldFilePath) : null;
    const targets = oldPath && oldFilePath
        ? new Map([[oldPath, oldFilePath]])
        : new Map<string, string>();
    const targetBasenames = oldPath
        ? new Set([getLocalReferenceBasename(oldPath)])
        : new Set<string>();
    const replacementPath = mutation.target === "file"
        ? normalizePath(mutation.newFile.path)
        : mutation.target === "url"
            ? mutation.newUrl
            : null;
    const canvasFiles = app.vault.getFiles().filter(candidate =>
        candidate.extension === "canvas"
        && (!options.allowedCanvasPaths || options.allowedCanvasPaths.has(candidate.path))
    );
    const resolver = new LocalImageTargetResolver(app);
    await getSharedVaultFileLookupService(app).ensureReady();

    for (const canvasFile of canvasFiles) {
        let matchedCount = 0;
        let replacedCount = 0;
        let hasUnresolvedCandidate = false;
        try {
            await app.vault.process(canvasFile, content => {
                matchedCount = 0;
                replacedCount = 0;
                hasUnresolvedCandidate = false;
                const canvasData = parseCanvasReferenceDocument(content);
                const { nodes } = canvasData;
                let fileChanged = false;

                const removedNodes = new Set<CanvasReferenceNode>();
                for (const node of nodes) {
                    if (mutation.source === "file"
                        && node.type === "file"
                        && typeof node.file === "string") {
                        const resolution = resolveLocalReference(
                            resolver,
                            node.file,
                            canvasFile,
                            targets,
                            targetBasenames,
                            "native"
                        );
                        hasUnresolvedCandidate ||= resolution.uncertain;
                        if (resolution.targetPath) {
                            matchedCount++;
                            if (mutation.target === "remove") {
                                removedNodes.add(node);
                                replacedCount++;
                                fileChanged = true;
                            } else if (replaceNativeCanvasNode(node, mutation)) {
                                replacedCount++;
                                fileChanged = true;
                            }
                        }
                    } else if (mutation.source === "url"
                        && typeof node.url === "string"
                        && isSameHttpUrl(node.url, mutation.oldUrl)) {
                        matchedCount++;
                        if (mutation.target === "remove") {
                            removedNodes.add(node);
                            replacedCount++;
                            fileChanged = true;
                        } else if (replaceNativeCanvasNode(node, mutation)) {
                            replacedCount++;
                            fileChanged = true;
                        }
                    }

                    if (removedNodes.has(node)) continue;
                    if (typeof node.text !== "string") continue;
                    const parsedLinks = getContextualReferenceLinks(node.text, options);
                    const links = parsedLinks
                        .filter(link => mutation.source === "file"
                            ? !isHttpUrl(link.path)
                            : isHttpUrl(link.path) && isSameHttpUrl(link.path, mutation.oldUrl))
                        .sort((left, right) => right.index - left.index);
                    let updatedText = node.text;

                    for (const link of links) {
                        if (mutation.source === "file") {
                            const resolution = resolveLocalReference(
                                resolver,
                                link.path,
                                canvasFile,
                                targets,
                                targetBasenames,
                                link.syntax === "markdown" ? "markdown" : "wiki"
                            );
                            hasUnresolvedCandidate ||= resolution.uncertain;
                            if (!resolution.targetPath) continue;
                        }

                        matchedCount++;
                        const replacement = mutation.target === "remove"
                            ? ""
                            : mutation.target === "file" && options.formatLocalTextReference
                                ? options.formatLocalTextReference(link.source, mutation.newFile, canvasFile)
                                : ImageLinkPathReplacer.replacePath(link.source, replacementPath!);
                        if (replacement === link.source) continue;
                        updatedText = updatedText.slice(0, link.index)
                            + replacement
                            + updatedText.slice(link.index + link.source.length);
                        replacedCount++;
                    }

                    if (mutation.source === "url"
                        && hasUnparsedUrlCandidate(node.text, mutation.oldUrl, parsedLinks, options)) {
                        hasUnresolvedCandidate = true;
                    }

                    if (updatedText !== node.text) {
                        node.text = updatedText;
                        fileChanged = true;
                    }
                }

                if (removedNodes.size > 0) {
                    canvasData.nodes = nodes.filter(node => !removedNodes.has(node));
                }
                return fileChanged ? JSON.stringify(canvasData, null, 2) : content;
            });

            found += matchedCount;
            replaced += replacedCount;
            const issues: string[] = [];
            if (replacedCount !== matchedCount) {
                failedFiles.add(canvasFile.path);
                issues.push(`Updated ${replacedCount} of ${matchedCount} reference(s)`);
            }
            if (hasUnresolvedCandidate) {
                uncertainFiles.add(canvasFile.path);
                issues.push(mutation.source === "file"
                    ? "An unresolved same-name reference may still target the source file"
                    : "An unparsed URL occurrence may still reference the source URL");
            }
            if (matchedCount > 0 || issues.length > 0) {
                files.push({
                    filePath: canvasFile.path,
                    found: matchedCount,
                    replaced: replacedCount,
                    error: issues.length > 0 ? issues.join("; ") : undefined
                });
            }
        } catch (error) {
            found += matchedCount;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`Error updating canvas file ${canvasFile.path}:`, error);
            if (matchedCount > 0) {
                failedFiles.add(canvasFile.path);
                files.push({ filePath: canvasFile.path, found: matchedCount, replaced: 0, error: message });
            } else {
                uncertainFiles.add(canvasFile.path);
                files.push({ filePath: canvasFile.path, found: 0, replaced: 0, error: message });
            }
        }
    }

    return {
        found,
        replaced,
        complete: failedFiles.size === 0 && uncertainFiles.size === 0,
        files,
        failedFiles: [...failedFiles],
        uncertainFiles: [...uncertainFiles]
    };
}

function replaceNativeCanvasNode(
    node: CanvasReferenceNode,
    mutation: Exclude<CanvasReferenceMutation, { target: "remove" }>
): boolean {
    const previousType = node.type;
    const previousFile = node.file;
    const previousUrl = node.url;

    if (mutation.target === "file") {
        node.type = "file";
        node.file = normalizePath(mutation.newFile.path);
        delete node.url;
    } else {
        node.type = "link";
        node.url = mutation.newUrl;
        delete node.file;
    }

    return node.type !== previousType
        || node.file !== previousFile
        || node.url !== previousUrl;
}

export function isCanvasFileReference(app: App, canvasPath: string, targetPath: string, canvasFile: TFile): boolean {
    const normalizedTargetPath = normalizePath(targetPath);
    return resolveLocalReference(
        new LocalImageTargetResolver(app),
        canvasPath,
        canvasFile,
        new Map([[normalizedTargetPath, normalizedTargetPath]]),
        new Set([getLocalReferenceBasename(normalizedTargetPath)]),
        "native"
    ).targetPath !== undefined;
}

export function findLineNumber(content: string, searchText: string): number {
    const index = content.indexOf(searchText);
    if (index < 0) return 1;

    let line = 1;
    for (let i = 0; i < index; i++) {
        if (content[i] === "\n") line++;
    }
    return line;
}

export function parseCanvasReferenceDocument(content: string): CanvasDocument {
    const canvasData = JSON.parse(content) as Partial<CanvasDocument> | null;
    if (!canvasData || typeof canvasData !== "object" || !Array.isArray(canvasData.nodes)) {
        throw new Error("Canvas document does not contain a valid nodes array");
    }
    return canvasData as CanvasDocument;
}

function resolveLocalReference(
    resolver: LocalImageTargetResolver,
    referencePath: string,
    canvasFile: TFile,
    targets: Map<string, string>,
    targetBasenames: Set<string>,
    syntax: LocalReferenceSyntax
): LocalReferenceResolution {
    if (!referencePath || isHttpUrl(referencePath)) return { uncertain: false };
    const resolution = resolver.resolve(referencePath, canvasFile, { syntax });
    if (resolution.status === "resolved" && resolution.file) {
        return { targetPath: targets.get(normalizePath(resolution.file.path)), uncertain: false };
    }
    const candidateTargets = resolution.candidates.some(candidate =>
        targets.has(normalizePath(candidate.path))
    );
    return {
        uncertain: candidateTargets
            || targetBasenames.has(getComparableLocalBasename(referencePath, syntax))
    };
}

function stripLocalSubpath(path: string): string {
    const hashIndex = path.indexOf("#");
    return hashIndex < 0 ? path : path.slice(0, hashIndex);
}

function getLocalReferenceBasename(path: string): string {
    const normalized = normalizePath(stripLocalSubpath(path));
    return normalized.split("/").pop() ?? normalized;
}

function hasUnparsedUrlCandidate(
    text: string,
    targetUrl: string,
    parsedLinks: ContextualReferenceLink[],
    options: MarkdownSourceScanOptions
): boolean {
    const matchingRanges = parsedLinks
        .filter(link => isHttpUrl(link.path) && isSameHttpUrl(link.path, targetUrl))
        .map(link => ({ start: link.index, end: link.index + link.source.length }));

    const contextIndex = MarkdownSourceContextIndex.create(text);
    let offset = text.indexOf(targetUrl);
    while (offset >= 0) {
        const end = offset + targetUrl.length;
        if (contextIndex.includes(offset, end, options)
            && !matchingRanges.some(range => offset >= range.start && end <= range.end)) {
            return true;
        }
        offset = text.indexOf(targetUrl, offset + targetUrl.length);
    }
    return false;
}
