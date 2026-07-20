import { beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "obsidian";
import { SingleUploadHandler } from "../../../../src/cloud/handlers/SingleUploadHandler";
import { UploaderManager } from "../../../../src/cloud/uploader";
import { DEFAULT_SETTINGS } from "../../../../src/settings/defaults";
import { VaultReferenceManager } from "../../../../src/utils/VaultReferenceManager";
import {
    fakeApp,
    fakeMetadataCache,
    fakeTFile,
    fakeVault
} from "../../../factories/obsidian";

const CLOUD_URL = "https://cdn.example/photo.png";

function createFixture(options: {
    noteContent?: string;
    canvasContent?: string;
    failReadPath?: string;
}) {
    const image = fakeTFile({ path: "attachments/photo.png", extension: "png" });
    const note = options.noteContent !== undefined
        ? fakeTFile({ path: "notes/current.md", extension: "md" })
        : null;
    const canvas = options.canvasContent !== undefined
        ? fakeTFile({ path: "boards/media.canvas", extension: "canvas" })
        : null;
    const locked = options.failReadPath
        ? fakeTFile({ path: options.failReadPath, extension: "md" })
        : null;
    const files = [image, note, canvas, locked].filter(Boolean) as any[];
    const contents = new Map<string, string>();
    if (note) contents.set(note.path, options.noteContent!);
    if (canvas) contents.set(canvas.path, options.canvasContent!);
    const vault = fakeVault({ files, fileContents: contents }) as any;
    if (locked) {
        const read = vault.read;
        vault.read = vi.fn(async (file: any) => {
            if (file.path === locked.path) throw new Error("locked");
            return read(file);
        });
    }
    const app = fakeApp({
        vault,
        metadataCache: fakeMetadataCache()
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
    const handler = new SingleUploadHandler(app, plugin);
    return { app, plugin, handler, image, note, canvas, contents };
}

function captureModals() {
    return vi.spyOn(Modal.prototype, "open").mockImplementation(function (this: Modal) {
        this.onOpen();
    });
}

describe("SingleUploadHandler reference workflow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(UploaderManager.prototype, "upload").mockResolvedValue({
            success: true,
            result: [CLOUD_URL],
            msg: ""
        } as any);
    });

    it("performs zero reference mutation before confirmation, then replaces all eligible links", async () => {
        const source = "![[attachments/photo.png|Caption|center|300]]";
        const fixture = createFixture({ noteContent: source });
        const open = captureModals();

        await fixture.handler.uploadSingleFile(fixture.image);

        expect(fixture.contents.get(fixture.note!.path)).toBe(source);
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
        const modal = open.mock.instances[0] as unknown as Modal;
        [...modal.contentEl.querySelectorAll<HTMLButtonElement>("button")]
            .find(button => button.textContent?.includes("eligible vault"))
            ?.click();

        await vi.waitFor(() => {
            expect(fixture.contents.get(fixture.note!.path)).toBe(
                `![[${CLOUD_URL}|Caption|center|300]]`
            );
        });
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("replaces Markdown and Canvas references before deleting the local source", async () => {
        const source = "![[attachments/photo.png|Caption]]";
        const canvasContent = JSON.stringify({
            nodes: [
                { id: "native", type: "file", file: "attachments/photo.png" },
                {
                    id: "text",
                    type: "text",
                    text: "![[attachments/photo.png|Canvas|200]]"
                }
            ]
        });
        const fixture = createFixture({ noteContent: source, canvasContent });
        const open = captureModals();

        await fixture.handler.uploadSingleFile(fixture.image);
        const modal = open.mock.instances[0] as unknown as Modal;
        [...modal.contentEl.querySelectorAll<HTMLButtonElement>("button")]
            .find(button => button.textContent?.includes("delete source"))
            ?.click();

        await vi.waitFor(() => {
            expect(fixture.app.vault.trash).toHaveBeenCalledWith(fixture.image, true);
        });
        expect(fixture.contents.get(fixture.note!.path)).toBe(
            `![[${CLOUD_URL}|Caption]]`
        );
        const updatedCanvas = JSON.parse(fixture.contents.get(fixture.canvas!.path) ?? "{}");
        expect(updatedCanvas.nodes[0]).toMatchObject({
            id: "native",
            type: "link",
            url: CLOUD_URL
        });
        expect(updatedCanvas.nodes[1].text).toBe(
            `![[${CLOUD_URL}|Canvas|200]]`
        );
    });

    it("offers source-only deletion for an unreferenced upload and rescans before trashing", async () => {
        const fixture = createFixture({});
        const open = captureModals();

        await fixture.handler.uploadSingleFile(fixture.image);
        const modal = open.mock.instances[0] as unknown as Modal;
        [...modal.contentEl.querySelectorAll<HTMLButtonElement>("button")]
            .find(button => button.textContent?.includes("unreferenced source"))
            ?.click();

        await vi.waitFor(() => {
            expect(fixture.app.vault.trash).toHaveBeenCalledWith(fixture.image, true);
        });
    });

    it("keeps both transfer results when the user cancels", async () => {
        const source = "![[attachments/photo.png]]";
        const fixture = createFixture({ noteContent: source });
        const open = captureModals();

        await fixture.handler.uploadSingleFile(fixture.image);
        const modal = open.mock.instances[0] as unknown as Modal;
        [...modal.contentEl.querySelectorAll<HTMLButtonElement>("button")]
            .find(button => button.textContent?.includes("Keep transfer"))
            ?.click();

        await vi.waitFor(() => {
            expect(fixture.plugin.imageStateManager.refreshAllImages).not.toHaveBeenCalled();
        });
        expect(fixture.contents.get(fixture.note!.path)).toBe(source);
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("refreshes the decision inventory when references change before execution", async () => {
        const source = "![[attachments/photo.png]]";
        const fixture = createFixture({ noteContent: source });
        const open = captureModals();

        await fixture.handler.uploadSingleFile(fixture.image);
        fixture.contents.set(fixture.note!.path, `${source}\n${source}`);
        const firstModal = open.mock.instances[0] as unknown as Modal;
        [...firstModal.contentEl.querySelectorAll<HTMLButtonElement>("button")]
            .find(button => button.textContent?.includes("eligible vault"))
            ?.click();

        await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(2));
        expect(fixture.contents.get(fixture.note!.path)).toBe(`${source}\n${source}`);
        expect(fixture.app.vault.trash).not.toHaveBeenCalled();
    });

    it("allows only keeping the transfer when a no-context scan is incomplete", async () => {
        const fixture = createFixture({ failReadPath: "notes/locked.md" });
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const open = captureModals();

        await fixture.handler.uploadSingleFile(fixture.image);
        const modal = open.mock.instances[0] as unknown as Modal;

        expect(modal.contentEl.textContent).toContain("notes/locked.md");
        expect(modal.contentEl.querySelectorAll("button")).toHaveLength(2);
        expect([...modal.contentEl.querySelectorAll("button")]
            .some(button => button.textContent?.includes("delete source"))).toBe(false);
    });
});
