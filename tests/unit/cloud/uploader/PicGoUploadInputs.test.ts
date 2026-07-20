import { describe, expect, it, vi } from "vitest";
import { requestUrl } from "obsidian";
import PicGoUploader from "../../../../src/cloud/uploader/picgo";
import { fakeTFile } from "../../../factories/obsidian";

function createUploader(data: ArrayBuffer = onePixelPng()) {
    const file = fakeTFile({ path: "assets/photo.png", name: "photo.png", extension: "png" });
    const readBinary = vi.fn(async () => data);
    const plugin = {
        settings: { pasteHandling: { cloud: { remoteServerMode: true, uploadServer: "http://localhost/upload" } } },
        app: {
            vault: {
                getAbstractFileByPath: vi.fn((path: string) => path === file.path ? file : null),
                readBinary,
            },
        },
        historyManager: { addRecord: vi.fn() },
    } as any;
    const imageFetcher = {
        fetch: vi.fn(async (url: string) => {
            const response = await requestUrl({ url, method: "GET" });
            const contentLength = response.headers?.["content-length"];
            if (contentLength && Number(contentLength) > 100 * 1024 * 1024) {
                throw new Error("Remote image exceeds the 100 MiB limit");
            }
            return {
                data: response.arrayBuffer,
                status: response.status,
                headers: response.headers ?? {},
                finalUrl: url,
                transport: "electron",
                redirectChainVerified: true,
                hardLimitEnforced: true
            };
        })
    };
    return {
        uploader: new PicGoUploader(plugin, imageFetcher as any),
        file,
        readBinary,
        data
    };
}

function onePixelPng(): ArrayBuffer {
    const bytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64"
    );
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("PicGo remote upload inputs", () => {
    it("reads a Vault-relative string through the Vault API", async () => {
        const { uploader, file, readBinary, data } = createUploader();

        const uploadFile = await (uploader as any).toRemoteUploadFile(file.path, 0);

        expect(readBinary).toHaveBeenCalledWith(file);
        expect(uploadFile.name).toBe("photo.png");
        expect(uploadFile.type).toBe("image/png");
        expect(await uploadFile.arrayBuffer()).toEqual(data);
    });

    it("uses local magic bytes instead of a misleading Vault extension and MIME guess", async () => {
        const tiff = new Uint8Array([0x49, 0x49, 0x2a, 0x00, 8, 0, 0, 0]).buffer;
        const { uploader, file } = createUploader(tiff);

        const uploadFile = await (uploader as any).toRemoteUploadFile(file.path, 0);

        expect(uploadFile.name).toBe("photo.tiff");
        expect(uploadFile.type).toBe("image/tiff");
    });

    it("rejects a Vault file whose extension claims it is an image but whose bytes are not", async () => {
        const { uploader, file } = createUploader(new TextEncoder().encode("not an image").buffer);

        await expect((uploader as any).toRemoteUploadFile(file.path, 0))
            .rejects.toThrow("did not contain a recognized image");
    });

    it("downloads an HTTP input instead of passing it to fs.readFile", async () => {
        const { uploader } = createUploader();
        const png = onePixelPng();
        vi.mocked(requestUrl).mockResolvedValueOnce({
            status: 200,
            headers: { "content-type": "image/png" },
            arrayBuffer: png,
        } as any);

        const uploadFile = await (uploader as any).toRemoteUploadFile("https://example.com/my%20photo.png", 0);

        expect(requestUrl).toHaveBeenCalledWith({ url: "https://example.com/my%20photo.png", method: "GET" });
        expect(uploadFile.name).toBe("my photo.png");
        expect(uploadFile.type).toBe("image/png");
    });

    it("accepts verified remote image bytes when the server declares text/plain", async () => {
        const { uploader } = createUploader();
        vi.mocked(requestUrl).mockResolvedValueOnce({
            status: 200,
            headers: { "content-type": "text/plain; charset=binary" },
            arrayBuffer: onePixelPng(),
        } as any);

        const uploadFile = await (uploader as any).toRemoteUploadFile("https://example.com/image", 0);

        expect(uploadFile.name).toBe("image.png");
        expect(uploadFile.type).toBe("image/png");
    });

    it("preserves each clipboard image's detected format in remote server mode", async () => {
        const { uploader } = createUploader();
        const jpeg = new File(
            [new Uint8Array([0xff, 0xd8, 0xff, 0xe0])],
            "camera.png",
            { type: "image/png" }
        );
        const webp = new File(
            [new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])],
            "diagram.jpg",
            { type: "image/jpeg" }
        );
        const upload = vi.spyOn(uploader as any, "uploadFileByData").mockResolvedValue({
            status: 200,
            json: { success: true, result: ["https://cdn.example/camera.jpg", "https://cdn.example/diagram.webp"] },
        });

        await (uploader as any).uploadFileByClipboard([jpeg, webp]);

        const uploadedFiles = upload.mock.calls[0][0] as File[];
        expect(uploadedFiles.map(file => [file.name, file.type])).toEqual([
            ["camera.jpg", "image/jpeg"],
            ["diagram.webp", "image/webp"],
        ]);
    });

    it("uses the detected image type instead of a misleading URL extension", async () => {
        const { uploader } = createUploader();
        vi.mocked(requestUrl).mockResolvedValueOnce({
            status: 200,
            headers: { "content-type": "image/png" },
            arrayBuffer: onePixelPng(),
        } as any);

        const uploadFile = await (uploader as any).toRemoteUploadFile("https://example.com/photo.jpg", 0);

        expect(uploadFile.name).toBe("photo.png");
        expect(uploadFile.type).toBe("image/png");
    });

    it("keeps downloading when the URL basename contains a malformed escape", async () => {
        const { uploader } = createUploader();
        vi.mocked(requestUrl).mockResolvedValueOnce({
            status: 200,
            headers: { "content-type": "image/png" },
            arrayBuffer: onePixelPng(),
        } as any);

        const uploadFile = await (uploader as any).toRemoteUploadFile("https://example.com/100%photo.jpg", 0);

        expect(uploadFile.name).toBe("100%photo.png");
    });

    it("rejects non-image and oversized remote responses", async () => {
        const { uploader } = createUploader();
        vi.mocked(requestUrl)
            .mockResolvedValueOnce({
                status: 200,
                headers: { "content-type": "text/html" },
                arrayBuffer: new TextEncoder().encode("<html>not an image</html>").buffer,
            } as any)
            .mockResolvedValueOnce({
                status: 200,
                headers: { "content-length": String(101 * 1024 * 1024) },
                arrayBuffer: onePixelPng(),
            } as any);

        await expect((uploader as any).toRemoteUploadFile("https://example.com/fake.png", 0))
            .rejects.toThrow("recognized image");
        await expect((uploader as any).toRemoteUploadFile("https://example.com/huge.png", 1))
            .rejects.toThrow("100 MiB");
    });

    it("rejects an unknown relative path with a clear error", async () => {
        const { uploader } = createUploader();

        await expect((uploader as any).toRemoteUploadFile("missing/photo.png", 0))
            .rejects.toThrow("neither a Vault file nor an absolute path");
    });
});
