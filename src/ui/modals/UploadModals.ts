import { App, Modal, Setting } from "obsidian";
import { t } from "../../lang/helpers";

/** Retry prompt retained for transport failures before reference review begins. */
export class UploadErrorDialog extends Modal {
    private settled = false;

    constructor(
        app: App,
        private readonly imageName: string,
        private readonly errorMessage: string,
        private readonly onChoice: (choice: "retry" | "cancel") => void
    ) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.createEl("h2", { text: t("MODAL_UPLOAD_FAILED_TITLE") });
        this.contentEl.createEl("p", { text: t("MODAL_IMAGE") + this.imageName });
        this.contentEl.createEl("p", {
            text: t("MODAL_ERROR") + this.errorMessage,
            cls: "upload-error-message"
        });

        new Setting(this.contentEl)
            .addButton(button => button
                .setButtonText(t("MODAL_BUTTON_RETRY"))
                .setCta()
                .onClick(() => this.choose("retry")))
            .addButton(button => button
                .setButtonText(t("MODAL_BUTTON_CANCEL"))
                .onClick(() => this.choose("cancel")));
    }

    onClose(): void {
        if (!this.settled) {
            this.settled = true;
            this.onChoice("cancel");
        }
        this.contentEl.empty();
    }

    private choose(choice: "retry" | "cancel"): void {
        if (this.settled) return;
        this.settled = true;
        this.close();
        this.onChoice(choice);
    }
}
