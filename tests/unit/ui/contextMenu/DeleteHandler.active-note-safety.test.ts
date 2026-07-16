import { describe, expect, it, vi } from "vitest";
import { CloudImageDeleter } from "../../../../src/cloud/CloudImageDeleter";
import { DeleteHandler } from "../../../../src/ui/contextMenu/handlers/DeleteHandler";
import { fakeApp, fakeTFile, fakeVault, fakeWorkspace } from "../../../factories/obsidian";

describe("DeleteHandler active-note reference safety", () => {
    it("keeps a local image when another active-note reference remains after removing one link", async () => {
        const imageFile = fakeTFile({ path: "attachments/photo.png", name: "photo.png", extension: "png" });
        const activeFile = fakeTFile({ path: "notes/day.md", name: "day.md", extension: "md" });
        const source = "![[attachments/photo.png]]";
        const editor = { getLine: vi.fn(() => source) } as any;
        const save = vi.fn(async () => undefined);
        const view = { editor, file: activeFile, save, contentEl: document.createElement("div") };
        const app = fakeApp({
            vault: fakeVault({ files: [imageFile, activeFile] }),
            workspace: fakeWorkspace({
                activeFile,
                activeView: view
            })
        }) as any;
        app.vault.trash = vi.fn(async () => undefined);
        const plugin = {
            settings: { pasteHandling: { cloud: { uploader: "PicList" } } },
            historyManager: { isUrlUploaded: vi.fn(() => false) },
            vaultReferenceManager: {
                scanReferencesDetailed: vi.fn(async () => ({
                    locations: [{
                        file: activeFile,
                        start: 20,
                        end: 45,
                        original: "![[attachments/photo.png]]",
                        link: imageFile.path,
                        line: 1
                    }],
                    complete: true,
                    uncertainFiles: []
                })),
                getFilesReferencingImage: vi.fn(async () => [])
            }
        } as any;
        const linkRemover = { removeImageLink: vi.fn(async () => undefined) } as any;
        const handler = new DeleteHandler(
            app,
            plugin,
            { getImagePath: vi.fn(() => imageFile.path) } as any,
            {
                findImageMatches: vi.fn(async () => [{
                    lineNumber: 0,
                    line: "![[attachments/photo.png]]",
                    fullMatch: "![[attachments/photo.png]]",
                    index: 0
                }])
            } as any,
            linkRemover,
            new CloudImageDeleter(plugin),
            {
                resolve: vi.fn(() => ({
                    view,
                    file: activeFile,
                    editor,
                    match: { line: 0, start: 0, end: source.length, linkText: source }
                }))
            } as any
        );
        const image = document.createElement("img");
        image.setAttribute("src", "app://vault/attachments/photo.png");

        await handler.deleteImageAndLink({ target: image } as unknown as MouseEvent, image);

        expect(linkRemover.removeImageLink).toHaveBeenCalledOnce();
        expect(save).toHaveBeenCalledOnce();
        expect(app.vault.trash).not.toHaveBeenCalled();
    });
});
