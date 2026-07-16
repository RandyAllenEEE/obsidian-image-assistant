import { beforeEach, describe, expect, it, vi } from "vitest";

const obsidianMocks = vi.hoisted(() => ({ Notice: vi.fn() }));
vi.mock("obsidian", async importOriginal => ({
    ...await importOriginal<typeof import("obsidian")>(),
    Notice: obsidianMocks.Notice
}));

import { UploadDownloadHandler } from "../../../../src/ui/contextMenu/handlers/UploadDownloadHandler";
import { fakeApp, fakeMetadataCache, fakeTFile, fakeVault, fakeWorkspace } from "../../../factories/obsidian";

describe("UploadDownloadHandler", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("uploads the exact vault-root target from the clicked source link", async () => {
        const note = fakeTFile({ path: "notes/current.md", extension: "md" });
        const local = fakeTFile({ path: "attachments/My Photo.png", extension: "png" });
        const source = "![Caption](/attachments/My%20Photo.png)";
        const editor = { getLine: vi.fn(() => source) };
        const view = { file: note, editor, contentEl: document.createElement("div") };
        const app = fakeApp({
            vault: fakeVault({ files: [note, local] }),
            workspace: fakeWorkspace({ activeFile: note, activeView: view as any })
        }) as any;
        const cloudImageHandler = { uploadSingleFile: vi.fn(async () => undefined) };
        const resolver = { resolve: vi.fn(() => ({
            view,
            file: note,
            editor,
            match: { line: 0, start: 0, end: source.length, linkText: source }
        })) };
        const folderManagement = { getImagePath: vi.fn(() => { throw new Error("DOM fallback used"); }) };
        const handler = new UploadDownloadHandler(
            app,
            { cloudImageHandler } as any,
            folderManagement as any,
            resolver as any
        );
        const image = document.createElement("img");
        image.src = "app://vault/attachments/My%20Photo.png";

        await handler.uploadImageToCloud(image);

        expect(cloudImageHandler.uploadSingleFile).toHaveBeenCalledWith(local);
        expect(folderManagement.getImagePath).not.toHaveBeenCalled();
    });

    it("shows the detailed download error and releases the undo record", async () => {
        const note = fakeTFile({ path: "notes/current.md", name: "current.md" });
        const source = "![remote](https://example.com/photo.png)";
        const editor = { getLine: vi.fn(() => source), replaceRange: vi.fn() };
        const view = { file: note, editor, save: vi.fn(async () => undefined), contentEl: document.createElement("div") };
        const app = fakeApp({ workspace: fakeWorkspace({ activeFile: note, activeView: view as any }) }) as any;
        const result = {
            success: false,
            url: "https://example.com/photo.png",
            vaultPath: "attachments/photo.png",
            disposition: "created",
            undoToken: "partial-token",
            error: "Downloaded to attachments/photo.png, but no matching image reference remained"
        };
        const cloudImageHandler = {
            downloadSingleImageFile: vi.fn(async () => result),
            discardDownloadUndo: vi.fn()
        };
        const resolver = {
            resolve: vi.fn(() => ({
                view,
                file: note,
                editor,
                match: { line: 0, start: 0, end: source.length, linkText: source }
            }))
        };
        const handler = new UploadDownloadHandler(
            app,
            { cloudImageHandler } as any,
            {} as any,
            resolver as any
        );
        const image = document.createElement("img");
        image.setAttribute("src", result.url);

        await handler.downloadNetworkImage(image);

        expect(cloudImageHandler.downloadSingleImageFile).toHaveBeenCalledWith(result.url, note);
        expect(obsidianMocks.Notice).toHaveBeenCalledWith(expect.stringContaining(result.error));
        expect(cloudImageHandler.discardDownloadUndo).toHaveBeenCalledWith(result);
    });

    it("replaces only the clicked Wiki link and preserves its pipe attributes", async () => {
        const note = fakeTFile({ path: "notes/current.md", extension: "md" });
        const local = fakeTFile({ path: "attachments/photo.webp", extension: "webp" });
        const url = "https://example.com/photo";
        const source = `prefix ![[${url}|Caption|right|320]] suffix`;
        const linkText = `![[${url}|Caption|right|320]]`;
        const start = source.indexOf(linkText);
        const editor = { getLine: vi.fn(() => source), replaceRange: vi.fn() };
        const view = { file: note, editor, save: vi.fn(async () => undefined), contentEl: document.createElement("div") };
        const metadataCache = fakeMetadataCache();
        metadataCache.fileToLinktext = vi.fn(() => "../attachments/photo.webp") as any;
        const app = fakeApp({
            vault: fakeVault({ files: [note, local] }),
            metadataCache,
            workspace: fakeWorkspace({ activeFile: note, activeView: view as any })
        }) as any;
        const result = {
            success: true, url, vaultPath: local.path, localPath: "../attachments/photo.webp",
            disposition: "created", undoToken: "undo-1"
        };
        const cloudImageHandler = {
            downloadSingleImageFile: vi.fn(async () => result),
            discardDownloadUndo: vi.fn()
        };
        const refreshAllImages = vi.fn();
        const refreshAllViews = vi.fn();
        const resolver = { resolve: vi.fn(() => ({
            view, file: note, editor,
            match: { line: 0, start, end: start + linkText.length, linkText }
        })) };
        const handler = new UploadDownloadHandler(
            app,
            {
                cloudImageHandler,
                vaultReferenceManager: {},
                settings: {
                    localProcessing: {
                        link: { linkFormat: "wikilink", pathFormat: "shortest", prependCurrentDir: false }
                    }
                },
                imageStateManager: { refreshAllImages },
                imageCaption: { refreshAllViews }
            } as any,
            {} as any,
            resolver as any
        );
        const image = document.createElement("img");
        image.setAttribute("src", url);

        await handler.downloadNetworkImage(image);

        expect(editor.replaceRange).toHaveBeenCalledWith(
            "![[../attachments/photo.webp|Caption|right|320]]",
            { line: 0, ch: start },
            { line: 0, ch: start + linkText.length }
        );
        expect(view.save).toHaveBeenCalledOnce();
        expect(refreshAllImages).toHaveBeenCalledOnce();
        expect(refreshAllViews).toHaveBeenCalledOnce();
        expect(cloudImageHandler.discardDownloadUndo).toHaveBeenCalledWith(result);
    });

    it("does not overwrite a source range changed while the download was running", async () => {
        const note = fakeTFile({ path: "notes/current.md", extension: "md" });
        const url = "https://example.com/photo.png";
        const linkText = `![](${url})`;
        const editor = { getLine: vi.fn(() => "![](https://example.com/changed.png)"), replaceRange: vi.fn() };
        const view = { file: note, editor, save: vi.fn(), contentEl: document.createElement("div") };
        const result = { success: true, url, vaultPath: "attachments/photo.png", disposition: "created" };
        const cloudImageHandler = {
            downloadSingleImageFile: vi.fn(async () => result),
            discardDownloadUndo: vi.fn()
        };
        const handler = new UploadDownloadHandler(
            fakeApp() as any,
            { cloudImageHandler, vaultReferenceManager: {} } as any,
            {} as any,
            { resolve: vi.fn(() => ({
                view, file: note, editor,
                match: { line: 0, start: 0, end: linkText.length, linkText }
            })) } as any
        );
        const image = document.createElement("img");
        image.setAttribute("src", url);

        await handler.downloadNetworkImage(image);

        expect(editor.replaceRange).not.toHaveBeenCalled();
        expect(view.save).not.toHaveBeenCalled();
        expect(cloudImageHandler.discardDownloadUndo).toHaveBeenCalledWith(result);
        expect(obsidianMocks.Notice).toHaveBeenCalledWith(expect.stringContaining("source link changed"));
    });
});
