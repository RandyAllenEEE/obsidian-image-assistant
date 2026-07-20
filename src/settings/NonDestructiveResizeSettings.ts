export type ResizeDimension =
    | "width"
    | "height"
    | "both"
    | "longest-edge"
    | "shortest-edge"
    | "original-width"
    | "original-height"
    | "editor-max-width"
    | "none";
export type ResizeScaleMode = "auto" | "reduce" | "enlarge";



export type ResizeUnits = "pixels" | "percentage";

export interface EmbedResizeSettings {
    resizeDimension: ResizeDimension;
    width?: number; // In pixels or percentage (depending on resizeUnits)
    height?: number; // In pixels or percentage
    customValue?: string; // For "both", e.g., "300x200" or "50x75%"
    longestEdge?: number;
    shortestEdge?: number;
    editorMaxWidthValue?: number;
    resizeScaleMode: ResizeScaleMode;
    resizeUnits: ResizeUnits;
}

/** Returns a synchronous PipeSyntax size for fixed pixel presets only. */
export function getFixedPixelResizePipe(
    settings: EmbedResizeSettings
): string | null {
    if (settings.resizeUnits !== "pixels"
        || settings.resizeScaleMode !== "auto") {
        return null;
    }
    const positive = (value: number | undefined): number | undefined =>
        typeof value === "number" && Number.isFinite(value) && value > 0
            ? Math.round(value)
            : undefined;
    switch (settings.resizeDimension) {
        case "none":
            return "";
        case "width": {
            const width = positive(settings.width);
            return width === undefined ? "" : `|${width}`;
        }
        case "height": {
            const height = positive(settings.height);
            return height === undefined ? "" : `|x${height}`;
        }
        case "both": {
            const width = positive(settings.width);
            const height = positive(settings.height);
            if (width !== undefined && height !== undefined) {
                return `|${width}x${height}`;
            }
            if (width !== undefined) return `|${width}`;
            if (height !== undefined) return `|x${height}`;
            if (!settings.customValue) return "";
            const match = /^\s*(\d+)?x(\d+)?\s*$/.exec(settings.customValue);
            if (!match) return null;
            const customWidth = match[1] ? Number(match[1]) : undefined;
            const customHeight = match[2] ? Number(match[2]) : undefined;
            if (customWidth !== undefined && customHeight !== undefined) {
                return `|${customWidth}x${customHeight}`;
            }
            if (customWidth !== undefined) return `|${customWidth}x`;
            if (customHeight !== undefined) return `|x${customHeight}`;
            return "";
        }
        case "editor-max-width": {
            const value = positive(settings.editorMaxWidthValue);
            return value === undefined ? "" : `|${value}`;
        }
        default:
            return null;
    }
}
