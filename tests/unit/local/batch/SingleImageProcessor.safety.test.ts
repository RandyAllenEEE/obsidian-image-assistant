import { describe, expect, it, vi } from "vitest";
import { SingleImageProcessor } from "../../../../src/local/batch/SingleImageProcessor";
import { fakeTFile } from "../../../factories/obsidian";

function createFixture(options: {
    references?: number;
    updatedReferences?: number;
    canvasWriteFails?: boolean;
    allowLargerFiles?: boolean;
} = {}) {
    const source = fakeTFile({
        path: "assets/photo.png",
        name: "photo.png",
        basename: "photo",
        extension: "png",
        stat: { ctime: 0, mtime: 0, size: 2_000 },
    });
    const output = fakeTFile({ path: "assets/photo.webp", name: "photo.webp", extension: "webp" });
    const note = fakeTFile({ path: "note.md", name: "note.md" });
    const canvas = fakeTFile({ path: "board.canvas", name: "board.canvas", extension: "canvas" });
    const trash = vi.fn(async (_file?: unknown, _system?: boolean) => undefined);
    let canvasContent = JSON.stringify({ nodes: [{ type: "file", file: source.path }] });
    const process = options.canvasWriteFails
        ? vi.fn(async (_file: any, updater: (content: string) => string) => {
            updater(canvasContent);
            throw new Error("disk full");
        })
        : vi.fn(async (_file: any, updater: (content: string) => string) => {
            canvasContent = updater(canvasContent);
            return canvasContent;
        });
    const app = {
        vault: {
            readBinary: vi.fn(async () => new Uint8Array([
                0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
            ]).buffer),
            modifyBinary: vi.fn(async () => undefined),
            trash,
            getFiles: vi.fn(() => [canvas]),
            read: vi.fn(async () => canvasContent),
            process,
            getAbstractFileByPath: vi.fn((path: string) =>
                path === source.path ? source : path === output.path ? output : null
            ),
        },
        metadataCache: {
            fileToLinktext: vi.fn((file) => file.path),
            getFirstLinkpathDest: vi.fn((path) => path === source.path ? source : null),
        },
    } as any;
    const referenceCount = options.references ?? 0;
    let remainingReferences = referenceCount;
    const vaultReferenceManager = {
        scanReferencesDetailed: vi.fn(async () => ({
            locations: Array.from({ length: remainingReferences }, (_, index) => ({
                file: note,
                start: index,
                end: index + 1,
                original: `![[${source.path}]]`,
                link: source.path,
                line: index,
            })),
            complete: true,
            uncertainFiles: [],
        })),
        updateReferencesDetailed: vi.fn(async () => ({
            found: referenceCount,
            replaced: options.updatedReferences ?? referenceCount,
            complete: true,
            files: [],
            failedFiles: [],
            uncertainFiles: [],
        })),
    };
    vaultReferenceManager.updateReferencesDetailed.mockImplementation(async () => {
        const replaced = options.updatedReferences ?? referenceCount;
        remainingReferences = Math.max(0, referenceCount - replaced);
        return {
            found: referenceCount,
            replaced,
            complete: true,
            files: [],
            failedFiles: [],
            uncertainFiles: [],
        };
    });
    const plugin = {
        settings: {
            localProcessing: { conversion: { minimumCompressionSavingsInKB: 2, allowLargerFiles: options.allowLargerFiles ?? true } },
            operationDefaults: {
                batchLocal: {
                    convertTo: "webp",
                    quality: 80,
                    resizeMode: "None",
                    desiredWidth: 0,
                    desiredHeight: 0,
                    desiredLength: 0,
                    enlargeOrReduce: "Auto",
                },
            },
            pasteHandling: { cloud: { uploadConcurrency: 1 } },
            global: { batchConcurrency: 1 },
            cleanerSettings: {
                enableDeleteContextMenu: true,
                trashMode: "follow-obsidian",
                customTrashPath: ".trash"
            }
        },
        vaultReferenceManager,
    } as any;
    app.fileManager = {
        trashFile: vi.fn(async (file: typeof source) => {
            await trash(file, true);
        })
    };
    const imageProcessor = {
        processImageDetailed: vi.fn(async () => ({
            data: new Uint8Array(500).buffer,
            mimeType: "image/webp",
            extension: "webp",
            outcome: "converted",
        }))
    } as any;
    const fileManager = { createUniqueBinary: vi.fn(async () => output) } as any;
    const processor = new SingleImageProcessor(app, plugin, imageProcessor, fileManager);

    return { processor, source, output, trash, process, fileManager, app, imageProcessor };
}

describe("SingleImageProcessor safe commit", () => {
    it("keeps the source when not every Markdown reference was updated", async () => {
        const { processor, source, trash } = createFixture({ references: 1, updatedReferences: 0 });

        const result = await processor.processSingleImage(source, "WEBP", 0.8, 1, "None", 0, 0, 0, "Auto", true);

        expect(result.success).toBe(false);
        expect(result.error).toContain("Updated 0 of 1");
        expect(trash).not.toHaveBeenCalled();
    });

    it("keeps the source and reports the Canvas file when its write fails", async () => {
        const { processor, source, trash } = createFixture({ canvasWriteFails: true });
        vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const result = await processor.processSingleImage(source, "WEBP", 0.8, 1, "None", 0, 0, 0, "Auto", true);

        expect(result.success).toBe(false);
        expect(result.error).toContain("board.canvas");
        expect(trash).not.toHaveBeenCalled();
    });

    it("deletes the source only after Markdown and Canvas references commit", async () => {
        const { processor, source, trash, process } = createFixture({ references: 1, updatedReferences: 1 });

        const result = await processor.processSingleImage(source, "WEBP", 0.8, 1, "None", 0, 0, 0, "Auto", true);

        expect(result.success).toBe(true);
        expect(process).toHaveBeenCalledOnce();
        expect(trash).toHaveBeenCalledWith(source, true);
    });

    it("updates a JPEG in place when only its extension alias differs", async () => {
        const { processor, source, trash, fileManager, app, imageProcessor } = createFixture();
        Object.assign(source, { name: "photo.jpeg", extension: "jpeg" });
        const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;
        app.vault.readBinary.mockResolvedValue(jpeg);
        imageProcessor.processImageDetailed.mockResolvedValue({
            data: jpeg,
            mimeType: "image/jpeg",
            extension: "jpg",
            outcome: "converted",
        });

        const result = await processor.processSingleImage(
            source, "JPEG", 0.8, 1, "None", 0, 0, 0, "Auto", true
        );

        expect(result.success).toBe(true);
        expect(app.vault.modifyBinary).toHaveBeenCalledWith(source, jpeg);
        expect(fileManager.createUniqueBinary).not.toHaveBeenCalled();
        expect(trash).not.toHaveBeenCalled();
    });

    it("reports insufficient savings as skipped without creating a target file", async () => {
        const { processor, source, fileManager } = createFixture({ allowLargerFiles: false });

        const result = await processor.batchProcess([source]);

        expect(result.successful).toHaveLength(0);
        expect(result.failed).toHaveLength(0);
        expect(result.skipped).toHaveLength(1);
        expect(fileManager.createUniqueBinary).not.toHaveBeenCalled();
    });

    it("keeps a readable failure message when an image adapter throws a non-Error value", async () => {
        const { processor, source } = createFixture();
        (processor as any).imageProcessor.processImageDetailed.mockRejectedValue("codec unavailable");

        const result = await processor.processSingleImage(source, "WEBP", 0.8, 1, "None", 0, 0, 0, "Auto", true);

        expect(result).toMatchObject({ success: false, error: "codec unavailable" });
    });

    it("keeps non-Error rejection details from a queued batch task", async () => {
        const { processor, source } = createFixture();
        vi.spyOn(processor, "processSingleImage").mockRejectedValue("worker unavailable");

        const result = await processor.batchProcess([source]);

        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].error).toBe("worker unavailable");
    });
});
