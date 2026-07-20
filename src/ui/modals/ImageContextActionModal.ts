import { App, Modal, Setting } from "obsidian";
import { t } from "../../lang/helpers";

export interface ImageContextActionDefinition {
    readonly title: Parameters<typeof t>[0];
    readonly icon: string;
    readonly run: () => void | Promise<void>;
}

/** Compact fallback used when the current Obsidian menu cannot host a submenu. */
export class ImageContextActionModal extends Modal {
    constructor(
        app: App,
        private readonly actions: readonly ImageContextActionDefinition[]
    ) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.empty();
        this.contentEl.createEl("h2", {
            text: t("MENU_MORE_IMAGE_ACTIONS")
        });
        for (const action of this.actions) {
            new Setting(this.contentEl).addButton(button => {
                button
                    .setIcon(action.icon)
                    .setButtonText(t(action.title))
                    .onClick(() => {
                        this.close();
                        void action.run();
                    });
            });
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
