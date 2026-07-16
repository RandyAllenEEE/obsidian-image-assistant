import { describe, expect, it, vi } from "vitest";
import { UploadHistoryManager } from "../../../src/utils/UploadHistoryManager";

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(resolvePromise => { resolve = resolvePromise; });
    return { promise, resolve };
}

describe("UploadHistoryManager", () => {
    it("accepts only HTTP(S) history URLs and limits templates to path or query", async () => {
        const stored = JSON.stringify([
            { url: "https://cdn.example/{year}/image.png?name={fileName}" },
            { url: "http://cdn.example/image.png" },
            { url: "ftp://cdn.example/image.png" },
            { url: "https://{tenant}.example/image.png" },
            { url: "https://cdn.example/image.png#{year}" },
            { url: "https://user:password@cdn.example/image.png" },
            { url: "not a url" },
            { url: "https://cdn.example/{broken/image.png" }
        ]);
        const adapter = {
            exists: vi.fn(async () => true),
            read: vi.fn(async () => stored),
            write: vi.fn(async () => undefined)
        };
        const manager = new UploadHistoryManager(
            { vault: { adapter, configDir: ".obsidian" } } as any,
            { manifest: { id: "image-assistant" }, settings: {} } as any
        );

        await manager.init();

        expect(manager.getHistory().map(record => record.url)).toEqual([
            "https://cdn.example/{year}/image.png?name={fileName}",
            "http://cdn.example/image.png"
        ]);
    });

    it("drops an invalid optional imgUrl without discarding a valid primary URL", async () => {
        const adapter = { exists: vi.fn(async () => false), write: vi.fn(async () => undefined) };
        const manager = new UploadHistoryManager(
            { vault: { adapter, configDir: ".obsidian" } } as any,
            { manifest: { id: "image-assistant" }, settings: {} } as any
        );

        await manager.addRecord({
            url: "https://cdn.example/image.png",
            imgUrl: "javascript:alert(1)"
        });

        expect(manager.getHistory()).toEqual([{ url: "https://cdn.example/image.png" }]);
        await expect(manager.addRecord({ url: "file:///tmp/image.png" })).rejects.toThrow("valid URL");
    });

    it("ignores malformed files and invalid record shapes", async () => {
        const adapter = {
            exists: vi.fn(async () => true),
            read: vi.fn(async () => "{not-json"),
            write: vi.fn(async () => undefined)
        };
        const manager = new UploadHistoryManager(
            { vault: { adapter, configDir: ".obsidian" } } as any,
            { manifest: { id: "image-assistant" }, settings: {} } as any
        );

        await manager.init();

        expect(manager.getHistory()).toEqual([]);
    });

    it("degrades to empty history when the history file cannot be read", async () => {
        const adapter = {
            exists: vi.fn(async () => true),
            read: vi.fn(async () => { throw new Error("permission denied"); }),
            write: vi.fn(async () => undefined)
        };
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const manager = new UploadHistoryManager(
            { vault: { adapter, configDir: ".obsidian" } } as any,
            { manifest: { id: "image-assistant" }, settings: {} } as any
        );

        await expect(manager.init()).resolves.toBeUndefined();

        expect(manager.getHistory()).toEqual([]);
        expect(errorSpy).toHaveBeenCalledWith(
            "Failed to read upload history; starting with an empty history:",
            expect.any(Error)
        );
    });

    it("serializes overlapping writes so records cannot overwrite each other", async () => {
        const firstWrite = deferred();
        const writeStarted = deferred();
        const writes: string[] = [];
        const adapter = {
            exists: vi.fn(async () => false),
            read: vi.fn(),
            write: vi.fn(async (_path: string, content: string) => {
                writes.push(content);
                if (writes.length === 1) {
                    writeStarted.resolve();
                    await firstWrite.promise;
                }
            }),
        };
        const app = { vault: { adapter, configDir: ".obsidian" } } as any;
        const plugin = { manifest: { id: "image-assistant" }, settings: {}, saveSettings: vi.fn() } as any;
        const manager = new UploadHistoryManager(app, plugin);

        const first = manager.addRecord({ url: "https://cdn.example/a.png" });
        const second = manager.addRecord({ url: "https://cdn.example/b.png" });
        await writeStarted.promise;

        expect(adapter.exists).toHaveBeenCalledOnce();
        firstWrite.resolve();
        await Promise.all([first, second]);

        expect(manager.getHistory().map(record => record.url)).toEqual([
            "https://cdn.example/a.png",
            "https://cdn.example/b.png",
        ]);
        expect(JSON.parse(writes.at(-1) ?? "[]")).toHaveLength(2);
    });

    it("returns a copy of history instead of mutable internal state", async () => {
        const adapter = { exists: vi.fn(async () => false), write: vi.fn(async () => undefined) };
        const manager = new UploadHistoryManager(
            { vault: { adapter, configDir: ".obsidian" } } as any,
            { manifest: { id: "image-assistant" }, settings: {} } as any
        );
        await manager.addRecord({ url: "https://cdn.example/a.png" });

        manager.getHistory().length = 0;

        expect(manager.getHistory()).toHaveLength(1);
    });

    it("merges duplicate URL records instead of appending them", async () => {
        const writes: string[] = [];
        const adapter = {
            exists: vi.fn(async () => false),
            write: vi.fn(async (_path: string, content: string) => { writes.push(content); })
        };
        const manager = new UploadHistoryManager(
            { vault: { adapter, configDir: ".obsidian" } } as any,
            { manifest: { id: "image-assistant" }, settings: {} } as any
        );

        await Promise.all([
            manager.addRecord({ url: "https://cdn.example/a.png", localPath: "old.png" }),
            manager.addRecord({ url: "https://cdn.example/a.png", localPath: "new.png", name: "new" })
        ]);

        expect(manager.getHistory()).toEqual([{
            url: "https://cdn.example/a.png",
            localPath: "new.png",
            name: "new"
        }]);
        expect(JSON.parse(writes.at(-1) ?? "[]")).toHaveLength(1);
    });

    it("does not mutate in-memory history when persistence fails", async () => {
        const adapter = {
            exists: vi.fn(async () => false),
            write: vi.fn()
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error("disk full"))
        };
        const manager = new UploadHistoryManager(
            { vault: { adapter, configDir: ".obsidian" } } as any,
            { manifest: { id: "image-assistant" }, settings: {} } as any
        );
        await manager.addRecord({ url: "https://cdn.example/a.png", metadata: { nested: true } });

        await expect(manager.addRecord({ url: "https://cdn.example/b.png" })).rejects.toThrow("disk full");

        expect(manager.getHistory().map(record => record.url)).toEqual(["https://cdn.example/a.png"]);
        const copy = manager.getRecord("https://cdn.example/a.png")!;
        (copy.metadata as { nested: boolean }).nested = false;
        expect(manager.getRecord("https://cdn.example/a.png")?.metadata).toEqual({ nested: true });
    });

    it("keeps the committed history in memory when backup cleanup fails after an atomic replace", async () => {
        const files = new Map<string, string>([[".obsidian/plugins/image-assistant/upload_history.json", JSON.stringify([
            { url: "https://cdn.example/old.png" }
        ])]]);
        const adapter = {
            exists: vi.fn(async (path: string) => files.has(path)),
            read: vi.fn(async (path: string) => files.get(path) ?? ""),
            write: vi.fn(async (path: string, content: string) => { files.set(path, content); }),
            rename: vi.fn(async (from: string, to: string) => {
                const content = files.get(from);
                if (content === undefined) throw new Error(`missing ${from}`);
                files.delete(from);
                files.set(to, content);
            }),
            remove: vi.fn(async (path: string) => {
                if (path.endsWith(".bak")) throw new Error("backup locked");
                files.delete(path);
            })
        };
        const manager = new UploadHistoryManager(
            { vault: { adapter, configDir: ".obsidian" } } as any,
            { manifest: { id: "image-assistant" }, settings: {} } as any
        );
        vi.spyOn(console, "warn").mockImplementation(() => undefined);

        await manager.init();
        await expect(manager.addRecord({ url: "https://cdn.example/new.png" })).resolves.toBeUndefined();

        expect(manager.getHistory().map(record => record.url)).toEqual([
            "https://cdn.example/old.png",
            "https://cdn.example/new.png"
        ]);
        expect(JSON.parse(files.get(".obsidian/plugins/image-assistant/upload_history.json") ?? "[]"))
            .toHaveLength(2);
    });

    it("migrates validated legacy records before removing the legacy setting", async () => {
        const writes: string[] = [];
        const adapter = {
            exists: vi.fn(async () => false),
            write: vi.fn(async (_path: string, content: string) => { writes.push(content); })
        };
        const plugin = {
            manifest: { id: "image-assistant" },
            settings: { uploadedImages: [{ imgUrl: "https://cdn.example/legacy.png" }, null] },
            saveSettings: vi.fn(async () => undefined)
        } as any;
        const manager = new UploadHistoryManager(
            { vault: { adapter, configDir: ".obsidian" } } as any,
            plugin
        );

        await manager.init();

        expect(manager.getHistory().map(record => record.url)).toEqual(["https://cdn.example/legacy.png"]);
        expect(plugin.settings.uploadedImages).toBeUndefined();
        expect(plugin.saveSettings).toHaveBeenCalledOnce();
        expect(JSON.parse(writes.at(-1) ?? "[]")).toHaveLength(1);
    });
});
