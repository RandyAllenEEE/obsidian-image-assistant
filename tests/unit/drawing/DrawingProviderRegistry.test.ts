import { describe, expect, it, vi } from "vitest";
import { DrawingProviderRegistry } from "../../../src/drawing/DrawingProviderRegistry";
import { fakeTFile } from "../../factories/obsidian";

describe("DrawingProviderRegistry", () => {
    it("routes by actual file semantics independently of the default creation engine", async () => {
        const registry = new DrawingProviderRegistry();
        const drawio = fakeTFile({ path: "Flow.drawio.svg", name: "Flow.drawio.svg" });
        const excalidraw = fakeTFile({ path: "Sketch.excalidraw.md", name: "Sketch.excalidraw.md" });
        const openDrawio = vi.fn();
        const openExcalidraw = vi.fn();
        registry.register({
            id: "drawio",
            inspect: file => file === drawio ? semantics("drawio", file) : null,
            open: openDrawio
        });
        registry.register({
            id: "excalidraw",
            inspect: file => file === excalidraw ? semantics("excalidraw", file) : null,
            open: openExcalidraw
        });

        expect(registry.inspect(drawio)?.providerId).toBe("drawio");
        expect(registry.inspect(excalidraw)?.providerId).toBe("excalidraw");
        await registry.get("excalidraw")!.open(excalidraw);
        expect(openExcalidraw).toHaveBeenCalledWith(excalidraw);
        expect(openDrawio).not.toHaveBeenCalled();
    });

    it("rejects duplicate engine registration", () => {
        const registry = new DrawingProviderRegistry();
        const adapter = { id: "drawio" as const, inspect: () => null, open: vi.fn() };
        registry.register(adapter);

        expect(() => registry.register(adapter)).toThrow(/already registered/);
    });
});

function semantics(providerId: "drawio" | "excalidraw", file: ReturnType<typeof fakeTFile>) {
    return {
        providerId,
        file,
        sourceFile: file,
        role: "source" as const,
        compoundSuffix: null,
        protectedFromImageMutation: true
    };
}
