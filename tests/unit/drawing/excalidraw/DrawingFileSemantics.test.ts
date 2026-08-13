import { describe, expect, it, vi } from "vitest";
import { DrawingFileInspector } from "../../../../src/drawing/DrawingFileSemantics";
import { fakeApp, fakeMetadataCache, fakeTFile, fakeVault } from "../../../factories/obsidian";

describe("DrawingFileInspector", () => {
    it("classifies Draw.io editable SVGs as their own protected source", () => {
        const file = fakeTFile({ path: "assets/Flow.drawio.svg", name: "Flow.drawio.svg" });
        const inspector = new DrawingFileInspector(fakeApp() as any, { isExcalidrawFile: () => false });

        expect(inspector.inspect(file)).toMatchObject({
            providerId: "drawio",
            sourceFile: file,
            role: "editable-image",
            compoundSuffix: ".drawio.svg",
            protectedFromImageMutation: true
        });
    });

    it.each(["Flow.excalidraw.svg", "Flow.excalidraw.dark.png"])(
        "maps generated preview %s to its unique modern source",
        previewName => {
            const source = fakeTFile({
                path: "assets/Flow.excalidraw.md",
                name: "Flow.excalidraw.md",
                extension: "md"
            });
            const preview = fakeTFile({ path: `assets/${previewName}`, name: previewName });
            const vault = fakeVault({ files: [source, preview] });
            const recognizer = { isExcalidrawFile: vi.fn(file => file.path === source.path) };
            const inspector = new DrawingFileInspector(fakeApp({ vault }) as any, recognizer);

            expect(inspector.inspect(preview)).toMatchObject({
                providerId: "excalidraw",
                sourceFile: source,
                role: "generated-preview",
                protectedFromImageMutation: true
            });
        }
    );

    it("leaves an Excalidraw-looking preview as an ordinary image without a source", () => {
        const preview = fakeTFile({ path: "assets/Icon.excalidraw.svg", name: "Icon.excalidraw.svg" });
        const inspector = new DrawingFileInspector(fakeApp({ vault: fakeVault({ files: [preview] }) }) as any, {
            isExcalidrawFile: () => false
        });

        expect(inspector.inspect(preview)).toBeNull();
    });

    it("rejects an ambiguous preview when modern and legacy sources both exist", () => {
        const modern = fakeTFile({ path: "assets/Flow.excalidraw.md", name: "Flow.excalidraw.md" });
        const legacy = fakeTFile({ path: "assets/Flow.excalidraw", name: "Flow.excalidraw" });
        const preview = fakeTFile({ path: "assets/Flow.excalidraw.svg", name: "Flow.excalidraw.svg" });
        const vault = fakeVault({ files: [modern, legacy, preview] });
        const inspector = new DrawingFileInspector(fakeApp({ vault }) as any, {
            isExcalidrawFile: file => file.path !== preview.path
        });

        expect(inspector.inspect(preview)).toBeNull();
    });

    it("recognizes arbitrary Markdown sources through Excalidraw frontmatter", () => {
        const file = fakeTFile({ path: "drawings/Architecture.md", extension: "md" });
        const metadataCache = fakeMetadataCache({
            fileCache: new Map([[file.path, { frontmatter: { "excalidraw-plugin": "parsed" } }]])
        });
        const inspector = new DrawingFileInspector(fakeApp({ metadataCache }) as any, {
            isExcalidrawFile: () => false
        });

        expect(inspector.inspect(file)).toMatchObject({
            providerId: "excalidraw",
            sourceFile: file,
            role: "source"
        });
    });
});
