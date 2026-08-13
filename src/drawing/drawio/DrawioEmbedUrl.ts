export interface DrawioEmbedUrlResult {
    readonly url: URL;
    readonly warning?: string;
}

export interface DrawioEmbedAppearance {
    readonly theme?: "kennedy" | "atlas" | "dark" | "minimal" | "sketch" | "simple";
    readonly dark?: boolean;
}

export function buildDrawioEmbedUrl(
    value: string,
    appearance: DrawioEmbedAppearance = {}
): DrawioEmbedUrlResult {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error("Enter a valid Draw.io URL.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Draw.io URL must use HTTP or HTTPS.");
    }
    if (url.username || url.password) {
        throw new Error("Draw.io URL cannot contain embedded credentials.");
    }
    url.searchParams.set("embed", "1");
    url.searchParams.set("proto", "json");
    // Older and self-hosted builds use this flag to acknowledge that the
    // requested XML has finished loading. Current builds also include bounds
    // in the standard JSON load response when it is present.
    url.searchParams.set("returnbounds", "1");
    // Standard embed mode already exports uncompressed XML by default. Avoid
    // the optional configure handshake: if any upstream startup task fails
    // after accepting the configure reply, diagrams.net never emits `init`.
    url.searchParams.delete("configure");
    url.searchParams.set("spin", "1");
    url.searchParams.set("libraries", "1");
    url.searchParams.set("saveAndExit", "0");
    url.searchParams.set("noSaveBtn", "1");
    url.searchParams.set("noExitBtn", "1");
    url.searchParams.set("suppressNewWindows", "1");
    if (appearance.theme) {
        url.searchParams.set("ui", appearance.theme === "minimal" ? "min" : appearance.theme);
    }
    if (appearance.dark !== undefined) {
        url.searchParams.set("dark", appearance.dark ? "1" : "0");
    }
    return {
        url,
        warning: url.hostname.toLowerCase() === "app.diagrams.net"
            ? "Official embed mode is hosted at https://embed.diagrams.net/. This URL will still be tested as entered."
            : url.protocol === "http:"
                ? "This Draw.io connection is not encrypted."
                : undefined
    };
}
