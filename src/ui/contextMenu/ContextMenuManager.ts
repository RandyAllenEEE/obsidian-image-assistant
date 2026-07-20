import { App, Component } from "obsidian";
import type ImageConverterPlugin from "../../main";
import type { FolderAndFilenameManagement } from "../../local/FolderAndFilenameManagement";
import type { VariableProcessor } from "../../local/VariableProcessor";
import { BatchOperationLauncher } from "./batch/BatchOperationLauncher";
import { FileContextMenu } from "./file/FileContextMenu";
import { RenderedImageContextMenu } from "./RenderedImageContextMenu";
import { MenuSessionRegistry } from "./shared/MenuSessionRegistry";

export class ContextMenuManager extends Component {
    readonly renderedImageMenu: RenderedImageContextMenu;
    readonly fileMenu: FileContextMenu;
    private readonly menuSessions: MenuSessionRegistry;

    constructor(
        app: App,
        plugin: ImageConverterPlugin,
        folderManagement: FolderAndFilenameManagement,
        variableProcessor: VariableProcessor,
        launcher: BatchOperationLauncher
    ) {
        super();
        const ownership = new MenuSessionRegistry();
        this.menuSessions = ownership;
        this.renderedImageMenu = this.addChild(new RenderedImageContextMenu(
            app,
            plugin,
            folderManagement,
            variableProcessor,
            ownership
        ));
        this.fileMenu = this.addChild(new FileContextMenu(
            app,
            plugin,
            launcher,
            ownership
        ));
        this.registerEvent(
            app.workspace.on("editor-menu", (menu, editor, info) => {
                this.renderedImageMenu.consumeEditorMenu(menu, editor, info);
            })
        );
        this.registerEvent(
            app.workspace.on("file-menu", (menu, target, _source, leaf) => {
                if (this.renderedImageMenu.consumeFileMenu(
                    menu,
                    target,
                    leaf
                )) {
                    return;
                }
                this.fileMenu.append(menu, target);
            })
        );
        this.registerEvent(
            app.workspace.on("url-menu", (menu, url) => {
                this.renderedImageMenu.consumeUrlMenu(menu, url);
            })
        );
    }

    onunload(): void {
        this.menuSessions.closeAll();
        super.onunload();
    }
}
