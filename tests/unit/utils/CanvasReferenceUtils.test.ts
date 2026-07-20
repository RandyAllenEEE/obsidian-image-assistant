import { describe, expect, it, vi } from "vitest";
import {
    getCanvasFileReferenceIndexDetailed,
    getCanvasUrlReferencesDetailed,
    removeCanvasFileReferences,
    removeCanvasUrlReferences,
    replaceCanvasFileReferences,
    replaceCanvasFileReferencesWithUrl,
    replaceCanvasUrlReferencesWithFile
} from "../../../src/utils/CanvasReferenceUtils";
import {
    fakeApp,
    fakeMetadataCache,
    fakeTFile,
    fakeVault
} from "../../factories/obsidian";

describe("CanvasReferenceUtils", () => {
    it("finds local references in native file nodes and ordinary or embedded text links", async () => {
        const image = fakeTFile({ path: "assets/photo.png", name: "photo.png", extension: "png" });
        const canvas = fakeTFile({ path: "boards/media.canvas", name: "media.canvas", extension: "canvas" });
        const content = JSON.stringify({
            nodes: [
                { id: "file", type: "file", file: image.path },
                {
                    id: "text",
                    type: "text",
                    text: `[[${image.path}|Open source]]\n![preview](${image.path})`
                }
            ]
        });
        const app = fakeApp({
            vault: fakeVault({
                files: [image, canvas],
                fileContents: new Map([[canvas.path, content]])
            }),
            metadataCache: fakeMetadataCache()
        }) as any;

        const result = await getCanvasFileReferenceIndexDetailed(app, [image]);

        expect(result.complete).toBe(true);
        expect(result.references.get(image.path)).toHaveLength(3);
        expect(result.references.get(image.path)?.map(reference => reference.nodeFile)).toEqual([
            image.path,
            image.path,
            image.path
        ]);
    });

    it("marks unresolved same-name Canvas references uncertain", async () => {
        const image = fakeTFile({ path: "assets/photo.png", name: "photo.png", extension: "png" });
        const duplicate = fakeTFile({ path: "archive/photo.png", name: "photo.png", extension: "png" });
        const canvas = fakeTFile({ path: "boards/media.canvas", name: "media.canvas", extension: "canvas" });
        const app = fakeApp({
            vault: fakeVault({
                files: [image, duplicate, canvas],
                fileContents: new Map([[canvas.path, JSON.stringify({
                    nodes: [
                        { id: "file", type: "file", file: "photo.png" },
                        { id: "text", type: "text", text: "[source](photo.png)" }
                    ]
                })]])
            }),
            metadataCache: fakeMetadataCache()
        }) as any;

        const result = await getCanvasFileReferenceIndexDetailed(app, [image]);

        expect(result.complete).toBe(false);
        expect(result.references.get(image.path)).toEqual([]);
        expect(result.uncertainFiles).toEqual([canvas.path]);
    });

    it("atomically replaces native and text references while preserving link syntax", async () => {
        const oldFile = fakeTFile({ path: "assets/photo.png", name: "photo.png", extension: "png" });
        const newFile = fakeTFile({ path: "assets/new photo.webp", name: "new photo.webp", extension: "webp" });
        const canvas = fakeTFile({ path: "boards/media.canvas", name: "media.canvas", extension: "canvas" });
        const contents = new Map([[canvas.path, JSON.stringify({
            nodes: [
                { id: "file", type: "file", file: oldFile.path },
                {
                    id: "text",
                    type: "text",
                    text: `![[${oldFile.path}|300]] [source](<${oldFile.path}> "original")`
                }
            ]
        })]]);
        const vault = fakeVault({ files: [oldFile, newFile, canvas], fileContents: contents });
        const app = fakeApp({ vault, metadataCache: fakeMetadataCache() }) as any;

        const result = await replaceCanvasFileReferences(app, oldFile, newFile);
        const updated = JSON.parse(contents.get(canvas.path) ?? "{}") as {
            nodes: Array<{ file?: string; text?: string }>;
        };

        expect(result).toMatchObject({ found: 3, replaced: 3, complete: true });
        expect(updated.nodes[0].file).toBe(newFile.path);
        expect(updated.nodes[1].text).toBe(
            `![[${newFile.path}|300]] [source](<${newFile.path}> "original")`
        );
        expect(vault.process).toHaveBeenCalledWith(canvas, expect.any(Function));
        expect(vault.read).not.toHaveBeenCalled();
        expect(vault.modify).not.toHaveBeenCalled();
    });

    it("finds equivalent URL references in native, ordinary, and embedded Canvas links", async () => {
        const targetUrl = "https://cdn.example/Photo.png?token=AbC";
        const equivalentUrl = "HTTPS://CDN.EXAMPLE/Photo.png?token=AbC";
        const canvas = fakeTFile({ path: "boards/network.canvas", name: "network.canvas", extension: "canvas" });
        const app = fakeApp({
            vault: fakeVault({
                files: [canvas],
                fileContents: new Map([[canvas.path, JSON.stringify({
                    nodes: [
                        { id: "link", type: "link", url: equivalentUrl },
                        {
                            id: "text",
                            type: "text",
                            text: `[source](${equivalentUrl}) ![[${equivalentUrl}|Preview]]`
                        }
                    ]
                })]])
            })
        }) as any;

        const result = await getCanvasUrlReferencesDetailed(app, targetUrl);

        expect(result.complete).toBe(true);
        expect(result.references).toHaveLength(3);
        expect(result.references.every(reference => reference.canvasFile === canvas)).toBe(true);
    });

    it("converts native and text references bidirectionally between local files and URLs", async () => {
        const localFile = fakeTFile({ path: "assets/photo.png", name: "photo.png", extension: "png" });
        const canvas = fakeTFile({ path: "boards/media.canvas", name: "media.canvas", extension: "canvas" });
        const url = "https://cdn.example/photo.png";
        const contents = new Map([[canvas.path, JSON.stringify({
            nodes: [
                { id: "native", type: "file", file: localFile.path, x: 10, y: 20 },
                { id: "text", type: "text", text: `[[${localFile.path}|Open image]]` }
            ]
        })]]);
        const app = fakeApp({
            vault: fakeVault({ files: [localFile, canvas], fileContents: contents }),
            metadataCache: fakeMetadataCache()
        }) as any;

        const uploaded = await replaceCanvasFileReferencesWithUrl(app, localFile, url);
        const cloudCanvas = JSON.parse(contents.get(canvas.path) ?? "{}") as { nodes: any[] };

        expect(uploaded).toMatchObject({ found: 2, replaced: 2, complete: true });
        expect(cloudCanvas.nodes[0]).toMatchObject({
            id: "native",
            type: "link",
            url,
            x: 10,
            y: 20
        });
        expect(cloudCanvas.nodes[0]).not.toHaveProperty("file");
        expect(cloudCanvas.nodes[1].text).toBe(`[[${url}|Open image]]`);

        const downloaded = await replaceCanvasUrlReferencesWithFile(app, url, localFile);
        const localCanvas = JSON.parse(contents.get(canvas.path) ?? "{}") as { nodes: any[] };

        expect(downloaded).toMatchObject({ found: 2, replaced: 2, complete: true });
        expect(localCanvas.nodes[0]).toMatchObject({
            id: "native",
            type: "file",
            file: localFile.path,
            x: 10,
            y: 20
        });
        expect(localCanvas.nodes[0]).not.toHaveProperty("url");
        expect(localCanvas.nodes[1].text).toBe(`[[${localFile.path}|Open image]]`);
    });

    it("removes native Canvas nodes and complete links from text nodes", async () => {
        const localFile = fakeTFile({ path: "assets/photo.png", extension: "png" });
        const canvas = fakeTFile({ path: "boards/remove.canvas", extension: "canvas" });
        const url = "https://cdn.example/photo.png";
        const contents = new Map([[canvas.path, JSON.stringify({
            nodes: [
                { id: "local", type: "file", file: localFile.path },
                { id: "remote", type: "link", url },
                {
                    id: "text",
                    type: "text",
                    text: `before ![[${localFile.path}|300]] middle ![alt](${url} "title") after`
                }
            ]
        })]]);
        const app = fakeApp({
            vault: fakeVault({ files: [localFile, canvas], fileContents: contents }),
            metadataCache: fakeMetadataCache()
        }) as any;

        const localResult = await removeCanvasFileReferences(app, localFile);
        const remoteResult = await removeCanvasUrlReferences(app, url);
        const updated = JSON.parse(contents.get(canvas.path) ?? "{}");

        expect(localResult).toMatchObject({ found: 2, replaced: 2, complete: true });
        expect(remoteResult).toMatchObject({ found: 2, replaced: 2, complete: true });
        expect(updated.nodes).toHaveLength(1);
        expect(updated.nodes[0]).toMatchObject({
            id: "text",
            text: "before  middle  after"
        });
    });

    it("limits Canvas mutation to explicitly allowed files", async () => {
        const localFile = fakeTFile({ path: "assets/photo.png", name: "photo.png", extension: "png" });
        const first = fakeTFile({ path: "boards/first.canvas", name: "first.canvas", extension: "canvas" });
        const second = fakeTFile({ path: "boards/second.canvas", name: "second.canvas", extension: "canvas" });
        const makeContent = () => JSON.stringify({ nodes: [{ type: "file", file: localFile.path }] });
        const contents = new Map([
            [first.path, makeContent()],
            [second.path, makeContent()]
        ]);
        const app = fakeApp({
            vault: fakeVault({ files: [localFile, first, second], fileContents: contents }),
            metadataCache: fakeMetadataCache()
        }) as any;
        const url = "https://cdn.example/photo.png";

        const result = await replaceCanvasFileReferencesWithUrl(app, localFile, url, {
            allowedCanvasPaths: new Set([first.path])
        });

        expect(result).toMatchObject({ found: 1, replaced: 1, complete: true });
        expect(JSON.parse(contents.get(first.path) ?? "{}").nodes[0]).toMatchObject({ type: "link", url });
        expect(JSON.parse(contents.get(second.path) ?? "{}").nodes[0]).toMatchObject({
            type: "file",
            file: localFile.path
        });
    });

    it("fails closed for bare URL text and structurally invalid Canvas documents", async () => {
        const targetUrl = "https://cdn.example/photo.png";
        const bareCanvas = fakeTFile({ path: "boards/bare.canvas", name: "bare.canvas", extension: "canvas" });
        const invalidCanvas = fakeTFile({ path: "boards/invalid.canvas", name: "invalid.canvas", extension: "canvas" });
        const app = fakeApp({
            vault: fakeVault({
                files: [bareCanvas, invalidCanvas],
                fileContents: new Map([
                    [bareCanvas.path, JSON.stringify({
                        nodes: [{ id: "text", type: "text", text: `Backup source: ${targetUrl}` }]
                    })],
                    [invalidCanvas.path, JSON.stringify({ nodes: {} })]
                ])
            })
        }) as any;
        vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const result = await getCanvasUrlReferencesDetailed(app, targetUrl);

        expect(result.complete).toBe(false);
        expect(result.references).toEqual([]);
        expect(result.uncertainFiles).toEqual([bareCanvas.path, invalidCanvas.path]);
    });

    it("reports unresolved same-name candidates during replacement instead of claiming completion", async () => {
        const oldFile = fakeTFile({ path: "assets/photo.png", name: "photo.png", extension: "png" });
        const duplicate = fakeTFile({ path: "archive/photo.png", name: "photo.png", extension: "png" });
        const newFile = fakeTFile({ path: "assets/photo.webp", name: "photo.webp", extension: "webp" });
        const canvas = fakeTFile({ path: "boards/media.canvas", name: "media.canvas", extension: "canvas" });
        const contents = new Map([[canvas.path, JSON.stringify({
            nodes: [{ id: "text", type: "text", text: "[[photo.png]]" }]
        })]]);
        const metadataCache = fakeMetadataCache();
        (metadataCache.getFirstLinkpathDest as ReturnType<typeof vi.fn>).mockReturnValue(null);
        const app = fakeApp({
            vault: fakeVault({ files: [oldFile, duplicate, newFile, canvas], fileContents: contents }),
            metadataCache
        }) as any;

        const result = await replaceCanvasFileReferences(app, oldFile, newFile);

        expect(result.complete).toBe(false);
        expect(result.found).toBe(0);
        expect(result.replaced).toBe(0);
        expect(result.uncertainFiles).toEqual([canvas.path]);
        expect(JSON.parse(contents.get(canvas.path) ?? "{}").nodes[0].text).toBe("[[photo.png]]");
    });

    it("indexes callout and ad-* image links in Canvas text while excluding literal Markdown contexts", async () => {
        const image = fakeTFile({ path: "assets/photo.png", name: "photo.png", extension: "png" });
        const canvas = fakeTFile({ path: "boards/context.canvas", name: "context.canvas", extension: "canvas" });
        const content = [
            '```markdown',
            '![[assets/photo.png]]',
            '```',
            '`![[assets/photo.png]]`',
            '<!-- ![[assets/photo.png]] -->',
            '```ad-note',
            '![[assets/photo.png]]',
            '```'
        ].join('\n');
        const metadataCache = fakeMetadataCache();
        metadataCache.getFirstLinkpathDest = vi.fn((link: string) =>
            link === image.path ? image : null
        ) as any;
        const app = fakeApp({
            vault: fakeVault({
                files: [image, canvas],
                fileContents: new Map([[canvas.path, JSON.stringify({ nodes: [{ type: 'text', text: content }] })]])
            }),
            metadataCache
        }) as any;

        const result = await getCanvasFileReferenceIndexDetailed(app, [image], { includeFencedCode: false });

        expect(result.references.get(image.path)).toHaveLength(1);
    });
});
