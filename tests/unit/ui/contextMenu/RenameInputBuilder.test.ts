import { describe, expect, it, vi } from "vitest";
import { Modal } from "obsidian";
import { RenameInputBuilder } from "../../../../src/ui/contextMenu/inputs/RenameInputBuilder";
import { fakeTFile } from "../../../factories/obsidian";

function makeContext(kind: "local" | "url") {
    const image = document.createElement("img");
    const localFile = kind === "local"
        ? fakeTFile({
            path: "assets/photo.png",
            name: "photo.png",
            extension: "png"
        })
        : null;
    return {
        image,
        ownerDocument: document,
        ownerWindow: window,
        renderedSrc: kind === "url"
            ? "https://example.com/photo.png"
            : "app://local/assets/photo.png",
        sourceKind: kind,
        resolution: "resolved",
        owner: null,
        viewContext: {},
        descriptor: null,
        localFile,
        url: kind === "url" ? "https://example.com/photo.png" : null,
        dataReference: null
    } as any;
}

describe("RenameInputBuilder", () => {
    function makeBuilder() {
        const app = {
            vault: {}
        } as any;
        const plugin = {
            imageStateManager: {
                getImageState: vi.fn(() => ({
                    caption: "A caption",
                    width: 640,
                    height: null,
                    align: "center"
                }))
            }
        } as any;
        return new RenameInputBuilder(app, plugin);
    }

    it("builds the typed local properties model without private menu DOM", () => {
        const builder = makeBuilder();
        expect(builder.createModel(makeContext("local"))).toMatchObject({
            fileName: "photo",
            directory: "assets",
            caption: "A caption",
            width: 640,
            height: null,
            alignment: "center"
        });
        builder.unload();
    });

    it("uses the same modal form and hides local file controls for URL properties", () => {
        const builder = makeBuilder();
        const open = vi.spyOn(Modal.prototype, "open")
            .mockImplementation(function (this: Modal) {
                this.onOpen();
            });

        builder.openModal(makeContext("url"), vi.fn());
        const modal = open.mock.instances[0] as unknown as Modal;
        expect(modal.contentEl.querySelector(
            ".image-converter-contextmenu-name-input"
        )).toBeNull();
        expect(modal.contentEl.querySelector(
            ".image-converter-contextmenu-path-input"
        )).toBeNull();
        expect(modal.contentEl.querySelector(
            ".image-converter-contextmenu-caption-input"
        )).toBeTruthy();
    });

    it("uses the shared form in modal fallback and prevents duplicate submits", async () => {
        const builder = makeBuilder();
        let finish!: (result: any) => void;
        const apply = vi.fn(() => new Promise<any>(resolve => {
            finish = resolve;
        }));
        const open = vi.spyOn(Modal.prototype, "open")
            .mockImplementation(function (this: Modal) {
                this.onOpen();
            });
        const close = vi.spyOn(Modal.prototype, "close");

        builder.openModal(makeContext("local"), apply);
        const modal = open.mock.instances[0] as unknown as Modal;
        const confirm = modal.contentEl.querySelector<HTMLButtonElement>(
            ".image-converter-contextmenu-confirm"
        )!;
        confirm.click();
        confirm.click();

        expect(apply).toHaveBeenCalledOnce();
        expect(confirm.disabled).toBe(true);
        finish({
            complete: true,
            linkUpdated: true,
            fileMoved: false
        });
        await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    });
});
