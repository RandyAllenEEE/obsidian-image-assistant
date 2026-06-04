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
    respectEditorMaxWidth: boolean;
    maintainAspectRatio: boolean; // New: Toggle aspect ratio preservation
    resizeUnits: ResizeUnits; // New: Pixels or percentage
}
