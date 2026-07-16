import { describe, expect, it } from "vitest";
import { getAllImageLinks, getAllReferenceLinks } from "../../../src/utils/RegexPatterns";

describe("RegexPatterns getAllImageLinks", () => {
    it("extracts angle-wrapped Markdown image destinations with spaces and title text", () => {
        const source = '![alt text](<https://example.com/my photo.png> "demo title")';

        const links = getAllImageLinks(`before ${source} after`);

        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({
            path: "https://example.com/my photo.png",
            name: "alt text",
            source,
            index: 7,
        });
    });

    it("extracts plain Markdown image destinations and strips title text", () => {
        const source = '![alt](https://example.com/photo.png "demo title")';

        const links = getAllImageLinks(source);

        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({
            path: "https://example.com/photo.png",
            name: "alt",
            source,
            index: 0,
        });
    });

    it("keeps distinct indexes for repeated identical Markdown links", () => {
        const source = "![alt](https://example.com/photo.png)";
        const text = `${source} and ${source}`;

        const links = getAllImageLinks(text);

        expect(links).toHaveLength(2);
        expect(links.map((link) => link.index)).toEqual([0, text.lastIndexOf(source)]);
    });

    it("extracts plain Markdown image destinations that contain parentheses", () => {
        const source = "![alt](https://example.com/photo(1).png)";

        const links = getAllImageLinks(source);

        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({
            path: "https://example.com/photo(1).png",
            name: "alt",
            source,
            index: 0,
        });
    });

    it("extracts parenthesized local paths and strips title text", () => {
        const source = '![alt](assets/photo(edited).png "demo")';

        const links = getAllImageLinks(source);

        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({
            path: "assets/photo(edited).png",
            name: "alt",
            source,
            index: 0,
        });
    });

    it("extracts wiki image paths with escaped literal pipes", () => {
        const source = "![[remote\\|img.png|300]]";

        const links = getAllImageLinks(source);

        expect(links).toHaveLength(1);
        expect(links[0]).toMatchObject({
            path: "remote|img.png",
            name: "remote|img.png",
            source,
            index: 0,
        });
    });
});

describe("RegexPatterns getAllReferenceLinks", () => {
    it("extracts embedded and ordinary Markdown/Wiki references without losing syntax metadata", () => {
        const markdown = '[source](<assets/my photo.png> "original")';
        const wiki = "[[assets/my photo.png|Open source]]";
        const embed = "![[assets/my photo.png|300]]";
        const content = `${markdown} ${wiki} ${embed}`;

        const links = getAllReferenceLinks(content);

        expect(links).toHaveLength(3);
        expect(links[0]).toMatchObject({
            source: markdown,
            path: "assets/my photo.png",
            embedded: false,
            syntax: "markdown",
            index: 0
        });
        expect(links[1]).toMatchObject({
            source: wiki,
            path: "assets/my photo.png",
            embedded: false,
            syntax: "wiki"
        });
        expect(links[2]).toMatchObject({
            source: embed,
            path: "assets/my photo.png",
            embedded: true,
            syntax: "wiki"
        });
    });

    it("keeps the image-only parser restricted to embeds", () => {
        const content = "[source](assets/photo.png) [[assets/photo.png]] ![](assets/photo.png)";

        expect(getAllImageLinks(content).map(link => link.source)).toEqual([
            "![](assets/photo.png)"
        ]);
        expect(getAllReferenceLinks(content)).toHaveLength(3);
    });

    it("extracts standalone URL autolinks without duplicating angle-wrapped destinations", () => {
        const url = "https://example.com/photo.png";
        const content = `<${url}> and [source](<${url}>)`;

        const links = getAllReferenceLinks(content);

        expect(links).toHaveLength(2);
        expect(links[0]).toMatchObject({ source: `<${url}>`, path: url, syntax: "autolink" });
        expect(links[1]).toMatchObject({ source: `[source](<${url}>)`, path: url, syntax: "markdown" });
    });
});
