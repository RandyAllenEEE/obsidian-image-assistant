import { describe, expect, it, vi } from "vitest";
import { ConcurrentQueue } from "../../../../src/utils/AsyncLock";
import { PasteHandler } from "../../../../src/local/handlers/PasteHandler";
import { fakeTFile } from "../../../factories/obsidian";

class MemoryEditor {
    value = "";
    cursor = { line: 0, ch: 0 };

    getCursor() { return { ...this.cursor }; }
    setCursor(position: { line: number; ch: number }) { this.cursor = { ...position }; }
    lineCount() { return this.value.split("\n").length; }
    getLine(line: number) { return this.value.split("\n")[line] ?? ""; }
    posToOffset(position: { line: number; ch: number }) {
        const lines = this.value.split("\n");
        return lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.ch;
    }
    offsetToPos(offset: number) {
        const before = this.value.slice(0, offset).split("\n");
        return { line: before.length - 1, ch: before[before.length - 1].length };
    }
    getRange(from: { line: number; ch: number }, to: { line: number; ch: number }) {
        return this.value.slice(this.posToOffset(from), this.posToOffset(to));
    }
    replaceRange(text: string, from: { line: number; ch: number }, to = from) {
        const start = this.posToOffset(from);
        const end = this.posToOffset(to);
        this.value = `${this.value.slice(0, start)}${text}${this.value.slice(end)}`;
    }
}

function createFixture(overrides: { determineDestination?: () => Promise<{ destinationPath: string; newFilename: string }> } = {}) {
    const editor = new MemoryEditor();
    const activeFile = fakeTFile({ path: "notes/note.md", name: "note.md" });
    const originalBuffer = new Uint8Array(2_000).buffer;
    const source = {
        name: "photo.png",
        size: originalBuffer.byteLength,
        arrayBuffer: vi.fn(async () => originalBuffer),
    } as unknown as File;
    const createUniqueBinary = vi.fn(async (_folder, filename: string) =>
        fakeTFile({ path: `assets/${filename}`, name: filename })
    );
    const determineDestination = overrides.determineDestination ?? vi.fn(async () => ({
        destinationPath: "assets",
        newFilename: "photo.webp",
    }));
    const plugin = {
        settings: {
            captions: { enabled: false },
            localProcessing: {
                conversion: {
                    outputFormat: "WEBP",
                    quality: 80,
                    colorDepth: 1,
                    resizeMode: "None",
                    desiredWidth: 0,
                    desiredHeight: 0,
                    desiredLongestEdge: 0,
                    enlargeOrReduce: "Auto",
                    allowLargerFiles: false,
                    minimumCompressionSavingsInKB: 1,
                },
                filename: { conflictResolution: "increment" },
                destination: {},
                link: {},
                embedResize: {},
                externalTools: {},
            },
        },
        concurrentQueue: new ConcurrentQueue(1),
        folderAndFilenameManagement: {
            determineDestination,
            ensureFolderExists: vi.fn(async () => undefined),
            shouldSkipConversion: vi.fn(() => false),
            createUniqueBinary,
            combinePath: vi.fn((folder: string, filename: string) => `${folder}/${filename}`),
        },
        imageProcessor: {
            processImage: vi.fn(async () => new Uint8Array(1_500).buffer),
        },
        insertLinkWithInserter: vi.fn(async (inserter, _editor, path: string) => {
            inserter.insertResponseToEditor(`![[${path}]]`);
        }),
    } as any;
    const app = {
        workspace: {
            getActiveFile: vi.fn(() => activeFile),
            getActiveViewOfType: vi.fn(() => ({ editor })),
        },
        vault: { adapter: { exists: vi.fn(async () => false) } },
    } as any;

    return { handler: new PasteHandler(app, plugin), editor, source, plugin, createUniqueBinary };
}

describe("PasteHandler data safety", () => {
    it("restores the source extension when compression savings are insufficient", async () => {
        const { handler, editor, source, createUniqueBinary } = createFixture();

        await handler.processFiles([source], editor as any);

        expect(createUniqueBinary).toHaveBeenCalledWith("assets", "photo.png", expect.any(ArrayBuffer), "increment");
        expect(editor.value).toBe("![[assets/photo.png]]");
    });

    it("preserves the pasted extension when processing returns unchanged data", async () => {
        const { handler, editor, source, plugin, createUniqueBinary } = createFixture();
        Object.defineProperty(source, "name", { value: "photo.jpeg" });
        plugin.imageProcessor.processImageDetailed = vi.fn(async () => ({
            data: await source.arrayBuffer(),
            mimeType: "image/jpeg",
            extension: "jpg",
            outcome: "unchanged",
        }));

        await handler.processFiles([source], editor as any);

        expect(createUniqueBinary).toHaveBeenCalledWith("assets", "photo.jpeg", expect.any(ArrayBuffer), "increment");
        expect(editor.value).toBe("![[assets/photo.jpeg]]");
    });

    it("removes the loading placeholder when destination resolution fails", async () => {
        const { handler, editor, source, createUniqueBinary } = createFixture({
            determineDestination: vi.fn(async () => { throw new Error("bad template"); }),
        });
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        await handler.processFiles([source], editor as any);

        expect(createUniqueBinary).not.toHaveBeenCalled();
        expect(editor.value).toBe("");
    });
});
