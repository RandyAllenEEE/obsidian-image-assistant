import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";
import {
    ImageReferenceWorkflowCoordinator
} from "../../../src/utils/ImageReferenceWorkflowCoordinator";
import { VaultReferenceManager } from "../../../src/utils/VaultReferenceManager";
import {
    fakeApp,
    fakeMetadataCache,
    fakeTFile,
    fakeVault
} from "../../factories/obsidian";

function createFixture(options: {
    codeBlocks?: boolean;
    files: ReturnType<typeof fakeTFile>[];
    contents: Map<string, string>;
    uploadedUrls?: string[];
}) {
    const vault = fakeVault({
        files: options.files,
        fileContents: options.contents
    });
    const app = fakeApp({
        vault,
        metadataCache: fakeMetadataCache()
    }) as any;
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.global.codeBlockImageLinkIndexing = options.codeBlocks ?? false;
    settings.localProcessing.link = {
        linkFormat: "wikilink",
        pathFormat: "absolute",
        prependCurrentDir: false
    };
    const uploaded = new Set(options.uploadedUrls ?? []);
    const plugin = {
        settings,
        historyManager: {
            isUrlUploaded: vi.fn((url: string) => uploaded.has(url)),
            getRecord: vi.fn(),
            removeRecord: vi.fn()
        },
        imageStateManager: { refreshAllImages: vi.fn() },
        imageCaption: { refreshAllViews: vi.fn() }
    } as any;
    plugin.vaultReferenceManager = new VaultReferenceManager(app, plugin);
    return {
        app,
        plugin,
        coordinator: new ImageReferenceWorkflowCoordinator(app, plugin)
    };
}

describe("ImageReferenceWorkflowCoordinator", () => {
    it("derives protected fenced references from existing safety and mutation scans", async () => {
        const image = fakeTFile({ path: "assets/photo.png", extension: "png" });
        const note = fakeTFile({ path: "notes/context.md", extension: "md" });
        const canvas = fakeTFile({ path: "boards/context.canvas", extension: "canvas" });
        const contents = new Map([
            [note.path, [
                "![[assets/photo.png|Prose|300]]",
                "```markdown",
                "![[assets/photo.png|Protected]]",
                "```",
                "`![[assets/photo.png|Inline]]`",
                "<!-- ![[assets/photo.png|Comment]] -->",
                "```ad-note",
                "![[assets/photo.png|Admonition]]",
                "```"
            ].join("\n")],
            [canvas.path, JSON.stringify({
                nodes: [
                    { id: "native", type: "file", file: image.path },
                    {
                        id: "text",
                        type: "text",
                        text: "![[assets/photo.png|Canvas]]"
                    }
                ]
            })]
        ]);
        const { coordinator } = createFixture({
            files: [image, note, canvas],
            contents,
            codeBlocks: false
        });

        const inventory = await coordinator.inspect({ kind: "local", file: image });

        expect(inventory).toMatchObject({
            totalReferences: 5,
            mutableReferences: 4,
            protectedFencedReferences: 1,
            outOfBoundaryReferences: 0,
            markdownReferences: 3,
            canvasReferences: 2,
            mutableComplete: true,
            canDeleteAfterAll: false
        });
        expect(coordinator.getAllowedDecisionActions(inventory, "delete")).toEqual(
            new Set(["cancel", "all-keep-source"])
        );
    });

    it("replaces mutable Markdown and Canvas references while preserving protected fences", async () => {
        const image = fakeTFile({ path: "assets/photo.png", extension: "png" });
        const note = fakeTFile({ path: "notes/context.md", extension: "md" });
        const canvas = fakeTFile({ path: "boards/context.canvas", extension: "canvas" });
        const url = "https://cdn.example/photo.png";
        const contents = new Map([
            [note.path, [
                "![[assets/photo.png|Prose|300]]",
                "```markdown",
                "![[assets/photo.png|Protected]]",
                "```",
                "```ad-note",
                "![[assets/photo.png|Admonition]]",
                "```"
            ].join("\n")],
            [canvas.path, JSON.stringify({
                nodes: [
                    { id: "native", type: "file", file: image.path },
                    { id: "text", type: "text", text: "![[assets/photo.png|Canvas|right]]" }
                ]
            })]
        ]);
        const { coordinator } = createFixture({
            files: [image, note, canvas],
            contents,
            codeBlocks: false
        });
        const inventory = await coordinator.inspect({ kind: "local", file: image });

        const result = await coordinator.replace(
            inventory,
            { kind: "url", url },
            "all"
        );

        expect(result).toMatchObject({ found: 4, changed: 4, complete: true });
        expect(contents.get(note.path)).toContain(`![[${url}|Prose|300]]`);
        expect(contents.get(note.path)).toContain("![[assets/photo.png|Protected]]");
        expect(contents.get(note.path)).toContain(`![[${url}|Admonition]]`);
        const canvasData = JSON.parse(contents.get(canvas.path) ?? "{}");
        expect(canvasData.nodes[0]).toMatchObject({ type: "link", url });
        expect(canvasData.nodes[1].text).toBe(`![[${url}|Canvas|right]]`);

        const deletion = await coordinator.deleteSource({ kind: "local", file: image });
        expect(deletion.sourceDeleted).toBe(false);
    });

    it("serializes URL replacements per source file and preserves title and pipe syntax", async () => {
        const local = fakeTFile({ path: "assets/My Photo.png", extension: "png" });
        const note = fakeTFile({ path: "notes/source.md", extension: "md" });
        const canvas = fakeTFile({ path: "boards/source.canvas", extension: "canvas" });
        const url = "https://cdn.example/photo?id=1";
        const contents = new Map([
            [note.path, [
                `![Alt](${url} "Title")`,
                `![[${url}|Caption|center|320]]`
            ].join("\n")],
            [canvas.path, JSON.stringify({
                nodes: [
                    { type: "link", url },
                    { type: "text", text: `![[${url}|Canvas|200]]` }
                ]
            })]
        ]);
        const { coordinator } = createFixture({
            files: [local, note, canvas],
            contents,
            codeBlocks: false
        });
        const inventory = await coordinator.inspect({ kind: "url", url });

        const result = await coordinator.replace(
            inventory,
            { kind: "local", file: local },
            "all"
        );

        expect(result).toMatchObject({ found: 4, changed: 4, complete: true });
        expect(contents.get(note.path)).toContain(
            '![Alt](/assets/My%20Photo.png "Title")'
        );
        expect(contents.get(note.path)).toContain(
            "![[/assets/My Photo.png|Caption|center|320]]"
        );
        const canvasData = JSON.parse(contents.get(canvas.path) ?? "{}");
        expect(canvasData.nodes[0]).toMatchObject({
            type: "file",
            file: local.path
        });
        expect(canvasData.nodes[1].text).toBe(
            "![[/assets/My Photo.png|Canvas|200]]"
        );
    });

    it("adds the configured fixed initial width to downloaded links without replacing existing sizes", async () => {
        const local = fakeTFile({ path: "assets/My Photo.png", extension: "png" });
        const note = fakeTFile({ path: "notes/source.md", extension: "md" });
        const url = "https://cdn.example/photo?id=1";
        const contents = new Map([[
            note.path,
            [
                `![Alt](${url} "Title")`,
                `![[${url}|Caption|right]]`,
                `![[${url}|Existing|320|center]]`
            ].join("\n")
        ]]);
        const { coordinator, plugin } = createFixture({
            files: [local, note],
            contents,
            codeBlocks: false
        });
        plugin.settings.localProcessing.embedResize = {
            ...plugin.settings.localProcessing.embedResize,
            resizeDimension: "width",
            width: 500,
            resizeScaleMode: "auto",
            resizeUnits: "pixels"
        };
        const inventory = await coordinator.inspect({ kind: "url", url });

        const result = await coordinator.replace(
            inventory,
            { kind: "local", file: local },
            "all"
        );

        expect(result).toMatchObject({ found: 3, changed: 3, complete: true });
        expect(contents.get(note.path)).toBe([
            '![Alt|500](/assets/My%20Photo.png "Title")',
            "![[/assets/My Photo.png|Caption|right|500]]",
            "![[/assets/My Photo.png|Existing|320|center]]"
        ].join("\n"));
    });

    it("returns a refreshed inventory without mutating when references change before execution", async () => {
        const image = fakeTFile({ path: "assets/photo.png", extension: "png" });
        const note = fakeTFile({ path: "notes/source.md", extension: "md" });
        const original = "![[assets/photo.png]]";
        const contents = new Map([[note.path, original]]);
        const { coordinator } = createFixture({
            files: [image, note],
            contents
        });
        const inventory = await coordinator.inspect({ kind: "local", file: image });
        contents.set(note.path, `${original}\n${original}`);

        const result = await coordinator.remove(inventory, "all");

        expect(result.changed).toBe(0);
        expect(result.staleInventory?.totalReferences).toBe(2);
        expect(contents.get(note.path)).toBe(`${original}\n${original}`);
    });

    it("limits mutations to the requested documents while keeping deletion safety global", async () => {
        const image = fakeTFile({ path: "assets/photo.png", extension: "png" });
        const allowed = fakeTFile({ path: "notes/allowed.md", extension: "md" });
        const outside = fakeTFile({ path: "notes/outside.md", extension: "md" });
        const source = "![[assets/photo.png|Caption|300]]";
        const contents = new Map([
            [allowed.path, source],
            [outside.path, source]
        ]);
        const { coordinator } = createFixture({
            files: [image, outside, allowed],
            contents,
            codeBlocks: true
        });
        const inventory = await coordinator.inspect(
            { kind: "local", file: image },
            {
                mutationBoundary: {
                    allowedDocumentPaths: [allowed.path, allowed.path]
                }
            }
        );

        expect(inventory).toMatchObject({
            totalReferences: 2,
            mutableReferences: 1,
            protectedFencedReferences: 0,
            outOfBoundaryReferences: 1,
            canDeleteAfterAll: false
        });
        expect(inventory.mutationBoundary?.allowedDocumentPaths)
            .toEqual([allowed.path]);

        const result = await coordinator.replace(
            inventory,
            { kind: "url", url: "https://cdn.example/photo.png" },
            "all"
        );

        expect(result).toMatchObject({ found: 1, changed: 1, complete: true });
        expect(contents.get(allowed.path)).toContain("https://cdn.example/photo.png");
        expect(contents.get(outside.path)).toBe(source);

        const deletion = await coordinator.deleteSource({ kind: "local", file: image });
        expect(deletion.sourceDeleted).toBe(false);
    });

    it("includes the normalized mutation boundary in the inventory signature", async () => {
        const image = fakeTFile({ path: "assets/photo.png", extension: "png" });
        const first = fakeTFile({ path: "notes/first.md", extension: "md" });
        const second = fakeTFile({ path: "notes/second.md", extension: "md" });
        const contents = new Map([
            [first.path, "![[assets/photo.png]]"],
            [second.path, "![[assets/photo.png]]"]
        ]);
        const { coordinator } = createFixture({
            files: [image, first, second],
            contents,
            codeBlocks: true
        });

        const firstInventory = await coordinator.inspect(
            { kind: "local", file: image },
            { mutationBoundary: { allowedDocumentPaths: [first.path] } }
        );
        const secondInventory = await coordinator.inspect(
            { kind: "local", file: image },
            { mutationBoundary: { allowedDocumentPaths: [second.path] } }
        );

        expect(firstInventory.signature).not.toBe(secondInventory.signature);
    });

    it("fails closed when a final source-deletion scan still finds a reference", async () => {
        const image = fakeTFile({ path: "assets/photo.png", extension: "png" });
        const note = fakeTFile({ path: "notes/source.md", extension: "md" });
        const contents = new Map([[note.path, "![[assets/photo.png]]"]]);
        const { app, coordinator } = createFixture({
            files: [image, note],
            contents
        });

        const result = await coordinator.deleteSource({ kind: "local", file: image });

        expect(result.sourceDeleted).toBe(false);
        expect(app.vault.trash).not.toHaveBeenCalled();
    });

    it("reports a deleted remote source as incomplete when history cleanup fails", async () => {
        const url = "https://cdn.example/photo.png";
        const { app, plugin } = createFixture({
            files: [],
            contents: new Map(),
            uploadedUrls: [url]
        });
        plugin.settings.pasteHandling.cloud.uploader = "PicList";
        plugin.settings.pasteHandling.cloud.deleteServer =
            "http://127.0.0.1:36677/delete";
        const cloudDeleter = {
            deleteImageDetailed: vi.fn(async () => ({
                success: true,
                historyUpdated: false,
                message: "remote deleted; history disk full"
            }))
        };
        const coordinator = new ImageReferenceWorkflowCoordinator(
            app,
            plugin,
            cloudDeleter as any
        );

        const result = await coordinator.deleteSource({ kind: "url", url });

        expect(result).toMatchObject({
            complete: false,
            sourceDeleted: true,
            uncertainFiles: ["remote deleted; history disk full"],
            sourceDeleteResult: {
                success: true,
                historyUpdated: false
            }
        });
    });

    it("keeps a local source whose content changed after the decision inventory", async () => {
        const image = fakeTFile({
            path: "assets/photo.png",
            extension: "png",
            stat: { ctime: 1, mtime: 1, size: 3 }
        });
        const { app, coordinator } = createFixture({
            files: [image],
            contents: new Map()
        });
        app.vault.readBinary
            .mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer);
        const inventory = await coordinator.inspect({
            kind: "local",
            file: image
        });
        image.stat.mtime = 2;
        app.vault.readBinary.mockResolvedValue(
            new Uint8Array([3, 2, 1]).buffer
        );

        const deletion = await coordinator.deleteSource(
            inventory.source,
            inventory.sourceRevision
        );

        expect(deletion).toMatchObject({
            complete: false,
            sourceDeleted: false,
            uncertainFiles: [image.path]
        });
        expect(app.vault.trash).not.toHaveBeenCalled();
    });

    it("reports partial vault mutation and preserves the source when one file write fails", async () => {
        const image = fakeTFile({ path: "assets/photo.png", extension: "png" });
        const first = fakeTFile({ path: "notes/first.md", extension: "md" });
        const second = fakeTFile({ path: "notes/second.md", extension: "md" });
        const source = "![[assets/photo.png]]";
        const contents = new Map([
            [first.path, source],
            [second.path, source]
        ]);
        const { app, coordinator } = createFixture({
            files: [image, first, second],
            contents
        });
        const originalProcess = app.vault.process;
        app.vault.process = vi.fn(async (file: any, updater: (value: string) => string) => {
            if (file.path === second.path) throw new Error("disk full");
            return originalProcess.call(app.vault, file, updater);
        });
        const inventory = await coordinator.inspect({ kind: "local", file: image });

        const result = await coordinator.replace(
            inventory,
            { kind: "url", url: "https://cdn.example/photo.png" },
            "all"
        );

        expect(result).toMatchObject({
            found: 2,
            changed: 1,
            complete: false,
            failedFiles: [second.path]
        });
        expect(contents.get(first.path)).toContain("https://cdn.example/photo.png");
        expect(contents.get(second.path)).toBe(source);

        const deletion = await coordinator.deleteSource({ kind: "local", file: image });
        expect(deletion.sourceDeleted).toBe(false);
        expect(app.vault.trash).not.toHaveBeenCalled();
    });

    it("turns scanner entry failures into an incomplete inventory", async () => {
        const image = fakeTFile({ path: "assets/photo.png", extension: "png" });
        const { plugin, coordinator } = createFixture({
            files: [image],
            contents: new Map()
        });
        plugin.vaultReferenceManager.scanReferencesDetailed = vi.fn(async () => {
            throw new Error("scanner offline");
        });

        const inventory = await coordinator.inspect({ kind: "local", file: image });

        expect(inventory.mutableComplete).toBe(false);
        expect(inventory.safety.complete).toBe(false);
        expect(inventory.uncertainFiles.some(file => file.includes("scanner offline"))).toBe(true);
        expect(coordinator.getAllowedDecisionActions(inventory, "upload")).toEqual(
            new Set(["cancel", "keep-transfer"])
        );
    });
});
