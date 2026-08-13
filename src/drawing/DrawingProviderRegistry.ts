import type { TFile } from "obsidian";
import type {
    DrawingEngineId,
    DrawingFileSemantics,
    DrawingProviderAdapter
} from "./DrawingContracts";

export class DrawingProviderRegistry {
    private readonly adapters = new Map<DrawingEngineId, DrawingProviderAdapter>();

    register(adapter: DrawingProviderAdapter): void {
        if (this.adapters.has(adapter.id)) {
            throw new Error(`Drawing provider already registered: ${adapter.id}`);
        }
        this.adapters.set(adapter.id, adapter);
    }

    inspect(file: TFile): DrawingFileSemantics | null {
        for (const adapter of this.adapters.values()) {
            const semantics = adapter.inspect(file);
            if (semantics) return semantics;
        }
        return null;
    }

    get(id: DrawingEngineId): DrawingProviderAdapter | null {
        return this.adapters.get(id) ?? null;
    }
}
