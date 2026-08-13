import type {
    DrawingFileSemantics,
    DrawingRenderedActionCapabilities
} from "./DrawingContracts";

/**
 * Keeps drawing safety decisions independent of menu DOM and provider UI.
 * A source file can be rendered by another plugin, but it is not necessarily
 * a useful image payload (for example an .excalidraw.md file).
 */
export function getDrawingRenderedActionCapabilities(
    semantics: DrawingFileSemantics
): DrawingRenderedActionCapabilities {
    return Object.freeze({
        editReferenceProperties: true,
        copyRenderedImage: true,
        uploadRenderedCopy: semantics.role !== "source",
        deleteReference: true,
        mutatePixels: false
    });
}
