import { Menu, TFile } from "obsidian";
import { appendDrawingOpenMenuItem } from "../../../src/drawing/DrawingContextMenu";

describe("DrawingContextMenu", () => {
    it.each(["Flow.drawio", "Flow.drawio.svg"])(
        "adds one editor action for a confirmed %s file",
        path => {
            const menu = new Menu();
            const file = makeFile(path);
            const open = vi.fn();

            expect(appendDrawingOpenMenuItem(menu, file, true, () => true, open)).toBe(true);
            expect(appendDrawingOpenMenuItem(menu, file, true, () => true, open)).toBe(false);
            const items = (menu as any).getItems();
            expect(items).toHaveLength(1);
            expect(items[0].title).toBe("Open in editor");
            expect(items[0].section).toBe("image-assistant");

            items[0].trigger();
            expect(open).toHaveBeenCalledWith(file);
        }
    );

    it("does not add the action for an ordinary SVG or while drawing is disabled", () => {
        const menu = new Menu();
        const open = vi.fn();

        expect(appendDrawingOpenMenuItem(menu, makeFile("Icon.svg"), true, () => false, open)).toBe(false);
        expect(appendDrawingOpenMenuItem(menu, makeFile("Flow.drawio.svg"), false, () => true, open)).toBe(false);
        expect((menu as any).getItems()).toHaveLength(0);
    });
});

function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path;
    const dot = path.lastIndexOf(".");
    file.basename = dot >= 0 ? path.slice(0, dot) : path;
    file.extension = dot >= 0 ? path.slice(dot + 1) : "";
    return file;
}
