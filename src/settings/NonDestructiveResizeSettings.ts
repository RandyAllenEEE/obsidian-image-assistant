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
    longestEdge?: number;
    shortestEdge?: number;
    editorMaxWidthValue?: number;
    resizeScaleMode: ResizeScaleMode;
    resizeUnits: ResizeUnits;
}

/**
 * Returns a synchronous canonical PipeSyntax size for fixed pixel presets.
 * `null` means that intrinsic image dimensions are required. Height-only
 * intentions must be converted to a proportional width by LinkFormatter.
 */
export function getFixedPixelResizePipe(
    settings: EmbedResizeSettings
): string | null {
    if (settings.resizeUnits !== "pixels"
        || settings.resizeScaleMode !== "auto") {
        return null;
    }
    const positive = (value: number | undefined): number | undefined => {
        if (typeof value !== "number" || !Number.isFinite(value)) {
            return undefined;
        }
        const rounded = Math.round(value);
        return Number.isSafeInteger(rounded) && rounded > 0
            ? rounded
            : undefined;
    };
    switch (settings.resizeDimension) {
        case "none":
            return "";
        case "width": {
            const width = positive(settings.width);
            return width === undefined ? "" : `|${width}`;
        }
        case "height": {
            return null;
        }
        case "both": {
            const width = positive(settings.width);
            const height = positive(settings.height);
            if (width !== undefined && height !== undefined) {
                return `|${width}x${height}`;
            }
            if (width !== undefined) return `|${width}`;
            if (height !== undefined) return null;
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
