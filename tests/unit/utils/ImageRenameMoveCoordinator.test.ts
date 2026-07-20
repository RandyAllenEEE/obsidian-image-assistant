import { describe, expect, it, vi } from "vitest";
import { ImageRenameMoveCoordinator } from "../../../src/utils/ImageRenameMoveCoordinator";
import { fakeTFile } from "../../factories/obsidian";

function inventory(overrides: Record<string, unknown> = {}) {
    return {
        safety: {
            complete: true,
            referenceCount: 0,
            markdown: [],
            canvas: []
        },
        mutableComplete: true,
        protectedFencedReferences: 0,
        outOfBoundaryReferences: 0,
        uncertainFiles: [],
        totalReferences: 0,
        ...overrides
    } as any;
}

function createFixture() {
    const source = fakeTFile({
        path: "assets/source.png",
        name: "source.png",
        extension: "png"
    });
    const moved = fakeTFile({
        path: "images/moved.png",
        name: "moved.png",
        extension: "png"
    });
    const compatibility = fakeTFile({
        path: source.path,
        name: source.name,
        extension: source.extension
    });
    const bytes = new Uint8Array([1, 2, 3]).buffer;
    const files = new Map<string, unknown>([
        [source.path, source]
    ]);
    const vault = {
        readBinary: vi.fn(async () => bytes),
        getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
        createBinary: vi.fn(async (path: string) => {
            files.set(path, compatibility);
            return compatibility;
        })
    };
    const workflow = {
        inspect: vi.fn()
            .mockResolvedValueOnce(inventory())
            .mockResolvedValueOnce(inventory({ totalReferences: 2 })),
        replace: vi.fn().mockResolvedValue({
            found: 2,
            changed: 2,
            complete: true,
            failedFiles: [],
            uncertainFiles: [],
            sourceDeleted: false
        }),
        deleteSource: vi.fn().mockResolvedValue({
            found: 0,
            changed: 0,
            complete: true,
            failedFiles: [],
            uncertainFiles: [],
            sourceDeleted: true
        })
    };
    const app = { vault } as any;
    const coordinator = new ImageRenameMoveCoordinator(
        app,
        {} as any,
        workflow as any
    );
    const rename = vi.fn(async () => {
        files.delete(source.path);
        files.set(moved.path, moved);
        return true;
    });
    return {
        coordinator,
        source,
        moved,
        compatibility,
        files,
        vault,
        workflow,
        rename
    };
}

describe("ImageRenameMoveCoordinator", () => {
    it("blocks before reading or renaming when safety preflight is incomplete", async () => {
        const fixture = createFixture();
        fixture.workflow.inspect.mockReset().mockResolvedValue(
            inventory({
                safety: {
                    complete: false,
                    referenceCount: 0,
                    markdown: [],
                    canvas: []
                },
                uncertainFiles: ["notes/locked.md"]
            })
        );

        const result = await fixture.coordinator.execute({
            file: fixture.source,
            targetPath: fixture.moved.path,
            rename: fixture.rename
        });

        expect(result.complete).toBe(false);
        expect(result.fileMoved).toBe(false);
        expect(result.uncertainFiles).toContain("notes/locked.md");
        expect(fixture.vault.readBinary).not.toHaveBeenCalled();
        expect(fixture.rename).not.toHaveBeenCalled();
    });

    it("blocks the rename when source bytes change after the backup read", async () => {
        const fixture = createFixture();
        fixture.vault.readBinary
            .mockResolvedValueOnce(new Uint8Array([1, 2, 3]).buffer)
            .mockResolvedValueOnce(new Uint8Array([3, 2, 1]).buffer);

        const result = await fixture.coordinator.execute({
            file: fixture.source,
            targetPath: fixture.moved.path,
            rename: fixture.rename
        });

        expect(result).toMatchObject({
            complete: false,
            fileMoved: false,
            uncertainFiles: [fixture.source.path]
        });
        expect(fixture.rename).not.toHaveBeenCalled();
        expect(fixture.files.get(fixture.source.path)).toBe(fixture.source);
    });

    it("repairs old references and removes the temporary compatibility copy", async () => {
        const fixture = createFixture();

        const result = await fixture.coordinator.execute({
            file: fixture.source,
            targetPath: fixture.moved.path,
            rename: fixture.rename
        });

        expect(result).toMatchObject({
            complete: true,
            fileMoved: true,
            compatibilityCopyCreated: true,
            compatibilityCopyPreserved: false,
            repairedReferences: 2
        });
        expect(fixture.vault.createBinary).toHaveBeenCalledWith(
            fixture.source.path,
            expect.any(ArrayBuffer)
        );
        expect(fixture.workflow.replace).toHaveBeenCalledOnce();
        expect(fixture.workflow.deleteSource).toHaveBeenCalledWith({
            kind: "local",
            file: fixture.compatibility
        });
    });

    it("keeps the old-path copy when reference repair is incomplete", async () => {
        const fixture = createFixture();
        fixture.workflow.replace.mockResolvedValueOnce({
            found: 2,
            changed: 1,
            complete: false,
            failedFiles: ["notes/failing.md"],
            uncertainFiles: [],
            sourceDeleted: false
        });

        const result = await fixture.coordinator.execute({
            file: fixture.source,
            targetPath: fixture.moved.path,
            rename: fixture.rename
        });

        expect(result).toMatchObject({
            complete: false,
            fileMoved: true,
            compatibilityCopyCreated: true,
            compatibilityCopyPreserved: true,
            repairedReferences: 1
        });
        expect(result.failedFiles).toContain("notes/failing.md");
        expect(fixture.workflow.deleteSource).not.toHaveBeenCalled();
        expect(fixture.files.get(fixture.source.path)).toBe(fixture.compatibility);
    });

    it("restores the old path when the renamed target cannot be resolved", async () => {
        const fixture = createFixture();
        const rename = vi.fn(async () => {
            fixture.files.delete(fixture.source.path);
            return true;
        });

        const result = await fixture.coordinator.execute({
            file: fixture.source,
            targetPath: fixture.moved.path,
            rename
        });

        expect(result).toMatchObject({
            complete: false,
            fileMoved: true,
            compatibilityCopyCreated: true,
            compatibilityCopyPreserved: true
        });
        expect(fixture.files.get(fixture.source.path)).toBe(fixture.compatibility);
        expect(fixture.workflow.replace).not.toHaveBeenCalled();
    });
});
