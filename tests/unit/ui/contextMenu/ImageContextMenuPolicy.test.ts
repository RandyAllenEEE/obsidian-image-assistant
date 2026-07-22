import { describe, expect, it } from "vitest";
import { ImageContextMenuPolicy } from "../../../../src/ui/contextMenu/ImageContextMenuPolicy";
import { fakeTFile } from "../../../factories/obsidian";

function context(overrides: Record<string, unknown> = {}) {
    const image = document.createElement("img");
    image.src = "app://local/assets/photo.png";
    return {
        image,
        ownerDocument: document,
        ownerWindow: window,
        renderedSrc: image.src,
        sourceKind: "unresolved",
        resolution: "unresolved",
        owner: null,
        viewContext: null,
        descriptor: null,
        localFile: null,
        url: null,
        dataReference: null,
        ...overrides
    } as any;
}

describe("ImageContextMenuPolicy", () => {
    const policy = new ImageContextMenuPolicy();

    it("exposes the complete resolved-local matrix and gates pixel editors by format", () => {
        const local = context({
            sourceKind: "local",
            resolution: "resolved",
            viewContext: {},
            localFile: fakeTFile({
                path: "assets/photo.png",
                extension: "png"
            })
        });
        expect(policy.getCapabilities(local)).toEqual({
            properties: true,
            copy: true,
            copyBase64: true,
            process: true,
            crop: true,
            annotate: true,
            upload: true,
            download: false,
            delete: true
        });

        const gif = context({
            ...local,
            localFile: fakeTFile({
                path: "assets/animated.gif",
                extension: "gif"
            })
        });
        expect(policy.getCapabilities(gif).crop).toBe(false);
        expect(policy.getCapabilities(gif).annotate).toBe(false);
        expect(policy.getCapabilities(gif).process).toBe(true);
    });

    it("keeps URL actions source-safe and hides CORS-dependent copy actions", () => {
        const url = context({
            sourceKind: "url",
            resolution: "resolved",
            owner: {},
            viewContext: {},
            renderedSrc: "blob:https://obsidian.local/proxy",
            url: "https://cdn.example.com/photo"
        });
        expect(policy.getGroups(url).flatMap(group => group.items)).toEqual([
            "properties",
            "download",
            "delete"
        ]);
    });

    it("keeps pending URL operations non-destructive", () => {
        const url = context({
            sourceKind: "url",
            resolution: "pending",
            owner: {},
            renderedSrc: "blob:https://obsidian.local/proxy",
            url: "https://cdn.example.com/photo"
        });

        expect(policy.getPrimaryItems(url)).toEqual(["download"]);
        expect(policy.getMoreItems(url)).toEqual([]);
        expect(policy.getCapabilities(url)).toMatchObject({
            properties: false,
            download: true,
            delete: false
        });
    });

    it("removes only the delete action when the cleaner child switch is off", () => {
        const deleteDisabled = new ImageContextMenuPolicy(
            undefined,
            () => false
        );
        const local = context({
            sourceKind: "local",
            resolution: "resolved",
            viewContext: {},
            localFile: fakeTFile({
                path: "assets/photo.png",
                extension: "png"
            })
        });

        expect(deleteDisabled.getPrimaryItems(local)).toEqual([
            "properties",
            "upload"
        ]);
        expect(deleteDisabled.getMoreItems(local)).toContain("process");
        expect(deleteDisabled.getCapabilities(local).delete).toBe(false);
    });

    it("exposes only read-only actions while the reference inventory is unavailable", () => {
        const unavailable = new ImageContextMenuPolicy(
            undefined,
            () => true,
            () => false
        );
        const local = context({
            sourceKind: "local",
            resolution: "resolved",
            owner: {},
            viewContext: {},
            localFile: fakeTFile({
                path: "assets/photo.png",
                extension: "png"
            })
        });
        const url = context({
            sourceKind: "url",
            resolution: "resolved",
            owner: {},
            viewContext: {},
            renderedSrc: "blob:https://obsidian.local/proxy",
            url: "https://cdn.example.com/photo"
        });

        expect(unavailable.getPrimaryItems(local)).toEqual([]);
        expect(unavailable.getMoreItems(local)).toEqual([
            "copy",
            "copy-base64"
        ]);
        expect(unavailable.getPrimaryItems(url)).toEqual([]);
        expect(unavailable.getMoreItems(url)).toEqual([]);
        expect(unavailable.getCapabilities(local)).toMatchObject({
            properties: false,
            process: false,
            crop: false,
            annotate: false,
            upload: false,
            download: false,
            delete: false
        });
    });

    it("only permits destructive data actions for one exact source occurrence", () => {
        const unresolvedData = context({
            sourceKind: "data",
            renderedSrc: "data:image/png;base64,AAAA"
        });
        expect(policy.getCapabilities(unresolvedData)).toMatchObject({
            copy: true,
            copyBase64: true,
            delete: false
        });

        const exactData = context({
            sourceKind: "data",
            resolution: "resolved",
            renderedSrc: "data:image/png;base64,AAAA",
            dataReference: {}
        });
        expect(policy.getCapabilities(exactData)).toMatchObject({
            delete: true
        });
    });

    it("limits blob, pending and unresolved contexts to non-source operations", () => {
        for (const candidate of [
            context({
                sourceKind: "blob",
                renderedSrc: "blob:https://obsidian.local/id"
            }),
            context({ resolution: "pending" }),
            context()
        ]) {
            expect(policy.getGroups(candidate).flatMap(group => group.items))
                .toEqual(["copy", "copy-base64"]);
        }
    });
});
