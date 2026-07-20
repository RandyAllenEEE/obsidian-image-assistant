import { describe, expect, it, vi } from "vitest";
import {
    ImageConversionCommitError,
    ImageConversionCommitter,
} from "../../../src/local/ImageConversionCommitter";
import { sha256Hex } from "../../../src/utils/BinaryHash";
import { createReferenceMutationScanPolicy } from "../../../src/utils/ReferenceScanPolicy";
import { fakeTFile } from "../../factories/obsidian";

interface FixtureOptions {
    preflightComplete?: boolean;
    preflightLocations?: number;
    postflightLocations?: number;
    createResult?: "target" | "null" | "throw";
    updateFound?: number;
    updateReplaced?: number;
    updateComplete?: boolean;
    updateFailedFiles?: string[];
    trashFails?: boolean;
    canvasContent?: string;
    canvasWriteFails?: boolean;
    useLocationUpdater?: boolean;
}

function makeFixture(options: FixtureOptions = {}) {
    const source = fakeTFile({ path: "assets/photo.png", name: "photo.png", extension: "png" });
    const target = fakeTFile({ path: "assets/photo.webp", name: "photo.webp", extension: "webp" });
    const note = fakeTFile({ path: "notes/day.md", name: "day.md", extension: "md" });
    const canvas = fakeTFile({ path: "boards/media.canvas", name: "media.canvas", extension: "canvas" });
    let canvasContent = options.canvasContent;
    const locations = (count: number) => Array.from({ length: count }, (_, index) => ({
        file: note,
        start: index,
        end: index + 1,
        original: "![[assets/photo.png|caption|300]]",
        link: source.path,
        line: index,
    }));
    let scanCount = 0;
    const scanReferencesDetailed = vi.fn(async () => {
        const isPreflight = scanCount++ === 0;
        const locationCount = isPreflight
            ? (options.preflightLocations ?? 1)
            : (options.postflightLocations ?? 0);
        return {
            locations: locations(locationCount),
            complete: isPreflight ? (options.preflightComplete ?? true) : true,
            uncertainFiles: isPreflight && options.preflightComplete === false ? ["notes/unreadable.md"] : [],
        };
    });
    const updateResult = {
        found: options.updateFound ?? (options.preflightLocations ?? 1),
        replaced: options.updateReplaced ?? (options.preflightLocations ?? 1),
        complete: options.updateComplete ?? true,
        files: [],
        failedFiles: options.updateFailedFiles ?? [],
        uncertainFiles: [],
    };
    const updateReferencesDetailed = vi.fn(async () => updateResult);
    const updateReferenceLocationsDetailed = vi.fn(async (foundLocations, replacement) => {
        for (const location of foundLocations) replacement(location);
        return updateResult;
    });
    const referenceManager: Record<string, unknown> = {
        scanReferencesDetailed,
        getFilesReferencingImage: vi.fn(async () => []),
        updateReferencesDetailed,
    };
    if (options.useLocationUpdater) {
        referenceManager.updateReferenceLocationsDetailed = updateReferenceLocationsDetailed;
    }

    const app = {
        vault: {
            modifyBinary: vi.fn(async () => undefined),
            trash: options.trashFails
                ? vi.fn(async () => { throw new Error("trash unavailable"); })
                : vi.fn(async () => undefined),
            getFiles: vi.fn(() => canvasContent === undefined ? [] : [canvas]),
            getAbstractFileByPath: vi.fn((path: string) => {
                if (path === source.path) return source;
                if (path === target.path) return target;
                if (path === note.path) return note;
                return null;
            }),
            read: vi.fn(async () => canvasContent as string),
            process: options.canvasWriteFails
                ? vi.fn(async (_file, updater: (content: string) => string) => {
                    updater(canvasContent as string);
                    throw new Error("canvas disk full");
                })
                : vi.fn(async (_file, updater: (content: string) => string) => {
                    canvasContent = updater(canvasContent as string);
                    return canvasContent;
                }),
            modify: options.canvasWriteFails
                ? vi.fn(async () => { throw new Error("canvas disk full"); })
                : vi.fn(async (_file, content: string) => { canvasContent = content; }),
        },
        metadataCache: {
            fileToLinktext: vi.fn(() => "../assets/photo.webp"),
            getFirstLinkpathDest: vi.fn(() => source),
        },
    } as any;
    const createUniqueBinary = options.createResult === "throw"
        ? vi.fn(async () => { throw new Error("target disk full"); })
        : vi.fn(async () => options.createResult === "null" ? null : target);
    const fileManager = { createUniqueBinary } as any;
    const committer = new ImageConversionCommitter(app, fileManager, referenceManager as any);

    return {
        app,
        committer,
        source,
        target,
        createUniqueBinary,
        scanReferencesDetailed,
        updateReferencesDetailed,
        updateReferenceLocationsDetailed,
    };
}

async function expectCommitError(promise: Promise<unknown>, stage: string): Promise<ImageConversionCommitError> {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(ImageConversionCommitError);
        expect((error as ImageConversionCommitError).report.stage).toBe(stage);
        expect((error as ImageConversionCommitError).report.sourcePreserved).toBe(true);
        return error as ImageConversionCommitError;
    }
    throw new Error("Expected conversion commit to fail");
}

describe("ImageConversionCommitter", () => {
    it("modifies the source in place when the output filename is unchanged", async () => {
        const fixture = makeFixture();
        const data = new Uint8Array([1, 2, 3]).buffer;

        const result = await fixture.committer.commit(fixture.source, fixture.source.name, data);

        expect(result).toBe(fixture.source);
        expect(fixture.app.vault.modifyBinary).toHaveBeenCalledWith(fixture.source, data);
        expect(fixture.createUniqueBinary).not.toHaveBeenCalled();
    });

    it("fails closed when the Markdown preflight is incomplete", async () => {
        const fixture = makeFixture({ preflightComplete: false });

        const error = await expectCommitError(
            fixture.committer.commit(fixture.source, "photo.webp", new ArrayBuffer(1)),
            "preflight"
        );

        expect(error.report.uncertainFiles).toContain("notes/unreadable.md");
        expect(fixture.createUniqueBinary).not.toHaveBeenCalled();
    });

    it("blocks conversion before target creation when ordinary fenced references are protected", async () => {
        const fixture = makeFixture({ preflightLocations: 1 });
        const committer = new ImageConversionCommitter(
            fixture.app,
            { createUniqueBinary: fixture.createUniqueBinary } as any,
            {
                scanReferencesDetailed: vi.fn(async (
                    _path: string,
                    policy: { kind: "safety" | "mutation" }
                ) => ({
                    locations: policy.kind === "safety"
                        ? [{
                            file: fakeTFile({ path: "notes/protected.md", extension: "md" }),
                            start: 12,
                            end: 39,
                            original: "![[assets/photo.png]]",
                            link: fixture.source.path,
                            line: 2
                        }]
                        : [],
                    complete: true,
                    uncertainFiles: []
                })),
                getFilesReferencingImage: vi.fn(async () => []),
                updateReferencesDetailed: vi.fn()
            } as any,
            createReferenceMutationScanPolicy(false)
        );

        const error = await expectCommitError(
            committer.commit(fixture.source, "photo.webp", new ArrayBuffer(1)),
            "preflight"
        );

        expect(error.report).toMatchObject({
            protectedReferences: 1,
            protectedFiles: ["notes/protected.md"]
        });
        expect(error.report).not.toHaveProperty("targetPath");
        expect(fixture.createUniqueBinary).not.toHaveBeenCalled();
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it.each([
        ["throw", "target disk full"],
        ["null", "Could not create converted image"],
    ] as const)("preserves the source when target creation returns %s", async (createResult, message) => {
        const fixture = makeFixture({ createResult });

        const error = await expectCommitError(
            fixture.committer.commit(fixture.source, "photo.webp", new ArrayBuffer(1)),
            "target-create"
        );

        expect(error.message).toContain(message);
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("keeps both files when not every Markdown reference is replaced", async () => {
        const fixture = makeFixture({ updateFound: 2, updateReplaced: 1 });

        const error = await expectCommitError(
            fixture.committer.commit(fixture.source, "photo.webp", new ArrayBuffer(1)),
            "markdown"
        );

        expect(error.report.targetPath).toBe(fixture.target.path);
        expect(error.message).toContain("Updated 1 of 2");
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("keeps both files when a Canvas reference cannot be saved", async () => {
        const fixture = makeFixture({
            canvasContent: JSON.stringify({ nodes: [{ type: "file", file: "assets/photo.png" }] }),
            canvasWriteFails: true,
        });
        vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const error = await expectCommitError(
            fixture.committer.commit(fixture.source, "photo.webp", new ArrayBuffer(1)),
            "canvas"
        );

        expect(error.report.canvas?.failedFiles).toContain("boards/media.canvas");
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("does not delete the source when the postflight finds a remaining reference", async () => {
        const fixture = makeFixture({ postflightLocations: 1 });

        const error = await expectCommitError(
            fixture.committer.commit(fixture.source, "photo.webp", new ArrayBuffer(1)),
            "markdown"
        );

        expect(error.message).toContain("Source references remain");
        expect(error.report.uncertainFiles).toContain("notes/day.md");
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("reports source deletion failure after references have been committed", async () => {
        const fixture = makeFixture({ trashFails: true });

        const error = await expectCommitError(
            fixture.committer.commit(fixture.source, "photo.webp", new ArrayBuffer(1)),
            "source-delete"
        );

        expect(error.message).toContain("trash unavailable");
        expect(error.report.targetPath).toBe(fixture.target.path);
    });

    it("preserves the source when its content changes before final deletion", async () => {
        const fixture = makeFixture();
        const original = new Uint8Array([1, 2, 3, 4]).buffer;
        const changed = new Uint8Array([9, 8, 7, 6]).buffer;
        fixture.app.vault.readBinary = vi.fn()
            .mockResolvedValueOnce(original)
            .mockResolvedValueOnce(original)
            .mockResolvedValueOnce(changed);
        const revision = {
            path: fixture.source.path,
            size: original.byteLength,
            mtime: fixture.source.stat.mtime,
            sha256: await sha256Hex(original)
        };

        const error = await expectCommitError(
            fixture.committer.commit(
                fixture.source,
                "photo.webp",
                new Uint8Array([4, 5, 6]).buffer,
                revision
            ),
            "preflight"
        );

        expect(error.message).toContain("changed before conversion");
        expect(fixture.createUniqueBinary).toHaveBeenCalledOnce();
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("uses the location updater and deletes the source only after clean postflight scans", async () => {
        const fixture = makeFixture({ useLocationUpdater: true });

        const result = await fixture.committer.commit(
            fixture.source,
            "photo.webp",
            new Uint8Array([4, 5, 6]).buffer
        );

        expect(result).toBe(fixture.target);
        expect(fixture.updateReferenceLocationsDetailed).toHaveBeenCalledOnce();
        expect(fixture.updateReferencesDetailed).not.toHaveBeenCalled();
        expect(fixture.app.metadataCache.fileToLinktext).toHaveBeenCalledWith(
            fixture.target,
            "notes/day.md",
            false
        );
        expect(fixture.app.vault.trash).toHaveBeenCalledWith(fixture.source, true);
        expect(fixture.scanReferencesDetailed).toHaveBeenCalledTimes(2);
    });
});
