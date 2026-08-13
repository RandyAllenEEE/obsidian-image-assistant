import { App, Component, Menu, Notice, TAbstractFile, TFile } from "obsidian";
import type ImageConverterPlugin from "../../../main";
import { t } from "../../../lang/helpers";
import { ProcessSingleImageModal } from "../../modals/ProcessSingleImageModal";
import type { BatchMode } from "../../../types/BatchTypes";
import { BatchOperationLauncher } from "../batch/BatchOperationLauncher";
import { MenuSessionRegistry } from "../shared/MenuSessionRegistry";
import { addSubmenuOrFallback } from "../shared/MenuSubmenuAdapter";
import { IMAGE_ASSISTANT_MENU_SECTION } from "../shared/MenuSections";
import { FileContextMenuPolicy } from "./FileContextMenuPolicy";
import type { FileContextMenuContext } from "./types";
import { canOpenDrawingFile, inspectDrawingFile } from "../../../drawing/DrawingFileSemantics";

export class FileContextMenu extends Component {
    private readonly policy: FileContextMenuPolicy;

    constructor(
        private readonly app: App,
        private readonly plugin: ImageConverterPlugin,
        private readonly launcher: BatchOperationLauncher,
        private readonly ownership: MenuSessionRegistry
    ) {
        super();
        this.policy = new FileContextMenuPolicy(
            app,
            plugin.supportedImageFormats,
            file => inspectDrawingFile(plugin, file) !== null
        );
    }

    append(menu: Menu, target: TAbstractFile): boolean {
        if (this.ownership.has(menu)) return false;
        const context = this.policy.resolve(target);
        if (!context) return false;
        const diagram = context.kind === "drawing";
        if (diagram && !canOpenDrawingFile(this.plugin, context.file)) {
            return false;
        }
        if (!diagram && !this.isReferenceInventoryReady()) return false;
        if (!this.ownership.claim(menu)) return false;

        if (diagram) {
            this.appendDrawingItem(menu, context.file);
        } else if (context.kind === "image") {
            this.appendImageItems(menu, context);
        } else {
            this.appendBatchSubmenu(menu, context);
        }
        return true;
    }

    private appendDrawingItem(menu: Menu, file: TFile): void {
        menu.addItem(item => {
            item
                .setTitle(t("MENU_EDIT_DRAWING"))
                .setIcon("shapes")
                .setSection(IMAGE_ASSISTANT_MENU_SECTION)
                .onClick(() => {
                    void this.plugin.drawingModule.openFile(file);
                });
        });
    }

    private appendImageItems(
        menu: Menu,
        context: Extract<FileContextMenuContext, { kind: "image" }>
    ): void {
        menu.addItem(item => {
            item
                .setTitle(t("MENU_PROCESS_IMAGE"))
                .setIcon("cog")
                .setSection(IMAGE_ASSISTANT_MENU_SECTION)
                .onClick(() => {
                    this.runWhenReferenceInventoryReady(() => {
                        new ProcessSingleImageModal(
                            this.app,
                            this.plugin,
                            context.file
                        ).open();
                    });
                });
        });
        menu.addItem(item => {
            item
                .setTitle(t("MENU_UPLOAD_CLOUD"))
                .setIcon("cloud-upload")
                .setSection(IMAGE_ASSISTANT_MENU_SECTION)
                .onClick(() => this.runWhenReferenceInventoryReady(() => {
                    void this.plugin.cloudImageHandler.uploadSingleFile(context.file);
                }));
        });
    }

    private appendBatchSubmenu(
        menu: Menu,
        context: Extract<FileContextMenuContext, { kind: "note" | "folder" | "vault" }>
    ): void {
        const modes: ReadonlyArray<{ mode: BatchMode; title: string; icon: string }> = [
            { mode: "local_process", title: t("BATCH_MODE_LOCAL"), icon: "cog" },
            { mode: "upload", title: t("BATCH_MODE_UPLOAD"), icon: "cloud-upload" },
            { mode: "download", title: t("BATCH_MODE_DOWNLOAD"), icon: "download" }
        ];
        addSubmenuOrFallback(
            menu,
            { title: t("MENU_BATCH_PROCESS_IMAGES"), icon: "images" },
            modes.map(({ mode, title, icon }) => ({
                title,
                icon,
                onClick: () => this.runWhenReferenceInventoryReady(() => {
                    this.launcher.open({ ...context.request, mode });
                })
            })),
            () => this.runWhenReferenceInventoryReady(() => {
                this.launcher.open(context.request);
            }),
            IMAGE_ASSISTANT_MENU_SECTION
        );
    }

    private isReferenceInventoryReady(): boolean {
        try {
            return this.plugin.referenceIndexService?.getReadiness?.() === "ready";
        } catch {
            return false;
        }
    }

    private runWhenReferenceInventoryReady(action: () => void): void {
        if (!this.isReferenceInventoryReady()) {
            new Notice(t("REFERENCE_INDEX_MENU_ACTIONS_UNAVAILABLE"));
            return;
        }
        action();
    }
}
