import { App, Modal } from "obsidian";
import { t } from "../../../lang/helpers";

export interface DrawingHistoryEntry {
    readonly id: string;
    readonly createdAt: number;
    readonly label: string;
    readonly xml: string;
    readonly previewSvg?: string;
}

export class DrawingHistoryModal extends Modal {
    constructor(
        app: App,
        private readonly entries: readonly DrawingHistoryEntry[],
        private readonly restore: (entry: DrawingHistoryEntry) => Promise<void>
    ) {
        super(app);
    }

    onOpen(): void {
        this.setTitle(t("DRAWING_HISTORY_TITLE"));
        this.contentEl.addClass("image-assistant-drawing-history-modal");
        if (this.entries.length === 0) {
            this.contentEl.createEl("p", { text: t("DRAWING_HISTORY_EMPTY") });
            return;
        }
        for (const entry of [...this.entries].reverse()) {
            const row = this.contentEl.createDiv("image-assistant-drawing-history-entry");
            if (entry.previewSvg) row.createEl("img", {
                cls: "image-assistant-drawing-history-preview",
                attr: {
                    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(entry.previewSvg)}`,
                    alt: ""
                }
            });
            const details = row.createDiv();
            details.createEl("strong", { text: entry.label || t("DRAWING_HISTORY_AI_EDIT") });
            details.createDiv({
                cls: "image-assistant-drawing-history-time",
                text: new Date(entry.createdAt).toLocaleString()
            });
            const button = row.createEl("button", { text: t("DRAWING_HISTORY_RESTORE") });
            button.addEventListener("click", () => {
                button.disabled = true;
                void this.restore(entry).then(() => this.close(), () => {
                    button.disabled = false;
                });
            });
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
