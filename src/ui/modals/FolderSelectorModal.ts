import { App, FuzzySuggestModal, TFolder } from "obsidian";
import { t } from "../../lang/helpers";

export class FolderSelectorModal extends FuzzySuggestModal<TFolder> {
    constructor(
        app: App,
        private readonly onChoose: (folder: TFolder) => void
    ) {
        super(app);
        this.setPlaceholder(t("DIALOG_SELECT_FOLDER_PLACEHOLDER"));
    }

    getItems(): TFolder[] {
        return this.app.vault.getAllLoadedFiles()
            .filter((file): file is TFolder => file instanceof TFolder)
            .sort((left, right) => left.path.localeCompare(right.path));
    }

    getItemText(folder: TFolder): string {
        return folder.path || "/";
    }

    onChooseItem(folder: TFolder): void {
        this.onChoose(folder);
    }
}
