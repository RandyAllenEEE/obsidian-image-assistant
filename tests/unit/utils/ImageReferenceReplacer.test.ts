import { describe, expect, it, vi } from "vitest";
import { ImageReferenceReplacer } from "../../../src/utils/ImageReferenceReplacer";
import { fakeTFile } from "../../factories/obsidian";

function makeHarness(original: string, count = 1) {
    const note = fakeTFile({ path: "notes/day.md", name: "day.md" });
    const target = fakeTFile({ path: "assets/photo local.png", name: "photo local.png" });
    const replacements: string[] = [];
    const app = {
        vault: {
            getAbstractFileByPath: vi.fn((path: string) => path === target.path ? target : null),
        },
        metadataCache: {
            fileToLinktext: vi.fn((_file: any, sourcePath: string) => sourcePath === "notes/other.md"
                ? "../assets/photo local.png"
                : "assets/photo local.png"),
        },
    } as any;
    const manager = {
        updateReferencesInFile: vi.fn(async (file: any, imagePath: string, replacer: any) => {
            if (count === 0) return 0;
            const replacement = replacer({
                file,
                start: 0,
                end: original.length,
                original,
                link: imagePath,
                line: 0,
            });
            replacements.push(replacement);
            return count;
        }),
    } as any;

    return { app, manager, note, target, replacements, replacer: new ImageReferenceReplacer(app, manager) };
}

describe("ImageReferenceReplacer", () => {
    it("replaces a wiki URL with a note-relative local path and keeps pipe attributes", async () => {
        const { manager, note, target, replacements, replacer } = makeHarness("![[https://cdn.test/a.png|300]]");

        const updated = await replacer.replaceUrlInFile(note, "https://cdn.test/a.png", target.path);

        expect(updated).toBe(1);
        expect(manager.updateReferencesInFile).toHaveBeenCalledWith(note, "https://cdn.test/a.png", expect.any(Function));
        expect(replacements).toEqual(["![[assets/photo local.png|300]]"]);
    });

    it("replaces a markdown URL and preserves title text", async () => {
        const { note, target, replacements, replacer } = makeHarness('![alt](https://cdn.test/a.png "demo")');

        await replacer.replaceUrlInFile(note, "https://cdn.test/a.png", target.path);

        expect(replacements).toEqual(['![alt](assets/photo%20local.png "demo")']);
    });

    it("uses each note path when replacing in multiple files", async () => {
        const { app, manager, target, replacements, replacer } = makeHarness("![alt](https://cdn.test/a.png)");
        const first = fakeTFile({ path: "notes/day.md", name: "day.md" });
        const second = fakeTFile({ path: "notes/other.md", name: "other.md" });

        const updated = await replacer.replaceUrlInFiles([first, second], "https://cdn.test/a.png", target);

        expect(updated).toBe(2);
        expect(app.metadataCache.fileToLinktext).toHaveBeenNthCalledWith(1, target, "notes/day.md", false);
        expect(app.metadataCache.fileToLinktext).toHaveBeenNthCalledWith(2, target, "notes/other.md", false);
        expect(manager.updateReferencesInFile).toHaveBeenCalledTimes(2);
        expect(replacements).toEqual([
            "![[assets/photo local.png|alt]]",
            "![[../assets/photo local.png|alt]]",
        ]);
    });

    it("returns zero when no references are updated", async () => {
        const { note, target, replacements, replacer } = makeHarness("![alt](https://cdn.test/a.png)", 0);

        const updated = await replacer.replaceUrlInFile(note, "https://cdn.test/a.png", target.path);

        expect(updated).toBe(0);
        expect(replacements).toEqual([]);
    });

    it("replaces a local path using a target TFile", async () => {
        const { note, target, replacements, replacer } = makeHarness("![[assets/old.png|right|200]]");

        const updated = await replacer.replacePathInFile(note, "assets/old.png", target);

        expect(updated).toBe(1);
        expect(replacements).toEqual(["![[assets/photo local.png|right|200]]"]);
    });

    it("fails closed when the target does not exist", () => {
        const { note, replacer } = makeHarness("![alt](old.png)");

        expect(() => replacer.toLinkTextForFile("missing/new image.png", note))
            .toThrow("Local image target not found");
    });

    it("falls back to a TFile path when metadata link generation is unavailable", () => {
        const { app, manager, note, target } = makeHarness("![alt](old.png)");
        app.metadataCache.fileToLinktext = undefined;
        const replacer = new ImageReferenceReplacer(app, manager);

        expect(replacer.toLinkTextForFile(target, note)).toBe(target.path);
    });
});
