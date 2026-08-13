import type { TFile } from "obsidian";

export type DrawingEngineId = "drawio" | "excalidraw";
export type DrawingFileRole = "source" | "editable-image" | "generated-preview";

export interface DrawingFileSemantics {
    readonly providerId: DrawingEngineId;
    readonly file: TFile;
    readonly sourceFile: TFile | null;
    readonly role: DrawingFileRole;
    readonly compoundSuffix: string | null;
    readonly protectedFromImageMutation: boolean;
}

/** Capabilities exposed by Image Assistant for a rendered drawing reference. */
export interface DrawingRenderedActionCapabilities {
    readonly editReferenceProperties: boolean;
    readonly copyRenderedImage: boolean;
    readonly uploadRenderedCopy: boolean;
    readonly deleteReference: boolean;
    readonly mutatePixels: boolean;
}

export interface DrawingProviderAdapter {
    readonly id: DrawingEngineId;
    inspect(file: TFile): DrawingFileSemantics | null;
    open(file: TFile): Promise<unknown>;
}
