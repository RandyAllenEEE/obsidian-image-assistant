import { afterEach, describe, expect, it, vi } from "vitest";
import { LivePreviewImageLayoutCoordinator } from "../../../../src/ui/caption/LivePreviewImageLayoutCoordinator";

function rect(left: number, width: number): DOMRect {
    return {
        left,
        right: left + width,
        top: 0,
        bottom: 100,
        width,
        height: 100,
        x: left,
        y: 0,
        toJSON: () => ({})
    } as DOMRect;
}

describe("LivePreviewImageLayoutCoordinator", () => {
    const restores: Array<() => void> = [];

    afterEach(() => {
        while (restores.length) restores.pop()?.();
        vi.restoreAllMocks();
    });

    it("tracks coordinate-only layout changes without cumulative drift", () => {
        const frameCallbacks = new Map<number, FrameRequestCallback>();
        let frameId = 0;
        vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
            frameCallbacks.set(++frameId, callback);
            return frameId;
        });
        vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => {
            frameCallbacks.delete(id);
        });
        const flushFrames = () => {
            for (let guard = 0; frameCallbacks.size > 0 && guard < 12; guard++) {
                const pending = [...frameCallbacks.entries()];
                frameCallbacks.clear();
                pending.forEach(([id, callback]) => callback(id));
            }
        };

        class TestResizeObserver {
            observe = vi.fn();
            unobserve = vi.fn();
            disconnect = vi.fn();
            constructor(_callback: ResizeObserverCallback) { }
        }
        const original = Object.getOwnPropertyDescriptor(window, "ResizeObserver");
        Object.defineProperty(window, "ResizeObserver", { configurable: true, value: TestResizeObserver });
        restores.push(() => original
            ? Object.defineProperty(window, "ResizeObserver", original)
            : delete (window as any).ResizeObserver);

        const root = document.createElement("div");
        document.body.appendChild(root);
        const editor = root.createDiv({ cls: "cm-editor" });
        const content = editor.createDiv({ cls: "cm-content" });
        const image = content.createEl("img");
        image.setAttribute("data-image-assistant-layout-owner", "true");
        image.setAttribute("data-image-assistant-align", "center");
        image.setAttribute("data-image-assistant-wrap", "false");
        const caption = content.createSpan({ cls: "image-assistant-live-preview-caption" });
        caption.setAttribute("data-image-assistant-caption-renderer", "codemirror");
        caption.setAttribute("data-image-assistant-source-key", "source-key");
        caption.setAttribute("data-image-assistant-caption-width", "auto");
        caption.setAttribute("data-image-assistant-caption-wrap", "false");

        let scopeLeft = 0;
        let scopeWidth = 1000;
        vi.spyOn(content, "getBoundingClientRect").mockImplementation(() => rect(scopeLeft, scopeWidth));
        vi.spyOn(image, "getBoundingClientRect").mockImplementation(() => {
            const offset = Number.parseFloat(image.style.getPropertyValue("--image-assistant-layout-offset")) || 0;
            return rect(100 + offset, 400);
        });
        vi.spyOn(caption, "getBoundingClientRect").mockImplementation(() => {
            const offset = Number.parseFloat(caption.style.getPropertyValue("--image-assistant-caption-offset")) || 0;
            return rect(offset, 400);
        });

        const coordinator = new LivePreviewImageLayoutCoordinator(root);
        coordinator.registerImage(image, "source-key", { standalone: true, scope: "root" });
        flushFrames();
        expect(image.style.getPropertyValue("--image-assistant-layout-offset")).toBe("200px");
        expect(caption.style.getPropertyValue("--image-assistant-caption-offset")).toBe("300px");

        scopeLeft = 20;
        scopeWidth = 900;
        coordinator.schedule(2);
        flushFrames();
        expect(image.style.getPropertyValue("--image-assistant-layout-offset")).toBe("170px");
        expect(caption.style.getPropertyValue("--image-assistant-caption-offset")).toBe("270px");

        coordinator.schedule(2);
        flushFrames();
        expect(image.style.getPropertyValue("--image-assistant-layout-offset")).toBe("170px");
        expect(caption.style.getPropertyValue("--image-assistant-caption-offset")).toBe("270px");

        coordinator.destroy();
        expect(image.hasAttribute("data-image-assistant-layout-positioned")).toBe(false);
        expect(caption.hasAttribute("data-image-assistant-caption-positioned")).toBe(false);
        root.remove();
    });

    it("releases a replaced image that reused the same source key", () => {
        const root = document.createElement("div");
        document.body.appendChild(root);
        const first = root.createEl("img");
        const second = root.createEl("img");
        first.setAttribute("data-image-assistant-layout-owner", "true");
        first.setAttribute("data-image-assistant-layout-positioned", "true");
        first.style.setProperty("--image-assistant-layout-offset", "10px");
        second.setAttribute("data-image-assistant-layout-owner", "true");
        const coordinator = new LivePreviewImageLayoutCoordinator(root);

        coordinator.registerImage(first, "same-key", { standalone: true, scope: "root" });
        coordinator.registerImage(second, "same-key", { standalone: true, scope: "root" });

        expect(first.hasAttribute("data-image-assistant-layout-positioned")).toBe(false);
        expect(first.style.getPropertyValue("--image-assistant-layout-offset")).toBe("");
        coordinator.destroy();
        root.remove();
    });
});
