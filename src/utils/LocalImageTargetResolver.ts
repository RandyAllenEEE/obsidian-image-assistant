import { App, normalizePath, TFile } from "obsidian";
import { isHttpUrl } from "./NetworkPolicy";
import {
    getSharedVaultFileLookupService,
    type VaultFileLookupService
} from "./VaultFileLookupService";

export type LocalReferenceSyntax = "markdown" | "wiki" | "native";
export type LocalTargetResolutionStatus =
    | "resolved"
    | "ambiguous"
    | "unresolved"
    | "invalid"
    | "pending";

export interface LocalTargetResolution {
    status: LocalTargetResolutionStatus;
    file?: TFile;
    candidates: readonly TFile[];
    normalizedPath?: string;
    reason?: string;
}

export interface LocalTargetResolveOptions {
    syntax?: LocalReferenceSyntax;
}

/** Resolves a local link path without depending solely on the metadata cache. */
export class LocalImageTargetResolver {
    private readonly fileLookup: VaultFileLookupService;

    constructor(
        private readonly app: App,
        fileLookup?: VaultFileLookupService
    ) {
        this.fileLookup = fileLookup ?? getSharedVaultFileLookupService(app);
    }

    async resolveAsync(
        referencePath: string,
        source: TFile | string,
        options: LocalTargetResolveOptions = {},
        signal?: AbortSignal
    ): Promise<LocalTargetResolution> {
        const immediate = this.resolve(referencePath, source, options);
        if (immediate.status !== "pending") return immediate;
        await this.fileLookup.ensureReady(signal);
        return this.resolve(referencePath, source, options);
    }

    resolve(
        referencePath: string,
        source: TFile | string,
        options: LocalTargetResolveOptions = {}
    ): LocalTargetResolution {
        const syntax = options.syntax ?? "wiki";
        const prepared = prepareReferencePath(referencePath, syntax);
        if (!prepared.ok) {
            return {
                status: "invalid",
                candidates: [],
                reason: prepared.reason
            };
        }

        const { path, metadataPath } = prepared;
        if (!path || isHttpUrl(path) || path.startsWith("data:")) {
            return { status: "unresolved", candidates: [], normalizedPath: path };
        }

        const sourcePath = typeof source === "string" ? source : source.path;
        const sourceDirectory = getParentPath(sourcePath);

        if (path.startsWith("/")) {
            const absolutePath = normalizeCandidatePath(path.replace(/^\/+/, ""));
            if (!absolutePath) {
                return { status: "invalid", candidates: [], reason: "Invalid vault-root path" };
            }
            return this.resolveExactPath(absolutePath);
        }

        if (path === "." || path.startsWith("./") || path === ".." || path.startsWith("../")) {
            const relativePath = resolveRelativePath(sourceDirectory, path);
            if (!relativePath) {
                return {
                    status: "invalid",
                    candidates: [],
                    reason: "Relative path escapes the vault root"
                };
            }
            return this.resolveExactPath(relativePath);
        }

        const metadataCandidates = uniqueStrings([metadataPath, path]);
        for (const candidate of metadataCandidates) {
            try {
                const resolved = this.app.metadataCache?.getFirstLinkpathDest?.(candidate, sourcePath);
                if (resolved instanceof TFile) {
                    return {
                        status: "resolved",
                        file: resolved,
                        candidates: [resolved],
                        normalizedPath: normalizePath(resolved.path)
                    };
                }
            } catch {
                // A stale or partial metadata cache is not authoritative here.
            }
        }

        const candidates = new Map<string, TFile>();
        const addCandidate = (candidatePath: string): void => {
            const file = this.getFile(candidatePath);
            if (file) candidates.set(file.path, file);
        };

        const normalized = normalizeCandidatePath(path);
        if (normalized) {
            addCandidate(normalized);
            const sourceRelative = resolveRelativePath(sourceDirectory, normalized);
            if (sourceRelative) addCandidate(sourceRelative);
        }

        const suffix = normalized ?? path;
        const basename = getPathBasename(suffix);
        const lookupCandidates = this.fileLookup.getCandidates(basename);
        if (!lookupCandidates) {
            return {
                status: "pending",
                candidates: [],
                normalizedPath: normalized ?? path,
                reason: "Vault basename index is not ready"
            };
        }
        for (const file of lookupCandidates) {
            const filePath = normalizePath(file.path);
            if (file.name === basename
                && (filePath === suffix || filePath.endsWith(`/${suffix}`) || !suffix.includes("/"))) {
                candidates.set(file.path, file);
            }
        }

        const resolvedCandidates = [...candidates.values()];
        if (resolvedCandidates.length === 1) {
            const file = resolvedCandidates[0];
            return {
                status: "resolved",
                file,
                candidates: resolvedCandidates,
                normalizedPath: normalizePath(file.path)
            };
        }
        if (resolvedCandidates.length > 1) {
            return {
                status: "ambiguous",
                candidates: resolvedCandidates,
                normalizedPath: normalized ?? path,
                reason: "Multiple vault files match this link path"
            };
        }
        return {
            status: "unresolved",
            candidates: [],
            normalizedPath: normalized ?? path
        };
    }

    private resolveExactPath(path: string): LocalTargetResolution {
        const file = this.getFile(path);
        if (!file) return { status: "unresolved", candidates: [], normalizedPath: path };
        return { status: "resolved", file, candidates: [file], normalizedPath: file.path };
    }

    private getFile(path: string): TFile | null {
        try {
            const getByPath = this.app.vault?.getAbstractFileByPath;
            if (typeof getByPath !== "function") return null;
            const abstractFile = getByPath.call(this.app.vault, normalizePath(path));
            return abstractFile instanceof TFile ? abstractFile : null;
        } catch {
            return null;
        }
    }

}

export function inferLocalReferenceSyntax(source: string): LocalReferenceSyntax {
    const trimmed = source.trim();
    return trimmed.startsWith("![[") || trimmed.startsWith("[[") ? "wiki" : "markdown";
}

export function getComparableLocalBasename(
    referencePath: string,
    syntax: LocalReferenceSyntax = "wiki"
): string {
    const prepared = prepareReferencePath(referencePath, syntax);
    if (!prepared.ok) return "";
    return getPathBasename(prepared.path).toLowerCase();
}

interface PreparedPathSuccess {
    ok: true;
    path: string;
    metadataPath: string;
}

interface PreparedPathFailure {
    ok: false;
    reason: string;
}

function prepareReferencePath(
    input: string,
    syntax: LocalReferenceSyntax
): PreparedPathSuccess | PreparedPathFailure {
    let raw = (input ?? "").trim();
    if (raw.startsWith("<") && raw.endsWith(">")) raw = raw.slice(1, -1);
    if (!raw || containsControlCharacter(raw)) return { ok: false, reason: "Empty or invalid link path" };

    const hashIndex = raw.indexOf("#");
    const withoutSubpath = hashIndex < 0 ? raw : raw.slice(0, hashIndex);
    let decoded = withoutSubpath;
    if (syntax === "markdown") {
        try {
            decoded = decodeURIComponent(withoutSubpath.replace(/%(?![0-9a-f]{2})/gi, "%25"));
        } catch {
            return { ok: false, reason: "Malformed URI encoding in link path" };
        }
    }

    decoded = decoded.replace(/\\/g, "/");
    if (!decoded || containsControlCharacter(decoded)) {
        return { ok: false, reason: "Invalid link path" };
    }
    return { ok: true, path: decoded, metadataPath: withoutSubpath };
}

function normalizeCandidatePath(path: string): string | null {
    const segments: string[] = [];
    for (const segment of path.replace(/^\/+/, "").split("/")) {
        if (!segment || segment === ".") continue;
        if (segment === "..") {
            if (segments.length === 0) return null;
            segments.pop();
            continue;
        }
        segments.push(segment);
    }
    return segments.length > 0 ? normalizePath(segments.join("/")) : null;
}

function resolveRelativePath(baseDirectory: string, relativePath: string): string | null {
    const baseSegments = baseDirectory.split("/").filter(Boolean);
    const segments = [...baseSegments];
    for (const segment of relativePath.split("/")) {
        if (!segment || segment === ".") continue;
        if (segment === "..") {
            if (segments.length === 0) return null;
            segments.pop();
            continue;
        }
        segments.push(segment);
    }
    return segments.length > 0 ? normalizePath(segments.join("/")) : null;
}

function getParentPath(path: string): string {
    const normalized = normalizePath(path);
    const slash = normalized.lastIndexOf("/");
    return slash < 0 ? "" : normalized.slice(0, slash);
}

function getPathBasename(path: string): string {
    const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
    return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function containsControlCharacter(value: string): boolean {
    return Array.from(value).some(character => character.charCodeAt(0) <= 0x1f);
}

function uniqueStrings(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))];
}
