import { describe, expect, it } from "vitest";
import { VaultFileLookupService } from "../../../src/utils/VaultFileLookupService";
import { fakeApp, fakeTFile, fakeVault } from "../../factories/obsidian";

describe("VaultFileLookupService", () => {
    it("builds the basename index once and keeps repeated queries inside one bucket", async () => {
        const files = Array.from({ length: 28_000 }, (_, index) => fakeTFile({
            path: `assets/${index}/image-${index}.png`,
            name: `image-${index}.png`,
            extension: "png"
        }));
        const target = fakeTFile({ path: "special/photo.png", extension: "png" });
        files.push(target);
        const vault = fakeVault({ files });
        const app = fakeApp({ vault }) as any;
        const lookup = new VaultFileLookupService(app);

        await lookup.ensureReady();
        for (let index = 0; index < 14_000; index++) {
            expect(lookup.getCandidates("photo.png")).toEqual([target]);
        }

        expect(vault.getFiles).toHaveBeenCalledOnce();
        expect(lookup.getCandidates("missing.png")).toEqual([]);
    });

    it("updates only affected basename buckets for create, rename and delete", async () => {
        const original = fakeTFile({ path: "assets/photo.png", extension: "png" });
        const vault = fakeVault({ files: [original] });
        const app = fakeApp({ vault }) as any;
        const lookup = new VaultFileLookupService(app);
        await lookup.ensureReady();

        const created = fakeTFile({ path: "archive/photo.png", extension: "png" });
        lookup.handleCreate(created);
        expect(lookup.getCandidates("photo.png")?.map(file => file.path)).toEqual([
            "archive/photo.png",
            "assets/photo.png"
        ]);

        const oldPath = created.path;
        created.path = "archive/renamed.png";
        created.name = "renamed.png";
        lookup.handleRename(created, oldPath);
        expect(lookup.getCandidates("photo.png")).toEqual([original]);
        expect(lookup.getCandidates("renamed.png")).toEqual([created]);

        lookup.handleDelete(created);
        expect(lookup.getCandidates("renamed.png")).toEqual([]);
        expect(vault.getFiles).toHaveBeenCalledOnce();
    });

    it("reconciles topology changes when a Vault event is delayed", async () => {
        const original = fakeTFile({ path: "assets/photo.png", extension: "png" });
        const files = [original];
        const vault = fakeVault({ files });
        const app = fakeApp({ vault }) as any;
        const lookup = new VaultFileLookupService(app);
        await lookup.ensureReady();
        const initialGeneration = lookup.getGeneration();

        const duplicate = fakeTFile({ path: "archive/photo.png", extension: "png" });
        files.push(duplicate);

        await expect(lookup.reconcile()).resolves.toBe(true);
        expect(lookup.getGeneration()).toBe(initialGeneration + 1);
        expect(lookup.getCandidates("photo.png")?.map(file => file.path)).toEqual([
            "archive/photo.png",
            "assets/photo.png"
        ]);
        await expect(lookup.reconcile()).resolves.toBe(false);
        expect(lookup.getGeneration()).toBe(initialGeneration + 1);
    });
});
