import { describe, expect, it, vi } from "vitest";
import { MarkdownView } from "obsidian";
import { ImageReferenceIndexService } from "../../../src/utils/ImageReferenceIndexService";
import { fakeApp, fakeTFile, fakeVault } from "../../factories/obsidian";

function createFixture(contents: Map<string, string>) {
    const image = fakeTFile({
        path: "assets/photo.png",
        name: "photo.png",
        extension: "png"
    });
    const note = fakeTFile({
        path: "notes/source.md",
        name: "source.md",
        extension: "md"
    });
    const canvas = fakeTFile({
        path: "boards/source.canvas",
        name: "source.canvas",
        extension: "canvas"
    });
    const vault = fakeVault({
        files: [image, note, canvas],
        fileContents: contents
    });
    const app = fakeApp({ vault }) as any;
    app.workspace.iterateAllLeaves = vi.fn();
    const service = new ImageReferenceIndexService(app, () => 2);
    return { app, image, note, canvas, service };
}

describe("ImageReferenceIndexService", () => {
    it("indexes Markdown, Admonition, ordinary fences and Canvas once", async () => {
        const contents = new Map([
            ["notes/source.md", [
                "![[assets/photo.png]]",
                "```markdown",
                "![[assets/photo.png|protected]]",
                "```",
                "```ad-note",
                "![[assets/photo.png|admonition]]",
                "```"
            ].join("\n")],
            ["boards/source.canvas", JSON.stringify({
                nodes: [
                    { type: "file", file: "assets/photo.png" },
                    { type: "text", text: "![[assets/photo.png|canvas]]" }
                ]
            })]
        ]);
        const { app, image, service } = createFixture(contents);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const safety = await service.inspectLocalFile(image, {
            includeFencedCode: true
        });
        const readsAfterBuild = app.vault.read.mock.calls.length;
        const mutation = await service.inspectLocalFile(image, {
            includeFencedCode: false
        });

        expect(safety).toMatchObject({
            complete: true,
            referenceCount: 5,
            safeToDelete: false
        });
        expect(mutation.referenceCount).toBe(4);
        expect(safety.markdown.map(reference => reference.line)).toEqual([
            0,
            2,
            5
        ]);
        expect(app.vault.read).toHaveBeenCalledTimes(readsAfterBuild);
    });

    it("queries multiple local targets in one indexed document pass", async () => {
        const secondImage = fakeTFile({
            path: "assets/second.png",
            name: "second.png",
            extension: "png"
        });
        const contents = new Map([
            ["notes/source.md", [
                "![[assets/photo.png]]",
                "![[assets/second.png]]"
            ].join("\n")],
            ["boards/source.canvas", JSON.stringify({
                nodes: [
                    { type: "file", file: "assets/second.png" }
                ]
            })]
        ]);
        const { app, image, service } = createFixture(contents);
        (app.vault.getFiles as ReturnType<typeof vi.fn>)
            .mockReturnValue([...app.vault.getFiles(), secondImage]);
        const originalLookup = app.vault.getAbstractFileByPath;
        app.vault.getAbstractFileByPath = vi.fn((path: string) =>
            path === secondImage.path
                ? secondImage
                : originalLookup.call(app.vault, path)
        );

        const snapshots = await service.inspectLocalFiles(
            [image, secondImage],
            { includeFencedCode: true }
        );

        expect(snapshots.get(image.path)?.referenceCount).toBe(1);
        expect(snapshots.get(secondImage.path)?.referenceCount).toBe(2);
        expect(snapshots.get(secondImage.path)?.canvas).toHaveLength(1);
    });

    it("refreshes only dirty documents and advances the generation", async () => {
        const contents = new Map([
            ["notes/source.md", "![[assets/photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { app, image, note, service } = createFixture(contents);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const first = await service.inspectLocalFile(image, {
            includeFencedCode: true
        });
        const readsBefore = app.vault.read.mock.calls.length;

        contents.set(note.path, "No image");
        await service.refreshPaths([note.path]);
        const second = await service.inspectLocalFile(image, {
            includeFencedCode: true
        });

        expect(second.generation).toBeGreaterThan(first.generation);
        expect(second.referenceCount).toBe(0);
        expect(app.vault.read.mock.calls.length).toBe(readsBefore + 1);
    });

    it("drains changes that arrive while the same document is being indexed", async () => {
        const contents = new Map([
            ["notes/source.md", "![[assets/photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { app, image, note, service } = createFixture(contents);
        await service.inspectLocalFile(image, { includeFencedCode: true });
        app.vault.read.mockClear();

        let releaseRead!: () => void;
        let readStarted!: () => void;
        const started = new Promise<void>(resolve => {
            readStarted = resolve;
        });
        const gate = new Promise<void>(resolve => {
            releaseRead = resolve;
        });
        let delayed = true;
        app.vault.read.mockImplementation(async (file: { path: string }) => {
            const captured = contents.get(file.path) ?? "";
            if (file.path === note.path && delayed) {
                delayed = false;
                readStarted();
                await gate;
            }
            return captured;
        });

        service.markDirty(note.path);
        const refresh = service.refreshPaths([note.path]);
        await started;
        contents.set(note.path, "No image");
        service.markDirty(note.path);
        const concurrentQuery = service.inspectLocalFile(image, {
            includeFencedCode: true
        });
        releaseRead();

        await refresh;
        const snapshot = await concurrentQuery;
        expect(snapshot.referenceCount).toBe(0);
        expect(app.vault.read.mock.calls.filter(
            ([file]: [{ path: string }]) => file.path === note.path
        )).toHaveLength(2);
    });

    it("refreshes a document whose stat changed even when a vault event was missed", async () => {
        const contents = new Map([
            ["notes/source.md", "![[assets/photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { image, note, service } = createFixture(contents);
        const first = await service.inspectLocalFile(image, {
            includeFencedCode: true
        });

        contents.set(note.path, "No image");
        note.stat.mtime += 1;
        note.stat.size += 1;
        const second = await service.inspectLocalFile(image, {
            includeFencedCode: true
        });

        expect(first.referenceCount).toBe(1);
        expect(second.referenceCount).toBe(0);
    });

    it("reuses a valid persisted index without rereading unchanged documents", async () => {
        const contents = new Map([
            ["notes/source.md", "![[assets/photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { app, image, service } = createFixture(contents);
        await service.inspectLocalFile(image, { includeFencedCode: true });
        await (service as any).persist();
        app.vault.read.mockClear();

        const restarted = new ImageReferenceIndexService(app, () => 2);
        const snapshot = await restarted.inspectLocalFile(image, {
            includeFencedCode: true
        });

        expect(snapshot.referenceCount).toBe(1);
        expect(app.vault.read).not.toHaveBeenCalled();
    });

    it("recovers a complete backup left by an interrupted index replacement", async () => {
        const contents = new Map([
            ["notes/source.md", "![[assets/photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { app, image, service } = createFixture(contents);
        await service.inspectLocalFile(image, { includeFencedCode: true });
        await (service as any).persist();
        const indexPath =
            "/.obsidian/plugins/obsidian-image-assistant/image-reference-index.json";
        await app.vault.adapter.rename(indexPath, `${indexPath}.bak`);
        app.vault.read.mockClear();

        const restarted = new ImageReferenceIndexService(app, () => 2);
        const snapshot = await restarted.inspectLocalFile(image, {
            includeFencedCode: true
        });

        expect(snapshot.referenceCount).toBe(1);
        expect(app.vault.read).not.toHaveBeenCalled();
    });

    it("uses open Markdown editor contents as the current query overlay", async () => {
        const contents = new Map([
            ["notes/source.md", "Disk content has no image"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { app, image, note, service } = createFixture(contents);
        const view = new MarkdownView({} as any);
        view.file = note;
        view.editor = {
            getValue: () => "![[assets/photo.png|unsaved]]"
        } as any;
        app.workspace.iterateAllLeaves = vi.fn(callback => {
            callback({ view });
        });

        const snapshot = await service.inspectLocalFile(image, {
            includeFencedCode: true
        });

        expect(snapshot.referenceCount).toBe(1);
        expect(snapshot.markdown[0].original).toContain("unsaved");
    });

    it("fails closed when an indexed Canvas document cannot be parsed", async () => {
        const contents = new Map([
            ["notes/source.md", ""],
            ["boards/source.canvas", "{broken"]
        ]);
        const { canvas, image, service } = createFixture(contents);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const snapshot = await service.inspectLocalFile(image, {
            includeFencedCode: true
        });

        expect(snapshot.complete).toBe(false);
        expect(snapshot.safeToDelete).toBe(false);
        expect(snapshot.uncertainFiles).toContain(canvas.path);
    });
});
