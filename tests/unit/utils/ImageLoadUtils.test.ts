import { describe, expect, it, vi } from "vitest";
import { loadImage } from "../../../src/utils/ImageLoadUtils";

describe("loadImage", () => {
    it("installs handlers before assigning the source", async () => {
        const image = document.createElement("img");
        Object.defineProperty(image, "src", {
            configurable: true,
            set() {
                image.onload?.(new Event("load"));
            }
        });

        await expect(loadImage(image, "blob:fast")).resolves.toBeUndefined();
    });

    it("rejects on an image error", async () => {
        const image = document.createElement("img");
        const pending = loadImage(image, "blob:broken");
        image.onerror?.(new Event("error"));

        await expect(pending).rejects.toThrow("Failed to load image");
    });

    it("rejects instead of waiting forever", async () => {
        vi.useFakeTimers();
        try {
            const image = document.createElement("img");
            const pending = loadImage(image, "blob:stalled", 50);
            const rejection = expect(pending).rejects.toThrow("timed out");
            await vi.advanceTimersByTimeAsync(50);

            await rejection;
        } finally {
            vi.useRealTimers();
        }
    });
});
