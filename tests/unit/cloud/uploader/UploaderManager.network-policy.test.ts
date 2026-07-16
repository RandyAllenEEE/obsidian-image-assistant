import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("obsidian", () => ({
    Platform: { isMobileApp: false },
    Notice: vi.fn(),
}));

import { UploaderManager } from "../../../../src/cloud/uploader";
import PicGoUploader from "../../../../src/cloud/uploader/picgo";

describe("UploaderManager network input policy", () => {
    beforeEach(() => vi.restoreAllMocks());

    it("rejects private network URLs before delegating them to PicGo or PicGo-Core", async () => {
        const plugin = {
            settings: { pasteHandling: { cloud: { uploader: "PicGo", remoteServerMode: false } } }
        } as any;
        const upload = vi.spyOn(PicGoUploader.prototype, "upload");
        const manager = new UploaderManager("PicGo", plugin);

        await expect(manager.upload(["http://127.0.0.1:8080/internal.png"])).rejects.toThrow("Private");

        expect(upload).not.toHaveBeenCalled();
    });

    it("continues to accept ordinary vault paths without applying URL validation", async () => {
        const plugin = {
            settings: { pasteHandling: { cloud: { uploader: "PicGo", remoteServerMode: false } } }
        } as any;
        const upload = vi.spyOn(PicGoUploader.prototype, "upload").mockResolvedValue({
            success: true,
            result: ["https://cdn.example/image.png"],
        } as any);
        const manager = new UploaderManager("PicGo", plugin);

        await expect(manager.upload(["attachments/image.png"])).resolves.toMatchObject({ success: true });

        expect(upload).toHaveBeenCalledWith(["attachments/image.png"]);
    });
});
