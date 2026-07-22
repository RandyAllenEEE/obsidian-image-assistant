export function isHttpUrl(value: string): boolean {
    try {
        const protocol = new URL(value.trim()).protocol.toLowerCase();
        return protocol === "http:" || protocol === "https:";
    } catch {
        return false;
    }
}

export function isSameHttpUrl(candidate: string, targetUrl: string): boolean {
    const normalizedCandidate = canonicalizeHttpUrl(candidate);
    const normalizedTarget = canonicalizeHttpUrl(targetUrl);
    return normalizedCandidate !== null && normalizedCandidate === normalizedTarget;
}

/**
 * Normalizes only URL identity details that do not alter the referenced
 * resource. Path, query, fragment, and credentials remain case-sensitive.
 */
export function canonicalizeHttpUrl(value: string): string | null {
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return null;

        const pathname = url.pathname === "/"
            ? ""
            : url.pathname.replace(/\/+$/, "");
        return `${url.protocol}//${url.username}${url.password ? `:${url.password}` : ""}`
            + `${url.username || url.password ? "@" : ""}${url.host}`
            + `${pathname}${url.search}${url.hash}`;
    } catch {
        return null;
    }
}
