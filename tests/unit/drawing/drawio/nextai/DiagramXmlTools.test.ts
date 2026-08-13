import {
    applyDiagramOperations,
    createDiagramFromCells,
    getDiagramPageContext,
    isCompleteCellFragment,
    validateDiagramStructure
} from "../../../../../src/drawing/drawio/nextai/DiagramXmlTools";

const vertex = (id: string, parent = "1") =>
    `<mxCell id="${id}" value="${id}" vertex="1" parent="${parent}"><mxGeometry x="0" y="0" width="80" height="40" as="geometry"/></mxCell>`;

describe("DiagramXmlTools", () => {
    it("applies add and update as one validated transaction", () => {
        const current = createDiagramFromCells(vertex("2"));
        const result = applyDiagramOperations(current, [
            { operation: "update", cell_id: "2", new_xml: vertex("2").replace('value="2"', 'value="updated"') },
            { operation: "add", cell_id: "3", new_xml: vertex("3") }
        ]);
        expect(result).toContain('value="updated"');
        expect(result).toContain('id="3"');
    });

    it("cascades container deletion through children and connected edges", () => {
        const cells = [
            vertex("container"),
            vertex("child", "container"),
            vertex("other"),
            '<mxCell id="edge" edge="1" parent="1" source="child" target="other"><mxGeometry relative="1" as="geometry"/></mxCell>'
        ].join("");
        const result = applyDiagramOperations(createDiagramFromCells(cells), [
            { operation: "delete", cell_id: "container" }
        ]);
        expect(result).not.toContain('id="container"');
        expect(result).not.toContain('id="child"');
        expect(result).not.toContain('id="edge"');
        expect(result).toContain('id="other"');
    });

    it("rejects the full batch without mutating input when any operation is invalid", () => {
        const current = createDiagramFromCells(vertex("2"));
        expect(() => applyDiagramOperations(current, [
            { operation: "update", cell_id: "2", new_xml: vertex("2").replace('value="2"', 'value="changed"') },
            { operation: "add", cell_id: "missing", new_xml: vertex("different") }
        ])).toThrow(/must match/);
        expect(current).toContain('value="2"');
        expect(current).not.toContain("changed");
    });

    it("detects incomplete continuations and invalid references", () => {
        expect(isCompleteCellFragment(vertex("2"))).toBe(true);
        expect(isCompleteCellFragment('<mxCell id="2"')).toBe(false);
        expect(() => createDiagramFromCells(vertex("2", "missing"))).toThrow(/invalid parent/);
        expect(() => createDiagramFromCells(vertex("2") + vertex("2"))).toThrow(/Duplicate/);
    });

    it("edits only the active page while allowing repeated root cell IDs", () => {
        const pageOne = createDiagramFromCells(vertex("page-one"));
        const pageTwo = createDiagramFromCells(vertex("page-two"));
        const modelOne = new DOMParser().parseFromString(pageOne, "application/xml")
            .querySelector("mxGraphModel")!;
        const modelTwo = new DOMParser().parseFromString(pageTwo, "application/xml")
            .querySelector("mxGraphModel")!;
        const multiPage = `<mxfile><diagram id="first" name="Overview">${new XMLSerializer().serializeToString(modelOne)}</diagram><diagram id="second" name="Details">${new XMLSerializer().serializeToString(modelTwo)}</diagram></mxfile>`;

        const result = applyDiagramOperations(multiPage, [{
            operation: "update",
            cell_id: "page-two",
            new_xml: vertex("page-two").replace('value="page-two"', 'value="updated"')
        }], 1);

        expect(result).toContain('id="page-one" value="page-one"');
        expect(result).toContain('id="page-two" value="updated"');
        expect(getDiagramPageContext(result, 1)).toEqual({
            index: 1,
            pageCount: 2,
            id: "second",
            name: "Details"
        });
        expect(() => applyDiagramOperations(result, [{
            operation: "delete",
            cell_id: "page-two"
        }], 2)).toThrow(/unavailable/);
    });

    it("rejects duplicate page IDs without treating root IDs across pages as duplicates", () => {
        const model = '<mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>';
        expect(() => validateDiagramStructure(
            `<mxfile><diagram id="same">${model}</diagram><diagram id="same">${model}</diagram></mxfile>`
        )).toThrow(/Duplicate diagram page id/);
        expect(() => validateDiagramStructure(
            `<mxfile><diagram id="one">${model}</diagram><diagram id="two">${model}</diagram></mxfile>`
        )).not.toThrow();
    });
});
