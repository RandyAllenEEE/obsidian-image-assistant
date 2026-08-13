import { afterEach, describe, expect, it, vi } from "vitest";
import { ExcalidrawBridge } from "../../../../src/drawing/excalidraw/ExcalidrawBridge";
import { fakeApp, fakeTFile } from "../../../factories/obsidian";

describe("ExcalidrawBridge", () => {
    afterEach(() => {
        delete (window as Window & { ExcalidrawAutomate?: unknown }).ExcalidrawAutomate;
    });

    it("reports a missing optional plugin without touching Vault state", () => {
        const bridge = new ExcalidrawBridge(fakeApp() as any);

        expect(bridge.probe()).toMatchObject({
            available: false,
            canRecognize: false,
            canCreate: false,
            reason: "missing"
        });
    });

    it("probes each capability and destroys only the isolated API instance", () => {
        const destroy = vi.fn();
        const rootDestroy = vi.fn();
        (window as any).ExcalidrawAutomate = {
            destroy: rootDestroy,
            getAPI: vi.fn(() => ({
                verifyMinimumPluginVersion: vi.fn(() => true),
                isExcalidrawFile: vi.fn(() => true),
                create: vi.fn(),
                getListOfTemplateFiles: vi.fn(() => []),
                destroy
            }))
        };
        const bridge = new ExcalidrawBridge(fakeApp() as any);

        expect(bridge.probe()).toMatchObject({
            available: true,
            canRecognize: true,
            canCreate: true,
            canListTemplates: true,
            canCreateSvgPreview: true,
            reason: "ready"
        });
        expect(destroy).toHaveBeenCalledOnce();
        expect(rootDestroy).not.toHaveBeenCalled();
    });

    it("keeps recognition available when the installed API is too old for silent creation", () => {
        (window as any).ExcalidrawAutomate = {
            getAPI: () => ({
                verifyMinimumPluginVersion: () => false,
                isExcalidrawFile: () => true,
                create: vi.fn(),
                destroy: vi.fn()
            })
        };

        expect(new ExcalidrawBridge(fakeApp() as any).probe()).toMatchObject({
            canRecognize: true,
            canCreate: false,
            reason: "outdated"
        });
    });

    it("passes the safe create contract and accepts the upstream path as-is", async () => {
        const create = vi.fn(async () => "drawings/Actual-2.excalidraw.md");
        const destroy = vi.fn();
        (window as any).ExcalidrawAutomate = {
            getAPI: () => ({
                verifyMinimumPluginVersion: () => true,
                isExcalidrawFile: () => true,
                create,
                destroy
            })
        };
        const bridge = new ExcalidrawBridge(fakeApp() as any);

        await expect(bridge.create({
            filename: "Planned",
            foldername: "drawings",
            silent: true
        })).resolves.toBe("drawings/Actual-2.excalidraw.md");
        expect(create).toHaveBeenCalledWith({
            filename: "Planned",
            foldername: "drawings",
            silent: true
        });
        expect(destroy).toHaveBeenCalledOnce();
    });

    it("creates and disposes a fresh API for each file recognition", () => {
        const first = vi.fn();
        const second = vi.fn();
        let calls = 0;
        (window as any).ExcalidrawAutomate = {
            getAPI: () => ({
                isExcalidrawFile: () => true,
                destroy: calls++ === 0 ? first : second
            })
        };
        const bridge = new ExcalidrawBridge(fakeApp() as any);
        const file = fakeTFile({ path: "Drawing.excalidraw.md" });

        expect(bridge.isExcalidrawFile(file)).toBe(true);
        expect(bridge.isExcalidrawFile(file)).toBe(true);
        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
    });

});
