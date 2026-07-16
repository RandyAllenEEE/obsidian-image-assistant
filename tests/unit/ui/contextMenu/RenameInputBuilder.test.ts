import { afterEach, describe, expect, it, vi } from "vitest";
import { Platform } from "obsidian";
import { RenameInputBuilder } from "../../../../src/ui/contextMenu/inputs/RenameInputBuilder";
import { fakeTFile } from "../../../factories/obsidian";

function makeMenu() {
    const dom = document.createElement("div");
    return {
        dom,
        addItem(callback: (item: any) => void) {
            callback({ dom, setTitle: vi.fn() });
            return this;
        }
    } as any;
}

afterEach(() => {
    Platform.isMobile = false;
});

describe("RenameInputBuilder", () => {
    it("builds populated local image controls and tracks alignment selection", () => {
        const imageFile = fakeTFile({ path: "assets/photo.png", name: "photo.png", extension: "png" });
        const app = {
            vault: {
                getConfig: vi.fn(() => false),
                getAbstractFileByPath: vi.fn(() => imageFile)
            }
        } as any;
        const plugin = {
            imageStateManager: {
                getImageState: vi.fn(() => ({
                    caption: "A caption",
                    width: 640,
                    height: 480,
                    align: "center"
                }))
            }
        } as any;
        const folderManagement = { getImagePath: vi.fn(() => "assets/photo.png") } as any;
        const builder = new RenameInputBuilder(app, plugin, folderManagement);
        const image = document.createElement("img");
        const menu = makeMenu();

        const inputs = builder.buildInputs(menu, image, fakeTFile({ path: "notes/note.md" }), false);

        expect(inputs).not.toBeNull();
        expect(inputs?.nameInput.value).toBe("photo");
        expect(inputs?.pathInput.value.replace(/\\/g, "/")).toBe("assets");
        expect(inputs?.captionInput.value).toBe("A caption");
        expect(inputs?.widthInput.value).toBe("640");
        expect(inputs?.heightInput.value).toBe("480");
        expect(inputs?.getAlignment()).toBe("center");
        expect(menu.dom.querySelectorAll(".image-converter-alignment-button")).toHaveLength(5);

        const left = menu.dom.querySelector(".image-converter-alignment-button") as HTMLElement;
        left.click();
        expect(inputs?.getAlignment()).toBe("left");
        left.click();
        expect(inputs?.getAlignment()).toBe("none");

        const event = new MouseEvent("click", { bubbles: true });
        const stop = vi.spyOn(event, "stopPropagation");
        inputs?.captionInput.dispatchEvent(event);
        expect(stop).toHaveBeenCalled();
        builder.onunload();
    });

    it("keeps caption and size controls for network images while hiding file controls", () => {
        const builder = new RenameInputBuilder(
            { vault: { getConfig: () => false, getAbstractFileByPath: () => null } } as any,
            { imageStateManager: { getImageState: () => undefined } } as any,
            { getImagePath: () => null } as any
        );
        const menu = makeMenu();
        const result = builder.buildInputs(menu, document.createElement("img"), fakeTFile(), true);

        expect(result?.isImageResolvable).toBe(false);
        expect(result?.nameInput.disabled).toBe(true);
        expect(menu.dom.querySelector(".image-converter-contextmenu-name-input")).toBeNull();
        expect(menu.dom.querySelector(".image-converter-contextmenu-caption-input")).toBeTruthy();
    });

    it("skips custom inputs for native menus and mobile", () => {
        const image = document.createElement("img");
        const activeFile = fakeTFile();
        const nativeBuilder = new RenameInputBuilder(
            { vault: { getConfig: () => true } } as any,
            {} as any,
            {} as any
        );
        expect(nativeBuilder.buildInputs(makeMenu(), image, activeFile)).toBeNull();

        Platform.isMobile = true;
        const mobileBuilder = new RenameInputBuilder(
            { vault: { getConfig: () => false } } as any,
            {} as any,
            {} as any
        );
        expect(mobileBuilder.buildInputs(makeMenu(), image, activeFile)).toBeNull();
    });
});
