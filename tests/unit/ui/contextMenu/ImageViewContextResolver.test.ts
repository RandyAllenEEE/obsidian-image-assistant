import { describe, expect, it, vi } from "vitest";
import { ImageViewContextResolver } from "../../../../src/ui/contextMenu/utils/ImageViewContextResolver";
import { fakeApp, fakeTFile, fakeWorkspace } from "../../../factories/obsidian";

function makeEditor(line: string) {
    return {
        lineCount: vi.fn(() => 1),
        getLine: vi.fn(() => line)
    };
}

describe("ImageViewContextResolver", () => {
    it("resolves the exact Markdown leaf that owns a duplicate network image", () => {
        const url = "https://cdn.example.com/shared.png";
        const firstFile = fakeTFile({ path: "notes/first.md", extension: "md" });
        const secondFile = fakeTFile({ path: "notes/second.md", extension: "md" });
        const firstSource = `![First caption](${url})`;
        const secondSource = `![Second caption|right|320](${url} "Title")`;
        const firstContent = document.createElement("div");
        const secondContent = document.createElement("div");
        const firstImage = firstContent.createEl("img", { attr: { src: url, alt: "First caption" } });
        const secondImage = secondContent.createEl("img", { attr: { src: url, alt: "Second caption" } });
        const firstView = {
            file: firstFile, editor: makeEditor(firstSource), contentEl: firstContent, getMode: () => "source"
        };
        const secondView = {
            file: secondFile, editor: makeEditor(secondSource), contentEl: secondContent, getMode: () => "source"
        };
        const workspace = fakeWorkspace({ activeFile: firstFile, activeView: firstView });
        workspace.getLeavesOfType = vi.fn(() => [{ view: firstView }, { view: secondView }] as any);
        const resolver = new ImageViewContextResolver(fakeApp({ workspace }) as any);

        const context = resolver.resolve(secondImage);

        expect(context?.file).toBe(secondFile);
        expect(context?.editor).toBe(secondView.editor);
        expect(context?.match).toMatchObject({
            line: 0,
            start: 0,
            end: secondSource.length,
            linkText: secondSource
        });
        expect(resolver.resolve(firstImage)?.file).toBe(firstFile);
    });

    it("fails closed when an image is not owned by any enumerated Markdown leaf", () => {
        const file = fakeTFile({ path: "notes/current.md", extension: "md" });
        const contentEl = document.createElement("div");
        const view = { file, editor: makeEditor("![[image.png]]"), contentEl, getMode: () => "source" };
        const workspace = fakeWorkspace({ activeFile: file, activeView: view });
        workspace.getLeavesOfType = vi.fn(() => [{ view }] as any);
        const resolver = new ImageViewContextResolver(fakeApp({ workspace }) as any);

        expect(resolver.resolve(document.createElement("img"))).toBeNull();
    });
});
