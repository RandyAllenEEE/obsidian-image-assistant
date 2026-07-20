import { describe, expect, it, vi } from "vitest";
import { ImageContextMenuResolver } from "../../../../src/ui/contextMenu/utils/ImageContextMenuResolver";
import {
    fakeApp,
    fakeTFile,
    fakeVault
} from "../../../factories/obsidian";

function makeFixture(options: {
    renderedSrc: string;
    sourceTarget?: string;
    detailedStatus?: "resolved" | "pending" | "absent";
    base64Matches?: any[];
}) {
    const note = fakeTFile({
        path: "notes/current.md",
        extension: "md"
    });
    const local = fakeTFile({
        path: "attachments/My Photo.png",
        extension: "png"
    });
    const app = fakeApp({
        vault: fakeVault({ files: [note, local] })
    }) as any;
    const image = document.createElement("img");
    image.src = options.renderedSrc;
    const source = options.sourceTarget
        ? `![](${options.sourceTarget})`
        : "";
    const editor = { getLine: vi.fn(() => source) };
    const owner = {
        view: { file: note, editor, contentEl: document.body },
        file: note,
        editor
    };
    const descriptor = options.sourceTarget
        ? { path: options.sourceTarget }
        : null;
    const detailed = options.detailedStatus === "resolved"
        ? {
            status: "resolved",
            context: {
                ...owner,
                match: {
                    line: 0,
                    start: 0,
                    end: source.length,
                    linkText: source,
                    descriptor
                }
            }
        }
        : { status: options.detailedStatus ?? "pending" };
    const viewResolver = {
        resolveOwner: vi.fn(() => owner),
        resolveDetailed: vi.fn(() => detailed),
        resolveWithUrlHint: vi.fn(() => detailed),
        isContextCurrent: vi.fn(() => false)
    };
    const imageMatchFinder = {
        findBase64ImageMatches: vi.fn(
            () => options.base64Matches ?? []
        )
    };
    return {
        image,
        local,
        viewResolver,
        resolver: new ImageContextMenuResolver(
            app,
            viewResolver as any,
            imageMatchFinder as any
        )
    };
}

describe("ImageContextMenuResolver", () => {
    it("uses the exact source URL when Obsidian rendered a Blob proxy", () => {
        const fixture = makeFixture({
            renderedSrc: "blob:https://obsidian.local/cache-id",
            sourceTarget: "https://cdn.example.com/image?id=42",
            detailedStatus: "resolved"
        });

        const result = fixture.resolver.resolve(fixture.image);

        expect(result).toMatchObject({
            sourceKind: "url",
            resolution: "resolved",
            url: "https://cdn.example.com/image?id=42",
            localFile: null
        });
    });

    it("resolves encoded vault-root paths against the owner note", () => {
        const fixture = makeFixture({
            renderedSrc: "app://local/attachments/My%20Photo.png",
            sourceTarget: "/attachments/My%20Photo.png",
            detailedStatus: "resolved"
        });

        const result = fixture.resolver.resolve(fixture.image);

        expect(result.sourceKind).toBe("local");
        expect(result.resolution).toBe("resolved");
        expect(result.localFile).toBe(fixture.local);
    });

    it("does not guess a source for an unbound Blob image", () => {
        const fixture = makeFixture({
            renderedSrc: "blob:https://obsidian.local/cache-id",
            detailedStatus: "pending"
        });

        expect(fixture.resolver.resolve(fixture.image)).toMatchObject({
            sourceKind: "blob",
            resolution: "pending",
            localFile: null,
            url: null
        });
    });

    it("uses an official URL hint for safe pending operations", () => {
        const fixture = makeFixture({
            renderedSrc: "blob:https://obsidian.local/cache-id",
            detailedStatus: "pending"
        });
        const initial = fixture.resolver.resolve(fixture.image);

        expect(fixture.resolver.resolveForOfficialMenu(
            fixture.image,
            { kind: "url", url: "https://cdn.example.com/dynamic?id=42" },
            initial
        )).toMatchObject({
            sourceKind: "url",
            resolution: "pending",
            url: "https://cdn.example.com/dynamic?id=42",
            viewContext: null
        });
    });

    it("retains a still-current exact source when refresh is transiently pending", () => {
        const url = "https://cdn.example.com/image?id=42";
        const fixture = makeFixture({
            renderedSrc: "blob:https://obsidian.local/cache-id",
            sourceTarget: url,
            detailedStatus: "resolved"
        });
        const initial = fixture.resolver.resolve(fixture.image);
        fixture.viewResolver.resolveWithUrlHint.mockReturnValue({
            status: "pending"
        });
        fixture.viewResolver.isContextCurrent.mockReturnValue(true);

        expect(fixture.resolver.resolveForOfficialMenu(
            fixture.image,
            { kind: "url", url },
            initial
        )).toBe(initial);
    });

    it("allows Base64 source mutation only for one exact HTML occurrence", () => {
        const src = "data:image/png;base64,AAAA";
        const match = {
            lineNumber: 2,
            line: `<img src="${src}">`,
            fullMatch: `<img src="${src}">`,
            index: 0
        };
        const unique = makeFixture({
            renderedSrc: src,
            detailedStatus: "absent",
            base64Matches: [match]
        });
        expect(unique.resolver.resolve(unique.image)).toMatchObject({
            sourceKind: "data",
            resolution: "resolved",
            dataReference: { match }
        });

        const repeated = makeFixture({
            renderedSrc: src,
            detailedStatus: "absent",
            base64Matches: [match, { ...match, lineNumber: 3 }]
        });
        expect(repeated.resolver.resolve(repeated.image)).toMatchObject({
            sourceKind: "data",
            resolution: "pending",
            dataReference: null
        });
    });

    it("binds an exact Markdown data link without scanning HTML occurrences", () => {
        const src = "data:image/png;base64,AAAA";
        const fixture = makeFixture({
            renderedSrc: src,
            sourceTarget: src,
            detailedStatus: "resolved",
            base64Matches: []
        });

        const result = fixture.resolver.resolve(fixture.image);

        expect(result).toMatchObject({
            sourceKind: "data",
            resolution: "resolved",
            dataReference: {
                match: {
                    lineNumber: 0,
                    fullMatch: `![](${src})`,
                    index: 0
                }
            }
        });
    });
});
