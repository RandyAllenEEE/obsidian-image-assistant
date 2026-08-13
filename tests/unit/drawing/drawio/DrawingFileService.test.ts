import { TFile, TFolder } from "obsidian";
import {
    DrawingFileService,
    DrawingSaveConflictError
} from "../../../../src/drawing/drawio/DrawingFileService";
import { EMPTY_DRAWIO_SVG } from "../../../../src/drawing/drawio/DiagramFile";
import { DEFAULT_SETTINGS } from "../../../../src/settings/defaults";

const RAW_XML = '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';

describe("DrawingFileService", () => {
    it("increments the compound suffix without producing .drawio-1.svg", async () => {
        const fixture = makeFixture();
        fixture.add("Notes/note.md", "# note");
        fixture.add("Assets/Drawing.drawio.svg", EMPTY_DRAWIO_SVG);
        fixture.plugin.settings.localProcessing.filename.conflictResolution = "increment";
        const service = new DrawingFileService(fixture.plugin);

        const result = await service.createDrawing(fixture.files.get("Notes/note.md")!);

        expect(result?.path).toBe("Assets/Drawing-1.drawio.svg");
        expect(fixture.contents.get(result!.path)).toBe(EMPTY_DRAWIO_SVG);
    });

    it("uses CAS and refuses to overwrite an external modification", async () => {
        const fixture = makeFixture();
        const file = fixture.add("Assets/Drawing.drawio.svg", EMPTY_DRAWIO_SVG);
        const service = new DrawingFileService(fixture.plugin);
        fixture.contents.set(file.path, EMPTY_DRAWIO_SVG.replace("100px", "101px"));

        await expect(service.save(file, EMPTY_DRAWIO_SVG, RAW_XML, EMPTY_DRAWIO_SVG))
            .rejects.toBeInstanceOf(DrawingSaveConflictError);
    });

    it("migrates legacy raw XML to a collision-safe .drawio.svg path", async () => {
        const fixture = makeFixture();
        const legacy = fixture.add("Assets/Legacy.drawio", RAW_XML);
        fixture.add("Assets/Legacy.drawio.svg", EMPTY_DRAWIO_SVG);
        const service = new DrawingFileService(fixture.plugin);

        const result = await service.save(legacy, RAW_XML, RAW_XML, EMPTY_DRAWIO_SVG);

        expect(result.migrated).toBe(true);
        expect(result.file.path).toBe("Assets/Legacy-1.drawio.svg");
        expect(fixture.contents.get(result.file.path)).toBe(EMPTY_DRAWIO_SVG);
        expect(fixture.contents.has("Assets/Legacy.drawio")).toBe(false);
    });

    it("renames a failed migration back while the source baseline is unchanged", async () => {
        const fixture = makeFixture();
        const legacy = fixture.add("Assets/Legacy.drawio", RAW_XML);
        fixture.failNextProcess = true;
        const service = new DrawingFileService(fixture.plugin);

        await expect(service.save(legacy, RAW_XML, RAW_XML, EMPTY_DRAWIO_SVG)).rejects.toThrow("process failed");
        expect(legacy.path).toBe("Assets/Legacy.drawio");
        expect(fixture.contents.get("Assets/Legacy.drawio")).toBe(RAW_XML);
    });

    it("migrates a confirmed legacy conflict instead of writing SVG into .drawio", async () => {
        const fixture = makeFixture();
        const legacy = fixture.add("Assets/Legacy.drawio", RAW_XML.replace("</mxfile>", "<!-- external --></mxfile>"));
        const service = new DrawingFileService(fixture.plugin);

        const result = await service.overwrite(legacy, RAW_XML, EMPTY_DRAWIO_SVG);

        expect(result.migrated).toBe(true);
        expect(result.file.path).toBe("Assets/Legacy.drawio.svg");
        expect(fixture.contents.has("Assets/Legacy.drawio")).toBe(false);
        expect(fixture.contents.get("Assets/Legacy.drawio.svg")).toBe(EMPTY_DRAWIO_SVG);
    });

    it("falls back to an explicit raw .drawio recovery before any SVG export succeeds", async () => {
        const fixture = makeFixture();
        const source = fixture.add("Assets/Drawing.drawio.svg", EMPTY_DRAWIO_SVG);
        const service = new DrawingFileService(fixture.plugin);

        const recovery = await service.saveRecoveryCopy(source, RAW_XML);

        expect(recovery.path).toMatch(/^Assets\/Drawing-recovery-.*\.drawio$/);
        expect(fixture.contents.get(recovery.path)).toBe(RAW_XML);
    });

    it("exports a collision-safe ordinary SVG copy beside the drawing", async () => {
        const fixture = makeFixture();
        const source = fixture.add("Assets/Drawing.drawio.svg", EMPTY_DRAWIO_SVG);
        fixture.add("Assets/Drawing-export.svg", '<svg xmlns="http://www.w3.org/2000/svg"/>');
        const service = new DrawingFileService(fixture.plugin);

        const exported = await service.saveExportCopy(
            source,
            "svg",
            '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'
        );

        expect(exported?.path).toBe("Assets/Drawing-export-1.svg");
    });
});

function makeFixture() {
    const contents = new Map<string, string>();
    const files = new Map<string, TFile>();
    const fixture = {
        contents,
        files,
        failNextProcess: false,
        add(path: string, content: string): TFile {
            const file = new TFile();
            updateFilePath(file, path);
            contents.set(path, content);
            files.set(path, file);
            return file;
        },
        plugin: null as any
    };
    const vault = {
        getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
        read: vi.fn(async (file: TFile) => contents.get(file.path) ?? ""),
        create: vi.fn(async (path: string, content: string) => {
            if (files.has(path)) throw new Error("already exists");
            return fixture.add(path, content);
        }),
        modify: vi.fn(async (file: TFile, content: string) => {
            contents.set(file.path, content);
        }),
        process: vi.fn(async (file: TFile, update: (content: string) => string) => {
            if (fixture.failNextProcess) {
                fixture.failNextProcess = false;
                throw new Error("process failed");
            }
            const current = contents.get(file.path) ?? "";
            contents.set(file.path, update(current));
        })
    };
    const settings = structuredClone(DEFAULT_SETTINGS);
    fixture.plugin = {
        app: {
            vault,
            fileManager: {
                renameFile: vi.fn(async (file: TFile, target: string) => {
                    const content = contents.get(file.path) ?? "";
                    contents.delete(file.path);
                    files.delete(file.path);
                    updateFilePath(file, target);
                    contents.set(target, content);
                    files.set(target, file);
                })
            }
        },
        settings,
        componentsReady: Promise.resolve(),
        folderAndFilenameManagement: {
            determineAssetDestination: vi.fn(async () => ({
                destinationPath: "Assets",
                newFilename: "Drawing.drawio.svg"
            })),
            ensureFolderExists: vi.fn(async () => undefined)
        }
    };
    return fixture;
}

function updateFilePath(file: TFile, path: string): void {
    const name = path.split("/").at(-1)!;
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const parent = new TFolder();
    parent.path = parentPath;
    parent.name = parentPath.split("/").at(-1) ?? "";
    file.path = path;
    file.name = name;
    file.extension = name.split(".").at(-1)!;
    file.basename = name.slice(0, -(file.extension.length + 1));
    file.parent = parent;
}
