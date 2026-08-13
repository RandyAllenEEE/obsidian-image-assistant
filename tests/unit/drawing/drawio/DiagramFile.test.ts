import { TFile } from "obsidian";
import {
    areDrawioModelsEquivalent,
    assertValidDiagramXml,
    assertValidDrawioSvg,
    extractDrawioModelFromSvg,
    assertUncompressedDiagramXml,
    buildCompoundFilename,
    decodeDrawioDataUri,
    EMPTY_DRAWIO_SVG,
    EMPTY_DRAWIO_XML,
    getDrawioDiagramSuffix,
    isDrawioDiagramFile,
    isDrawioDiagramPath,
    stripDrawioDiagramSuffix
} from "../../../../src/drawing/drawio/DiagramFile";

describe("DiagramFile", () => {
    it("treats .drawio.svg as an indivisible compound suffix", () => {
        expect(buildCompoundFilename("Drawing", 1)).toBe("Drawing-1.drawio.svg");
        expect(buildCompoundFilename("Architecture.drawio.svg", 2)).toBe("Architecture-2.drawio.svg");
        expect(isDrawioDiagramPath("Assets/Architecture.DRAWIO.SVG")).toBe(true);
        expect(isDrawioDiagramPath("Assets/legacy.drawio")).toBe(true);
        expect(isDrawioDiagramPath("Assets/plain.svg")).toBe(false);
    });

    it("recognizes TFiles without claiming ordinary SVG files", () => {
        const file = new TFile();
        file.path = "Assets/model.drawio.svg";
        expect(isDrawioDiagramFile(file)).toBe(true);
        expect(getDrawioDiagramSuffix(file)).toBe(".drawio.svg");
        expect(stripDrawioDiagramSuffix("model.drawio.svg")).toBe("model");
        file.path = "Assets/model.svg";
        expect(isDrawioDiagramFile(file)).toBe(false);
        expect(getDrawioDiagramSuffix(file)).toBeNull();
    });

    it("validates the empty editable template and rejects plain SVG", () => {
        expect(() => assertValidDrawioSvg(EMPTY_DRAWIO_SVG)).not.toThrow();
        expect(extractDrawioModelFromSvg(EMPTY_DRAWIO_SVG)).toBe(EMPTY_DRAWIO_XML);
        expect(() => assertValidDrawioSvg('<svg xmlns="http://www.w3.org/2000/svg"/>'))
            .toThrow(/editable Draw\.io model/i);
    });

    it("decodes Unicode percent and base64 xmlsvg data URIs", () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" content="&lt;mxGraphModel&gt;你好&lt;/mxGraphModel&gt;"/>';
        const percent = `data:image/svg+xml,${encodeURIComponent(svg)}`;
        const bytes = new TextEncoder().encode(svg);
        const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join("");
        const base64 = `data:image/svg+xml;base64,${btoa(binary)}`;
        expect(decodeDrawioDataUri(percent)).toBe(svg);
        expect(decodeDrawioDataUri(base64)).toBe(svg);
    });

    it("rejects malformed diagram XML", () => {
        expect(() => assertValidDiagramXml("<mxfile>"))
            .toThrow(/does not contain|malformed/i);
    });

    it("accepts legacy compressed mxfile data but distinguishes it from AI-editable XML", () => {
        const compressed = '<mxfile><diagram id="page">7V1bc+I4FP41PCYjP8aX</diagram></mxfile>';
        expect(() => assertValidDiagramXml(compressed)).not.toThrow();
        expect(() => assertUncompressedDiagramXml(compressed)).toThrow(/compressed XML/);
    });

    it("compares uncompressed models without layout viewport noise", () => {
        const changedViewport = EMPTY_DRAWIO_XML.replace('dx="1200" dy="800"', 'dy="20" dx="10"');
        expect(areDrawioModelsEquivalent(EMPTY_DRAWIO_XML, changedViewport)).toBe(true);
        expect(areDrawioModelsEquivalent(
            EMPTY_DRAWIO_XML,
            EMPTY_DRAWIO_XML.replace('id="1"', 'id="different"')
        )).toBe(false);
        expect(areDrawioModelsEquivalent(
            '<mxGraphModel dx="1"><root><mxCell id="0"/></root></mxGraphModel>',
            '<mxfile><diagram id="generated" name="Page-1"><mxGraphModel dx="2"><root><mxCell id="0"/></root></mxGraphModel></diagram></mxfile>'
        )).toBe(true);
        expect(areDrawioModelsEquivalent(
            '<mxfile><diagram>compressed</diagram></mxfile>',
            EMPTY_DRAWIO_XML
        )).toBeNull();
    });
});
