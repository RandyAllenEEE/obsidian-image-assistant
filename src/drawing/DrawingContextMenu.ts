import { Menu, TFile } from "obsidian";
import { t } from "../lang/helpers";
import { IMAGE_ASSISTANT_MENU_SECTION } from "../ui/contextMenu/shared/MenuSections";

const menusWithDrawingAction = new WeakSet<Menu>();

/** Adds one namespaced editor action after the target has resolved to a real diagram file. */
export function appendDrawingOpenMenuItem(
    menu: Menu,
    file: TFile | null,
    enabled: boolean,
    canOpen: (file: TFile) => boolean,
    open: (file: TFile) => unknown | Promise<unknown>
): boolean {
    if (!enabled || !file || !canOpen(file) || menusWithDrawingAction.has(menu)) {
        return false;
    }
    menusWithDrawingAction.add(menu);
    menu.addItem(item => item
        .setTitle(t("MENU_EDIT_DRAWING"))
        .setIcon("shapes")
        .setSection(IMAGE_ASSISTANT_MENU_SECTION)
        .onClick(() => void open(file)));
    return true;
}
