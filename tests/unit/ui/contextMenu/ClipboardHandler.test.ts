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

    function makeFixture(source = "![img](https://example.com/pic.png)") {
        let value = source;
        const editor = {
            getValue: vi.fn(() => value),
            lineCount: vi.fn(() => value.split("\n").length),
            getLine: vi.fn((line: number) => value.split("\n")[line] ?? ""),
            replaceRange: vi.fn((
                replacement: string,
                from: { line: number; ch: number },
                to: { line: number; ch: number }
            ) => {
                const currentLine = value.split("\n")[from.line] ?? "";
                value = currentLine.slice(0, from.ch)
                    + replacement
                    + currentLine.slice(to.ch);
            })
        };
        const view = {
            editor,
            file: { path: "notes/current.md" },
            save: vi.fn().mockResolvedValue(undefined)
        };
        const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
        const image = document.createElement("img");
        image.src = "https://proxy.local/cached";
        const viewContext = {
            view,
            file: view.file,
            editor,
            match: {
                line: 0,
                start: 0,
                end: source.length,
                linkText: source
            }
        };
        const context = {
            image,
            ownerDocument: document,
            ownerWindow: { navigator: { clipboard } },
            renderedSrc: image.src,
            sourceKind: "url",
            resolution: "resolved",
            owner: viewContext,
            viewContext,
            descriptor: null,
            localFile: null,
            url: "https://example.com/pic.png",
            dataReference: null
        } as any;
        return {
            context,
            clipboard,
            editor,
            getValue: () => value,
            handler: new ClipboardHandler(),
            setValue: (next: string) => { value = next; },
            view
        };
    }

    it("cuts only the exact source occurrence supplied by the shared context", async () => {
        const fixture = makeFixture();
        await fixture.handler.cutImageAndLink(fixture.context);

        expect(fixture.clipboard.writeText)
            .toHaveBeenCalledWith(fixture.context.viewContext.match.linkText);
        expect(fixture.getValue()).toBe("");
        expect(fixture.view.save).toHaveBeenCalledOnce();
    });

    it("fails closed when the source range changed before the click executes", async () => {
        const fixture = makeFixture();
        fixture.setValue("![other](https://example.com/other.png)");

        await fixture.handler.cutImageAndLink(fixture.context);

        expect(fixture.clipboard.writeText).not.toHaveBeenCalled();
        expect(fixture.view.save).not.toHaveBeenCalled();
    });

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
