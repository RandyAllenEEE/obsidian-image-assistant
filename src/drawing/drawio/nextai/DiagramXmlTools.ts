import { assertValidDiagramXml } from "../DiagramFile";

export interface DiagramOperation {
    readonly operation: "add" | "update" | "delete";
    readonly cell_id: string;
    readonly new_xml?: string;
}

export interface DiagramPageContext {
    readonly index: number;
    readonly pageCount: number;
    readonly id: string;
    readonly name: string;
}

export function createDiagramFromCells(fragment: string): string {
    const cells = parseCellFragment(fragment);
    validateIncomingCells(cells, new Set(["0", "1"]));
    const document = new DOMParser().parseFromString(
        '<mxfile host="Image Assistant"><diagram id="image-assistant-ai" name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>',
        "application/xml"
    );
    const root = document.querySelector("root");
    if (!root) throw new Error("Unable to create diagram root.");
    for (const cell of cells) root.appendChild(document.importNode(cell, true));
    const result = new XMLSerializer().serializeToString(document);
    validateDiagramStructure(result);
    return result;
}

export function applyDiagramOperations(
    currentXml: string,
    operations: readonly DiagramOperation[],
    currentPage = 0
): string {
    if (!Array.isArray(operations) || operations.length === 0) {
        throw new Error("edit_diagram requires at least one operation.");
    }
    if (operations.length > 1_000) throw new Error("Too many diagram operations.");
    const document = parseDiagram(currentXml);
    const root = requireRoot(document, currentPage);

    for (const operation of operations) {
        const id = operation.cell_id?.trim();
        if (!id) throw new Error("Diagram operation has an empty cell_id.");
        if (id === "0" || id === "1") throw new Error(`Root cell ${id} cannot be modified.`);
        const cells = getCellMap(root);
        if (operation.operation === "delete") {
            if (!cells.has(id)) throw new Error(`Cell ${id} does not exist.`);
            const deletion = new Set([id]);
            let changed = true;
            while (changed) {
                changed = false;
                for (const [cellId, cell] of cells) {
                    if (deletion.has(cellId)) continue;
                    const related = ["parent", "source", "target"]
                        .some(attribute => deletion.has(cell.getAttribute(attribute) ?? ""));
                    if (related) {
                        deletion.add(cellId);
                        changed = true;
                    }
                }
            }
            for (const deletedId of deletion) cells.get(deletedId)?.remove();
            continue;
        }
        if (operation.operation !== "add" && operation.operation !== "update") {
            throw new Error(`Unsupported diagram operation: ${String(operation.operation)}`);
        }
        const incoming = parseSingleCell(operation.new_xml ?? "");
        if (incoming.getAttribute("id") !== id) {
            throw new Error(`new_xml id must match cell_id ${id}.`);
        }
        if (operation.operation === "add") {
            if (cells.has(id)) throw new Error(`Cell ${id} already exists.`);
            root.appendChild(document.importNode(incoming, true));
        } else {
            const existing = cells.get(id);
            if (!existing) throw new Error(`Cell ${id} does not exist.`);
            existing.replaceWith(document.importNode(incoming, true));
        }
    }

    const result = new XMLSerializer().serializeToString(document);
    validateDiagramStructure(result);
    return result;
}

export function getDiagramPageContext(xml: string, currentPage: number | null): DiagramPageContext {
    const document = parseDiagram(xml);
    const models = getModels(document);
    const index = resolvePageIndex(models, currentPage ?? 0);
    const model = models[index];
    const diagram = model.closest("diagram");
    return {
        index,
        pageCount: models.length,
        id: diagram?.getAttribute("id")?.trim() || String(index),
        name: diagram?.getAttribute("name")?.trim() || `Page-${index + 1}`
    };
}

export function isCompleteCellFragment(value: string): boolean {
    try {
        parseCellFragment(value);
        return true;
    } catch {
        return false;
    }
}

export function validateDiagramStructure(xml: string): void {
    assertValidDiagramXml(xml);
    const document = parseDiagram(xml);
    const models = getModels(document);
    const pageIds = new Set<string>();
    for (const [pageIndex, model] of models.entries()) {
        const diagram = model.closest("diagram");
        const pageId = diagram?.getAttribute("id")?.trim();
        if (pageId) {
            if (pageIds.has(pageId)) throw new Error(`Duplicate diagram page id: ${pageId}.`);
            pageIds.add(pageId);
        }
        const root = model.querySelector(":scope > root") ?? model.querySelector("root");
        if (!root) throw new Error(`Diagram page ${pageIndex + 1} has no root element.`);
        const cells = getCellMap(root);
        if (!cells.has("0") || !cells.has("1")) {
            throw new Error(`Diagram page ${pageIndex + 1} requires root cells 0 and 1.`);
        }
        if (cells.get("1")?.getAttribute("parent") !== "0") {
            throw new Error(`Diagram page ${pageIndex + 1} root cell 1 must have parent 0.`);
        }
        for (const [id, cell] of cells) {
            if (id === "0") continue;
            const parent = cell.getAttribute("parent");
            if (!parent || !cells.has(parent)) throw new Error(`Cell ${id} has an invalid parent.`);
            const ancestors = new Set([id]);
            let ancestorId: string | null = parent;
            while (ancestorId && ancestorId !== "0") {
                if (ancestors.has(ancestorId)) throw new Error(`Cell ${id} has a cyclic parent chain.`);
                ancestors.add(ancestorId);
                ancestorId = cells.get(ancestorId)?.getAttribute("parent") ?? null;
            }
            for (const attribute of ["source", "target"] as const) {
                const reference = cell.getAttribute(attribute);
                if (reference && !cells.has(reference)) {
                    throw new Error(`Cell ${id} has an invalid ${attribute} reference.`);
                }
            }
        }
    }
}

function parseDiagram(xml: string): XMLDocument {
    const document = new DOMParser().parseFromString(xml, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("Diagram XML is malformed.");
    if (!document.querySelector("mxGraphModel")) throw new Error("Diagram has no mxGraphModel.");
    return document;
}

function requireRoot(document: XMLDocument, currentPage: number): Element {
    const models = getModels(document);
    const model = models[resolvePageIndex(models, currentPage)];
    const root = model.querySelector(":scope > root") ?? model.querySelector("root");
    if (!root) throw new Error("Diagram has no root element.");
    return root;
}

function getModels(document: XMLDocument): Element[] {
    const models = Array.from(document.querySelectorAll("mxGraphModel"));
    if (models.length === 0 && document.documentElement.localName === "mxGraphModel") {
        models.push(document.documentElement);
    }
    if (models.length === 0) throw new Error("Diagram has no mxGraphModel.");
    return models;
}

function resolvePageIndex(models: readonly Element[], currentPage: number): number {
    if (!Number.isSafeInteger(currentPage) || currentPage < 0 || currentPage >= models.length) {
        throw new Error(`Current Draw.io page ${currentPage + 1} is unavailable.`);
    }
    return currentPage;
}

function getCellMap(scope: ParentNode): Map<string, Element> {
    const map = new Map<string, Element>();
    for (const cell of Array.from(scope.querySelectorAll("mxCell"))) {
        const id = cell.getAttribute("id")?.trim();
        if (!id) throw new Error("Every mxCell must have an id.");
        if (map.has(id)) throw new Error(`Duplicate mxCell id: ${id}.`);
        map.set(id, cell);
    }
    return map;
}

function parseCellFragment(fragment: string): Element[] {
    const document = new DOMParser().parseFromString(`<fragment>${fragment}</fragment>`, "application/xml");
    if (document.querySelector("parsererror")) throw new Error("mxCell fragment is incomplete or malformed.");
    const root = document.documentElement;
    const elements = Array.from(root.children);
    if (elements.length === 0 || elements.some(element => element.tagName !== "mxCell")) {
        throw new Error("Provide only sibling mxCell elements.");
    }
    for (const cell of elements) {
        if (cell.querySelector("mxCell")) throw new Error("mxCell elements cannot be nested.");
    }
    return elements;
}

function parseSingleCell(value: string): Element {
    const cells = parseCellFragment(value);
    if (cells.length !== 1) throw new Error("new_xml must contain exactly one mxCell.");
    return cells[0];
}

function validateIncomingCells(cells: Element[], existing: Set<string>): void {
    const incoming = new Set<string>();
    for (const cell of cells) {
        const id = cell.getAttribute("id")?.trim();
        if (!id) throw new Error("Every mxCell must have an id.");
        if (id === "0" || id === "1") throw new Error("Do not include root cells 0 or 1.");
        if (existing.has(id) || incoming.has(id)) throw new Error(`Duplicate mxCell id: ${id}.`);
        incoming.add(id);
    }
    const available = new Set([...existing, ...incoming]);
    for (const cell of cells) {
        const id = cell.getAttribute("id")!;
        const parent = cell.getAttribute("parent");
        if (!parent || !available.has(parent)) throw new Error(`Cell ${id} has an invalid parent.`);
        for (const attribute of ["source", "target"] as const) {
            const reference = cell.getAttribute(attribute);
            if (reference && !available.has(reference)) {
                throw new Error(`Cell ${id} has an invalid ${attribute} reference.`);
            }
        }
    }
}
