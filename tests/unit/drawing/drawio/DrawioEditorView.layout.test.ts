import { clampDrawingChatSize } from "../../../../src/drawing/drawio/DrawioEditorView";

describe("drawing chat pane sizing", () => {
    it("keeps desktop and narrow sizes within a usable view-local range", () => {
        expect(clampDrawingChatSize(20, 1200, false)).toBe(260);
        expect(clampDrawingChatSize(900, 1200, false)).toBe(620);
        expect(clampDrawingChatSize(20, 700, true)).toBe(180);
        expect(clampDrawingChatSize(600, 700, true)).toBe(520);
        expect(clampDrawingChatSize(400, 500, true)).toBe(320);
    });
});
