import { getCanvasExportMime } from "../../utils/CanvasImageOutput";
import type { CanvasEditCapability } from "../../utils/CanvasEditCapability";
import type {
    ImageContextMenuCapabilities,
    ImageContextMenuContext,
    ImageContextMenuGroup,
    ImageContextMenuItemId
} from "./types";
import type { DrawingFileSemantics } from "../../drawing/DrawingContracts";
import { getDrawingRenderedActionCapabilities } from "../../drawing/DrawingActionPolicy";

/** Pure capability policy for rendered-image context menus. */
export class ImageContextMenuPolicy {
    constructor(
        private readonly getEditCapability: (extension: string) => CanvasEditCapability =
            extension => ({
                decodable: !!getCanvasExportMime(extension),
                encodable: ["jpg", "jpeg", "png", "webp"]
                    .includes(extension.trim().toLowerCase()),
                encoder: ["jpg", "jpeg", "png", "webp"]
                    .includes(extension.trim().toLowerCase())
                    ? "canvas"
                    : null
            }),
        private readonly isDeleteEnabled: () => boolean = () => true,
        private readonly isReferenceInventoryReady: () => boolean = () => true,
        private readonly inspectDrawing: (
            file: NonNullable<ImageContextMenuContext["localFile"]>
        ) => DrawingFileSemantics | null = () => null
    ) { }

    getCapabilities(context: ImageContextMenuContext): ImageContextMenuCapabilities {
        const inventoryReady = this.isReferenceInventoryReady();
        const exact = context.resolution === "resolved";
        const local = exact && context.sourceKind === "local" && !!context.localFile;
        const url = context.sourceKind === "url" && !!context.url;
        const exactUrl = exact && url && !!context.viewContext;
        const data = context.sourceKind === "data";
        const exactData = data && exact && !!context.dataReference;
        const canReadPixels = !!context.image
            && context.sourceKind !== "url"
            && !!context.renderedSrc;
        const editCapability = context.localFile
            ? this.getEditCapability(context.localFile.extension)
            : null;
        const editable = local
            && !!editCapability?.decodable
            && !!editCapability.encodable;
        const drawing = context.localFile
            ? this.inspectDrawing(context.localFile)
            : null;
        const drawingActions = drawing
            ? getDrawingRenderedActionCapabilities(drawing)
            : null;
        const protectedDiagram = drawing?.protectedFromImageMutation === true;

        return Object.freeze({
            properties: inventoryReady && (local || exactUrl)
                && (drawingActions?.editReferenceProperties ?? true),
            copy: canReadPixels
                && (drawingActions?.copyRenderedImage ?? true),
            copyBase64: canReadPixels
                && (drawingActions?.copyRenderedImage ?? true),
            process: inventoryReady && local && !protectedDiagram,
            crop: inventoryReady && editable && !protectedDiagram,
            annotate: inventoryReady && editable && !protectedDiagram,
            upload: inventoryReady && local
                && (drawingActions?.uploadRenderedCopy ?? true),
            download: inventoryReady && url && !!context.owner,
            delete: inventoryReady
                && this.isDeleteEnabled()
                && (local || exactUrl || exactData)
                && (drawingActions?.deleteReference ?? true)
        });
    }

    getGroups(context: ImageContextMenuContext): readonly ImageContextMenuGroup[] {
        const capabilities = this.getCapabilities(context);
        return [
            group("properties", [
                capabilities.properties ? "properties" : null
            ]),
            group("clipboard", [
                capabilities.copy ? "copy" : null,
                capabilities.copyBase64 ? "copy-base64" : null
            ]),
            group("processing", [
                capabilities.process ? "process" : null,
                capabilities.crop ? "crop" : null,
                capabilities.annotate ? "annotate" : null,
                capabilities.upload ? "upload" : null,
                capabilities.download ? "download" : null
            ]),
            group("delete", [
                capabilities.delete ? "delete" : null
            ])
        ].filter(candidate => candidate.items.length > 0);
    }

    getPrimaryItems(context: ImageContextMenuContext): readonly ImageContextMenuItemId[] {
        const capabilities = this.getCapabilities(context);
        if (context.sourceKind === "local" && context.resolution === "resolved") {
            return [
                capabilities.properties ? "properties" : null,
                capabilities.upload ? "upload" : null,
                capabilities.delete ? "delete" : null
            ].filter((item): item is ImageContextMenuItemId => item !== null);
        }
        if (context.sourceKind === "url") {
            return [
                capabilities.properties ? "properties" : null,
                capabilities.download ? "download" : null,
                capabilities.delete ? "delete" : null
            ].filter((item): item is ImageContextMenuItemId => item !== null);
        }
        return [];
    }

    getMoreItems(context: ImageContextMenuContext): readonly ImageContextMenuItemId[] {
        const capabilities = this.getCapabilities(context);
        return [
            capabilities.copy ? "copy" : null,
            capabilities.copyBase64 ? "copy-base64" : null,
            capabilities.process ? "process" : null,
            capabilities.crop ? "crop" : null,
            capabilities.annotate ? "annotate" : null
        ].filter((item): item is ImageContextMenuItemId => item !== null);
    }
}

function group(
    id: ImageContextMenuGroup["id"],
    items: Array<ImageContextMenuGroup["items"][number] | null>
): ImageContextMenuGroup {
    return Object.freeze({
        id,
        items: Object.freeze(items.filter(
            (item): item is ImageContextMenuGroup["items"][number] => item !== null
        ))
    });
}
