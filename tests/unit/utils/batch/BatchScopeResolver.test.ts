import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../../../src/settings/defaults";
import { BatchScopeResolver } from "../../../../src/utils/batch/BatchScopeResolver";
import {
    fakeApp,
    fakeMetadataCache,
    fakeTFile,
    fakeTFolder,
    fakeVault
} from "../../../factories/obsidian";

function createResolver(options: {
    files: ReturnType<typeof fakeTFile>[];
    folders?: ReturnType<typeof fakeTFolder>[];
    contents?: Map<string, string>;
}) {
    const vault = fakeVault({
        files: options.files,
        folders: options.folders,
        fileContents: options.contents
    });
    const app = fakeApp({
        vault,
        metadataCache: fakeMetadataCache()
    }) as any;
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.global.codeBlockImageLinkIndexing = false;
    const plugin = {
        settings,
        supportedImageFormats: {
            isSupported: vi.fn((extension?: string, name?: string) => {
                const candidate = (extension ?? name?.split(".").pop() ?? "").toLowerCase();
                return ["png", "jpg", "jpeg", "webp"].includes(candidate);
            })
        }
    } as any;
    return {
        app,
        resolver: new BatchScopeResolver(app, plugin)
    };
}

describe("BatchScopeResolver", () => {
    it("collects and sorts source documents for note, folder and vault scopes", () => {
        const noteA = fakeTFile({ path: "project/a.md", extension: "md" });
        const noteB = fakeTFile({ path: "project/z.canvas", extension: "canvas" });
        const outside = fakeTFile({ path: "outside/b.md", extension: "md" });
        const image = fakeTFile({ path: "project/photo.png", extension: "png" });
        const folder = fakeTFolder({ path: "project" });
        const { resolver } = createResolver({
            files: [outside, noteB, image, noteA],
            folders: [folder]
        });

        expect(resolver.collectSourceDocuments("note", noteA).items)
            .toEqual([noteA]);
        expect(resolver.collectSourceDocuments("folder", folder).items)
            .toEqual([noteA, noteB]);
        expect(resolver.collectSourceDocuments("vault", null).items)
            .toEqual([outside, noteA, noteB]);
        expect([...resolver.getAllowedDocumentPaths("folder", folder)])
            .toEqual([noteA.path, noteB.path]);
    });

    it("collects physical image files for folder and vault scopes", async () => {
        const first = fakeTFile({ path: "project/a.png", extension: "png" });
        const second = fakeTFile({ path: "project/nested/z.jpg", extension: "jpg" });
        const outside = fakeTFile({ path: "outside/b.webp", extension: "webp" });
        const note = fakeTFile({ path: "project/source.md", extension: "md" });
        const folder = fakeTFolder({ path: "project" });
        const { resolver } = createResolver({
            files: [second, note, outside, first],
            folders: [folder]
        });

        expect((await resolver.collectLocalAssets("folder", folder)).items)
            .toEqual([first, second]);
        expect((await resolver.collectLocalAssets("vault", null)).items)
            .toEqual([outside, first, second]);
    });

    it("uses shared Markdown context semantics for note-local assets", async () => {
        const note = fakeTFile({ path: "notes/source.md", extension: "md" });
        const prose = fakeTFile({ path: "assets/prose.png", extension: "png" });
        const admonition = fakeTFile({ path: "assets/admonition.png", extension: "png" });
        const fenced = fakeTFile({ path: "assets/fenced.png", extension: "png" });
        const frontmatter = fakeTFile({ path: "assets/frontmatter.png", extension: "png" });
        const contents = new Map([[
            note.path,
            [
                "---",
                "cover: \"![[assets/frontmatter.png]]\"",
                "---",
                "![[assets/prose.png]]",
                "```markdown",
                "![[assets/fenced.png]]",
                "```",
                "```ad-note",
                "![[assets/admonition.png]]",
                "```",
                "`![[assets/fenced.png]]`",
                "<!-- ![[assets/frontmatter.png]] -->"
            ].join("\n")
        ]]);
        const { resolver } = createResolver({
            files: [note, prose, admonition, fenced, frontmatter],
            contents
        });

        const result = await resolver.collectLocalAssets("note", note);

        expect(result.complete).toBe(true);
        expect(result.items).toEqual([admonition, prose]);
    });

    it("reports malformed Canvas discovery instead of silently omitting it", async () => {
        const canvas = fakeTFile({ path: "boards/broken.canvas", extension: "canvas" });
        const { resolver } = createResolver({
            files: [canvas],
            contents: new Map([[canvas.path, "{bad"]])
        });

        const result = await resolver.collectLocalAssets("note", canvas);

        expect(result.complete).toBe(false);
        expect(result.items).toEqual([]);
        expect(result.failedFiles[0]).toContain(canvas.path);
        expect(result.uncertainFiles).toEqual([canvas.path]);
    });

    it("reports missing Markdown and Canvas image targets as uncertain", async () => {
        const note = fakeTFile({ path: "notes/missing.md", extension: "md" });
        const canvas = fakeTFile({ path: "boards/missing.canvas", extension: "canvas" });
        const contents = new Map([
            [note.path, "![[assets/missing.png]]"],
            [canvas.path, JSON.stringify({
                nodes: [{ type: "file", file: "assets/missing.png" }]
            })]
        ]);
        const { resolver } = createResolver({
            files: [note, canvas],
            contents
        });

        const markdownResult = await resolver.collectLocalAssets("note", note);
        const canvasResult = await resolver.collectLocalAssets("note", canvas);

        expect(markdownResult.complete).toBe(false);
        expect(markdownResult.uncertainFiles).toEqual([
            `${note.path}: assets/missing.png`
        ]);
        expect(canvasResult.complete).toBe(false);
        expect(canvasResult.uncertainFiles).toEqual([
            `${canvas.path}: assets/missing.png`
        ]);
    });

    it("reports invalid scope and target combinations", async () => {
        const image = fakeTFile({ path: "assets/photo.png", extension: "png" });
        const { resolver } = createResolver({ files: [image] });

        const documents = resolver.collectSourceDocuments("note", image);
        const assets = await resolver.collectLocalAssets("note", image);

        expect(documents.complete).toBe(false);
        expect(assets.complete).toBe(false);
        expect(documents.uncertainFiles).toEqual([image.path]);
        expect(assets.uncertainFiles).toEqual([image.path]);
    });
});
