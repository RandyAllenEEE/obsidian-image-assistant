import { describe, expect, it, vi } from "vitest";
import { ReferenceSafetyService } from "../../../src/utils/ReferenceSafetyService";
import { fakeApp, fakeTFile, fakeVault } from "../../factories/obsidian";

function manager() {
    return {
        scanReferencesDetailed: vi.fn(async () => ({ locations: [], complete: true, uncertainFiles: [] })),
        getFilesReferencingImage: vi.fn(async () => []),
        getFilesReferencingUrl: vi.fn(async () => [])
    } as any;
}

describe("ReferenceSafetyService", () => {
    it("counts ordinary local image links in Canvas text nodes", async () => {
        const image = fakeTFile({ path: "assets/image.png", name: "image.png", extension: "png" });
        const canvas = fakeTFile({ path: "board.canvas", name: "board.canvas", extension: "canvas" });
        const app = fakeApp({
            vault: fakeVault({
                files: [image, canvas],
                fileContents: new Map([[canvas.path, JSON.stringify({
                    nodes: [{ id: "text", type: "text", text: `[source](${image.path})` }]
                })]])
            })
        }) as any;

        const result = await new ReferenceSafetyService(app, manager()).inspectLocalFile(image);

        expect(result.complete).toBe(true);
        expect(result.referenceCount).toBe(1);
        expect(result.safeToDelete).toBe(false);
        expect(result.canvas[0]).toMatchObject({ canvasFile: canvas, nodeFile: image.path });
    });

    it("counts network image references in Canvas text nodes", async () => {
        const url = "https://cdn.example/image.png";
        const canvas = fakeTFile({ path: "board.canvas", name: "board.canvas", extension: "canvas" });
        const app = fakeApp({
            vault: fakeVault({
                files: [canvas],
                fileContents: new Map([[canvas.path, JSON.stringify({
                    nodes: [{ id: "text", type: "text", text: `![](${url})` }]
                })]])
            })
        }) as any;

        const result = await new ReferenceSafetyService(app, manager()).inspectUrl(url);

        expect(result.complete).toBe(true);
        expect(result.referenceCount).toBe(1);
        expect(result.safeToDelete).toBe(false);
        expect(result.canvas[0].canvasFile).toBe(canvas);
    });

    it("counts network images stored as native Canvas link nodes", async () => {
        const url = "https://cdn.example/image.png";
        const canvas = fakeTFile({ path: "board.canvas", name: "board.canvas", extension: "canvas" });
        const app = fakeApp({
            vault: fakeVault({
                files: [canvas],
                fileContents: new Map([[canvas.path, JSON.stringify({
                    nodes: [{ id: "link", type: "link", url }]
                })]])
            })
        }) as any;

        const result = await new ReferenceSafetyService(app, manager()).inspectUrl(url);

        expect(result.complete).toBe(true);
        expect(result.referenceCount).toBe(1);
        expect(result.safeToDelete).toBe(false);
        expect(result.canvas[0]).toMatchObject({ canvasFile: canvas, nodeFile: url });
    });

    it("fails closed when any Canvas file cannot be parsed", async () => {
        const canvas = fakeTFile({ path: "broken.canvas", name: "broken.canvas", extension: "canvas" });
        const app = fakeApp({
            vault: fakeVault({ files: [canvas], fileContents: new Map([[canvas.path, "{bad"]]) })
        }) as any;

        const result = await new ReferenceSafetyService(app, manager()).inspectUrl("https://cdn.example/image.png");

        expect(result.complete).toBe(false);
        expect(result.safeToDelete).toBe(false);
        expect(result.uncertainFiles).toContain(canvas.path);
    });
});
