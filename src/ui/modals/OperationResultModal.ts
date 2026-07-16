import { App, ButtonComponent, Modal } from "obsidian";

export interface OperationResultReport {
    title: string;
    summary: string;
    successful?: string[];
    failed?: string[];
    uncertain?: string[];
}

export class OperationResultModal extends Modal {
    constructor(app: App, private readonly report: OperationResultReport) {
        super(app);
    }

    onOpen(): void {
        this.titleEl.setText(this.report.title);
        this.contentEl.empty();
        this.contentEl.addClass("image-assistant-operation-result");
        this.contentEl.createEl("p", { text: this.report.summary });

        this.renderSection("Completed", this.report.successful ?? [], "is-success");
        this.renderSection("Failed or blocked", this.report.failed ?? [], "is-error");
        this.renderSection("Could not be verified", this.report.uncertain ?? [], "is-warning");

        const actions = this.contentEl.createDiv({ cls: "modal-button-container" });
        new ButtonComponent(actions)
            .setButtonText("Done")
            .setCta()
            .onClick(() => this.close());
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private renderSection(title: string, entries: string[], className: string): void {
        if (entries.length === 0) return;

        const details = this.contentEl.createEl("details", { cls: className });
        details.open = true;
        details.createEl("summary", { text: `${title} (${entries.length})` });
        const list = details.createEl("ul");
        for (const entry of entries) {
            list.createEl("li", { text: entry });
        }
    }
}
