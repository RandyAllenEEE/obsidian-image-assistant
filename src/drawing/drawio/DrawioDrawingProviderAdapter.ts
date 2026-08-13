import type { TFile } from "obsidian";
import type { DrawingFileSemantics, DrawingProviderAdapter } from "../DrawingContracts";
import type { DrawingFileInspector } from "../DrawingFileSemantics";
import { isDrawioDiagramFile } from "./DiagramFile";

export class DrawioDrawingProviderAdapter implements DrawingProviderAdapter {
    readonly id = "drawio" as const;

    constructor(
        private readonly inspector: DrawingFileInspector,
        private readonly openDrawing: (file: TFile) => Promise<unknown>
    ) {}

    inspect(file: TFile): DrawingFileSemantics | null {
        if (!isDrawioDiagramFile(file)) return null;
        const semantics = this.inspector.inspect(file);
        return semantics?.providerId === this.id ? semantics : null;
    }

    open(file: TFile): Promise<unknown> {
        return this.openDrawing(file);
    }
}
