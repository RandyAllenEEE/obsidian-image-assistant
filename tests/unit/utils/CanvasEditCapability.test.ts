import { afterEach, describe, expect, it, vi } from "vitest";
import {
    CanvasEditCapabilityService
} from "../../../src/utils/CanvasEditCapability";
import {
    finalizeCanvasImageOutput,
    getCanvasIntermediateMime
} from "../../../src/utils/CanvasImageOutput";
import { makePngBytes } from "../../factories/image";

function makeAvifBytes(): ArrayBuffer {
    return Uint8Array.from([
        0x00, 0x00, 0x00, 0x18,
        0x66, 0x74, 0x79, 0x70,
        0x61, 0x76, 0x69, 0x66,
        0x00, 0x00, 0x00, 0x00,
        0x61, 0x76, 0x69, 0x66,
        0x6d, 0x69, 0x66, 0x31
    ]).buffer;
}

function makePlugin(overrides: Record<string, unknown> = {}) {
    const detectAvifEncoder = vi.fn().mockResolvedValue(null);
    const processImageDetailed = vi.fn();
    return {
        settings: {
            localProcessing: {
                externalTools: {
                    ffmpegExecutablePath: "",
                    ffmpegDetectedEncoder: undefined,
                    ffmpegDetectedEncoderPath: undefined
                }
            }
        },
        imageProcessor: {
            detectAvifEncoder,
            processImageDetailed
        },
        ...overrides
    } as any;
}

describe("CanvasEditCapabilityService", () => {
    afterEach(() => {
        CanvasEditCapabilityService.clearCache();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("keeps AVIF editing disabled when neither native nor external encoding works", async () => {
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob")
            .mockImplementation(callback => callback(null));
        const plugin = makePlugin();
        const service = new CanvasEditCapabilityService(plugin);

        const capability = await service.get("avif", document);

        expect(capability).toEqual({
            decodable: true,
            encodable: false,
            encoder: null
        });
        expect(service.peek("png").encodable).toBe(true);
    });

    it("enables AVIF after a configured FFmpeg encoder passes a real probe", async () => {
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob")
            .mockImplementation(callback => callback(null));
        const plugin = makePlugin();
        plugin.settings.localProcessing.externalTools.ffmpegExecutablePath = "ffmpeg";
        plugin.imageProcessor.detectAvifEncoder.mockResolvedValue("libaom-av1");
        const service = new CanvasEditCapabilityService(plugin);

        const capability = await service.get("avif", document);

        expect(capability.encoder).toBe("avif-external");
        expect(capability.encodable).toBe(true);
        expect(plugin.imageProcessor.detectAvifEncoder).toHaveBeenCalledWith(
            "ffmpeg",
            undefined,
            { forceProbe: true }
        );
    });

    it("fails the native AVIF probe closed when toBlob never settles", async () => {
        vi.useFakeTimers();
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob")
            .mockImplementation(() => undefined);
        const service = new CanvasEditCapabilityService(makePlugin());

        const capabilityPromise = service.get("avif", document);
        await vi.advanceTimersByTimeAsync(1_500);

        await expect(capabilityPromise).resolves.toEqual({
            decodable: true,
            encodable: false,
            encoder: null
        });
    });

    it("routes a PNG canvas intermediate through the existing AVIF processor", async () => {
        const avif = makeAvifBytes();
        const plugin = makePlugin();
        plugin.imageProcessor.processImageDetailed.mockResolvedValue({
            data: avif,
            mimeType: "image/avif",
            extension: "avif",
            outcome: "converted"
        });
        const capability = {
            decodable: true,
            encodable: true,
            encoder: "avif-external" as const
        };

        expect(getCanvasIntermediateMime("avif", capability)).toBe("image/png");
        const output = await finalizeCanvasImageOutput(
            makePngBytes({ width: 1, height: 1 }),
            "avif",
            capability,
            plugin
        );

        expect(new Uint8Array(output)).toEqual(new Uint8Array(avif));
        expect(plugin.imageProcessor.processImageDetailed).toHaveBeenCalledOnce();
    });
});
