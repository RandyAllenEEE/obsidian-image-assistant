import type { Menu, MenuItem } from "obsidian";

export interface SubmenuItemDefinition {
    readonly title: string;
    readonly icon: string;
    readonly onClick: () => void;
}

interface SubmenuCapableItem {
    setSubmenu?: () => Menu;
}

export function addSubmenuOrFallback(
    menu: Menu,
    parent: { readonly title: string; readonly icon: string },
    items: readonly SubmenuItemDefinition[],
    fallback: () => void,
    section?: string
): void {
    menu.addItem(item => {
        item.setTitle(parent.title).setIcon(parent.icon);
        if (section && typeof item.setSection === "function") {
            item.setSection(section);
        }
        const setSubmenu = (item as MenuItem & SubmenuCapableItem).setSubmenu;
        if (typeof setSubmenu === "function") {
            try {
                const submenu = setSubmenu.call(item);
                if (submenu && typeof submenu.addItem === "function") {
                    for (const definition of items) {
                        submenu.addItem((child: MenuItem) => {
                            child
                                .setTitle(definition.title)
                                .setIcon(definition.icon)
                                .onClick(definition.onClick);
                        });
                    }
                    return;
                }
            } catch (error) {
                console.warn("[Image Assistant] Menu submenu is unavailable:", error);
            }
        }
        item.onClick(fallback);
    });
}
