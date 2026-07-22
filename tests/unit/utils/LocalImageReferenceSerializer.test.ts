import { describe, expect, it, vi } from "vitest";
import type { LocalLinkSettings } from "../../../src/settings/types";
import {
    LocalImageReferenceSerializationError,
    LocalImageReferenceSerializer,
    parseImageReferenceSyntax
} from "../../../src/utils/LocalImageReferenceSerializer";
import { fakeApp, fakeMetadataCache, fakeTFile, fakeVault } from "../../factories/obsidian";

const settings = (overrides: Partial<LocalLinkSettings>): LocalLinkSettings => ({
    linkFormat: "wikilink",
    pathFormat: "shortest",
    prependCurrentDir: false,
    ...overrides
});

function makeHarness(targetPath = "assets/photo.png") {
    const source = fakeTFile({ path: "notes/current.md" });
    const target = fakeTFile({ path: targetPath });
    const metadataCache = fakeMetadataCache() as any;
    metadataCache.fileToLinktext = vi.fn(() => null);
    const app = fakeApp({
        vault: fakeVault({ files: [source, target] }),
        metadataCache
    }) as any;
    return { app, source, target, metadataCache, serializer: new LocalImageReferenceSerializer(app) };
}

describe("LocalImageReferenceSerializer", () => {
    it("encodes reserved Markdown path characters and preserves arbitrary pipe order", () => {
        const fixture = makeHarness("20 领域/图像 #?%20(1).png");
        const output = fixture.serializer.serialize({
            sourceFile: fixture.source,
            target: fixture.target,
            settings: settings({ linkFormat: "markdown", pathFormat: "absolute" }),
            originalLink: "![800|center|GFL caption](https://cdn.example/gfl)"
        });

        expect(output).toBe(
            "![800|center|GFL caption](/20%20%E9%A2%86%E5%9F%9F/"
            + "%E5%9B%BE%E5%83%8F%20%23%3F%2520%281%29.png)"
        );
        expect(parseImageReferenceSyntax(output)?.path).toContain("%20");
    });

    it("keeps Wiki paths readable and only prepends ./ for non-parent relative paths", () => {
        const child = makeHarness("notes/assets/图片 one.png");
        expect(child.serializer.serialize({
            sourceFile: child.source,
            target: child.target,
            settings: settings({ pathFormat: "relative", prependCurrentDir: true }),
            originalLink: "![[https://cdn.example/image|300|right|Caption]]"
        })).toBe("![[./assets/图片 one.png|300|right|Caption]]");

        const parent = makeHarness("assets/图片 one.png");
        expect(parent.serializer.serialize({
            sourceFile: parent.source,
            target: parent.target,
            settings: settings({ pathFormat: "relative", prependCurrentDir: true }),
            originalLink: "![[https://cdn.example/image|Caption]]"
        })).toBe("![[../assets/图片 one.png|Caption]]");
    });

    it("retains Markdown when a quoted title cannot be represented by Wiki syntax", () => {
        const fixture = makeHarness("assets/My Photo.png");
        const output = fixture.serializer.serialize({
            sourceFile: fixture.source,
            target: fixture.target,
            settings: settings({ pathFormat: "absolute" }),
            originalLink: '![Caption|left|320](https://cdn.example/image "Original title")'
        });

        expect(output).toBe('![Caption|left|320](/assets/My%20Photo.png "Original title")');
    });

    it("preserves pipe order, escaped pipes, and an explicit empty caption", () => {
        const fixture = makeHarness("assets/photo.png");
        expect(fixture.serializer.serialize({
            sourceFile: fixture.source,
            target: fixture.target,
            settings: settings({ linkFormat: "markdown", pathFormat: "absolute" }),
            originalLink: "![[https://cdn.example/image|300|right|Caption\\|part]]"
        })).toBe("![300|right|Caption\\|part](/assets/photo.png)");

        expect(fixture.serializer.serialize({
            sourceFile: fixture.source,
            target: fixture.target,
            settings: settings({}),
            originalLink: "![[https://cdn.example/image|]]"
        })).toBe("![[assets/photo.png|]]");
    });

    it("uses enough shortest-path context to resolve duplicate basenames", () => {
        const fixture = makeHarness("assets/photo.png");
        const duplicate = fakeTFile({ path: "archive/photo.png" });
        const files = [fixture.source, fixture.target, duplicate];
        (fixture.app.vault.getFiles as any).mockReturnValue(files);
        (fixture.app.vault.getAbstractFileByPath as any).mockImplementation(
            (path: string) => files.find(file => file.path === path) ?? null
        );

        expect(fixture.serializer.serialize({
            sourceFile: fixture.source,
            target: fixture.target,
            settings: settings({}),
            originalLink: "![[https://cdn.example/image|Caption]]"
        })).toBe("![[assets/photo.png|Caption]]");
    });

    it("fails closed when a stale metadata link text resolves ambiguously", () => {
        const fixture = makeHarness("assets/photo.png");
        const duplicate = fakeTFile({ path: "archive/photo.png" });
        const files = [fixture.source, fixture.target, duplicate];
        (fixture.app.vault.getFiles as any).mockReturnValue(files);
        (fixture.app.vault.getAbstractFileByPath as any).mockImplementation(
            (path: string) => files.find(file => file.path === path) ?? null
        );
        fixture.metadataCache.fileToLinktext.mockReturnValue("photo.png");

        expect(() => fixture.serializer.serialize({
            sourceFile: fixture.source,
            target: fixture.target,
            settings: settings({}),
            originalLink: "![[https://cdn.example/image]]"
        })).toThrow(LocalImageReferenceSerializationError);
    });
});
