import { TFile } from "obsidian";
import { EMPTY_DRAWIO_SVG } from "../../../../src/drawing/drawio/DiagramFile";
import { DrawioEditorView } from "../../../../src/drawing/drawio/DrawioEditorView";

vi.mock("../../../../src/drawing/DrawingConfirmModal", () => ({
    confirmDrawingAction: vi.fn(async () => true)
}));

const RAW_XML = '<mxfile><diagram><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>';
const RAW_XML_2 = RAW_XML.replace('<mxCell id="1"', '<mxCell id="2"');
const SVG_2 = EMPTY_DRAWIO_SVG.replace('width="100px"', 'width="101px"');

describe("DrawioEditorView atomic saves", () => {
    it("retries sequential exports when the canvas revision changes between XML and xmlsvg", async () => {
        const { view, files, port } = makeView();
        const order: string[] = [];
        let exportCount = 0;
        port.export.mockImplementation(async (format: string) => {
            order.push(format);
            exportCount++;
            if (exportCount === 1) return result(RAW_XML);
            if (exportCount === 2) {
                (view as any).revision = 2;
                (view as any).latestRawXml = RAW_XML_2;
                (view as any).latestRawXmlRevision = 2;
                return result(EMPTY_DRAWIO_SVG);
            }
            return format === "xml" ? result(RAW_XML_2) : result(SVG_2);
        });
        files.save.mockResolvedValue({
            file: view.file,
            baseline: SVG_2,
            migrated: false
        });

        await view.flush();

        expect(order).toEqual(["xml", "xmlsvg", "xml", "xmlsvg"]);
        expect(files.save).toHaveBeenCalledOnce();
        expect(files.save).toHaveBeenCalledWith(view.file, EMPTY_DRAWIO_SVG, RAW_XML_2, SVG_2);
        expect((view as any).savedRevision).toBe(2);
    });

    it("creates a raw recovery when the first xmlsvg export fails during close", async () => {
        const { view, files, port } = makeView();
        port.export.mockImplementation(async (format: string) => {
            if (format === "xml") return result(RAW_XML);
            throw new Error("xmlsvg unavailable");
        });
        const recovery = makeFile("Assets/Drawing-recovery.drawio");
        files.saveRecoveryCopy.mockResolvedValue(recovery);

        const first = view.prepareForDetach();
        const second = view.prepareForDetach();
        await Promise.all([first, second]);

        expect(files.save).not.toHaveBeenCalled();
        expect(files.saveRecoveryCopy).toHaveBeenCalledOnce();
        expect(files.saveRecoveryCopy).toHaveBeenCalledWith(view.file, RAW_XML, "");
    });

    it("keeps close preparation pending until an in-flight save is committed", async () => {
        const { view, files, port } = makeView();
        let finishSave!: (value: unknown) => void;
        const pendingSave = new Promise(resolve => { finishSave = resolve; });
        port.export.mockImplementation(async (format: string) =>
            format === "xml" ? result(RAW_XML) : result(EMPTY_DRAWIO_SVG));
        files.save.mockReturnValue(pendingSave);

        let prepared = false;
        const preparation = view.prepareForDetach().then(() => { prepared = true; });
        await vi.waitFor(() => expect(files.save).toHaveBeenCalledOnce());
        expect(prepared).toBe(false);

        finishSave({ file: view.file, baseline: EMPTY_DRAWIO_SVG, migrated: false });
        await preparation;
        expect(prepared).toBe(true);
        expect(files.saveRecoveryCopy).not.toHaveBeenCalled();
    });

    it("passes both stable formats to confirmed conflict overwrite and accepts migration", async () => {
        const { view, files, port } = makeView("Assets/Legacy.drawio");
        (view as any).conflicted = true;
        port.export.mockImplementation(async (format: string) =>
            format === "xml" ? result(RAW_XML) : result(EMPTY_DRAWIO_SVG));
        files.overwrite.mockResolvedValue({
            file: view.file,
            baseline: EMPTY_DRAWIO_SVG,
            migrated: true
        });

        await (view as any).overwriteExternal();

        expect(files.overwrite).toHaveBeenCalledWith(view.file, RAW_XML, EMPTY_DRAWIO_SVG);
        expect((view as any).conflicted).toBe(false);
        expect((view as any).savedRevision).toBe(1);
    });
});

function makeView(path = "Assets/Drawing.drawio.svg") {
    const files = {
        save: vi.fn(),
        overwrite: vi.fn(),
        saveCopy: vi.fn(),
        saveRecoveryCopy: vi.fn()
    };
    const port = {
        export: vi.fn(),
        getViewMetadata: vi.fn(() => ({ currentPage: null, bounds: null, scale: null })),
        onDirty: vi.fn(() => () => undefined),
        destroy: vi.fn()
    };
    const plugin = {
        app: {},
        settings: {
            drawing: { provider: "drawio", drawio: { nextAi: { enabled: false } } }
        },
        imageResourceRefreshService: { refreshFile: vi.fn(async () => undefined) }
    };
    const view = new DrawioEditorView(
        {} as any,
        plugin as any,
        {} as any,
        files as any,
        {} as any,
        {} as any
    );
    view.file = makeFile(path);
    (view as any).port = port;
    (view as any).baseline = path.endsWith(".svg") ? EMPTY_DRAWIO_SVG : RAW_XML;
    (view as any).revision = 1;
    (view as any).savedRevision = 0;
    (view as any).latestRawXml = RAW_XML;
    (view as any).latestRawXmlRevision = 1;
    return { view, files, port };
}

function makeFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split("/").at(-1)!;
    file.extension = file.name.split(".").at(-1)!;
    file.basename = file.name.slice(0, -(file.extension.length + 1));
    return file;
}

function result(data: string) {
    return {
        data,
        metadata: { currentPage: null, bounds: null, scale: null }
    };
}
