import { beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "obsidian";

const obsidianMocks = vi.hoisted(() => ({
    Notice: vi.fn(),
    requestUrl: vi.fn()
}));

vi.mock("obsidian", async importOriginal => ({
    ...await importOriginal<typeof import("obsidian")>(),
    Notice: obsidianMocks.Notice,
    requestUrl: obsidianMocks.requestUrl
}));

import { CloudImageDeleter } from "../../../../src/cloud/CloudImageDeleter";
import { DEFAULT_SETTINGS } from "../../../../src/settings/defaults";
import { DeleteHandler } from "../../../../src/ui/contextMenu/handlers/DeleteHandler";
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
        getLine: vi.fn(() => value),
        lineCount: vi.fn(() => value.split("\n").length),
        replaceRange: vi.fn((replacement: string, start: any, end: any) => {
            value = value.slice(0, start.ch) + replacement + value.slice(end.ch);
        })
    };
}

function createFixture(options: {
    owned?: boolean;
    uploader?: string;
    deleteServer?: string;
    failRead?: boolean;
}) {
    const url = "https://cdn.example.com/photo.png";
    const link = `![Remote|center|320](${url})`;
    const note = fakeTFile({ path: "notes/current.md", extension: "md" });
    const locked = options.failRead
        ? fakeTFile({ path: "notes/locked.md", extension: "md" })
        : null;
    const files = locked ? [note, locked] : [note];
    const contents = new Map([[note.path, link]]);
    const vault = fakeVault({ files, fileContents: contents }) as any;
    if (locked) {
        const read = vault.read;
        vault.read = vi.fn(async (file: any) => {
            if (file.path === locked.path) throw new Error("locked");
            return read(file);
        });
    }
    const editor = createEditor(link);
    const save = vi.fn(async () => {
        contents.set(note.path, editor.getValue());
    });
    const view = {
        file: note,
        editor,
        save,
        contentEl: document.createElement("div")
    };
    const app = fakeApp({
        vault,
        metadataCache: fakeMetadataCache(),
        workspace: fakeWorkspace({ activeFile: note, activeView: view as any })
    }) as any;
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.pasteHandling.cloud.uploader = (options.uploader ?? "PicList") as any;
    settings.pasteHandling.cloud.deleteServer = options.deleteServer
        ?? "http://127.0.0.1:36677/delete";
    const historyRecord = options.owned ? { url, name: "photo.png" } : null;
    const plugin = {
        settings,
        historyManager: {
            isUrlUploaded: vi.fn(() => !!historyRecord),
            getRecord: vi.fn(() => historyRecord),
            removeRecord: vi.fn(async () => undefined)
        },
        imageStateManager: { refreshAllImages: vi.fn() },
        imageCaption: { refreshAllViews: vi.fn() }
    } as any;
    plugin.vaultReferenceManager = new VaultReferenceManager(app, plugin);
    const clickedReference = {
        view,
        file: note,
        editor,
        match: {
            line: 0,
            start: 0,
            end: link.length,
            linkText: link,
            descriptor: { path: url }
        }
    };
    const handler = new DeleteHandler(
        app,
        plugin,
        new CloudImageDeleter(plugin)
    );
    const image = document.createElement("img");
    image.src = url;
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
        url,
        dataReference: null
    } as any;
    return { app, plugin, handler, image, editor, contents, url, context };
}

function captureModals() {
    return vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
        this.onOpen();
    });
}

function getDecisionModal(open: ReturnType<typeof captureModals>): Modal {
    const modal = open.mock.instances.find(instance =>
        (instance as unknown as Modal).contentEl.querySelectorAll("button").length > 1
    ) as unknown as Modal | undefined;
    if (!modal) throw new Error("Expected the reference decision modal to open");
    return modal;
}

describe("DeleteHandler remote-source safety", () => {
    beforeEach(() => vi.clearAllMocks());

    it("only offers clicked removal when the remote object is not owned", async () => {
        const fixture = createFixture({ owned: false });
        const open = captureModals();

        await fixture.handler.deleteImageAndLink(fixture.context);
        const modal = getDecisionModal(open);
        const labels = [...modal.contentEl.querySelectorAll("button")]
            .map(button => button.textContent);

        expect(labels).toHaveLength(2);
        expect(labels.some(label => label?.includes("delete source"))).toBe(false);
        modal.contentEl.querySelectorAll<HTMLButtonElement>("button")[0].click();

        await vi.waitFor(() => expect(fixture.editor.getValue()).toBe(""));
        expect(obsidianMocks.requestUrl).not.toHaveBeenCalled();
        expect(fixture.plugin.historyManager.removeRecord).not.toHaveBeenCalled();
    });

    it("deletes an owned PicList object only after all references are removed and rescanned", async () => {
        const fixture = createFixture({ owned: true });
        obsidianMocks.requestUrl.mockResolvedValue({
            status: 200,
            json: { success: true }
        });
        const open = captureModals();

        await fixture.handler.deleteImageAndLink(fixture.context);
        const modal = getDecisionModal(open);
        const deleteSource = [...modal.contentEl.querySelectorAll<HTMLButtonElement>("button")]
            .find(button => button.textContent?.includes("delete source"));
        deleteSource?.click();

        await vi.waitFor(() => {
            expect(fixture.plugin.historyManager.removeRecord).toHaveBeenCalledWith(fixture.url);
        });
        expect(obsidianMocks.requestUrl).toHaveBeenCalledWith(expect.objectContaining({
            url: "http://127.0.0.1:36677/delete",
            method: "POST"
        }));
        expect(fixture.contents.get("notes/current.md")).toBe("");
    });

    it("hides remote deletion when the uploader or delete server is unsupported", async () => {
        for (const options of [
            { owned: true, uploader: "PicGo" },
            { owned: true, deleteServer: "" }
        ]) {
            const fixture = createFixture(options);
            const open = captureModals();
            await fixture.handler.deleteImageAndLink(fixture.context);
            const modal = getDecisionModal(open);
            expect([...modal.contentEl.querySelectorAll("button")]
                .some(button => button.textContent?.includes("delete source"))).toBe(false);
        }
    });

    it("keeps history and reports a readable API failure after references were removed", async () => {
        const fixture = createFixture({ owned: true });
        obsidianMocks.requestUrl.mockResolvedValue({
            status: 503,
            json: { success: false }
        });
        const open = captureModals();

        await fixture.handler.deleteImageAndLink(fixture.context);
        const modal = getDecisionModal(open);
        [...modal.contentEl.querySelectorAll<HTMLButtonElement>("button")]
            .find(button => button.textContent?.includes("delete source"))
            ?.click();

        await vi.waitFor(() => {
            expect(obsidianMocks.Notice).toHaveBeenCalledWith(
                expect.stringContaining("HTTP 503")
            );
        });
        expect(fixture.plugin.historyManager.removeRecord).not.toHaveBeenCalled();
    });

    it("does not expose vault-wide or destructive actions when any file is uncertain", async () => {
        const fixture = createFixture({ owned: true, failRead: true });
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const open = captureModals();

        await fixture.handler.deleteImageAndLink(fixture.context);
        const modal = getDecisionModal(open);

        expect(modal.contentEl.textContent).toContain("notes/locked.md");
        expect(modal.contentEl.querySelectorAll("button")).toHaveLength(2);
    });
});
