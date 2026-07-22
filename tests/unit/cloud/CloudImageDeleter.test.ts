import { beforeEach, describe, expect, it, vi } from "vitest";

import { CloudImageDeleter } from "../../../src/cloud/CloudImageDeleter";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";
import { AbortableDesktopHttpClient } from "../../../src/utils/AbortableDesktopHttpClient";

const desktopRequest = vi.fn();

function createPlugin(options: {
    uploader?: "PicGo" | "PicList";
    deleteServer?: string;
    record?: Record<string, unknown> | null;
    removeRecord?: () => Promise<void>;
} = {}) {
    const settings = structuredClone(DEFAULT_SETTINGS);
    settings.pasteHandling.cloud.uploader = options.uploader ?? "PicList";
    settings.pasteHandling.cloud.deleteServer = options.deleteServer
        ?? "http://127.0.0.1:36677/delete";
    return {
        settings,
        historyManager: {
            getRecord: vi.fn(() => options.record === undefined
                ? { url: "https://cdn.example/photo.png" }
                : options.record),
            removeRecord: vi.fn(options.removeRecord ?? (async () => undefined))
        }
    } as any;
}

describe("CloudImageDeleter", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(AbortableDesktopHttpClient.prototype, "isAvailable")
            .mockReturnValue(true);
        vi.spyOn(AbortableDesktopHttpClient.prototype, "request")
            .mockImplementation(desktopRequest);
    });

    it("reports remote deletion as successful when only history cleanup fails", async () => {
        const historyError = new Error("history disk full");
        const plugin = createPlugin({
            removeRecord: async () => {
                throw historyError;
            }
        });
        desktopRequest.mockResolvedValue(response(200, { success: true }));
        vi.spyOn(console, "error").mockImplementation(() => undefined);

        const result = await new CloudImageDeleter(plugin).deleteImageDetailed({
            url: "https://cdn.example/photo.png"
        });

        expect(result).toMatchObject({
            success: true,
            historyUpdated: false,
            uploader: "PicList"
        });
        expect(result.reason).toBeUndefined();
        expect(result.message).toContain("history disk full");
        expect(plugin.historyManager.removeRecord).toHaveBeenCalledOnce();
    });

    it("deletes owned PicList objects and then removes their history record", async () => {
        const plugin = createPlugin();
        desktopRequest.mockResolvedValue(response(200, { success: true }));

        const result = await new CloudImageDeleter(plugin).deleteImageDetailed({
            url: "https://cdn.example/photo.png"
        });

        expect(result).toEqual({
            success: true,
            historyUpdated: true
        });
        expect(plugin.historyManager.removeRecord)
            .toHaveBeenCalledWith("https://cdn.example/photo.png");
    });

    it("rejects unsupported uploaders before reading history or making a request", async () => {
        const plugin = createPlugin({ uploader: "PicGo" });
        vi.spyOn(console, "warn").mockImplementation(() => undefined);

        const result = await new CloudImageDeleter(plugin).deleteImageDetailed({
            url: "https://cdn.example/photo.png"
        });

        expect(result).toMatchObject({
            success: false,
            reason: "unsupported-uploader",
            uploader: "PicGo"
        });
        expect(plugin.historyManager.getRecord).not.toHaveBeenCalled();
        expect(desktopRequest).not.toHaveBeenCalled();
    });

    it("rejects missing delete configuration and ownership history", async () => {
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const missingServer = createPlugin({ deleteServer: "" });
        const missingHistory = createPlugin({ record: null });

        await expect(new CloudImageDeleter(missingServer).deleteImageDetailed({
            url: "https://cdn.example/photo.png"
        })).resolves.toMatchObject({
            success: false,
            reason: "missing-delete-server"
        });
        await expect(new CloudImageDeleter(missingHistory).deleteImageDetailed({
            url: "https://cdn.example/photo.png"
        })).resolves.toMatchObject({
            success: false,
            reason: "missing-history"
        });
        expect(desktopRequest).not.toHaveBeenCalled();
    });

    it("reports HTTP and malformed response failures without changing history", async () => {
        const plugin = createPlugin();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        desktopRequest
            .mockResolvedValueOnce(response(503, {}))
            .mockResolvedValueOnce(response(200, null));

        await expect(new CloudImageDeleter(plugin).deleteImageDetailed({
            url: "https://cdn.example/photo.png"
        })).resolves.toMatchObject({
            success: false,
            reason: "api-failed",
            message: expect.stringContaining("503")
        });
        await expect(new CloudImageDeleter(plugin).deleteImageDetailed({
            url: "https://cdn.example/photo.png"
        })).resolves.toMatchObject({
            success: false,
            reason: "api-failed",
            message: expect.stringContaining("invalid response")
        });
        expect(plugin.historyManager.removeRecord).not.toHaveBeenCalled();
    });

    it("preserves provider failure messages and request errors", async () => {
        const plugin = createPlugin();
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        desktopRequest
            .mockResolvedValueOnce(response(200, {
                success: false,
                message: "provider refused deletion"
            }))
            .mockRejectedValueOnce(new Error("connection reset"));

        await expect(new CloudImageDeleter(plugin).deleteImageDetailed({
            url: "https://cdn.example/photo.png"
        })).resolves.toMatchObject({
            success: false,
            reason: "api-failed",
            message: "provider refused deletion"
        });
        await expect(new CloudImageDeleter(plugin).deleteImageDetailed({
            url: "https://cdn.example/photo.png"
        })).resolves.toMatchObject({
            success: false,
            reason: "request-failed",
            message: "connection reset"
        });
        expect(plugin.historyManager.removeRecord).not.toHaveBeenCalled();
    });

    it("disables remote deletion when Electron transport is unavailable", async () => {
        const plugin = createPlugin();
        vi.spyOn(AbortableDesktopHttpClient.prototype, "isAvailable")
            .mockReturnValue(false);

        await expect(new CloudImageDeleter(plugin).deleteImageDetailed({
            url: "https://cdn.example/photo.png"
        })).resolves.toMatchObject({
            success: false,
            reason: "transport-unavailable"
        });
        expect(desktopRequest).not.toHaveBeenCalled();
        expect(plugin.historyManager.getRecord).not.toHaveBeenCalled();
    });
});

function response(status: number, body: unknown) {
    return {
        status,
        data: new TextEncoder().encode(JSON.stringify(body)).buffer,
        headers: {},
        finalUrl: "http://127.0.0.1:36677/delete",
        redirects: []
    };
}
