import type { TFile } from "obsidian";
import type { DrawingFileSemantics, DrawingProviderAdapter } from "../DrawingContracts";
import type { DrawingFileInspector } from "../DrawingFileSemantics";
import type { ExcalidrawService } from "./ExcalidrawService";

export class ExcalidrawProviderAdapter implements DrawingProviderAdapter {
    readonly id = "excalidraw" as const;

    constructor(
        private readonly inspector: DrawingFileInspector,
        private readonly service: ExcalidrawService
    ) {}

    inspect(file: TFile): DrawingFileSemantics | null {
        const semantics = this.inspector.inspect(file);
        return semantics?.providerId === this.id ? semantics : null;
    }

    open(file: TFile): Promise<void> {
        return this.service.open(file);
    }
}
