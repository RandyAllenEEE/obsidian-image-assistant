import { beforeEach, describe, expect, it, vi } from "vitest";

const loadImageMock = vi.hoisted(
    () => vi.fn<() => Promise<void>>(async () => undefined)
);
vi.mock("../../../../src/utils/ImageLoadUtils", () => ({
    loadImage: loadImageMock
}));

import { ClipboardHandler } from "../../../../src/ui/contextMenu/handlers/ClipboardHandler";

describe("ClipboardHandler", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        loadImageMock.mockResolvedValue(undefined);
    });

    function makeFixture() {
        const image = document.createElement("img");
        image.src = "https://proxy.local/cached";
        const context = {
            image,
            ownerDocument: document,
            ownerWindow: window,
            renderedSrc: image.src,
            sourceKind: "url",
            resolution: "resolved",
            owner: null,
            viewContext: null,
            descriptor: null,
            localFile: null,
            url: "https://example.com/pic.png",
            dataReference: null
        } as any;
        return {
            context,
            handler: new ClipboardHandler()
        };
    }

    it("waits for image loading and reports a load failure when copying", async () => {
        let rejectLoad!: (error: Error) => void;
        loadImageMock.mockReturnValueOnce(
            new Promise<void>((_, reject) => {
                rejectLoad = reject;
            })
        );
        const fixture = makeFixture();
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        let settled = false;

        const copying = fixture.handler.copyImage(fixture.context)
            .then(() => {
                settled = true;
            });
        await Promise.resolve();
        expect(settled).toBe(false);

        rejectLoad(new Error("offline"));
        await copying;

        expect(loadImageMock).toHaveBeenCalledWith(
            expect.any(HTMLImageElement),
            fixture.context.image.src
        );
        expect(errorSpy).toHaveBeenCalledWith(
            "Failed to copy image:",
            expect.any(Error)
        );
    });
});
