import { beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "obsidian";
import { CloudImageDeleter } from "../../../../src/cloud/CloudImageDeleter";
import { DeleteHandler } from "../../../../src/ui/contextMenu/handlers/DeleteHandler";
import { fakeApp, fakeTFile, fakeVault, fakeWorkspace } from "../../../factories/obsidian";

describe("DeleteHandler local deletion safety", () => {
    beforeEach(() => vi.clearAllMocks());

    function makeFixture(options: {
        locations: any[];
        complete?: boolean;
        uncertainFiles?: string[];
        matches?: any[];
        imagePath?: string;
        sourceLink?: string;
    }) {
        const imagePath = options.imagePath ?? "attachments/photo.png";
        const sourceLink = options.sourceLink ?? "![[attachments/photo.png|Clicked|320]]";
        const imageFile = fakeTFile({ path: imagePath, extension: "png" });
        const noteFile = fakeTFile({ path: "notes/current.md", extension: "md" });
        const matches = options.matches ?? [{
            lineNumber: 0,
            line: sourceLink,
            fullMatch: sourceLink,
            index: 0
        }];
        const editor = {
            getLine: vi.fn((line: number) => matches.find(match => match.lineNumber === line)?.line ?? "")
        };
        const save = vi.fn(async () => undefined);
        const view = { file: noteFile, editor, save, contentEl: document.createElement("div") };
        const vault = fakeVault({ files: [imageFile, noteFile] });
        const app = fakeApp({
            vault,
            workspace: fakeWorkspace({ activeFile: noteFile, activeView: view })
        }) as any;
        const scanReferencesDetailed = vi.fn(async () => ({
            locations: options.locations,
            complete: options.complete ?? true,
            uncertainFiles: options.uncertainFiles ?? []
        }));
        const plugin = {
            settings: {
                global: { codeBlockImageLinkIndexing: true },
                pasteHandling: { cloud: { uploader: "PicList" } }
            },
            historyManager: { isUrlUploaded: vi.fn(() => false) },
            vaultReferenceManager: {
                scanReferencesDetailed,
                getFilesReferencingImage: vi.fn(async () => [])
            }
        } as any;
        const linkRemover = { removeImageLink: vi.fn(async () => undefined) };
        const imageMatchFinder = {
            findImageMatches: vi.fn(async () => matches),
            processBase64Image: vi.fn(async (_editor: unknown, _src: string, callback: (...args: any[]) => Promise<void>) => {
                await callback(editor, matches[0].lineNumber, matches[0].line, matches[0].fullMatch);
                return true;
            })
        };
        const handler = new DeleteHandler(
            app,
            plugin,
            { getImagePath: vi.fn(() => imageFile.path) } as any,
            imageMatchFinder as any,
            linkRemover as any,
            new CloudImageDeleter(plugin),
            {
                resolve: vi.fn(() => ({
                    view,
                    file: noteFile,
                    editor,
                    match: {
                        line: matches[0].lineNumber,
                        start: matches[0].index,
                        end: matches[0].index + matches[0].fullMatch.length,
                        linkText: matches[0].fullMatch
                    }
                })),
                resolveOwner: vi.fn(() => ({ view, file: noteFile, editor }))
            } as any
        );
        const image = document.createElement("img");
        image.setAttribute("src", "app://vault/attachments/photo.png");
        return { app, handler, image, imageFile, imageMatchFinder, linkRemover, save, scanReferencesDetailed };
    }

    function openDialogs() {
        return vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
            (this as any).onOpen();
        });
    }

    it("only removes the clicked link when another Markdown reference remains", async () => {
        const note = fakeTFile({ path: "notes/current.md", extension: "md" });
        const other = fakeTFile({ path: "notes/other.md", extension: "md" });
        const fixture = makeFixture({ locations: [
            { file: note, start: 0, end: 1, original: "![[attachments/photo.png]]", link: "attachments/photo.png", line: 0 },
            { file: other, start: 0, end: 1, original: "![[attachments/photo.png]]", link: "attachments/photo.png", line: 0 }
        ] });
        const open = openDialogs();

        await fixture.handler.deleteImageAndLink({ target: fixture.image } as unknown as MouseEvent, fixture.image);
        const dialog = open.mock.instances[0] as unknown as Modal;
        dialog.contentEl.querySelectorAll<HTMLButtonElement>("button")[1].click();

        await vi.waitFor(() => expect(fixture.linkRemover.removeImageLink).toHaveBeenCalledOnce());
        expect(fixture.save).toHaveBeenCalledOnce();
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("forces source preservation when the reference scan is incomplete", async () => {
        const fixture = makeFixture({
            locations: [],
            complete: false,
            uncertainFiles: ["notes/locked.md"]
        });
        const open = openDialogs();

        await fixture.handler.deleteImageAndLink({ target: fixture.image } as unknown as MouseEvent, fixture.image);
        const dialog = open.mock.instances[0] as unknown as Modal;
        expect(dialog.contentEl.textContent).toContain("notes/locked.md");
        dialog.contentEl.querySelectorAll<HTMLButtonElement>("button")[1].click();

        await vi.waitFor(() => expect(fixture.save).toHaveBeenCalledOnce());
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("deletes the source only after an explicit all-links confirmation and a clean rescan", async () => {
        const note = fakeTFile({ path: "notes/current.md", extension: "md" });
        const matches = [
            { lineNumber: 0, line: "![[attachments/photo.png|A]]", fullMatch: "![[attachments/photo.png|A]]", index: 0 },
            { lineNumber: 1, line: "![[attachments/photo.png|B]]", fullMatch: "![[attachments/photo.png|B]]", index: 0 }
        ];
        const fixture = makeFixture({
            matches,
            locations: [
                { file: note, start: 0, end: 1, original: matches[0].fullMatch, link: "attachments/photo.png", line: 0 },
                { file: note, start: 2, end: 3, original: matches[1].fullMatch, link: "attachments/photo.png", line: 1 }
            ]
        });
        const initialLocations = [
            { file: note, start: 0, end: 1, original: matches[0].fullMatch, link: "attachments/photo.png", line: 0 },
            { file: note, start: 2, end: 3, original: matches[1].fullMatch, link: "attachments/photo.png", line: 1 }
        ];
        fixture.scanReferencesDetailed.mockReset()
            .mockResolvedValueOnce({ locations: initialLocations, complete: true, uncertainFiles: [] })
            .mockResolvedValue({ locations: [], complete: true, uncertainFiles: [] });
        const open = openDialogs();

        await fixture.handler.deleteAllMatchingImageLinks(
            { target: fixture.image } as unknown as MouseEvent,
            fixture.image
        );
        const dialog = open.mock.instances[0] as unknown as Modal;
        dialog.contentEl.querySelectorAll<HTMLButtonElement>("button")[1].click();

        await vi.waitFor(() => expect(fixture.app.vault.trash).toHaveBeenCalledWith(fixture.imageFile, true));
        expect(fixture.linkRemover.removeImageLink).toHaveBeenCalledTimes(2);
        expect(fixture.save).toHaveBeenCalledOnce();
        expect(fixture.scanReferencesDetailed).toHaveBeenCalledTimes(2);
    });

    it("deletes the last URI-encoded vault-root reference without metadata cache support", async () => {
        const sourceLink = "![Caption|center|300](/attachments/My%20Photo.png)";
        const imagePath = "attachments/My Photo.png";
        const note = fakeTFile({ path: "notes/current.md", extension: "md" });
        const initialLocation = {
            file: note,
            start: 0,
            end: sourceLink.length,
            original: sourceLink,
            link: "/attachments/My%20Photo.png",
            line: 0
        };
        const fixture = makeFixture({
            imagePath,
            sourceLink,
            locations: [initialLocation]
        });
        fixture.scanReferencesDetailed.mockReset()
            .mockResolvedValueOnce({ locations: [initialLocation], complete: true, uncertainFiles: [] })
            .mockResolvedValue({ locations: [], complete: true, uncertainFiles: [] });

        await fixture.handler.deleteImageAndLink(
            { target: fixture.image } as unknown as MouseEvent,
            fixture.image
        );

        expect(fixture.linkRemover.removeImageLink).toHaveBeenCalledOnce();
        expect(fixture.save).toHaveBeenCalledOnce();
        expect(fixture.app.vault.trash).toHaveBeenCalledWith(fixture.imageFile, true);
        expect(fixture.scanReferencesDetailed).toHaveBeenCalledTimes(2);
    });

    it("fails closed when the clicked image cannot be mapped to a source link", async () => {
        const fixture = makeFixture({ locations: [] });
        (fixture.handler as any).viewContextResolver.resolve = vi.fn(() => null);

        await fixture.handler.deleteImageAndLink(
            { target: fixture.image } as unknown as MouseEvent,
            fixture.image
        );

        expect(fixture.linkRemover.removeImageLink).not.toHaveBeenCalled();
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("removes one Base64 link but rejects implicit bulk Base64 deletion", async () => {
        const fixture = makeFixture({ locations: [] });
        fixture.image.setAttribute("src", "data:image/png;base64,AAAA");

        await fixture.handler.deleteImageAndLink(
            { target: fixture.image } as unknown as MouseEvent,
            fixture.image
        );
        expect(fixture.imageMatchFinder.processBase64Image).toHaveBeenCalledOnce();
        expect(fixture.linkRemover.removeImageLink).toHaveBeenCalledOnce();
        expect(fixture.save).toHaveBeenCalledOnce();

        fixture.linkRemover.removeImageLink.mockClear();
        await fixture.handler.deleteAllMatchingImageLinks(
            { target: fixture.image } as unknown as MouseEvent,
            fixture.image
        );
        expect(fixture.linkRemover.removeImageLink).not.toHaveBeenCalled();
    });
});
