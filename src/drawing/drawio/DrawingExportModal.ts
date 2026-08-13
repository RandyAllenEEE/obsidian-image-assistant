import { App, Modal, Notice, Setting } from "obsidian";
import { t } from "../../lang/helpers";
import type { DrawingNativeExportFormat } from "./DrawingFileService";

export class DrawingExportModal extends Modal {
    private format: DrawingNativeExportFormat = "drawio-svg";

    constructor(
        app: App,
        private readonly exportDrawing: (format: DrawingNativeExportFormat) => Promise<void>
    ) {
        super(app);
    }

    onOpen(): void {
        this.setTitle(t("DRAWING_EXPORT_TITLE"));
        new Setting(this.contentEl)
            .setName(t("DRAWING_EXPORT_FORMAT"))
            .setDesc(t("DRAWING_EXPORT_FORMAT_DESC"))
            .addDropdown(dropdown => dropdown
                .addOption("drawio-svg", ".drawio.svg")
                .addOption("drawio", ".drawio")
                .addOption("svg", ".svg")
                .addOption("png", ".png")
                .setValue(this.format)
                .onChange(value => { this.format = value as DrawingNativeExportFormat; }));
        new Setting(this.contentEl)
            .addButton(button => button
                .setButtonText(t("DRAWING_CONFIRM_CANCEL"))
                .onClick(() => this.close()))
            .addButton(button => button
                .setCta()
                .setButtonText(t("DRAWING_EXPORT_ACTION"))
                .onClick(async () => {
                    button.setDisabled(true);
                    try {
                        await this.exportDrawing(this.format);
                        this.close();
                    } catch (error) {
                        new Notice(t("NOTICE_DRAWIO_EXPORT_FAILED", [
                            error instanceof Error ? error.message : String(error)
                        ]));
                    } finally {
                        button.setDisabled(false);
                    }
                }));
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
