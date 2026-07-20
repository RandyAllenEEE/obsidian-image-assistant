import { afterEach, describe, expect, it } from "vitest";
import { Platform } from "obsidian";
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

afterEach(() => {
    Platform.isMobile = false;
});

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
            open: true,
            cut: true,
            copy: true,
            copyBase64: true,
            process: true,
            crop: true,
            annotate: true,
            upload: true,
            download: false,
            delete: true,
            showNavigation: true,
            showExplorer: true
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
            "open",
            "cut",
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
        expect(policy.getMoreItems(url)).toEqual(["open"]);
        expect(policy.getCapabilities(url)).toMatchObject({
            properties: false,
            cut: false,
            download: true,
            delete: false
        });
    });

    it("only permits destructive data actions for one exact source occurrence", () => {
        const unresolvedData = context({
            sourceKind: "data",
            renderedSrc: "data:image/png;base64,AAAA"
        });
        expect(policy.getCapabilities(unresolvedData)).toMatchObject({
            open: true,
            copy: true,
            copyBase64: true,
            cut: false,
            delete: false
        });

        const exactData = context({
            sourceKind: "data",
            resolution: "resolved",
            renderedSrc: "data:image/png;base64,AAAA",
            dataReference: {}
        });
        expect(policy.getCapabilities(exactData)).toMatchObject({
            cut: true,
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
                .toEqual(["open", "copy", "copy-base64"]);
        }
    });

    it("removes desktop-only capabilities on mobile", () => {
        Platform.isMobile = true;
        const local = context({
            sourceKind: "local",
            resolution: "resolved",
            viewContext: {},
            localFile: fakeTFile({
                path: "assets/photo.png",
                extension: "png"
            })
        });
        expect(policy.getCapabilities(local)).toMatchObject({
            open: false,
            cut: false,
            showNavigation: false,
            showExplorer: false,
            process: true,
            delete: true
        });
    });
});
