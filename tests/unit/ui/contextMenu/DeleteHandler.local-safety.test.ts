import { beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "obsidian";
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
            const before = lines.slice(0, start.line);
            const after = lines.slice(end.line + 1);
            const changed = lines[start.line].slice(0, start.ch)
                + replacement
                + lines[end.line].slice(end.ch);
            value = [...before, ...changed.split("\n"), ...after].join("\n");
        })
    };
}

function createFixture(options: {
    noteContent: string;
    sourceLink?: string;
    imagePath?: string;
    failReadPath?: string;
}) {
    const imagePath = options.imagePath ?? "attachments/photo.png";
    const sourceLink = options.sourceLink ?? options.noteContent.split("\n")[0];
    const image = fakeTFile({ path: imagePath, extension: "png" });
    const note = fakeTFile({ path: "notes/current.md", extension: "md" });
    const locked = options.failReadPath
        ? fakeTFile({ path: options.failReadPath, extension: "md" })
        : null;
    const files = locked ? [image, note, locked] : [image, note];
    const contents = new Map([[note.path, options.noteContent]]);
    const vault = fakeVault({ files, fileContents: contents }) as any;
    if (locked) {
        const read = vault.read;
        vault.read = vi.fn(async (file: any) => {
            if (file.path === locked.path) throw new Error("permission denied");
            return read(file);
        });
    }
    const editor = createEditor(options.noteContent);
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
    settings.global.codeBlockImageLinkIndexing = false;
    const plugin = {
        settings,
        historyManager: {
            isUrlUploaded: vi.fn(() => false),
            getRecord: vi.fn(),
            removeRecord: vi.fn()
        },
        imageStateManager: { refreshAllImages: vi.fn() },
        imageCaption: { refreshAllViews: vi.fn() }
    } as any;
    plugin.vaultReferenceManager = new VaultReferenceManager(app, plugin);
    const line = options.noteContent.split("\n").findIndex(item => item.includes(sourceLink));
    const start = editor.getLine(line).indexOf(sourceLink);
    const clickedReference = {
        view,
        file: note,
        editor,
        match: {
            line,
            start,
            end: start + sourceLink.length,
            linkText: sourceLink,
            descriptor: { path: imagePath }
        }
    };
    const handler = new DeleteHandler(
        app,
        plugin,
        new CloudImageDeleter(plugin)
    );
    const element = document.createElement("img");
    element.src = `app://vault/${imagePath}`;
    const context = {
        image: element,
        ownerDocument: document,
        ownerWindow: window,
        renderedSrc: element.src,
        sourceKind: "local",
        resolution: "resolved",
        owner: clickedReference,
        viewContext: clickedReference,
        descriptor: clickedReference.match.descriptor,
        localFile: image,
        url: null,
        dataReference: null
    } as any;
    return {
        app,
        plugin,
        handler,
        element,
        editor,
        save,
        contents,
        image,
        context
    };
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

describe("DeleteHandler vault-wide workflow", () => {
    beforeEach(() => vi.clearAllMocks());

    it("does not modify references before confirmation and defaults to the clicked occurrence", async () => {
        const first = "![[attachments/photo.png|First]]";
        const second = "![[attachments/photo.png|Second]]";
        const fixture = createFixture({ noteContent: `${first}\n${second}`, sourceLink: first });
        const open = captureModals();

        await fixture.handler.deleteImageAndLink(fixture.context);

        expect(fixture.editor.getValue()).toBe(`${first}\n${second}`);
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
        const modal = getDecisionModal(open);
        modal.contentEl.querySelectorAll<HTMLButtonElement>("button")[0].click();

        await vi.waitFor(() => expect(fixture.editor.getValue()).toBe(second));
        expect(fixture.contents.get("notes/current.md")).toBe(second);
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
        expect(fixture.save).toHaveBeenCalledTimes(2);
    });

    it("removes every vault reference and trashes the source only after explicit confirmation", async () => {
        const first = "![[attachments/photo.png|First]]";
        const second = "![[attachments/photo.png|Second]]";
        const fixture = createFixture({ noteContent: `${first}\n${second}`, sourceLink: first });
        const open = captureModals();

        await fixture.handler.deleteImageAndLink(fixture.context);
        const modal = getDecisionModal(open);
        const deleteSource = [...modal.contentEl.querySelectorAll<HTMLButtonElement>("button")]
            .find(button => button.textContent?.includes("delete source"));
        deleteSource?.click();

        await vi.waitFor(() => {
            expect(fixture.app.vault.trash).toHaveBeenCalledWith(fixture.image, true);
        });
        expect(fixture.contents.get("notes/current.md")).toBe("\n");
        expect(fixture.plugin.imageStateManager.refreshAllImages).toHaveBeenCalled();
    });

    it("limits an incomplete scan to clicked-only removal and always keeps the source", async () => {
        const source = "![[attachments/photo.png]]";
        const fixture = createFixture({
            noteContent: source,
            sourceLink: source,
            failReadPath: "notes/locked.md"
        });
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const open = captureModals();

        await fixture.handler.deleteImageAndLink(fixture.context);
        const modal = getDecisionModal(open);
        const labels = [...modal.contentEl.querySelectorAll("button")]
            .map(button => button.textContent);

        expect(labels).toHaveLength(2);
        expect(labels.some(label => label?.includes("delete source"))).toBe(false);
        modal.contentEl.querySelectorAll<HTMLButtonElement>("button")[0].click();

        await vi.waitFor(() => expect(fixture.editor.getValue()).toBe(""));
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("refreshes the inventory instead of deleting when references change while the modal is open", async () => {
        const source = "![[attachments/photo.png]]";
        const fixture = createFixture({ noteContent: source, sourceLink: source });
        const open = captureModals();

        await fixture.handler.deleteImageAndLink(fixture.context);
        fixture.editor.setValue(`${source}\n${source}`);
        await fixture.save();
        const modal = getDecisionModal(open);
        modal.contentEl.querySelectorAll<HTMLButtonElement>("button")[0].click();

        await vi.waitFor(() => {
            const decisionModals = open.mock.instances.filter(instance =>
                (instance as unknown as Modal).contentEl.querySelectorAll("button").length > 1
            );
            expect(decisionModals).toHaveLength(2);
        });
        expect(fixture.editor.getValue()).toBe(`${source}\n${source}`);
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("reports a partial reference removal and keeps the source object", async () => {
        const source = "![[attachments/photo.png]]";
        const fixture = createFixture({ noteContent: source, sourceLink: source });
        const open = captureModals();

        await fixture.handler.deleteImageAndLink(fixture.context);
        vi.spyOn((fixture.handler as any).coordinator, "remove").mockResolvedValue({
            complete: false,
            changed: 0,
            found: 1,
            staleInventory: null
        });
        const modal = getDecisionModal(open);
        modal.contentEl.querySelectorAll<HTMLButtonElement>("button")[0].click();

        await vi.waitFor(() => {
            expect(fixture.plugin.imageStateManager.refreshAllImages).toHaveBeenCalled();
        });
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
        expect(fixture.editor.getValue()).toBe(source);
    });

    it("resolves URI-encoded vault-root paths before offering source deletion", async () => {
        const source = "![Caption|center|300](/attachments/My%20Photo.png)";
        const fixture = createFixture({
            noteContent: source,
            sourceLink: source,
            imagePath: "attachments/My Photo.png"
        });
        const open = captureModals();

        await fixture.handler.deleteImageAndLink(fixture.context);
        const modal = getDecisionModal(open);
        const deleteSource = [...modal.contentEl.querySelectorAll<HTMLButtonElement>("button")]
            .find(button => button.textContent?.includes("delete source"));
        deleteSource?.click();

        await vi.waitFor(() => {
            expect(fixture.app.vault.trash).toHaveBeenCalledWith(fixture.image, true);
        });
    });

    it("keeps Base64 deletion as a single clicked-occurrence operation", async () => {
        const source = "![inline](data:image/png;base64,AAAA)";
        const fixture = createFixture({ noteContent: source, sourceLink: source });
        fixture.element.src = "data:image/png;base64,AAAA";
        fixture.context.sourceKind = "data";
        fixture.context.localFile = null;
        fixture.context.viewContext = null;
        fixture.context.dataReference = {
            owner: fixture.context.owner,
            match: {
                lineNumber: 0,
                line: source,
                fullMatch: source,
                index: 0
            }
        };
        const open = captureModals();

        await fixture.handler.deleteImageAndLink(fixture.context);

        expect(open).not.toHaveBeenCalled();
        expect(fixture.editor.getValue()).toBe("");
        expect(fixture.save).toHaveBeenCalledOnce();
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("does nothing when the clicked DOM image cannot be mapped to source", async () => {
        const fixture = createFixture({
            noteContent: "![[attachments/photo.png]]"
        });
        fixture.context.resolution = "unresolved";
        fixture.context.viewContext = null;
        fixture.context.localFile = null;
        const open = captureModals();

        await fixture.handler.deleteImageAndLink(fixture.context);

        expect(open).not.toHaveBeenCalled();
        expect(fixture.save).not.toHaveBeenCalled();
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("does nothing when a local source target is unresolved", async () => {
        const fixture = createFixture({
            noteContent: "![[attachments/photo.png]]"
        });
        fixture.context.resolution = "unresolved";
        fixture.context.localFile = null;
        const open = captureModals();

        await fixture.handler.deleteImageAndLink(fixture.context);

        expect(open).not.toHaveBeenCalled();
        expect(fixture.save).not.toHaveBeenCalled();
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("stops before scanning when the clicked note cannot be saved", async () => {
        const fixture = createFixture({
            noteContent: "![[attachments/photo.png]]"
        });
        fixture.save.mockRejectedValueOnce(new Error("disk full"));
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const open = captureModals();

        await fixture.handler.deleteImageAndLink(fixture.context);

        expect(open).toHaveBeenCalledOnce();
        expect(open.mock.instances.some(instance =>
            (instance as unknown as Modal).contentEl.querySelectorAll("button").length > 1
        )).toBe(false);
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("fails closed when a Base64 image has no owning Markdown view", async () => {
        const source = "![inline](data:image/png;base64,AAAA)";
        const fixture = createFixture({ noteContent: source, sourceLink: source });
        fixture.element.src = "data:image/png;base64,AAAA";
        fixture.context.sourceKind = "data";
        fixture.context.localFile = null;
        fixture.context.viewContext = null;
        fixture.context.dataReference = null;

        await fixture.handler.deleteImageAndLink(fixture.context);

        expect(fixture.editor.getValue()).toBe(source);
        expect(fixture.save).not.toHaveBeenCalled();
    });

    it("reports a missing Base64 source match without modifying the editor", async () => {
        const source = "![inline](data:image/png;base64,AAAA)";
        const fixture = createFixture({ noteContent: source, sourceLink: source });
        fixture.element.src = "data:image/png;base64,AAAA";
        fixture.context.sourceKind = "data";
        fixture.context.localFile = null;
        fixture.context.viewContext = null;
        fixture.context.dataReference = {
            owner: fixture.context.owner,
            match: {
                lineNumber: 0,
                line: source,
                fullMatch: source,
                index: 1
            }
        };

        await fixture.handler.deleteImageAndLink(fixture.context);

        expect(fixture.editor.getValue()).toBe(source);
        expect(fixture.save).not.toHaveBeenCalled();
    });
});
