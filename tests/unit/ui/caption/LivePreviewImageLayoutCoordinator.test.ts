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
        caption.setAttribute("data-image-assistant-layout-key", "source-key");
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

    it("retains valid geometry across a zero-size frame and virtualized DOM replacement", () => {
        const root = document.createElement("div");
        document.body.appendChild(root);
        const content = root.createDiv({ cls: "cm-content" });
        const first = content.createEl("img");
        first.setAttribute("data-image-assistant-layout-owner", "true");
        first.setAttribute("data-image-assistant-align", "left");
        first.setAttribute("data-image-assistant-wrap", "false");
        const caption = content.createSpan({ cls: "image-assistant-live-preview-caption" });
        caption.setAttribute("data-image-assistant-caption-renderer", "codemirror");
        caption.setAttribute("data-image-assistant-layout-key", "0:https://example.com/a");
        caption.setAttribute("data-image-assistant-caption-width", "auto");
        caption.setAttribute("data-image-assistant-caption-wrap", "false");

        let firstRect = rect(240, 500);
        vi.spyOn(first, "getBoundingClientRect").mockImplementation(() => firstRect);
        vi.spyOn(caption, "getBoundingClientRect").mockImplementation(() => {
            const offset = Number.parseFloat(
                caption.style.getPropertyValue("--image-assistant-caption-offset")
            ) || 0;
            return rect(40 + offset, 500);
        });

        const coordinator = new LivePreviewImageLayoutCoordinator(root);
        coordinator.registerImage(first, "0:https://example.com/a", {
            standalone: true,
            scope: "root"
        });
        (coordinator as any).flush();
        expect(caption.style.getPropertyValue("--image-assistant-caption-offset")).toBe("200px");

        firstRect = rect(0, 0);
        (coordinator as any).flush();
        expect(caption.style.getPropertyValue("--image-assistant-caption-offset")).toBe("200px");
        expect(caption.style.getPropertyValue("--image-assistant-caption-rendered-width"))
            .toBe("500px");

        coordinator.detachImage(first);
        first.remove();
        const replacement = content.createEl("img");
        replacement.setAttribute("data-image-assistant-layout-owner", "true");
        replacement.setAttribute("data-image-assistant-align", "left");
        replacement.setAttribute("data-image-assistant-wrap", "false");
        vi.spyOn(replacement, "getBoundingClientRect").mockReturnValue(rect(300, 420));
        coordinator.registerImage(replacement, "0:https://example.com/a", {
            standalone: true,
            scope: "root"
        });
        (coordinator as any).flush();

        expect(caption.style.getPropertyValue("--image-assistant-caption-offset")).toBe("260px");
        expect(caption.style.getPropertyValue("--image-assistant-caption-rendered-width"))
            .toBe("420px");

        const replacementCaption = content.createSpan({
            cls: "image-assistant-live-preview-caption"
        });
        replacementCaption.setAttribute(
            "data-image-assistant-caption-renderer",
            "codemirror"
        );
        replacementCaption.setAttribute(
            "data-image-assistant-layout-key",
            "0:https://example.com/a"
        );
        replacementCaption.setAttribute("data-image-assistant-caption-width", "auto");
        replacementCaption.setAttribute("data-image-assistant-caption-wrap", "false");
        vi.spyOn(replacementCaption, "getBoundingClientRect").mockImplementation(() => {
            const offset = Number.parseFloat(
                replacementCaption.style.getPropertyValue("--image-assistant-caption-offset")
            ) || 0;
            return rect(80 + offset, 420);
        });
        caption.remove();
        (coordinator as any).flush();
        expect(replacementCaption.getAttribute("data-image-assistant-caption-positioned"))
            .toBe("true");
        expect(replacementCaption.style.getPropertyValue("--image-assistant-caption-offset"))
            .toBe("220px");

        coordinator.reconcileSourceKeys(new Set());
        expect(replacementCaption.hasAttribute("data-image-assistant-caption-positioned"))
            .toBe(false);
        expect(replacementCaption.style.getPropertyValue("--image-assistant-caption-offset"))
            .toBe("");
        coordinator.destroy();
        root.remove();
    });

    it("builds the caption lookup index once per geometry frame", () => {
        const root = document.createElement("div");
        document.body.appendChild(root);
        for (let index = 0; index < 100; index++) {
            const image = root.createEl("img");
            image.setAttribute("data-image-assistant-layout-owner", "true");
            vi.spyOn(image, "getBoundingClientRect").mockReturnValue(rect(index, 100));
            const caption = root.createSpan({
                cls: "image-assistant-live-preview-caption"
            });
            caption.setAttribute(
                "data-image-assistant-caption-renderer",
                "codemirror"
            );
            caption.setAttribute("data-image-assistant-layout-key", `key-${index}`);
            caption.setAttribute("data-image-assistant-caption-width", "auto");
            caption.setAttribute("data-image-assistant-caption-wrap", "false");
        }
        const images = Array.from(root.querySelectorAll("img"));
        const coordinator = new LivePreviewImageLayoutCoordinator(root);
        images.forEach((image, index) => coordinator.registerImage(
            image,
            `key-${index}`,
            { standalone: true, scope: "root" }
        ));
        const query = vi.spyOn(root, "querySelectorAll");

        (coordinator as any).flush();

        const captionQueries = query.mock.calls.filter(
            ([selector]) => String(selector).includes(
                "image-assistant-live-preview-caption"
            )
        );
        expect(captionQueries).toHaveLength(1);
        coordinator.destroy();
        root.remove();
    });
});
