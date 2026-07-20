import { beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "obsidian";

const obsidianMocks = vi.hoisted(() => ({ Notice: vi.fn() }));
vi.mock("obsidian", async importOriginal => ({
    ...await importOriginal<typeof import("obsidian")>(),
    Notice: obsidianMocks.Notice
}));

import { DEFAULT_SETTINGS } from "../../../../src/settings/defaults";
import { UploadDownloadHandler } from "../../../../src/ui/contextMenu/handlers/UploadDownloadHandler";
import { VaultReferenceManager } from "../../../../src/utils/VaultReferenceManager";
import {
    fakeApp,
    fakeMetadataCache,
    fakeTFile,
    fakeVault,
    fakeWorkspace
} from "../../../factories/obsidian";

function createEditor(initialValue: string) {
    let value = initialValue;
    return {
        getValue: () => value,
        setValue: (next: string) => {
            value = next;
        },
        getLine: vi.fn((line: number) => value.split("\n")[line] ?? ""),
        lineCount: vi.fn(() => value.split("\n").length),
        replaceRange: vi.fn((
            replacement: string,
            start: { line: number; ch: number },
            end: { line: number; ch: number }
        ) => {
            const lines = value.split("\n");
            lines[start.line] = lines[start.line].slice(0, start.ch)
                + replacement
                + lines[end.line].slice(end.ch);
            value = lines.join("\n");
        })
    };
}

function captureModals() {
    return vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
        this.onOpen();
    });
}

function createDownloadFixture(options: {
    firstSource: string;
    secondSource?: string;
    url: string;
}) {
    const first = fakeTFile({ path: "notes/first.md", extension: "md" });
    const second = options.secondSource
        ? fakeTFile({ path: "notes/second.md", extension: "md" })
        : null;
    const local = fakeTFile({ path: "attachments/My Photo.webp", extension: "webp" });
    const files = second ? [first, second, local] : [first, local];
    const contents = new Map([[first.path, options.firstSource]]);
    if (second && options.secondSource) contents.set(second.path, options.secondSource);
    const editor = createEditor(options.firstSource);
    const save = vi.fn(async () => {
        contents.set(first.path, editor.getValue());
    });
    const view = {
        file: first,
        editor,
        save,
        contentEl: document.createElement("div")
    };
    const app = fakeApp({
        vault: fakeVault({ files, fileContents: contents }),
        metadataCache: fakeMetadataCache(),
        workspace: fakeWorkspace({ activeFile: first, activeView: view as any })
    }) as any;
    const result = {
        success: true,
        url: options.url,
        vaultPath: local.path,
        localPath: local.path,
        disposition: "created" as const,
        undoToken: "undo-1"
    };
    const cloudImageHandler = {
        downloadSingleImageFile: vi.fn(async () => result),
        discardDownloadUndo: vi.fn(),
        uploadSingleFile: vi.fn()
    };
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.localProcessing.link = {
        linkFormat: "wikilink",
        pathFormat: "absolute",
        prependCurrentDir: false
    };
    const plugin = {
        settings,
        cloudImageHandler,
        historyManager: {
            isUrlUploaded: vi.fn(() => false),
            getRecord: vi.fn(),
            removeRecord: vi.fn()
        },
        imageStateManager: { refreshAllImages: vi.fn() },
        imageCaption: { refreshAllViews: vi.fn() }
    } as any;
    plugin.vaultReferenceManager = new VaultReferenceManager(app, plugin);
    const linkText = options.firstSource.match(/!\[\[[^\n]+?\]\]|!\[[^\]]*\]\([^\n]+\)/)?.[0]
        ?? options.firstSource;
    const start = options.firstSource.indexOf(linkText);
    const clickedReference = {
        view,
        file: first,
        editor,
        match: {
            line: 0,
            start,
            end: start + linkText.length,
            linkText,
            descriptor: { path: options.url }
        }
    };
    const handler = new UploadDownloadHandler(app, plugin);
    const image = document.createElement("img");
    image.src = options.url;
    const context = {
        image,
        ownerDocument: document,
        ownerWindow: window,
        renderedSrc: image.src,
        sourceKind: "url",
        resolution: "resolved",
        owner: clickedReference,
        viewContext: clickedReference,
        descriptor: clickedReference.match.descriptor,
        localFile: null,
        url: options.url,
        dataReference: null
    } as any;
    return {
        app,
        plugin,
        handler,
        image,
        editor,
        view,
        save,
        contents,
        first,
        second,
        local,
        result,
        context
    };
}

describe("UploadDownloadHandler", () => {
    beforeEach(() => vi.clearAllMocks());

    it("uploads the exact clicked vault target and forwards its source context", async () => {
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
        const context = {
            view,
            file: note,
            editor,
            match: { line: 0, start: 0, end: source.length, linkText: source }
        };
        const handler = new UploadDownloadHandler(
            app,
            { cloudImageHandler } as any
        );
        const image = document.createElement("img");
        image.src = "app://vault/attachments/My%20Photo.png";
        const menuContext = {
            image,
            ownerDocument: document,
            ownerWindow: window,
            renderedSrc: image.src,
            sourceKind: "local",
            resolution: "resolved",
            owner: context,
            viewContext: context,
            descriptor: null,
            localFile: local,
            url: null,
            dataReference: null
        } as any;

        await handler.uploadImageToCloud(menuContext);

        expect(cloudImageHandler.uploadSingleFile).toHaveBeenCalledWith(local, context);
    });

    it("shows a transport error and always releases its undo record", async () => {
        const note = fakeTFile({ path: "notes/current.md", extension: "md" });
        const source = "![remote](https://example.com/photo.png)";
        const editor = { getLine: vi.fn(() => source) };
        const view = { file: note, editor, contentEl: document.createElement("div") };
        const result = {
            success: false,
            url: "https://example.com/photo.png",
            error: "HTTP 503",
            undoToken: "partial"
        };
        const cloudImageHandler = {
            downloadSingleImageFile: vi.fn(async () => result),
            discardDownloadUndo: vi.fn()
        };
        const handler = new UploadDownloadHandler(
            fakeApp() as any,
            { cloudImageHandler } as any
        );
        const image = document.createElement("img");
        image.src = result.url;
        const clickedReference = {
            view,
            file: note,
            editor,
            match: { line: 0, start: 0, end: source.length, linkText: source }
        };
        const context = {
            image,
            ownerDocument: document,
            ownerWindow: window,
            renderedSrc: image.src,
            sourceKind: "url",
            resolution: "resolved",
            owner: clickedReference,
            viewContext: clickedReference,
            descriptor: null,
            localFile: null,
            url: result.url,
            dataReference: null
        } as any;

        await handler.downloadNetworkImage(context);

        expect(obsidianMocks.Notice).toHaveBeenCalledWith(
            expect.stringContaining("HTTP 503")
        );
        expect(cloudImageHandler.discardDownloadUndo).toHaveBeenCalledWith(result);
    });

    it("does not replace before confirmation, then replaces only the clicked Wiki reference", async () => {
        const url = "https://example.com/photo";
        const link = `![[${url}|Caption|right|320]]`;
        const source = `prefix ${link} suffix`;
        const fixture = createDownloadFixture({ firstSource: source, url });
        const open = captureModals();

        await fixture.handler.downloadNetworkImage(fixture.context);

        expect(fixture.editor.getValue()).toBe(source);
        expect(fixture.editor.replaceRange).not.toHaveBeenCalled();
        expect(fixture.plugin.cloudImageHandler.discardDownloadUndo)
            .toHaveBeenCalledWith(fixture.result);
        const modal = open.mock.instances[0] as unknown as Modal;
        modal.contentEl.querySelectorAll<HTMLButtonElement>("button")[0].click();

        await vi.waitFor(() => {
            expect(fixture.editor.getValue()).toBe(
                "prefix ![[/attachments/My Photo.webp|Caption|right|320]] suffix"
            );
        });
        expect(fixture.view.save).toHaveBeenCalledTimes(2);
    });

    it("keeps a pending URL download without attempting source replacement", async () => {
        const url = "https://example.com/dynamic?id=42";
        const source = `![](${url})`;
        const fixture = createDownloadFixture({ firstSource: source, url });
        const open = captureModals();
        const pendingContext = {
            ...fixture.context,
            resolution: "pending",
            viewContext: null
        };

        await fixture.handler.downloadNetworkImage(pendingContext);

        expect(fixture.plugin.cloudImageHandler.downloadSingleImageFile)
            .toHaveBeenCalledWith(url, fixture.first);
        expect(fixture.editor.getValue()).toBe(source);
        expect(fixture.editor.replaceRange).not.toHaveBeenCalled();
        expect(fixture.view.save).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
        expect(obsidianMocks.Notice).toHaveBeenCalledWith(
            expect.stringContaining("transfer result was kept")
        );
        expect(fixture.plugin.cloudImageHandler.discardDownloadUndo)
            .toHaveBeenCalledWith(fixture.result);
    });

    it("can replace the same URL across all Markdown files after one decision", async () => {
        const url = "https://example.com/photo.png";
        const firstLink = `![First|center|300](${url})`;
        const secondLink = `![[${url}|Second|left|200]]`;
        const fixture = createDownloadFixture({
            firstSource: firstLink,
            secondSource: secondLink,
            url
        });
        const open = captureModals();

        await fixture.handler.downloadNetworkImage(fixture.context);
        const modal = open.mock.instances[0] as unknown as Modal;
        const replaceAll = [...modal.contentEl.querySelectorAll<HTMLButtonElement>("button")]
            .find(button => button.textContent?.includes("eligible vault"));
        replaceAll?.click();

        await vi.waitFor(() => {
            expect(fixture.contents.get(fixture.first.path)).toBe(
                "![[/attachments/My Photo.webp|First|center|300]]"
            );
            expect(fixture.contents.get(fixture.second!.path)).toBe(
                "![[/attachments/My Photo.webp|Second|left|200]]"
            );
        });
    });

    it("keeps the downloaded file and performs zero replacement when cancelled", async () => {
        const url = "https://example.com/photo.png";
        const source = `![](${url})`;
        const fixture = createDownloadFixture({ firstSource: source, url });
        const open = captureModals();

        await fixture.handler.downloadNetworkImage(fixture.context);
        const modal = open.mock.instances[0] as unknown as Modal;
        [...modal.contentEl.querySelectorAll<HTMLButtonElement>("button")]
            .find(button => button.textContent?.includes("Keep transfer"))
            ?.click();

        await vi.waitFor(() => {
            expect(obsidianMocks.Notice).toHaveBeenCalledWith(
                expect.stringContaining("transfer result was kept")
            );
        });
        expect(fixture.editor.getValue()).toBe(source);
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("drops clicked scope when the source range changes during download", async () => {
        const url = "https://example.com/photo.png";
        const source = `![](${url})`;
        const fixture = createDownloadFixture({ firstSource: source, url });
        let finishDownload!: (value: typeof fixture.result) => void;
        fixture.plugin.cloudImageHandler.downloadSingleImageFile.mockImplementation(
            () => new Promise(resolve => {
                finishDownload = resolve;
            })
        );
        const open = captureModals();

        const pending = fixture.handler.downloadNetworkImage(fixture.context);
        fixture.editor.setValue("![](https://example.com/changed.png)");
        finishDownload(fixture.result);
        await pending;

        const modal = open.mock.instances[0] as unknown as Modal;
        expect([...modal.contentEl.querySelectorAll("button")]
            .some(button => button.textContent?.includes("clicked reference"))).toBe(false);
        expect(fixture.editor.replaceRange).not.toHaveBeenCalled();
    });
});
