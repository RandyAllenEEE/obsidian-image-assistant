import { describe, expect, it } from "vitest";
import { LocalImageTargetResolver } from "../../../src/utils/LocalImageTargetResolver";
import { fakeApp, fakeMetadataCache, fakeTFile, fakeVault } from "../../factories/obsidian";

describe("LocalImageTargetResolver", () => {
    it("resolves a URI-encoded vault-root path without metadata cache support", () => {
        const source = fakeTFile({ path: "notes/current.md" });
        const target = fakeTFile({ path: "20 Areas/图片/My Photo#1.png" });
        const app = fakeApp({
            vault: fakeVault({ files: [source, target] }),
            metadataCache: fakeMetadataCache()
        }) as any;

        const result = new LocalImageTargetResolver(app).resolve(
            "/20%20Areas/%E5%9B%BE%E7%89%87/My%20Photo%231.png",
            source,
            { syntax: "markdown" }
        );

        expect(result.status).toBe("resolved");
        expect(result.file).toBe(target);
    });

    it("resolves explicit current and parent-relative paths from the owning note", () => {
        const source = fakeTFile({ path: "notes/topic/current.md" });
        const child = fakeTFile({ path: "notes/topic/assets/child.png" });
        const parent = fakeTFile({ path: "notes/assets/parent.png" });
        const app = fakeApp({
            vault: fakeVault({ files: [source, child, parent] }),
            metadataCache: fakeMetadataCache()
        }) as any;
        const resolver = new LocalImageTargetResolver(app);

        expect(resolver.resolve("./assets/child.png", source).file).toBe(child);
        expect(resolver.resolve("../assets/parent.png", source).file).toBe(parent);
    });

    it("uses a unique basename fallback but rejects a genuinely ambiguous shortest link", () => {
        const source = fakeTFile({ path: "notes/current.md" });
        const first = fakeTFile({ path: "assets/photo.png" });
        const app = fakeApp({
            vault: fakeVault({ files: [source, first] }),
            metadataCache: fakeMetadataCache()
        }) as any;
        const resolver = new LocalImageTargetResolver(app);

        expect(resolver.resolve("photo.png", source).file).toBe(first);

        const duplicate = fakeTFile({ path: "archive/photo.png" });
        (app.vault.getFiles() as any[]).push?.(duplicate);
        const files = [source, first, duplicate];
        (app.vault.getFiles as any).mockReturnValue(files);
        (app.vault.getAbstractFileByPath as any).mockImplementation(
            (path: string) => files.find(file => file.path === path) ?? null
        );

        const ambiguous = resolver.resolve("photo.png", source);
        expect(ambiguous.status).toBe("ambiguous");
        expect(ambiguous.candidates.map(file => file.path)).toEqual([
            "assets/photo.png",
            "archive/photo.png"
        ]);
    });

    it("rejects malformed encoding and relative paths that escape the vault", () => {
        const source = fakeTFile({ path: "current.md" });
        const app = fakeApp({ vault: fakeVault({ files: [source] }) }) as any;
        const resolver = new LocalImageTargetResolver(app);

        expect(resolver.resolve("bad-%E0%A4%A.png", source, { syntax: "markdown" }).status)
            .toBe("invalid");
        expect(resolver.resolve("../outside.png", source).status).toBe("invalid");
    });
});
