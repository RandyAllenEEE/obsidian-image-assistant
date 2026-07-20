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
    it("uses the reference index safety view for local files and URLs", async () => {
        const image = fakeTFile({ path: "assets/image.png", extension: "png" });
        const note = fakeTFile({ path: "notes/source.md", extension: "md" });
        const markdown = [{
            file: note,
            start: 0,
            end: 10,
            original: "![[image]]",
            link: image.path,
            line: 0
        }];
        const canvas = [{
            canvasFile: fakeTFile({ path: "board.canvas", extension: "canvas" }),
            nodeFile: image.path,
            lineNumber: 1
        }];
        const localSnapshot = {
            complete: true,
            markdown,
            canvas,
            uncertainFiles: [],
            referenceCount: 2,
            safeToDelete: false
        };
        const urlSnapshot = {
            complete: false,
            markdown: [],
            canvas: [],
            uncertainFiles: ["broken.canvas"],
            referenceCount: 0,
            safeToDelete: false
        };
        const referenceIndex = {
            inspectLocalFile: vi.fn(async () => localSnapshot),
            inspectUrl: vi.fn(async () => urlSnapshot)
        } as any;
        const service = new ReferenceSafetyService(
            fakeApp() as any,
            manager(),
            referenceIndex
        );

        const local = await service.inspectLocalFile(image);
        const remote = await service.inspectUrl("https://cdn.example/image");

        expect(referenceIndex.inspectLocalFile).toHaveBeenCalledWith(image, {
            includeFencedCode: true
        });
        expect(referenceIndex.inspectUrl).toHaveBeenCalledWith(
            "https://cdn.example/image",
            { includeFencedCode: true }
        );
        expect(local).toEqual(localSnapshot);
        expect(remote).toEqual(urlSnapshot);
    });

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

    it("fails closed when Canvas enumeration throws before individual files can be scanned", async () => {
        const app = fakeApp() as any;
        app.vault.getFiles = vi.fn(() => {
            throw new Error("vault unavailable");
        });

        const result = await new ReferenceSafetyService(app, manager())
            .inspectUrl("https://cdn.example/image.png");

        expect(result.complete).toBe(false);
        expect(result.safeToDelete).toBe(false);
        expect(result.uncertainFiles).toContain("Canvas scan: vault unavailable");
    });

    it("always passes the full fenced-code safety policy to existing scanners", async () => {
        const image = fakeTFile({ path: "assets/image.png", extension: "png" });
        const referenceManager = manager();
        const app = fakeApp() as any;

        await new ReferenceSafetyService(app, referenceManager).inspectLocalFile(image);

        expect(referenceManager.scanReferencesDetailed).toHaveBeenCalledWith(
            image.path,
            { kind: "safety", includeFencedCode: true }
        );
    });

    it("treats metadata index lookup as optional after a complete raw scan", async () => {
        const image = fakeTFile({ path: "assets/image.png", extension: "png" });
        const referenceManager = manager();
        referenceManager.getFilesReferencingImage.mockRejectedValue(
            new Error("cache rebuilding")
        );
        const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const result = await new ReferenceSafetyService(
            fakeApp() as any,
            referenceManager
        ).inspectLocalFile(image);

        expect(result.complete).toBe(true);
        expect(result.safeToDelete).toBe(true);
        expect(warn).toHaveBeenCalled();
    });
});
