import { normalizePath } from "obsidian";

const invalidVaultSegment = /[:*?"<>|]/;

function containsControlCharacter(value: string): boolean {
    return Array.from(value).some(character => character.charCodeAt(0) <= 0x1f);
}

export function normalizeVaultFolderPath(value: string): string {
    const raw = value.trim().replace(/\\/g, "/");
    if (!raw) return "";
    if (/^[A-Za-z]:/.test(raw) || raw.startsWith("//")) {
        throw new Error(`Vault paths must not be absolute filesystem paths: ${value}`);
    }

    const segments = raw.split("/").filter(segment => segment.length > 0 && segment !== ".");
    if (segments.some(segment => segment === "..")) {
        throw new Error(`Vault paths must not contain parent traversal: ${value}`);
    }
    const invalid = segments.find(segment => invalidVaultSegment.test(segment) || containsControlCharacter(segment));
    if (invalid) throw new Error(`Invalid vault path segment: ${invalid}`);

    if (segments.length === 0) return raw.startsWith("/") ? "/" : "";
    return normalizePath(segments.join("/"));
}

export function assertSafeVaultFilename(value: string): void {
    if (!value || value === "." || value === ".." || /[\\/]/.test(value) || containsControlCharacter(value)) {
        throw new Error(`Invalid vault filename: ${value || "(empty)"}`);
    }
}
