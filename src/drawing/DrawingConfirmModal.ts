import { App, Modal, Setting } from "obsidian";
import { t } from "../lang/helpers";

export class DrawingConfirmModal extends Modal {
    private resolve: ((value: boolean) => void) | null;

    constructor(
        app: App,
        private readonly title: string,
        private readonly message: string,
        resolve: (value: boolean) => void
    ) {
        super(app);
        this.resolve = resolve;
    }

    onOpen(): void {
        this.titleEl.setText(this.title);
        this.contentEl.createEl("p", { text: this.message });
        new Setting(this.contentEl)
            .addButton(button => button
                .setButtonText(t("DRAWING_CONFIRM_CANCEL"))
                .onClick(() => this.finish(false)))
            .addButton(button => button
                .setButtonText(t("DRAWING_CONFIRM_CONTINUE"))
                .setWarning()
                .onClick(() => this.finish(true)));
    }

    onClose(): void {
        this.resolve?.(false);
        this.resolve = null;
        this.contentEl.empty();
    }

    private finish(value: boolean): void {
        const resolve = this.resolve;
        this.resolve = null;
        resolve?.(value);
        this.close();
    }
}

export function confirmDrawingAction(
    app: App,
    title: string,
    message: string
): Promise<boolean> {
    return new Promise(resolve => {
        new DrawingConfirmModal(app, title, message, resolve).open();
    });
}
