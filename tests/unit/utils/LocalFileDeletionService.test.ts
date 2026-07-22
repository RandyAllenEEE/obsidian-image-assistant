import { describe, expect, it, vi } from "vitest";
import {
    LocalFileDeletionService,
    type LocalFileDeletionSettings
} from "../../../src/utils/LocalFileDeletionService";
import { fakeTFile, fakeTFolder } from "../../factories/obsidian";

function createFixture(settings: LocalFileDeletionSettings) {
    const file = fakeTFile({
        path: "assets/photo.png",
        name: "photo.png",
        basename: "photo",
        extension: "png"
    });
    const trashFolder = fakeTFolder({ path: "Archive/Trash" });
    const app = {
        vault: {
            trash: vi.fn().mockResolvedValue(undefined),
            createFolder: vi.fn().mockResolvedValue(undefined),
            getAbstractFileByPath: vi.fn((path: string) =>
                path === trashFolder.path ? trashFolder : null)
        },
        fileManager: {
            trashFile: vi.fn().mockResolvedValue(undefined),
            renameFile: vi.fn().mockResolvedValue(undefined)
        }
    } as any;
    return {
        app,
        file,
        service: new LocalFileDeletionService(app, () => settings)
    };
}

describe("LocalFileDeletionService", () => {
    it("delegates the recommended mode to Obsidian's public deletion API", async () => {
        const fixture = createFixture({
            trashMode: "follow-obsidian",
            customTrashPath: ".trash"
        });

        const result = await fixture.service.delete(fixture.file);

        expect(fixture.app.fileManager.trashFile)
            .toHaveBeenCalledWith(fixture.file);
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
        expect(result.disposition).toBe("obsidian-preference");
    });

    it.each([
        ["system", true, "system-trash"],
        ["obsidian", false, "obsidian-trash"]
    ] as const)("applies the explicit %s override", async (
        trashMode,
        system,
        disposition
    ) => {
        const fixture = createFixture({
            trashMode,
            customTrashPath: ".trash"
        });

        const result = await fixture.service.delete(fixture.file);

        expect(fixture.app.vault.trash)
            .toHaveBeenCalledWith(fixture.file, system);
        expect(fixture.app.fileManager.trashFile).not.toHaveBeenCalled();
        expect(result.disposition).toBe(disposition);
    });

    it("moves custom-trash files to a collision-safe vault path", async () => {
        const fixture = createFixture({
            trashMode: "custom",
            customTrashPath: "Archive/Trash"
        });
        fixture.app.vault.getAbstractFileByPath.mockImplementation(
            (path: string) => {
                if (path === "Archive/Trash") {
                    return fakeTFolder({ path });
                }
                if (path === "Archive/Trash/photo.png") {
                    return fakeTFile({ path });
                }
                return null;
            }
        );

        const result = await fixture.service.delete(fixture.file);

        expect(fixture.app.fileManager.renameFile).toHaveBeenCalledWith(
            fixture.file,
            "Archive/Trash/photo_1.png"
        );
        expect(result).toEqual({
            disposition: "custom-folder",
            destinationPath: "Archive/Trash/photo_1.png"
        });
    });

    it("rejects an empty custom-trash destination before moving", async () => {
        const fixture = createFixture({
            trashMode: "custom",
            customTrashPath: ""
        });

        await expect(fixture.service.delete(fixture.file))
            .rejects.toThrow("non-root vault folder");
        expect(fixture.app.fileManager.renameFile).not.toHaveBeenCalled();
    });
});
