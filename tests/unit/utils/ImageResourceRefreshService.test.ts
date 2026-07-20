import { describe, expect, it, vi } from "vitest";
import { ImageResourceRefreshService } from "../../../src/utils/ImageResourceRefreshService";
import { fakeApp, fakeTFile, fakeVault } from "../../factories/obsidian";

function makeEditor(source: string) {
    const lines = source.split("\n");
    return {
        getValue: () => source,
        lineCount: () => lines.length,
        getLine: (line: number) => lines[line] ?? ""
    } as any;
}

describe("ImageResourceRefreshService", () => {
    it("cache-busts only images whose source resolves to the modified file", async () => {
        const note = fakeTFile({ path: "notes/current.md", extension: "md" });
        const target = fakeTFile({
            path: "assets/target.png",
            extension: "png",
            stat: { ctime: 1, mtime: 42, size: 100 }
        });
        const other = fakeTFile({ path: "assets/other.png", extension: "png" });
        const vault = fakeVault({ files: [note, target, other] });
        (vault as any).getResourcePath = vi.fn((file) => `app://local/${file.path}`);
        const contentEl = document.createElement("div");
        document.body.appendChild(contentEl);
        const targetImage = contentEl.createEl("img");
        targetImage.src = "app://local/assets/target.png";
        const otherImage = contentEl.createEl("img");
        otherImage.src = "app://local/assets/other.png";
        const editor = makeEditor(
            "![[assets/target.png]]\n![[assets/other.png]]"
        );
        const view = {
            contentEl,
            containerEl: contentEl,
            file: note,
            editor,
            getMode: () => "preview"
        };
        const app = fakeApp({ vault }) as any;
        app.workspace.getLeavesOfType = vi.fn(() => [{ view }]);
        app.workspace.getActiveViewOfType = vi.fn(() => null);
        const refreshAllImages = vi.fn();
        const refreshAllViews = vi.fn();
        const service = new ImageResourceRefreshService(app, {
            imageStateManager: { refreshAllImages } as any,
            imageCaption: { refreshAllViews } as any
        });

        const result = await service.refreshFile(target);

        expect(result).toEqual({ matched: 1, refreshed: 1 });
        expect(targetImage.getAttribute("src")).toBe(
            "app://local/assets/target.png?image-assistant-mtime=42"
        );
        expect(otherImage.getAttribute("src")).toBe(
            "app://local/assets/other.png"
        );
        expect(refreshAllImages).toHaveBeenCalledOnce();
        expect(refreshAllViews).toHaveBeenCalledOnce();
    });

    it("refreshes every duplicate resource instance and preserves query/hash", async () => {
        const note = fakeTFile({ path: "notes/current.md", extension: "md" });
        const target = fakeTFile({
            path: "assets/target.png",
            extension: "png",
            stat: { ctime: 1, mtime: 99, size: 100 }
        });
        const sameName = fakeTFile({
            path: "other/target.png",
            extension: "png"
        });
        const vault = fakeVault({ files: [note, target, sameName] });
        (vault as any).getResourcePath = vi.fn((file) =>
            `app://local/${file.path}?vault=main#preview`
        );
        const contentEl = document.createElement("div");
        document.body.appendChild(contentEl);
        const first = contentEl.createEl("img");
        const second = contentEl.createEl("img");
        const ambiguousBasename = contentEl.createEl("img");
        first.setAttribute(
            "src",
            "app://local/assets/target.png?vault=main&image-assistant-mtime=1#preview"
        );
        second.setAttribute("src", "app://local/assets/target.png?vault=main#preview");
        ambiguousBasename.setAttribute(
            "src",
            "app://local/other/target.png?vault=main#preview"
        );
        const view = {
            contentEl,
            containerEl: contentEl,
            file: note,
            editor: makeEditor(""),
            getMode: () => "preview"
        };
        const app = fakeApp({ vault }) as any;
        app.workspace.getLeavesOfType = vi.fn(() => [{ view }]);
        app.workspace.getActiveViewOfType = vi.fn(() => null);

        const result = await new ImageResourceRefreshService(app).refreshFile(target);

        expect(result).toEqual({ matched: 2, refreshed: 2 });
        expect(first.getAttribute("src")).toBe(
            "app://local/assets/target.png?vault=main&image-assistant-mtime=99#preview"
        );
        expect(second.getAttribute("src")).toBe(
            "app://local/assets/target.png?vault=main&image-assistant-mtime=99#preview"
        );
        expect(ambiguousBasename.getAttribute("src")).toBe(
            "app://local/other/target.png?vault=main#preview"
        );
    });
});
