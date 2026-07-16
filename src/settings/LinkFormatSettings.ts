export type LinkFormat = "wikilink" | "markdown";
export type PathFormat = "shortest" | "relative" | "absolute";

export interface LinkFormatOptions {
    linkFormat: LinkFormat;
    pathFormat: PathFormat;
    prependCurrentDir: boolean;
}
