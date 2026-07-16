import { describe, it, expect } from "vitest";
import { ImageLinkPathReplacer } from "../../../src/utils/ImageLinkPathReplacer";

describe("ImageLinkPathReplacer", () => {
    it("keeps wiki link and pipe attrs when replacing to cloud url", () => {
        const original = "![[assets/cat.png|My Alt|left|300x200]]";
        const replaced = ImageLinkPathReplacer.replacePath(original, "https://cdn.example.com/cat.webp");
        expect(replaced).toBe("![[https://cdn.example.com/cat.webp|My Alt|left|300x200]]");
    });

    it("keeps markdown link and alt pipe attrs when replacing to local path", () => {
        const original = "![caption|right|200](https://example.com/a.png)";
        const replaced = ImageLinkPathReplacer.replacePath(original, "attachments/a local.webp");
        expect(replaced).toBe("![caption|right|200](<attachments/a local.webp>)");
    });

    it("preserves markdown title segment", () => {
        const original = '![img](https://old.site/img.png "demo title")';
        const replaced = ImageLinkPathReplacer.replacePath(original, "assets/new.png");
        expect(replaced).toBe('![img](assets/new.png "demo title")');
    });

    it("supports replacing from markdown wrapped url string", () => {
        const original = "![[old/path.png|alt]]";
        const wrapped = "![x](https://host/new.png)";
        const replaced = ImageLinkPathReplacer.replacePath(original, wrapped);
        expect(replaced).toBe("![[https://host/new.png|alt]]");
    });

    it("replaces an ordinary Markdown file link while preserving its label", () => {
        const original = "[link](https://example.com)";
        const replaced = ImageLinkPathReplacer.replacePath(original, "assets/a.png");
        expect(replaced).toBe("[link](assets/a.png)");
    });

    it("replaces an ordinary WikiLink while preserving aliases and escaped pipes", () => {
        const original = "[[old/path.png|Open image|source]]";
        const replaced = ImageLinkPathReplacer.replacePath(original, "assets/new|photo.png");
        expect(replaced).toBe("[[assets/new\\|photo.png|Open image|source]]");
    });

    it("preserves titles and angle wrapping in ordinary Markdown links", () => {
        const original = '[source](<old photo.png> "original")';
        const replaced = ImageLinkPathReplacer.replacePath(original, "assets/new photo.webp");
        expect(replaced).toBe('[source](<assets/new photo.webp> "original")');
    });

    it("wiki: escapes literal pipes in newPath to avoid double-pipe corruption", () => {
        // newPath contains a literal pipe character — it must be escaped so the
        // rebuild doesn't interpret it as an attribute separator.
        const original = "![[old.png|alt|300]]";
        const replaced = ImageLinkPathReplacer.replacePath(original, "remote|img");
        expect(replaced).toBe("![[remote\\|img|alt|300]]");
    });

    it("wiki: escapes literal pipes even when the original link has no attrs", () => {
        const original = "![[old.png]]";
        const replaced = ImageLinkPathReplacer.replacePath(original, "remote|img.png");
        expect(replaced).toBe("![[remote\\|img.png]]");
    });

    it("wiki: preserves pipe attrs even when newPath has no pipe", () => {
        const original = "![[img.png|center|400x300]]";
        const replaced = ImageLinkPathReplacer.replacePath(original, "new.jpg");
        expect(replaced).toBe("![[new.jpg|center|400x300]]");
    });

    it("markdown: wraps parentheses in angle brackets so the destination stays valid", () => {
        const original = "![alt](https://old.com/old.png)";
        const replaced = ImageLinkPathReplacer.replacePath(original, "file(1).png");
        expect(replaced).toBe("![alt](<file(1).png>)");
    });

    it("markdown: preserves angle-wrapped paths with spaces and title suffixes", () => {
        const original = '![alt](<https://old.test/a photo.png> "demo title")';
        const replaced = ImageLinkPathReplacer.replacePath(original, "assets/new photo.png");
        expect(replaced).toBe('![alt](<assets/new photo.png> "demo title")');
    });

    it("extractPureUrlFromPossibleMarkdown: strips angle brackets around URL", () => {
        const wrapped = "![x](<https://a.com/b.png>)";
        const extracted = (ImageLinkPathReplacer as any).extractPureUrlFromPossibleMarkdown(wrapped);
        expect(extracted).toBe("https://a.com/b.png");
    });

    it("extractPureUrlFromPossibleMarkdown: keeps spaces inside angle-wrapped paths and drops title", () => {
        const wrapped = '![x](<assets/my photo.png> "demo")';
        const extracted = (ImageLinkPathReplacer as any).extractPureUrlFromPossibleMarkdown(wrapped);
        expect(extracted).toBe("assets/my photo.png");
    });

    it("replaceUrlInLinks: replaces angle-wrapped markdown URL paths without dropping titles", () => {
        const content = 'before ![alt](<https://old.test/a photo.png> "demo") after';
        const replaced = ImageLinkPathReplacer.replaceUrlInLinks(
            content,
            "https://old.test/a photo.png",
            "assets/new photo.png"
        );
        expect(replaced).toBe('before ![alt](<assets/new photo.png> "demo") after');
    });

    it("replaceUrlInLinks: replaces repeated identical links from end to start", () => {
        const source = "![alt](https://old.test/photo.png)";
        const content = `${source} and ${source}`;

        const replaced = ImageLinkPathReplacer.replaceUrlInLinks(
            content,
            "https://old.test/photo.png",
            "assets/photo.png"
        );

        expect(replaced).toBe("![alt](assets/photo.png) and ![alt](assets/photo.png)");
    });

    it("replaceUrlInLinks: replaces plain markdown URLs that contain parentheses", () => {
        const content = "![alt](https://old.test/photo(1).png)";

        const replaced = ImageLinkPathReplacer.replaceUrlInLinks(
            content,
            "https://old.test/photo(1).png",
            "assets/photo(1).png"
        );

        expect(replaced).toBe("![alt](<assets/photo(1).png>)");
    });

    it("replaceUrlInLinks: updates rendered Admonition content but leaves literal contexts intact", () => {
        const url = "https://old.test/photo.png";
        const content = [
            '```ad-note',
            `![[${url}|Caption|300]]`,
            '```',
            '```markdown',
            `![[${url}|Code]]`,
            '```',
            `<!-- ![[${url}|Comment]] -->`
        ].join('\n');

        expect(ImageLinkPathReplacer.replaceUrlInLinks(content, url, 'assets/photo.png')).toBe([
            '```ad-note',
            '![[assets/photo.png|Caption|300]]',
            '```',
            '```markdown',
            `![[${url}|Code]]`,
            '```',
            `<!-- ![[${url}|Comment]] -->`
        ].join('\n'));
    });
});

