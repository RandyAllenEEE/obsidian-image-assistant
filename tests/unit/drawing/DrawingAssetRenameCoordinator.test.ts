import { describe, expect, it, vi } from "vitest";
import { DrawingAssetRenameCoordinator } from "../../../src/drawing/DrawingAssetRenameCoordinator";
import { fakeApp, fakeTFile, fakeVault } from "../../factories/obsidian";

describe("DrawingAssetRenameCoordinator", () => {
    function fixture(conflict = false) {
        const source = fakeTFile({
            path: "drawings/Flow.excalidraw.md",
            name: "Flow.excalidraw.md",
            extension: "md"
        });
        const svg = fakeTFile({
            path: "drawings/Flow.excalidraw.svg",
            name: "Flow.excalidraw.svg",
            extension: "svg"
        });
        const dark = fakeTFile({
            path: "drawings/Flow.excalidraw.dark.svg",
            name: "Flow.excalidraw.dark.svg",
            extension: "svg"
        });
        const occupied = conflict
            ? fakeTFile({ path: "archive/Renamed.excalidraw.svg" })
            : null;
        const files = [source, svg, dark, ...(occupied ? [occupied] : [])];
        const vault = fakeVault({ files }) as any;
        const app = fakeApp({ vault }) as any;
        const calls: string[] = [];
        const single = {
            execute: vi.fn(async (request: any) => {
                const moved = await request.rename();
                return {
                    complete: moved,
                    fileMoved: moved,
                    compatibilityCopyCreated: false,
                    compatibilityCopyPreserved: false,
                    repairedReferences: 1,
                    failedFiles: [],
                    uncertainFiles: []
                };
            })
        };
        const move = vi.fn(async (file: any, target: string) => {
            calls.push(`${file.path}->${target}`);
            await vault.rename(file, target);
            return true;
        });
        const coordinator = new DrawingAssetRenameCoordinator(app, single as any, move);
        const semantics = {
            providerId: "excalidraw",
            file: svg,
            sourceFile: source,
            role: "generated-preview",
            compoundSuffix: ".excalidraw.svg",
            protectedFromImageMutation: true
        } as const;
        return { calls, coordinator, dark, move, semantics, single, source, svg };
    }

    it("moves every same-stem derivative before the source", async () => {
        const f = fixture();
        const result = await f.coordinator.execute(
            f.semantics,
            "archive/Renamed.excalidraw.svg"
        );

        expect(result).toMatchObject({ complete: true, fileMoved: true });
        expect(f.calls).toEqual([
            "drawings/Flow.excalidraw.dark.svg->archive/Renamed.excalidraw.dark.svg",
            "drawings/Flow.excalidraw.svg->archive/Renamed.excalidraw.svg",
            "drawings/Flow.excalidraw.md->archive/Renamed.excalidraw.md"
        ]);
    });

    it("fails closed before moving when any family target is occupied", async () => {
        const f = fixture(true);
        const result = await f.coordinator.execute(
            f.semantics,
            "archive/Renamed.excalidraw.svg"
        );

        expect(result.complete).toBe(false);
        expect(result.fileMoved).toBe(false);
        expect(f.move).not.toHaveBeenCalled();
        expect(f.source.path).toBe("drawings/Flow.excalidraw.md");
    });

    it("rolls the complete family back when a moved source reports partial failure", async () => {
        const f = fixture();
        let failed = false;
        (f.single.execute as any).mockImplementation(async (request: any) => {
            const moved = await request.rename();
            if (!failed && request.targetPath.endsWith(".excalidraw.md")) {
                failed = true;
                return {
                    complete: false,
                    fileMoved: moved,
                    compatibilityCopyCreated: true,
                    compatibilityCopyPreserved: true,
                    repairedReferences: 0,
                    failedFiles: [request.targetPath],
                    uncertainFiles: [],
                    error: "reference repair failed"
                };
            }
            return {
                complete: moved,
                fileMoved: moved,
                compatibilityCopyCreated: false,
                compatibilityCopyPreserved: false,
                repairedReferences: 1,
                failedFiles: [],
                uncertainFiles: []
            };
        });

        const result = await f.coordinator.execute(
            f.semantics,
            "archive/Renamed.excalidraw.svg"
        );

        expect(result).toMatchObject({ complete: false, fileMoved: false });
        expect(f.source.path).toBe("drawings/Flow.excalidraw.md");
        expect(f.svg.path).toBe("drawings/Flow.excalidraw.svg");
        expect(f.dark.path).toBe("drawings/Flow.excalidraw.dark.svg");
        expect(f.calls).toHaveLength(6);
    });
});
