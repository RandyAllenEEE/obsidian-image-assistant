import { describe, expect, it } from "vitest";
import { ImageMatchFinder } from "../../../../src/ui/contextMenu/utils/ImageMatchFinder";

function editor(lines: string[]) {
    return {
        lineCount: () => lines.length,
        getLine: (line: number) => lines[line] ?? ""
    } as any;
}

describe("ImageMatchFinder", () => {
    it("returns every exact HTML Base64 occurrence with its source range", () => {
        const src = "data:image/png;base64,AAAA";
        const first = `<img alt="first" src="${src}">`;
        const second = `<img src='${src}' width="20">`;
        const finder = new ImageMatchFinder();

        expect(finder.findBase64ImageMatches(editor([
            `before ${first}`,
            second
        ]), src)).toEqual([
            {
                lineNumber: 0,
                line: `before ${first}`,
                fullMatch: first,
                index: 7
            },
            {
                lineNumber: 1,
                line: second,
                fullMatch: second,
                index: 0
            }
        ]);
    });

    it("does not match Markdown data links or a different Base64 payload", () => {
        const finder = new ImageMatchFinder();
        expect(finder.findBase64ImageMatches(editor([
            "![inline](data:image/png;base64,AAAA)",
            '<img src="data:image/png;base64,BBBB">'
        ]), "data:image/png;base64,AAAA")).toEqual([]);
    });
});
