import { describe, expect, it, vi } from "vitest";
import { FileContextMenuPolicy } from "../../../../../src/ui/contextMenu/file/FileContextMenuPolicy";
import {
    fakeApp,
    fakeTFile,
    fakeTFolder,
    fakeVault
} from "../../../../factories/obsidian";

describe("FileContextMenuPolicy", () => {
    const supportedFormats = {
        isSupported: vi.fn((_extension?: string, name?: string) =>
            /\.(?:png|jpe?g|webp)$/i.test(name ?? "")
        )
    } as any;

    it("maps supported images, notes, folders and the vault root", () => {
        const folder = fakeTFolder({ path: "projects" });
        const vault = fakeVault({ folders: [folder] });
        const app = fakeApp({ vault }) as any;
        const policy = new FileContextMenuPolicy(app, supportedFormats);
        const image = fakeTFile({ path: "assets/photo.png", extension: "png" });
        const markdown = fakeTFile({ path: "notes/source.md", extension: "md" });
        const canvas = fakeTFile({ path: "boards/source.canvas", extension: "canvas" });

        expect(policy.resolve(image)).toEqual({ kind: "image", file: image });
        expect(policy.resolve(markdown)).toMatchObject({
            kind: "note",
            request: { scope: "note", target: markdown, mode: "local_process" }
        });
        expect(policy.resolve(canvas)).toMatchObject({
            kind: "note",
            request: { scope: "note", target: canvas, mode: "local_process" }
        });
        expect(policy.resolve(folder)).toMatchObject({
            kind: "folder",
            request: { scope: "folder", target: folder, mode: "local_process" }
        });
        expect(policy.resolve(app.vault.getRoot())).toMatchObject({
            kind: "vault",
            target: null,
            request: { scope: "vault", target: null, mode: "local_process" }
        });
    });

    it("treats an empty normalized folder path as the vault root", () => {
        const app = fakeApp() as any;
        const policy = new FileContextMenuPolicy(app, supportedFormats);
        const rootAlias = fakeTFolder({ path: "" });

        expect(policy.resolve(rootAlias)).toMatchObject({
            kind: "vault",
            request: { scope: "vault", target: null }
        });
    });

    it("does not add actions for unsupported ordinary files", () => {
        const app = fakeApp() as any;
        const policy = new FileContextMenuPolicy(app, supportedFormats);
        const pdf = fakeTFile({ path: "docs/source.pdf", extension: "pdf" });

        expect(policy.resolve(pdf)).toBeNull();
    });

    it.each(["Flow.drawio", "Flow.drawio.svg"])(
        "recognizes %s before ordinary image extension filtering",
        name => {
            const app = fakeApp() as any;
            const policy = new FileContextMenuPolicy(
                app,
                supportedFormats,
                file => file.name === name
            );
            const diagram = fakeTFile({ path: `assets/${name}`, name });

            expect(policy.resolve(diagram)).toEqual({ kind: "drawing", file: diagram });
        }
    );
});
