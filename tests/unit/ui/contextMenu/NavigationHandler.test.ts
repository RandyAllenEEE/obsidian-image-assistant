import { describe, expect, it, vi } from "vitest";
import { NavigationHandler } from "../../../../src/ui/contextMenu/handlers/NavigationHandler";
import { fakeApp, fakeTFile } from "../../../factories/obsidian";

function context(file: ReturnType<typeof fakeTFile>) {
    return {
        image: document.createElement("img"),
        ownerDocument: document,
        ownerWindow: window,
        renderedSrc: "app://local/assets/photo.png",
        sourceKind: "local",
        resolution: "resolved",
        owner: null,
        viewContext: null,
        descriptor: null,
        localFile: file,
        url: null,
        dataReference: null
    } as any;
}

describe("NavigationHandler", () => {
    it("reveals the exact file supplied by a non-active image context", async () => {
        const file = fakeTFile({
            path: "other-pane/assets/photo.png",
            extension: "png"
        });
        const revealInFolder = vi.fn().mockResolvedValue(undefined);
        const leaf = { view: { revealInFolder } };
        const app = fakeApp() as any;
        app.showInFolder = vi.fn().mockResolvedValue(undefined);
        app.workspace.getLeavesOfType = vi.fn(() => [leaf]);
        app.workspace.leftSplit = { expand: vi.fn() };
        const handler = new NavigationHandler(app);

        await handler.showImageInNavigation(context(file));
        await handler.showImageInSystemExplorer(context(file));

        expect(revealInFolder).toHaveBeenCalledWith(file);
        expect(app.showInFolder).toHaveBeenCalledWith(file.path);
    });

    it("does not fall back to the active note when no local file is resolved", async () => {
        const app = fakeApp() as any;
        app.showInFolder = vi.fn().mockResolvedValue(undefined);
        const handler = new NavigationHandler(app);
        const unresolved = {
            ...context(fakeTFile()),
            resolution: "unresolved",
            localFile: null
        };

        await handler.showImageInNavigation(unresolved);
        await handler.showImageInSystemExplorer(unresolved);

        expect(app.workspace.getLeavesOfType).not.toHaveBeenCalled();
        expect(app.showInFolder).not.toHaveBeenCalled();
    });
});
