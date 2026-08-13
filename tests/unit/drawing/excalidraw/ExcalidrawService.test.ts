import { afterEach, describe, expect, it, vi } from "vitest";
import { ExcalidrawService } from "../../../../src/drawing/excalidraw/ExcalidrawService";
import { DEFAULT_SETTINGS } from "../../../../src/settings/defaults";
import { fakeApp, fakeTFile, fakeVault } from "../../../factories/obsidian";

vi.mock("../../../../src/drawing/DrawingConfirmModal", () => ({
    confirmDrawingAction: vi.fn(async () => true)
}));

afterEach(() => document.body.classList.remove("theme-dark", "theme-light"));

describe("ExcalidrawService", () => {
    it("validates the returned file then relocates it to the Image Assistant plan", async () => {
        const actual = fakeTFile({
            path: "drawings/Actual-2.excalidraw.md",
            name: "Actual-2.excalidraw.md",
            extension: "md"
        });
        const vault = fakeVault({ files: [actual] });
        const bridge = createBridge("drawings/Actual-2.excalidraw.md");
        const plugin = createPlugin(vault);
        const service = createService(plugin, bridge);

        const result = await service.create(fakeTFile({ path: "notes/source.md", extension: "md" }));

        expect(result).toMatchObject({ sourceFile: actual, embedFile: actual });
        expect(actual.path).toBe("attachments/Planned.excalidraw.md");
        expect((plugin.app.fileManager!.renameFile as ReturnType<typeof vi.fn>))
            .toHaveBeenCalledWith(actual, "attachments/Planned.excalidraw.md");
        expect(bridge.create).toHaveBeenCalledWith({
            filename: "Planned",
            foldername: "attachments",
            silent: true
        });
    });

    it("corrects Excalidraw's default-folder fallback when the planned destination is Vault root", async () => {
        const actual = fakeTFile({ path: "Excalidraw/Planned.excalidraw.md", extension: "md" });
        const vault = fakeVault({ files: [actual] });
        const bridge = createBridge(actual.path);
        const plugin = createPlugin(vault, {
            destinationPath: "",
            newFilename: "Planned.excalidraw.md"
        });

        const result = await createService(plugin, bridge)
            .create(fakeTFile({ path: "notes/source.md" }));

        expect(result?.sourceFile.path).toBe("Planned.excalidraw.md");
        expect(plugin.app.fileManager!.renameFile).toHaveBeenCalledWith(
            actual,
            "Planned.excalidraw.md"
        );
    });

    it("delegates filename, folder and collision handling to Excalidraw when management is disabled", async () => {
        const actual = fakeTFile({
            path: "Excalidraw/Native 2026-07-29.excalidraw.md",
            extension: "md"
        });
        const vault = fakeVault({ files: [actual] });
        const bridge = createBridge(actual.path);
        const plugin = createPlugin(vault);
        plugin.settings.drawing.excalidraw.manageCreatedFileLocation = false;

        const result = await createService(plugin, bridge)
            .create(fakeTFile({ path: "notes/source.md" }));

        expect(result?.sourceFile).toBe(actual);
        expect(bridge.create).toHaveBeenCalledWith({ silent: true });
        expect(plugin.folderAndFilenameManagement.determineAssetDestination)
            .not.toHaveBeenCalled();
        expect(plugin.folderAndFilenameManagement.ensureFolderExists)
            .not.toHaveBeenCalled();
        expect(plugin.app.fileManager!.renameFile).not.toHaveBeenCalled();
    });

    it("keeps native path delegation while requesting per-file SVG auto-export", async () => {
        const source = fakeTFile({
            path: "Excalidraw/Native.excalidraw.md",
            extension: "md"
        });
        const vault = fakeVault({ files: [source] });
        const bridge = createBridge(source.path);
        const plugin = createPlugin(vault);
        plugin.settings.drawing.excalidraw.manageCreatedFileLocation = false;
        plugin.settings.drawing.excalidraw.embedMode = "auto-export-preview";

        const result = await createService(plugin, bridge)
            .create(fakeTFile({ path: "notes/source.md" }));

        expect(bridge.create).toHaveBeenCalledWith({
            frontmatterKeys: { "excalidraw-autoexport": "svg" },
            silent: true
        });
        expect(result?.sourceFile).toBe(source);
        expect(result?.embedFile).toBe(source);
        expect(result?.previewFallback).toBe(true);
        expect(plugin.app.fileManager!.renameFile).not.toHaveBeenCalled();
    });

    it("falls back to the source without creating a permanent empty SVG", async () => {
        const source = fakeTFile({
            path: "Excalidraw/Planned.excalidraw.md",
            name: "Planned.excalidraw.md",
            extension: "md"
        });
        const bridge = createBridge(source.path);
        const vault = fakeVault({ files: [source] });
        const plugin = createPlugin(vault);
        plugin.settings.drawing.excalidraw.embedMode = "auto-export-preview";
        const service = createService(plugin, bridge);

        const result = await service.create(fakeTFile({ path: "notes/source.md" }));

        expect(bridge.create).toHaveBeenCalledWith({
            filename: "Planned",
            foldername: "attachments",
            frontmatterKeys: { "excalidraw-autoexport": "svg" },
            silent: true
        });
        expect(result?.sourceFile).toBe(source);
        expect(result?.embedFile).toBe(source);
        expect(result?.previewFallback).toBe(true);
        expect(vault.create).not.toHaveBeenCalled();
        expect((plugin as any).__frontmatter["excalidraw-autoexport"]).toBe("svg");
    });

    it("relocates an existing real sibling preview with its source", async () => {
        const source = fakeTFile({ path: "Excalidraw/Planned.excalidraw.md", extension: "md" });
        const preview = fakeTFile({ path: "Excalidraw/Planned.excalidraw.svg", extension: "svg" });
        const contents = new Map([[preview.path, '<svg width="10" height="10"></svg>']]);
        const bridge = createBridge(source.path);
        const vault = fakeVault({ files: [source, preview], fileContents: contents });
        const plugin = createPlugin(vault);
        plugin.settings.drawing.excalidraw.embedMode = "auto-export-preview";

        const result = await createService(plugin, bridge)
            .create(fakeTFile({ path: "notes/source.md" }));

        expect(result?.embedFile).toBe(preview);
        expect(preview.path).toBe("attachments/Planned.excalidraw.svg");
        expect(vault.process).not.toHaveBeenCalled();
        expect(vault.create).not.toHaveBeenCalled();
        expect(contents.get("attachments/Planned.excalidraw.svg"))
            .toBe('<svg width="10" height="10"></svg>');
    });

    it("falls back to the source when a conflicting sibling is not valid SVG", async () => {
        const source = fakeTFile({ path: "Excalidraw/Planned.excalidraw.md", extension: "md" });
        const conflict = fakeTFile({ path: "attachments/Planned.excalidraw.svg", extension: "svg" });
        const bridge = createBridge(source.path);
        const plugin = createPlugin(fakeVault({
            files: [source, conflict],
            fileContents: new Map([[conflict.path, "not svg"]])
        }));
        plugin.settings.drawing.excalidraw.embedMode = "auto-export-preview";

        await expect(createService(plugin, bridge)
            .create(fakeTFile({ path: "notes/source.md" }))).resolves.toMatchObject({
                sourceFile: source,
                embedFile: source,
                previewFallback: true
            });
    });

    it("repairs native SVG auto-export when opening an older managed preview", async () => {
        const source = fakeTFile({ path: "drawings/Actual.excalidraw.md", extension: "md" });
        const preview = fakeTFile({ path: "drawings/Actual.excalidraw.svg", extension: "svg" });
        const bridge = createBridge(source.path);
        const plugin = createPlugin(fakeVault({ files: [source, preview] }));
        plugin.settings.drawing.excalidraw.embedMode = "auto-export-preview";
        const inspector = { inspect: vi.fn(() => ({ providerId: "excalidraw", sourceFile: source })) };

        await createService(plugin, bridge, inspector as any).open(preview);

        expect((plugin as any).__frontmatter["excalidraw-autoexport"]).toBe("svg");
        expect(bridge.openFile).toHaveBeenCalledWith(source);
    });

    it("honors skip before invoking the external creator", async () => {
        const existing = fakeTFile({
            path: "attachments/Planned.excalidraw.md",
            name: "Planned.excalidraw.md",
            extension: "md"
        });
        const bridge = createBridge(existing.path);
        const plugin = createPlugin(fakeVault({ files: [existing] }));
        plugin.settings.localProcessing.filename.conflictResolution = "skip";
        const service = createService(plugin, bridge);

        await expect(service.create(fakeTFile({ path: "notes/source.md" }))).resolves.toBeNull();
        expect(bridge.create).not.toHaveBeenCalled();
    });

    it("waits for a delayed native preview and never substitutes a placeholder", async () => {
        const contents = new Map<string, string>();
        const vault = fakeVault({ fileContents: contents });
        const bridge = createBridge("");
        bridge.create.mockImplementation(async options => {
            const path = `${options?.foldername}/${options?.filename}.excalidraw.md`;
            await vault.create!(path, "drawing");
            return path;
        });
        const plugin = createPlugin(vault);
        plugin.settings.drawing.excalidraw.embedMode = "auto-export-preview";
        let polls = 0;
        const service = createService(plugin, bridge, undefined, {
            previewWaitMs: 300,
            previewPollMs: 100,
            delay: async () => {
                polls += 1;
                if (polls === 2) {
                    await vault.create!(
                        "attachments/Planned.excalidraw.svg",
                        '<svg viewBox="0 0 20 10"><path d="M0 0h20v10z"/></svg>'
                    );
                }
            }
        });

        const result = await service.create(fakeTFile({ path: "notes/source.md" }));

        expect(result?.embedFile.path).toBe("attachments/Planned.excalidraw.svg");
        expect(result?.previewFallback).toBe(false);
        expect(polls).toBe(2);
    });

    it("moves the complete pre-created preview family before moving the source", async () => {
        document.body.classList.add("theme-dark");
        const source = fakeTFile({ path: "Excalidraw/Actual.excalidraw.md", extension: "md" });
        const dark = fakeTFile({ path: "Excalidraw/Actual.excalidraw.dark.svg", extension: "svg" });
        const light = fakeTFile({ path: "Excalidraw/Actual.excalidraw.light.svg", extension: "svg" });
        const neutral = fakeTFile({ path: "Excalidraw/Actual.excalidraw.svg", extension: "svg" });
        const png = fakeTFile({ path: "Excalidraw/Actual.excalidraw.png", extension: "png" });
        const contents = new Map<string, string>([
            [dark.path, '<svg width="30" height="20"></svg>'],
            [light.path, '<svg width="31" height="20"></svg>'],
            [neutral.path, '<svg width="32" height="20"></svg>']
        ]);
        const binaries = new Map([[png.path, validPng()]]);
        const vault = fakeVault({
            files: [source, dark, light, neutral, png],
            fileContents: contents,
            binaryContents: binaries
        });
        const plugin = createPlugin(vault);
        plugin.settings.drawing.excalidraw.embedMode = "auto-export-preview";

        const result = await createService(plugin, createBridge(source.path))
            .create(fakeTFile({ path: "notes/source.md" }));

        const moves = (plugin.app.fileManager!.renameFile as ReturnType<typeof vi.fn>).mock.calls;
        expect(moves.at(-1)?.[0]).toBe(source);
        expect(moves.slice(0, -1).every(([file]) => file !== source)).toBe(true);
        expect(source.path).toBe("attachments/Planned.excalidraw.md");
        expect(dark.path).toBe("attachments/Planned.excalidraw.dark.svg");
        expect(light.path).toBe("attachments/Planned.excalidraw.light.svg");
        expect(neutral.path).toBe("attachments/Planned.excalidraw.svg");
        expect(png.path).toBe("attachments/Planned.excalidraw.png");
        expect(result?.embedFile).toBe(neutral);
    });

    it("prefers the active-theme SVG before PNG when no neutral SVG exists", async () => {
        document.body.classList.add("theme-dark");
        const source = fakeTFile({ path: "attachments/Planned.excalidraw.md", extension: "md" });
        const dark = fakeTFile({ path: "attachments/Planned.excalidraw.dark.svg", extension: "svg" });
        const light = fakeTFile({ path: "attachments/Planned.excalidraw.light.svg", extension: "svg" });
        const png = fakeTFile({ path: "attachments/Planned.excalidraw.png", extension: "png" });
        const vault = fakeVault({
            files: [source, dark, light, png],
            fileContents: new Map([
                [dark.path, '<svg width="20" height="10"></svg>'],
                [light.path, '<svg width="20" height="10"></svg>']
            ]),
            binaryContents: new Map([[png.path, validPng()]])
        });
        const plugin = createPlugin(vault);
        plugin.settings.drawing.excalidraw.manageCreatedFileLocation = false;
        plugin.settings.drawing.excalidraw.embedMode = "auto-export-preview";

        const result = await createService(plugin, createBridge(source.path))
            .create(fakeTFile({ path: "notes/source.md" }));

        expect(result?.embedFile).toBe(dark);
    });

    it("increments the whole destination family instead of overwriting an orphan preview", async () => {
        const source = fakeTFile({ path: "Excalidraw/Actual.excalidraw.md", extension: "md" });
        const sourcePreview = fakeTFile({ path: "Excalidraw/Actual.excalidraw.svg", extension: "svg" });
        const orphan = fakeTFile({ path: "attachments/Planned.excalidraw.svg", extension: "svg" });
        const vault = fakeVault({
            files: [source, sourcePreview, orphan],
            fileContents: new Map([
                [sourcePreview.path, '<svg width="30" height="20"></svg>'],
                [orphan.path, '<svg width="99" height="99"></svg>']
            ])
        });
        const plugin = createPlugin(vault);
        plugin.settings.drawing.excalidraw.embedMode = "auto-export-preview";

        const result = await createService(plugin, createBridge(source.path))
            .create(fakeTFile({ path: "notes/source.md" }));

        expect(result?.sourceFile.path).toBe("attachments/Planned-1.excalidraw.md");
        expect(result?.embedFile.path).toBe("attachments/Planned-1.excalidraw.svg");
        expect(orphan.path).toBe("attachments/Planned.excalidraw.svg");
    });

    it("rolls every derivative back when a family relocation fails", async () => {
        const source = fakeTFile({ path: "Excalidraw/Actual.excalidraw.md", extension: "md" });
        const dark = fakeTFile({ path: "Excalidraw/Actual.excalidraw.dark.svg", extension: "svg" });
        const neutral = fakeTFile({ path: "Excalidraw/Actual.excalidraw.svg", extension: "svg" });
        const vault = fakeVault({ files: [source, dark, neutral] });
        const plugin = createPlugin(vault);
        const rename = plugin.app.fileManager!.renameFile as ReturnType<typeof vi.fn>;
        rename.mockImplementation(async (file, destination: string) => {
            if (file === neutral && destination.startsWith("attachments/")) {
                throw new Error("simulated move failure");
            }
            await vault.rename!(file, destination);
        });

        const result = await createService(plugin, createBridge(source.path))
            .create(fakeTFile({ path: "notes/source.md" }));

        expect(result?.sourceFile).toBe(source);
        expect(source.path).toBe("Excalidraw/Actual.excalidraw.md");
        expect(dark.path).toBe("Excalidraw/Actual.excalidraw.dark.svg");
        expect(neutral.path).toBe("Excalidraw/Actual.excalidraw.svg");
    });

    it("promotes staging previews and removes every staging artifact after overwrite", async () => {
        const target = fakeTFile({ path: "attachments/Planned.excalidraw.md", extension: "md" });
        const targetPreview = fakeTFile({
            path: "attachments/Planned.excalidraw.svg",
            extension: "svg"
        });
        const contents = new Map([
            [target.path, "old drawing"],
            [targetPreview.path, '<svg width="10" height="10"></svg>']
        ]);
        const vault = fakeVault({ files: [target, targetPreview], fileContents: contents });
        const plugin = createPlugin(vault);
        plugin.settings.localProcessing.filename.conflictResolution = "overwrite";
        plugin.settings.drawing.excalidraw.embedMode = "auto-export-preview";
        const bridge = createCreatingBridge(vault, "new drawing");

        const result = await createService(plugin, bridge)
            .create(fakeTFile({ path: "notes/source.md" }));

        expect(contents.get(target.path)).toBe("new drawing");
        expect(contents.get(targetPreview.path)).toContain('width="40"');
        expect(result?.sourceFile).toBe(target);
        expect(result?.embedFile).toBe(targetPreview);
        expect(vault.getFiles!().some(file => file.path.includes("image-assistant-staging")))
            .toBe(false);
    });

    it("retains only the recoverable staging source when overwrite CAS fails", async () => {
        const target = fakeTFile({ path: "attachments/Planned.excalidraw.md", extension: "md" });
        const contents = new Map([[target.path, "externally changed"]]);
        const vault = fakeVault({ files: [target], fileContents: contents });
        vault.process = vi.fn(async () => {
            throw new Error("concurrent modification");
        });
        const plugin = createPlugin(vault);
        plugin.settings.localProcessing.filename.conflictResolution = "overwrite";
        plugin.settings.drawing.excalidraw.embedMode = "auto-export-preview";

        await expect(createService(plugin, createCreatingBridge(vault, "staged recovery"))
            .create(fakeTFile({ path: "notes/source.md" }))).rejects.toThrow(/staging/i);

        const staged = vault.getFiles!().filter(file => file.path.includes("image-assistant-staging"));
        expect(staged).toHaveLength(1);
        expect(staged[0].path.endsWith(".excalidraw.md")).toBe(true);
        expect(contents.get(target.path)).toBe("externally changed");
    });

    it("preserves a target preview changed concurrently during staging", async () => {
        const target = fakeTFile({ path: "attachments/Planned.excalidraw.md", extension: "md" });
        const targetPreview = fakeTFile({
            path: "attachments/Planned.excalidraw.svg",
            extension: "svg"
        });
        const concurrentPreview = '<svg width="77" height="55"></svg>';
        const contents = new Map([
            [target.path, "old drawing"],
            [targetPreview.path, '<svg width="10" height="10"></svg>']
        ]);
        const vault = fakeVault({ files: [target, targetPreview], fileContents: contents });
        const plugin = createPlugin(vault);
        plugin.settings.localProcessing.filename.conflictResolution = "overwrite";
        plugin.settings.drawing.excalidraw.embedMode = "auto-export-preview";
        const bridge = createCreatingBridge(vault, "new drawing", () => {
            contents.set(targetPreview.path, concurrentPreview);
        });

        const result = await createService(plugin, bridge)
            .create(fakeTFile({ path: "notes/source.md" }));

        expect(result?.sourceFile).toBe(target);
        expect(contents.get(targetPreview.path)).toBe(concurrentPreview);
        expect(vault.getFiles!().some(file => file.path.includes("image-assistant-staging")))
            .toBe(false);
    });
});

function createBridge(returnedPath: string) {
    return {
        probe: vi.fn(() => ({
            available: true,
            canRecognize: true,
            canCreate: true,
            canListTemplates: false,
            canCreateSvgPreview: true,
            reason: "ready"
        })),
        listTemplates: vi.fn(async () => []),
        create: vi.fn(async (_options?: Record<string, string>) => returnedPath),
        isExcalidrawFile: vi.fn(() => true),
        openFile: vi.fn(async () => undefined)
    };
}

function createCreatingBridge(
    vault: ReturnType<typeof fakeVault>,
    sourceContent: string,
    afterCreate?: () => void
) {
    const bridge = createBridge("");
    bridge.create.mockImplementation(async options => {
        const folder = options?.foldername ? `${options.foldername}/` : "";
        const sourcePath = `${folder}${options?.filename}.excalidraw.md`;
        await vault.create!(sourcePath, sourceContent);
        await vault.create!(
            sourcePath.replace(/\.md$/i, ".svg"),
            '<svg width="40" height="30"><path d="M0 0h40v30z"/></svg>'
        );
        afterCreate?.();
        return sourcePath;
    });
    return bridge;
}

function createService(
    plugin: ReturnType<typeof createPlugin>,
    bridge: ReturnType<typeof createBridge>,
    inspector: { inspect: ReturnType<typeof vi.fn> } | undefined = undefined,
    timing: ConstructorParameters<typeof ExcalidrawService>[3] = { previewWaitMs: 0 }
) {
    return new ExcalidrawService(
        plugin as any,
        bridge as any,
        (inspector ?? { inspect: vi.fn() }) as any,
        timing
    );
}

function validPng(width = 2, height = 2): ArrayBuffer {
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(bytes.buffer);
    view.setUint32(16, width);
    view.setUint32(20, height);
    return bytes.buffer;
}

function createPlugin(
    vault: ReturnType<typeof fakeVault>,
    plan = { destinationPath: "attachments", newFilename: "Planned.excalidraw.md" }
) {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const frontmatter: Record<string, unknown> = {};
    const fileManager = {
        processFrontMatter: vi.fn(async (_file, update: (value: Record<string, unknown>) => void) => {
            update(frontmatter);
        }),
        renameFile: vi.fn(async (file, destination: string) => {
            await vault.rename!(file, destination);
        })
    };
    return {
        app: fakeApp({ vault, fileManager }),
        settings,
        __frontmatter: frontmatter,
        componentsReady: Promise.resolve(),
        folderAndFilenameManagement: {
            determineAssetDestination: vi.fn(async () => plan),
            ensureFolderExists: vi.fn(async () => undefined)
        }
    };
}
