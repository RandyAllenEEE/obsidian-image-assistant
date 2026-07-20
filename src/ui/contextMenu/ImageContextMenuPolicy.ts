import { Platform } from "obsidian";
import { getCanvasExportMime } from "../../utils/CanvasImageOutput";
import type { CanvasEditCapability } from "../../utils/CanvasEditCapability";
import type {
    ImageContextMenuCapabilities,
    ImageContextMenuContext,
    ImageContextMenuGroup,
    ImageContextMenuItemId
} from "./types";

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
            })
    ) { }

    getCapabilities(context: ImageContextMenuContext): ImageContextMenuCapabilities {
        const exact = context.resolution === "resolved";
        const local = exact && context.sourceKind === "local" && !!context.localFile;
        const url = context.sourceKind === "url" && !!context.url;
        const exactUrl = exact && url && !!context.viewContext;
        const data = context.sourceKind === "data";
        const exactData = data && exact && !!context.dataReference;
        const canReadPixels = context.sourceKind !== "url" && !!context.renderedSrc;
        const editCapability = context.localFile
            ? this.getEditCapability(context.localFile.extension)
            : null;
        const editable = local
            && !!editCapability?.decodable
            && !!editCapability.encodable;

        return Object.freeze({
            properties: local || exactUrl,
            open: !Platform.isMobile && (!!context.url || !!context.renderedSrc),
            cut: !Platform.isMobile && (!!context.viewContext || exactData),
            copy: canReadPixels,
            copyBase64: canReadPixels,
            process: local,
            crop: editable,
            annotate: editable,
            upload: local,
            download: url && !!context.owner,
            delete: local || exactUrl || exactData,
            showNavigation: !Platform.isMobile && local,
            showExplorer: !Platform.isMobile && local
        });
    }

    getGroups(context: ImageContextMenuContext): readonly ImageContextMenuGroup[] {
        const capabilities = this.getCapabilities(context);
        return [
            group("properties", [
                capabilities.properties ? "properties" : null
            ]),
            group("clipboard", [
                capabilities.open ? "open" : null,
                capabilities.cut ? "cut" : null,
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
            ]),
            group("navigation", [
                capabilities.showNavigation ? "show-navigation" : null,
                capabilities.showExplorer ? "show-explorer" : null
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
            capabilities.open ? "open" : null,
            capabilities.cut ? "cut" : null,
            capabilities.copy ? "copy" : null,
            capabilities.copyBase64 ? "copy-base64" : null,
            capabilities.process ? "process" : null,
            capabilities.crop ? "crop" : null,
            capabilities.annotate ? "annotate" : null,
            capabilities.showNavigation ? "show-navigation" : null,
            capabilities.showExplorer ? "show-explorer" : null
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
