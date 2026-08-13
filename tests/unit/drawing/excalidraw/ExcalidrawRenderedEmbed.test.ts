import { describe, expect, it } from "vitest";
import {
    collectExcalidrawRenderedEmbeds,
    findExcalidrawRenderedEmbed,
    getExcalidrawRenderedAlignment
} from "../../../../src/drawing/excalidraw/ExcalidrawRenderedEmbed";

function createNativeRender(viewClass = "markdown-preview-view") {
    const view = document.createElement("div");
    view.className = viewClass;
    const wrapper = view.appendChild(document.createElement("div"));
    wrapper.className = "excalidraw-svg";
    const rendered = wrapper.appendChild(document.createElement("div"));
    rendered.className = "excalidraw-svg excalidraw-embedded-img";
    rendered.setAttribute("fileSource", "Drawings/Flow.excalidraw.md#^area");
    const svg = rendered.appendChild(document.createElementNS(
        "http://www.w3.org/2000/svg",
        "svg"
    ));
    svg.classList.add("excalidraw-svg");
    const path = svg.appendChild(document.createElementNS(
        "http://www.w3.org/2000/svg",
        "path"
    ));
    document.body.appendChild(view);
    return { path, rendered, svg, view, wrapper };
}

describe("ExcalidrawRenderedEmbed", () => {
    it("resolves a path inside the real inline SVG through the upstream fileSource owner", () => {
        const fixture = createNativeRender();
        const resolved = findExcalidrawRenderedEmbed(fixture.path);

        expect(resolved).toMatchObject({
            element: fixture.rendered,
            svg: fixture.svg,
            fileSource: "Drawings/Flow.excalidraw.md#^area"
        });
        expect(collectExcalidrawRenderedEmbeds(fixture.view)).toHaveLength(1);
        fixture.view.remove();
    });

    it("recognizes the upstream SVGIMG and PNG preview modes through the same contract", () => {
        const view = document.body.appendChild(document.createElement("div"));
        view.className = "markdown-source-view";
        const image = view.appendChild(document.createElement("img"));
        image.className = "excalidraw-svg excalidraw-embedded-img";
        image.setAttribute("fileSource", "Drawings/Flow.excalidraw.md");

        const resolved = findExcalidrawRenderedEmbed(image);

        expect(resolved).toMatchObject({
            element: image,
            image,
            svg: null,
            fileSource: "Drawings/Flow.excalidraw.md"
        });
        expect(collectExcalidrawRenderedEmbeds(view)).toHaveLength(1);
        view.remove();
    });

    it("recognizes a stable marker that is itself the rendered SVG", () => {
        const view = document.body.appendChild(document.createElement("div"));
        view.className = "markdown-preview-view";
        const svg = view.appendChild(document.createElementNS(
            "http://www.w3.org/2000/svg",
            "svg"
        ));
        svg.classList.add("excalidraw-svg", "excalidraw-embedded-img");
        svg.setAttribute("fileSource", "Drawings/Flow.excalidraw.md");

        expect(findExcalidrawRenderedEmbed(svg)).toMatchObject({
            element: svg,
            image: null,
            svg,
            fileSource: "Drawings/Flow.excalidraw.md"
        });
        view.remove();
    });

    it("rejects an Excalidraw editor canvas even when a forged fileSource is present", () => {
        const fixture = createNativeRender("excalidraw-wrapper");
        expect(findExcalidrawRenderedEmbed(fixture.path)).toBeNull();
        fixture.view.remove();
    });

    it.each([
        ["excalidraw-svg-left-wrap", "left-wrap"],
        ["excalidraw-svg-right-wrap", "right-wrap"],
        ["excalidraw-svg-left", "left"],
        ["excalidraw-svg-center", "center"],
        ["excalidraw-svg-right", "right"]
    ] as const)("reads the upstream %s alignment class", (className, expected) => {
        const fixture = createNativeRender();
        fixture.rendered.classList.add(className);
        expect(getExcalidrawRenderedAlignment(fixture.rendered)).toBe(expected);
        fixture.view.remove();
    });
});
