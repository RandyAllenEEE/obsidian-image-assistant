import { describe, expect, it, vi } from "vitest";
import { MarkdownView } from "obsidian";
import { ImageReferenceIndexService } from "../../../src/utils/ImageReferenceIndexService";
import { ReferenceIndexWorkerUnavailableError } from "../../../src/utils/reference-index/ReferenceIndexWorkerClient";
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
    it("does not read vault documents before the browser grants an idle turn", async () => {
        const contents = new Map([
            ["notes/source.md", "![[assets/photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { app, service } = createFixture(contents);
        const callbacks: IdleRequestCallback[] = [];
        const original = window.requestIdleCallback;
        Object.defineProperty(window, "requestIdleCallback", {
            configurable: true,
            value: vi.fn((callback: IdleRequestCallback) => {
                callbacks.push(callback);
                return callbacks.length;
            })
        });

        try {
            let completed = false;
            const start = service.start().then(() => {
                completed = true;
            });
            await Promise.resolve();
            expect(app.vault.read).not.toHaveBeenCalled();

            for (let index = 0; index < 50 && !completed; index++) {
                const callback = callbacks.shift();
                if (callback) {
                    callback({
                        didTimeout: false,
                        timeRemaining: () => 16
                    });
                }
                await new Promise(resolve => window.setTimeout(resolve, 0));
            }
            await start;
            expect(app.vault.read).toHaveBeenCalledTimes(2);
        } finally {
            Object.defineProperty(window, "requestIdleCallback", {
                configurable: true,
                value: original
            });
        }
    });

    it("keeps startup document indexing at one active Vault read", async () => {
        const contents = new Map([
            ["notes/source.md", "![[assets/photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { app, image, service } = createFixture(contents);
        let activeReads = 0;
        let maxActiveReads = 0;
        app.vault.read.mockImplementation(async (file: { path: string }) => {
            activeReads++;
            maxActiveReads = Math.max(maxActiveReads, activeReads);
            await new Promise(resolve => window.setTimeout(resolve, 1));
            activeReads--;
            return contents.get(file.path) ?? "";
        });

        await service.inspectLocalFile(image, { includeFencedCode: true });

        expect(maxActiveReads).toBe(1);
    });

    it("rejects a large legacy cache from its header without parsing the payload", async () => {
        const contents = new Map([
            ["notes/source.md", ""],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { app, service } = createFixture(contents);
        const indexPath =
            "/.obsidian/plugins/obsidian-image-assistant/image-reference-index.json";
        await app.vault.adapter.write(
            indexPath,
            `{"version":2,"padding":"${"x".repeat(4 * 1024 * 1024)}"}`
        );
        const parse = vi.spyOn(JSON, "parse");

        try {
            await (service as any).loadPersisted();
            expect(parse).not.toHaveBeenCalled();
        } finally {
            parse.mockRestore();
        }
    });

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

    it("refreshes a missed vault event during explicit reconciliation", async () => {
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
        await service.reconcile();
        const second = await service.inspectLocalFile(image, {
            includeFencedCode: true
        });

        expect(first.referenceCount).toBe(1);
        expect(second.referenceCount).toBe(0);
    });

    it("reconciles a delayed local-file topology event before a safety query", async () => {
        const contents = new Map([
            ["notes/source.md", "![[photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { app, image, service } = createFixture(contents);
        const first = await service.inspectLocalFile(image, {
            includeFencedCode: true
        });
        expect(first).toMatchObject({ complete: true, referenceCount: 1 });

        const duplicate = fakeTFile({
            path: "archive/photo.png",
            name: "photo.png",
            extension: "png"
        });
        const currentFiles = app.vault.getFiles();
        app.vault.getFiles.mockReturnValue([...currentFiles, duplicate]);
        const originalLookup = app.vault.getAbstractFileByPath;
        app.vault.getAbstractFileByPath = vi.fn((path: string) =>
            path === duplicate.path
                ? duplicate
                : originalLookup.call(app.vault, path)
        );

        await service.reconcile();
        const second = await service.inspectLocalFile(image, {
            includeFencedCode: true
        });

        expect(second.complete).toBe(false);
        expect(second.safeToDelete).toBe(false);
        expect(second.uncertainFiles).toContain("notes/source.md");
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

    it("rejects an unsupported V2 cache and rebuilds only V3 records", async () => {
        const contents = new Map([
            ["notes/source.md", "![[assets/photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { app, image } = createFixture(contents);
        const indexPath =
            "/.obsidian/plugins/obsidian-image-assistant/image-reference-index.json";
        await app.vault.adapter.write(indexPath, JSON.stringify({
            version: 2,
            documents: []
        }));
        app.vault.read.mockClear();

        const service = new ImageReferenceIndexService(app, () => 2);
        const snapshot = await service.inspectLocalFile(image, {
            includeFencedCode: true
        });
        await (service as any).persist();
        const persisted = JSON.parse(new TextDecoder().decode(
            new Uint8Array(await app.vault.adapter.readBinary(indexPath))
        ));

        expect(snapshot.referenceCount).toBe(1);
        expect(app.vault.read).toHaveBeenCalled();
        expect(persisted.version).toBe(3);
        expect(persisted.documents[0]).toHaveProperty("links");
        expect(persisted.documents[0]).not.toHaveProperty("safetyLinks");
    });

    it("uses open Markdown editor contents as the current query overlay", async () => {
        const contents = new Map([
            ["notes/source.md", "Disk content has no image"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { app, image, note, service } = createFixture(contents);
        const view = new MarkdownView({} as any);
        view.file = note;
        const documentIdentity = {};
        const getValue = vi.fn(() => "![[assets/photo.png|unsaved]]");
        view.editor = {
            getValue,
            cm: { state: { doc: documentIdentity } }
        } as any;
        app.workspace.iterateAllLeaves = vi.fn(callback => {
            callback({ view });
        });

        const snapshot = await service.inspectLocalFile(image, {
            includeFencedCode: true
        });

        expect(snapshot.referenceCount).toBe(1);
        expect(snapshot.markdown[0].original).toContain("unsaved");
        await service.inspectLocalFile(image, { includeFencedCode: true });
        expect(getValue).toHaveBeenCalledOnce();

        (view.editor as any).cm.state.doc = {};
        getValue.mockReturnValue("No image now");
        await expect(service.isTokenCurrent(snapshot.token)).resolves.toBe(false);
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

    it("queries only the requested reverse bucket", async () => {
        const contents = new Map([
            ["notes/source.md", "![[assets/photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { image, service } = createFixture(contents);
        await service.inspectLocalFile(image, { includeFencedCode: true });

        const query = vi.spyOn((service as any).worker, "queryLocal");

        await expect(service.inspectLocalFile(image, {
            includeFencedCode: true
        })).resolves.toMatchObject({ referenceCount: 1 });
        expect(query).toHaveBeenLastCalledWith(
            ["photo.png"],
            true,
            [],
            undefined
        );
    });

    it("lets an explicit query wake a background queue waiting for inactivity", async () => {
        vi.useFakeTimers();
        const contents = new Map([
            ["notes/source.md", "![[assets/photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { service } = createFixture(contents);
        const activityGate = (service as any).activityGate;
        activityGate.onload();
        (service as any).lifecycleLoaded = true;
        (service as any).foregroundRequested = false;

        let resumed = false;
        const waiting = (service as any).waitForBackgroundPermission().then(() => {
            resumed = true;
        });
        await Promise.resolve();
        expect(resumed).toBe(false);

        (service as any).requestForeground();
        await waiting;
        expect(resumed).toBe(true);

        service.onunload();
    });

    it("returns a degraded fail-closed snapshot when a Worker query fails", async () => {
        const contents = new Map([
            ["notes/source.md", "![[assets/photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { image, service } = createFixture(contents);
        await service.inspectLocalFile(image, { includeFencedCode: true });
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        vi.spyOn((service as any).worker, "queryLocal")
            .mockRejectedValueOnce(new Error("worker crashed"));

        const snapshot = await service.inspectLocalFile(image, {
            includeFencedCode: true
        });

        expect(snapshot).toMatchObject({
            readiness: "degraded",
            complete: false,
            safeToDelete: false
        });
        expect(snapshot.uncertainFiles).toContain("image-reference-index.json");
    });

    it("rebuilds the index once after a Worker query failure", async () => {
        const contents = new Map([
            ["notes/source.md", "![[assets/photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { image, service } = createFixture(contents);
        await service.inspectLocalFile(image, { includeFencedCode: true });
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const worker = (service as any).worker;
        vi.spyOn(worker, "queryLocal")
            .mockRejectedValueOnce(new Error("worker crashed"));
        const restart = vi.spyOn(worker, "restart");

        const failed = await service.inspectLocalFile(image, {
            includeFencedCode: true
        });
        expect(failed.safeToDelete).toBe(false);

        await vi.waitFor(() => expect(service.getReadiness()).toBe("ready"));
        expect(restart).toHaveBeenCalledTimes(1);
        await expect(service.inspectLocalFile(image, {
            includeFencedCode: true
        })).resolves.toMatchObject({ referenceCount: 1, complete: true });

        service.onunload();
    });

    it("does not loop when the single Worker restart also fails", async () => {
        const contents = new Map([
            ["notes/source.md", "![[assets/photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { service } = createFixture(contents);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const worker = (service as any).worker;
        const restart = vi.spyOn(worker, "restart")
            .mockRejectedValue(new Error("restart failed"));

        (service as any).handleWorkerFailure(new Error("worker crashed"));
        await vi.waitFor(() => expect(service.getReadiness()).toBe("degraded"));
        await Promise.resolve();
        expect(restart).toHaveBeenCalledTimes(1);

        (service as any).handleWorkerFailure(new Error("worker crashed again"));
        await Promise.resolve();
        expect(restart).toHaveBeenCalledTimes(1);

        service.onunload();
    });

    it("does not retry a permanently unsupported Worker runtime", async () => {
        const contents = new Map([
            ["notes/source.md", "![[assets/photo.png]]"],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { service } = createFixture(contents);
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const restart = vi.spyOn((service as any).worker, "restart");

        (service as any).handleWorkerFailure(
            new ReferenceIndexWorkerUnavailableError([
                new Error("Node Workers unsupported")
            ])
        );
        await Promise.resolve();

        expect(service.getReadiness()).toBe("degraded");
        expect(restart).not.toHaveBeenCalled();
        service.onunload();
    });

    it("computes reference line numbers with linear character visits", async () => {
        const references = Array.from(
            { length: 2_000 },
            (_, index) => `![[assets/photo.png|${index}]]`
        ).join("\n");
        const markdown = `${"x".repeat(4 * 1024 * 1024)}\n${references}`;
        const contents = new Map([
            ["notes/source.md", markdown],
            ["boards/source.canvas", JSON.stringify({ nodes: [] })]
        ]);
        const { image, service } = createFixture(contents);
        const original = String.prototype.charCodeAt;
        let visits = 0;
        const charCodeAt = vi.spyOn(String.prototype, "charCodeAt")
            .mockImplementation(function (this: string, index: number) {
                visits++;
                return original.call(this, index);
            });

        try {
            const snapshot = await service.inspectLocalFile(image, {
                includeFencedCode: true
            });
            expect(snapshot.referenceCount).toBe(2_000);
            expect(visits).toBeLessThan(markdown.length * 2);
        } finally {
            charCodeAt.mockRestore();
        }
    });
});
