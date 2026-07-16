import { describe, expect, it, vi } from "vitest";
import { SingleUploadHandler } from "../../../../src/cloud/handlers/SingleUploadHandler";
import { CloudImageDeleter } from "../../../../src/cloud/CloudImageDeleter";
import { fakeApp, fakeTFile, fakeVault } from "../../../factories/obsidian";

function createFixture() {
    const file = fakeTFile({ path: "attachments/photo.png", name: "photo.png", extension: "png" });
    const app = fakeApp({ vault: fakeVault({ files: [file] }) }) as any;
    app.vault.trash = vi.fn(async () => undefined);
    const referenceManager = {
        scanReferencesDetailed: vi.fn(async () => ({
            locations: [] as any[], complete: true, uncertainFiles: [] as string[]
        })),
        updateReferenceLocationsDetailed: vi.fn(async (locations: any[]) => ({
            found: locations.length,
            replaced: locations.length,
            complete: true,
            files: [],
            failedFiles: [],
            uncertainFiles: []
        })),
        getFilesReferencingImage: vi.fn(async () => []),
        getFilesReferencingUrl: vi.fn(async () => [])
    };
    const plugin = {
        settings: {
            captions: { enabled: false },
            pasteHandling: { cloud: { uploader: "PicList" } }
        },
        vaultReferenceManager: referenceManager
    } as any;
    const handler = new SingleUploadHandler(app, plugin);
    return { app, file, handler, referenceManager };
}

describe("SingleUploadHandler no-reference deletion safety", () => {
    it("keeps both copies when a fresh scan finds a reference after the dialog was shown", async () => {
        const { app, file, handler, referenceManager } = createFixture();
        referenceManager.scanReferencesDetailed.mockResolvedValueOnce({
            locations: [{ file, start: 0, end: 1, original: "![[attachments/photo.png]]", link: file.path, line: 0 }],
            complete: true,
            uncertainFiles: []
        });

        await (handler as any).handleNoReferenceChoice("keep-cloud", file, "https://cdn.example/photo.png");

        expect(app.vault.trash).not.toHaveBeenCalled();
    });

    it("rechecks after cloud deletion and keeps the local file when a reference appears", async () => {
        const { app, file, handler, referenceManager } = createFixture();
        referenceManager.scanReferencesDetailed
            .mockResolvedValueOnce({ locations: [], complete: true, uncertainFiles: [] })
            .mockResolvedValueOnce({
                locations: [{ file, start: 0, end: 1, original: "![[attachments/photo.png]]", link: file.path, line: 0 }],
                complete: true,
                uncertainFiles: []
            });
        const deleteCloudImage = vi.spyOn(handler as any, "deleteCloudImage").mockResolvedValue(true);

        await (handler as any).handleNoReferenceChoice("delete-all", file, "https://cdn.example/photo.png");

        expect(deleteCloudImage).toHaveBeenCalledOnce();
        expect(app.vault.trash).not.toHaveBeenCalled();
    });

    it("rechecks immediately before keep-cloud deletes the local file", async () => {
        const { app, file, handler, referenceManager } = createFixture();
        referenceManager.scanReferencesDetailed
            .mockResolvedValueOnce({ locations: [], complete: true, uncertainFiles: [] })
            .mockResolvedValueOnce({
                locations: [{ file, start: 0, end: 1, original: "![[attachments/photo.png]]", link: file.path, line: 0 }],
                complete: true,
                uncertainFiles: []
            });

        await (handler as any).handleNoReferenceChoice("keep-cloud", file, "https://cdn.example/photo.png");

        expect(referenceManager.scanReferencesDetailed).toHaveBeenCalledTimes(2);
        expect(app.vault.trash).not.toHaveBeenCalled();
    });

    it("keeps the cloud object when undo finds a URL reference", async () => {
        const { file, handler, referenceManager } = createFixture();
        const url = "https://cdn.example/photo.png";
        referenceManager.scanReferencesDetailed.mockResolvedValue({
            locations: [{ file, start: 0, end: 1, original: `![](${url})`, link: url, line: 0 }],
            complete: true,
            uncertainFiles: []
        });
        const deleteSpy = vi.spyOn(CloudImageDeleter.prototype, "deleteImage");

        await expect((handler as any).deleteCloudImage(url)).resolves.toBe(false);

        expect(deleteSpy).not.toHaveBeenCalled();
    });

    it("replaces Canvas references before deleting the uploaded local file", async () => {
        const file = fakeTFile({ path: "attachments/photo.png", name: "photo.png", extension: "png" });
        const canvas = fakeTFile({ path: "boards/media.canvas", name: "media.canvas", extension: "canvas" });
        const url = "https://cdn.example/photo.png";
        const contents = new Map([[canvas.path, JSON.stringify({
            nodes: [
                { id: "native", type: "file", file: file.path },
                { id: "text", type: "text", text: `![[${file.path}|300]]` }
            ]
        })]]);
        const app = fakeApp({ vault: fakeVault({ files: [file, canvas], fileContents: contents }) }) as any;
        const referenceManager = {
            scanReferencesDetailed: vi.fn(async () => ({
                locations: [], complete: true, uncertainFiles: []
            })),
            updateReferenceLocationsDetailed: vi.fn(async () => ({
                found: 0, replaced: 0, complete: true,
                files: [], failedFiles: [], uncertainFiles: []
            })),
            getFilesReferencingImage: vi.fn(async () => []),
            getFilesReferencingUrl: vi.fn(async () => [])
        };
        const plugin = {
            settings: {
                captions: { enabled: false },
                pasteHandling: { cloud: { uploader: "PicList" } }
            },
            vaultReferenceManager: referenceManager
        } as any;
        const handler = new SingleUploadHandler(app, plugin);

        await (handler as any).replaceAllLinksAndDelete(file, url);
        const updated = JSON.parse(contents.get(canvas.path) ?? "{}");

        expect(updated.nodes[0]).toMatchObject({ id: "native", type: "link", url });
        expect(updated.nodes[1].text).toBe(`![[${url}|300]]`);
        expect(app.vault.trash).toHaveBeenCalledWith(file, true);
    });
});
