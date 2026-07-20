import { beforeEach, describe, expect, it, vi } from "vitest";
import { RenameHandler } from "../../../../src/ui/contextMenu/handlers/RenameHandler";
import {
    fakeApp,
    fakeTFile,
    fakeVault,
    fakeWorkspace
} from "../../../factories/obsidian";

describe("RenameHandler", () => {
    beforeEach(() => vi.clearAllMocks());

    function makeFixture(
        source = "![[assets/pic.png|Old caption|right|500x300]]"
    ) {
        const imageFile = fakeTFile({
            path: "assets/pic.png",
            name: "pic.png",
            extension: "png"
        });
        const note = fakeTFile({
            path: "notes/current.md",
            name: "current.md",
            extension: "md"
        });
        const vault = fakeVault({ files: [imageFile, note] }) as any;
        const app = fakeApp({
            vault,
            workspace: fakeWorkspace({ activeFile: note })
        }) as any;
        let line = source;
        const editor = {
            getLine: vi.fn(() => line),
            getValue: vi.fn(() => line),
            lineCount: vi.fn(() => 1),
            replaceRange: vi.fn((
                replacement: string,
                start: { ch: number },
                end: { ch: number }
            ) => {
                line = line.slice(0, start.ch)
                    + replacement
                    + line.slice(end.ch);
            })
        };
        const view = {
            file: note,
            editor,
            save: vi.fn().mockResolvedValue(undefined),
            contentEl: document.createElement("div")
        };
        const match = {
            line: 0,
            start: 0,
            end: source.length,
            linkText: source
        };
        const context = {
            image: document.createElement("img"),
            ownerDocument: document,
            ownerWindow: window,
            renderedSrc: "app://local/assets/pic.png",
            sourceKind: "local",
            resolution: "resolved",
            owner: { view, file: note, editor },
            viewContext: { view, file: note, editor, match },
            descriptor: null,
            localFile: imageFile,
            url: null,
            dataReference: null
        } as any;
        const plugin = {
            imageStateManager: { refreshAllImages: vi.fn() },
            imageCaption: { refreshAllViews: vi.fn() }
        } as any;
        const folderManagement = {
            ensureFolderExists: vi.fn().mockResolvedValue(undefined),
            safeRenameFile: vi.fn().mockResolvedValue(true),
            sanitizeFilename: vi.fn((value: string) => value.trim())
        };
        const renameCoordinator = {
            execute: vi.fn(async (request: { rename: () => Promise<boolean> }) => {
                try {
                    const fileMoved = await request.rename();
                    return {
                        complete: fileMoved,
                        fileMoved,
                        compatibilityCopyCreated: false,
                        compatibilityCopyPreserved: false,
                        repairedReferences: 0,
                        failedFiles: [],
                        uncertainFiles: [],
                        error: fileMoved ? undefined : "File rename was not completed"
                    };
                } catch (error) {
                    return {
                        complete: false,
                        fileMoved: false,
                        compatibilityCopyCreated: false,
                        compatibilityCopyPreserved: false,
                        repairedReferences: 0,
                        failedFiles: [],
                        uncertainFiles: [],
                        error: error instanceof Error ? error.message : String(error)
                    };
                }
            })
        };
        const handler = new RenameHandler(
            app,
            plugin,
            folderManagement as any,
            {
                processTemplate: vi.fn(async (value: string) => value)
            } as any,
            renameCoordinator as any
        );
        return {
            app,
            context,
            editor,
            folderManagement,
            getLine: () => line,
            handler,
            imageFile,
            plugin,
            renameCoordinator,
            view
        };
    }

    it("writes caption, one-sided dimensions and alignment through the exact link", async () => {
        const fixture = makeFixture();
        const result = await fixture.handler.applyProperties(
            fixture.context,
            {
                fileName: "pic",
                directory: "assets",
                caption: "New caption",
                width: 500,
                height: null,
                alignment: "center"
            }
        );

        expect(result).toEqual({
            complete: true,
            linkUpdated: true,
            fileMoved: false
        });
        expect(fixture.getLine()).toBe(
            "![[assets/pic.png|New caption|center|500]]"
        );
        expect(fixture.view.save).toHaveBeenCalledOnce();
        expect(fixture.app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it("saves property changes before moving the exact local file", async () => {
        const fixture = makeFixture();
        const result = await fixture.handler.applyProperties(
            fixture.context,
            {
                fileName: "renamed",
                directory: "images",
                caption: "Updated",
                width: null,
                height: 240,
                alignment: "left-wrap"
            }
        );

        expect(result).toEqual({
            complete: true,
            linkUpdated: true,
            fileMoved: true
        });
        expect(fixture.folderManagement.ensureFolderExists)
            .toHaveBeenCalledWith("images");
        expect(fixture.app.fileManager.renameFile).toHaveBeenCalledWith(
            fixture.imageFile,
            "images/renamed.png"
        );
        expect(fixture.view.save.mock.invocationCallOrder[0]).toBeLessThan(
            fixture.app.fileManager.renameFile.mock.invocationCallOrder[0]
        );
    });

    it("does not write when the original source range changed", async () => {
        const fixture = makeFixture();
        fixture.editor.getLine.mockReturnValue(
            "![[assets/other.png|Old caption|right|500x300]]"
        );

        const result = await fixture.handler.applyProperties(
            fixture.context,
            {
                fileName: "renamed",
                directory: "images",
                caption: "Changed",
                width: null,
                height: null,
                alignment: null
            }
        );

        expect(result.complete).toBe(false);
        expect(fixture.editor.replaceRange).not.toHaveBeenCalled();
        expect(fixture.app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it("rolls back an editor mutation and skips rename when saving fails", async () => {
        const fixture = makeFixture();
        fixture.view.save.mockRejectedValueOnce(new Error("disk full"));

        const result = await fixture.handler.applyProperties(
            fixture.context,
            {
                fileName: "renamed",
                directory: "images",
                caption: "Changed",
                width: null,
                height: null,
                alignment: null
            }
        );

        expect(result.complete).toBe(false);
        expect(fixture.getLine()).toBe(
            "![[assets/pic.png|Old caption|right|500x300]]"
        );
        expect(fixture.app.fileManager.renameFile).not.toHaveBeenCalled();
    });

    it("reports partial success when rename fails after a saved property update", async () => {
        const fixture = makeFixture();
        fixture.app.fileManager.renameFile.mockRejectedValueOnce(
            new Error("target exists")
        );

        const result = await fixture.handler.applyProperties(
            fixture.context,
            {
                fileName: "renamed",
                directory: "images",
                caption: "Changed",
                width: null,
                height: null,
                alignment: null
            }
        );

        expect(result).toMatchObject({
            complete: false,
            linkUpdated: true,
            fileMoved: false,
            error: "target exists"
        });
        expect(fixture.getLine()).toBe("![[assets/pic.png|Changed]]");
    });

    it("rejects invalid dimensions and target traversal without changing data", async () => {
        const fixture = makeFixture();
        const invalidSize = await fixture.handler.applyProperties(
            fixture.context,
            {
                fileName: "pic",
                directory: "assets",
                caption: "Old caption",
                width: -1,
                height: null,
                alignment: "right"
            }
        );
        expect(invalidSize.complete).toBe(false);

        const invalidPath = await fixture.handler.applyProperties(
            fixture.context,
            {
                fileName: "renamed",
                directory: "../outside",
                caption: "Old caption",
                width: 500,
                height: 300,
                alignment: "right"
            }
        );
        expect(invalidPath.complete).toBe(false);
        expect(fixture.app.fileManager.renameFile).not.toHaveBeenCalled();
    });
});
