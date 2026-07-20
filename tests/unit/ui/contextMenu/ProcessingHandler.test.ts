import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessingHandler } from "../../../../src/ui/contextMenu/handlers/ProcessingHandler";
import { ProcessSingleImageModal } from "../../../../src/ui/modals/ProcessSingleImageModal";
import { Crop } from "../../../../src/ui/Crop";
import { ImageAnnotationModal } from "../../../../src/ui/ImageAnnotation";
import { fakeApp, fakeTFile } from "../../../factories/obsidian";

describe("ProcessingHandler", () => {
    beforeEach(() => vi.clearAllMocks());

    function makeFixture(extension = "png") {
        const file = fakeTFile({
            path: `assets/pic.${extension}`,
            name: `pic.${extension}`,
            extension
        });
        const app = fakeApp() as any;
        const plugin = {
            settings: { operationDefaults: {} },
            getDefaultSingleImageOperationSettings: vi.fn(() => ({
                outputFormat: "NONE",
                quality: 0.8,
                colorDepth: 1,
                resizeMode: "None",
                desiredWidth: 0,
                desiredHeight: 0,
                desiredLongestEdge: 0,
                enlargeOrReduce: "Auto",
                allowLargerFiles: true
            }))
        } as any;
        const image = document.createElement("img");
        const context = {
            image,
            ownerDocument: document,
            ownerWindow: window,
            renderedSrc: "app://local/assets/pic.png",
            sourceKind: "local",
            resolution: "resolved",
            owner: null,
            viewContext: null,
            descriptor: null,
            localFile: file,
            url: null,
            dataReference: null
        } as const;
        return {
            handler: new ProcessingHandler(app, plugin),
            context,
            file
        };
    }

    it("only exposes in-place editors for formats with verified canvas encoders", () => {
        expect(makeFixture("png").handler.canEditImage(makeFixture("png").context)).toBe(true);
        expect(makeFixture("webp").handler.canEditImage(makeFixture("webp").context)).toBe(true);
        expect(makeFixture("gif").handler.canEditImage(makeFixture("gif").context)).toBe(false);
        expect(makeFixture("tiff").handler.canEditImage(makeFixture("tiff").context)).toBe(false);
    });

    it("opens every tool for the exact file supplied by the menu context", async () => {
        const { handler, context, file } = makeFixture();
        const processOpen = vi.spyOn(ProcessSingleImageModal.prototype, "open");
        const cropOpen = vi.spyOn(Crop.prototype, "open");
        const annotationOpen = vi.spyOn(ImageAnnotationModal.prototype, "open");

        await handler.processImage(context);
        await handler.cropRotateFlip(context);
        await handler.annotateImage(context);

        expect(processOpen).toHaveBeenCalledOnce();
        expect(cropOpen).toHaveBeenCalledOnce();
        expect(annotationOpen).toHaveBeenCalledOnce();
        expect((processOpen.mock.instances[0] as any).imageFile).toBe(file);
        expect((cropOpen.mock.instances[0] as any).imageFile).toBe(file);
        expect((annotationOpen.mock.instances[0] as any).file).toBe(file);
    });

    it("does not open a local tool when the shared context has no file", async () => {
        const fixture = makeFixture();
        const processOpen = vi.spyOn(ProcessSingleImageModal.prototype, "open");
        await fixture.handler.processImage({
            ...fixture.context,
            resolution: "unresolved",
            localFile: null
        });
        expect(processOpen).not.toHaveBeenCalled();
    });
});
