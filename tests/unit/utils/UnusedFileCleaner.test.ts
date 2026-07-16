import { describe, expect, it, vi } from "vitest";
import { UnusedFileCleaner } from "../../../src/utils/UnusedFileCleaner";
import { fakeApp, fakeTFile, fakeTFolder, fakeVault } from "../../factories/obsidian";

function makeCleanerFixture(canvasContent: string, resolveCanvasLink?: (link: string) => any) {
    const folder = fakeTFolder({ path: "attachments", name: "attachments" });
    const used = fakeTFile({
        path: "attachments/used.png",
        name: "used.png",
        extension: "png",
        parent: folder
    });
    const unused = fakeTFile({
        path: "attachments/unused.png",
        name: "unused.png",
        extension: "png",
        parent: folder
    });
    const canvas = fakeTFile({
        path: "boards/board.canvas",
        name: "board.canvas",
        extension: "canvas"
    });
    (folder as any).children = [used, unused];

    const app = fakeApp({
        vault: fakeVault({
            files: [used, unused, canvas],
            folders: [folder],
            fileContents: new Map([[canvas.path, canvasContent]])
        })
    }) as any;
    app.metadataCache.getFirstLinkpathDest = vi.fn((link: string) => resolveCanvasLink?.(link) ?? null);

    const getFilesReferencingImages = vi.fn(async (paths: string[]) =>
        new Map(paths.map(path => [path, []]))
    );
    const plugin = {
        vaultReferenceManager: {
            getFilesReferencingImages,
            getFilesReferencingImage: vi.fn(async () => [])
        }
    } as any;

    return {
        app,
        plugin,
        cleaner: new UnusedFileCleaner(app, plugin),
        used,
        unused,
        canvas
    };
}

describe("UnusedFileCleaner", () => {
    it("treats files referenced by Canvas file nodes as referenced", async () => {
        const canvasContent = JSON.stringify({
            nodes: [
                { id: "1", type: "file", file: "attachments/used.png" }
            ]
        }, null, 2);
        const { cleaner, used, unused, canvas, plugin } = makeCleanerFixture(canvasContent);

        const result = await cleaner.scanFolder("attachments", ["png"]);

        expect(plugin.vaultReferenceManager.getFilesReferencingImages).toHaveBeenCalledWith([used.path, unused.path]);
        expect(plugin.vaultReferenceManager.getFilesReferencingImage).not.toHaveBeenCalled();
        expect((cleaner as any).app.vault.read).toHaveBeenCalledTimes(1);
        expect(result.scannedFiles).toBe(2);
        expect(result.referencedFiles.map(info => info.file.path)).toEqual([used.path]);
        expect(result.unreferencedFiles.map(info => info.file.path)).toEqual([unused.path]);
        expect(result.referencedFiles[0].references[0]).toMatchObject({
            notePath: canvas.path,
            lineContent: "Canvas file node: attachments/used.png"
        });
        expect(result.referencedFiles[0].references[0].lineNumber).toBeGreaterThan(0);
    });

    it("resolves Canvas file nodes through metadataCache before declaring them unused", async () => {
        const canvasContent = JSON.stringify({
            nodes: [
                { id: "1", type: "file", file: "used.png" }
            ]
        });
        const { cleaner, used } = makeCleanerFixture(
            canvasContent,
            (link) => link === "used.png" ? used : null
        );

        const result = await cleaner.scanFolder("attachments", ["png"]);

        expect(result.referencedFiles.map(info => info.file.path)).toEqual([used.path]);
    });

    it("marks candidates unknown when a Canvas file contains malformed JSON", async () => {
        const { cleaner, used, unused } = makeCleanerFixture("{ bad json");

        const result = await cleaner.scanFolder("attachments", ["png"]);

        expect(result.referencedFiles).toEqual([]);
        expect(result.unreferencedFiles).toEqual([]);
        expect(result.unknownFiles.map(info => info.file.path)).toEqual([used.path, unused.path]);
        expect(result.scanComplete).toBe(false);
    });

    it("marks candidates unknown when the Markdown safety scan is incomplete", async () => {
        const { cleaner, plugin, used, unused } = makeCleanerFixture(JSON.stringify({ nodes: [] }));
        plugin.vaultReferenceManager.scanReferencesForTargetsDetailed = vi.fn(async (paths: string[]) => ({
            references: new Map(paths.map(path => [path, []])),
            complete: false,
            uncertainFiles: ["notes/unreadable.md"]
        }));

        const result = await cleaner.scanFolder("attachments", ["png"]);

        expect(result.unreferencedFiles).toEqual([]);
        expect(result.unknownFiles.map(info => info.file.path)).toEqual([used.path, unused.path]);
        expect(result.scanComplete).toBe(false);
        expect(result.uncertainFiles).toContain("notes/unreadable.md");
    });

    it("normalizes file type settings with dots, whitespace, case, and duplicates", () => {
        expect(UnusedFileCleaner.parseFileTypes(" .PNG, jpg, .webp, png, , .JPG ")).toEqual([
            "png",
            "jpg",
            "webp"
        ]);
    });

    it("excludes the configured custom trash subtree from future scans", async () => {
        const folder = fakeTFolder({ path: "attachments", name: "attachments" });
        const trash = fakeTFolder({ path: "attachments/Trash", name: "Trash", parent: folder });
        const candidate = fakeTFile({ path: "attachments/new.png", name: "new.png", extension: "png", parent: folder });
        const previouslyTrashed = fakeTFile({
            path: "attachments/Trash/old.png", name: "old.png", extension: "png", parent: trash
        });
        (folder as any).children = [candidate, trash];
        (trash as any).children = [previouslyTrashed];
        const app = fakeApp({
            vault: fakeVault({ files: [candidate, previouslyTrashed], folders: [folder, trash] })
        }) as any;
        const plugin = {
            settings: { cleanerSettings: { trashMode: "custom", customTrashPath: "attachments/Trash" } },
            vaultReferenceManager: {
                getFilesReferencingImages: vi.fn(async (paths: string[]) => new Map(paths.map(path => [path, []]))),
                getFilesReferencingImage: vi.fn(async () => [])
            }
        } as any;

        const result = await new UnusedFileCleaner(app, plugin).scanFolder("attachments", ["png"]);

        expect(result.scannedFiles).toBe(1);
        expect(result.unreferencedFiles.map(info => info.file.path)).toEqual([candidate.path]);
    });

    it("creates custom trash folders recursively before moving files", async () => {
        const file = fakeTFile({
            path: "attachments/unused.png",
            name: "unused.png",
            extension: "png"
        });
        const app = fakeApp({
            vault: fakeVault({ files: [file] })
        }) as any;
        const plugin = {
            vaultReferenceManager: {
                scanReferencesDetailed: vi.fn(async () => ({ locations: [], complete: true, uncertainFiles: [] })),
                getFilesReferencingImage: vi.fn(async () => [])
            }
        } as any;
        const cleaner = new UnusedFileCleaner(app, plugin);

        const count = await cleaner.deleteFiles([file], "custom", "Trash/Unused");

        expect(count).toBe(1);
        expect(app.vault.createFolder).toHaveBeenNthCalledWith(1, "Trash");
        expect(app.vault.createFolder).toHaveBeenNthCalledWith(2, "Trash/Unused");
        expect(app.fileManager.renameFile).toHaveBeenCalledWith(file, "Trash/Unused/unused.png");
    });

    it("does not move files when a custom trash path segment is an existing file", async () => {
        const file = fakeTFile({
            path: "attachments/unused.png",
            name: "unused.png",
            extension: "png"
        });
        const pathConflict = fakeTFile({
            path: "Trash",
            name: "Trash",
            extension: ""
        });
        const app = fakeApp({
            vault: fakeVault({ files: [file, pathConflict] })
        }) as any;
        const plugin = {
            vaultReferenceManager: {
                scanReferencesDetailed: vi.fn(async () => ({ locations: [], complete: true, uncertainFiles: [] })),
                getFilesReferencingImage: vi.fn(async () => [])
            }
        } as any;
        const cleaner = new UnusedFileCleaner(app, plugin);

        const count = await cleaner.deleteFiles([file], "custom", "Trash/Unused");

        expect(count).toBe(0);
        expect(app.vault.createFolder).not.toHaveBeenCalled();
        expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it("rejects a custom trash path that traverses outside the vault", async () => {
        const file = fakeTFile({
            path: "attachments/unused.png",
            name: "unused.png",
            extension: "png"
        });
        const app = fakeApp({ vault: fakeVault({ files: [file] }) }) as any;
        const plugin = {
            vaultReferenceManager: {
                scanReferencesDetailed: vi.fn(async () => ({ locations: [], complete: true, uncertainFiles: [] })),
                getFilesReferencingImage: vi.fn(async () => [])
            }
        } as any;
        const cleaner = new UnusedFileCleaner(app, plugin);

        const count = await cleaner.deleteFiles([file], "custom", "../outside");

        expect(count).toBe(0);
        expect(app.vault.createFolder).not.toHaveBeenCalled();
        expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it("does not disguise a same-folder rename as custom-trash deletion", async () => {
        const folder = fakeTFolder({ path: "attachments", name: "attachments" });
        const file = fakeTFile({
            path: "attachments/unused.png", name: "unused.png", extension: "png", parent: folder
        });
        const app = fakeApp({ vault: fakeVault({ files: [file], folders: [folder] }) }) as any;
        const plugin = {
            vaultReferenceManager: {
                scanReferencesDetailed: vi.fn(async () => ({ locations: [], complete: true, uncertainFiles: [] })),
                getFilesReferencingImage: vi.fn(async () => [])
            }
        } as any;

        const count = await new UnusedFileCleaner(app, plugin)
            .deleteFiles([file], "custom", "attachments");

        expect(count).toBe(0);
        expect(app.fileManager.renameFile).not.toHaveBeenCalled();
    });
});
