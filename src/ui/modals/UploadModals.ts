import { App, Modal, Setting, TFile } from "obsidian";
import { basename } from "path-browserify";
import { t } from "../../lang/helpers";

export interface ImageMatch {
    lineNumber: number;
    line: string;
    original: string;
}

export interface ImageMatchResult {
    totalCount: number;
    files: Array<{
        path: string;
        matches: ImageMatch[];
    }>;
}

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

export class NoReferenceUploadDialog extends Modal {
    private settled = false;

    constructor(
        app: App,
        private readonly imageName: string,
        private readonly cloudUrl: string,
        _localFile: TFile,
        private readonly onChoice: (choice: "keep-cloud" | "delete-all" | "keep-all") => void
    ) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.createEl("h2", { text: t("MODAL_UPLOAD_SUCCESS_TITLE") });
        const content = this.contentEl.createDiv();
        content.createEl("p", { text: t("MODAL_IMAGE") + this.imageName });
        content.createEl("p", {
            text: t("MODAL_CLOUD_URL") + this.cloudUrl,
            cls: "upload-cloud-url-text"
        });
        content.createEl("p", {
            text: t("MODAL_NO_REF_WARNING"),
            cls: "upload-warning-text"
        });

        new Setting(content)
            .addButton(button => button
                .setButtonText(t("MODAL_KEEP_CLOUD"))
                .setTooltip(t("TOOLTIP_KEEP_CLOUD"))
                .onClick(() => this.choose("keep-cloud")))
            .addButton(button => button
                .setButtonText(t("MODAL_DELETE_ALL"))
                .setWarning()
                .setTooltip(t("TOOLTIP_DELETE_ALL"))
                .onClick(() => this.choose("delete-all")))
            .addButton(button => button
                .setButtonText(t("MODAL_KEEP_ALL"))
                .setTooltip(t("TOOLTIP_KEEP_ALL"))
                .onClick(() => this.choose("keep-all")));
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private choose(choice: "keep-cloud" | "delete-all" | "keep-all"): void {
        if (this.settled) return;
        this.settled = true;
        this.close();
        this.onChoice(choice);
    }
}

export class SingleReferenceUploadDialog extends Modal {
    private settled = false;

    constructor(
        app: App,
        private readonly imageName: string,
        private readonly cloudUrl: string,
        private readonly referenceInfo: { file: string; line: number },
        private readonly onChoice: (choice: "replace" | "replace-delete" | "cancel" | "undo") => void
    ) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.createEl("h2", { text: t("MODAL_UPLOAD_SUCCESS_TITLE") });
        const content = this.contentEl.createDiv();
        content.createEl("p", { text: t("MODAL_IMAGE") + this.imageName });
        content.createEl("p", {
            text: t("MODAL_CLOUD_URL") + this.cloudUrl,
            cls: "upload-cloud-url-text"
        });
        content.createEl("p", {
            text: t("MODAL_REF_LOCATION", [basename(this.referenceInfo.file), this.referenceInfo.line.toString()]),
            cls: "upload-reference-info"
        });

        const buttons = content.createDiv({ cls: "upload-button-container" });
        new Setting(buttons)
            .addButton(button => button
                .setButtonText(t("MODAL_REPLACE_REF"))
                .setCta()
                .setTooltip(t("TOOLTIP_REPLACE_REF"))
                .onClick(() => this.choose("replace")))
            .addButton(button => button
                .setButtonText(t("MODAL_REPLACE_DELETE"))
                .setTooltip(t("TOOLTIP_REPLACE_DELETE"))
                .onClick(() => this.choose("replace-delete")));
        new Setting(buttons)
            .addButton(button => button
                .setButtonText(t("MODAL_BUTTON_CANCEL"))
                .setTooltip(t("TOOLTIP_CANCEL_REPLACE"))
                .onClick(() => this.choose("cancel")))
            .addButton(button => button
                .setButtonText(t("MODAL_UNDO_UPLOAD"))
                .setWarning()
                .setTooltip(t("TOOLTIP_UNDO_UPLOAD_CLOUD"))
                .onClick(() => this.choose("undo")));
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private choose(choice: "replace" | "replace-delete" | "cancel" | "undo"): void {
        if (this.settled) return;
        this.settled = true;
        this.close();
        this.onChoice(choice);
    }
}

export class MultiReferenceUploadDialog extends Modal {
    private settled = false;

    constructor(
        app: App,
        private readonly imageName: string,
        private readonly cloudUrl: string,
        private readonly matches: ImageMatchResult,
        private readonly currentNotePath: string | undefined,
        private readonly onChoice: (choice: "replace-current" | "replace-all" | "replace-all-delete" | "cancel") => void
    ) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.createEl("h2", { text: t("MODAL_MULTI_REF_TITLE") });
        const content = this.contentEl.createDiv();
        content.createEl("p", { text: t("MODAL_IMAGE") + this.imageName });
        content.createEl("p", {
            text: t("MODAL_CLOUD_URL") + this.cloudUrl,
            cls: "upload-cloud-url-text"
        });

        this.renderStats(content);
        this.renderDetails(content);
        this.renderButtons(content);
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private renderStats(content: HTMLElement): void {
        const stats = content.createDiv({ cls: "upload-reference-stats" });
        if (!this.currentNotePath) {
            stats.createEl("p", {
                text: t("MSG_STATS_TOTAL", [this.matches.totalCount.toString(), this.matches.files.length.toString()]),
                cls: "upload-stats-title"
            });
            return;
        }

        const currentCount = this.currentReferenceCount();
        const otherCount = this.matches.totalCount - currentCount;
        const otherFileCount = this.matches.files.filter(file => file.path !== this.currentNotePath).length;
        stats.createEl("p", { text: t("MODAL_REF_STATS"), cls: "upload-stats-title" });
        stats.createEl("p", {
            text: t("MSG_REF_COUNT_CURRENT", [basename(this.currentNotePath), currentCount.toString()]),
            cls: "upload-current-note-stat"
        });
        stats.createEl("p", {
            text: t("MSG_REF_COUNT_OTHER", [otherCount.toString(), otherFileCount.toString()]),
            cls: "upload-other-notes-stat"
        });
    }

    private renderDetails(content: HTMLElement): void {
        const details = content.createDiv({ cls: "upload-reference-details" });
        details.createEl("p", { text: t("MODAL_DETAILS_LIST"), cls: "upload-details-title" });
        const list = details.createEl("ul");

        for (const file of this.matches.files.slice(0, 10)) {
            const isCurrent = file.path === this.currentNotePath;
            const item = list.createEl("li", {
                text: `${isCurrent ? "✓ " : "  "}${t("MSG_FILE_REFS", [basename(file.path), file.matches.length.toString()])}`
            });
            if (isCurrent) item.addClass("upload-current-note-item");
        }

        if (this.matches.files.length > 10) {
            list.createEl("li", {
                text: t("MSG_MORE_FILES", [(this.matches.files.length - 10).toString()]),
                cls: "upload-more-files"
            });
        }
    }

    private renderButtons(content: HTMLElement): void {
        const container = content.createDiv({ cls: "upload-button-container" });
        const primary = new Setting(container);
        if (this.currentNotePath) {
            primary.addButton(button => button
                .setButtonText(t("MODAL_REPLACE_CURRENT_EXT", [this.currentReferenceCount().toString()]))
                .setTooltip(t("TOOLTIP_REPLACE_CURRENT"))
                .onClick(() => this.choose("replace-current")));
        }
        primary.addButton(button => button
            .setButtonText(t("MODAL_REPLACE_ALL_EXT", [this.matches.totalCount.toString()]))
            .setCta()
            .setTooltip(t("TOOLTIP_REPLACE_ALL"))
            .onClick(() => this.choose("replace-all")));

        new Setting(container)
            .addButton(button => button
                .setButtonText(t("MODAL_REPLACE_ALL_DELETE"))
                .setTooltip(t("TOOLTIP_REPLACE_ALL_DELETE"))
                .onClick(() => this.choose("replace-all-delete")))
            .addButton(button => button
                .setButtonText(t("MODAL_BUTTON_CANCEL"))
                .setTooltip(t("TOOLTIP_CANCEL_REPLACE"))
                .onClick(() => this.choose("cancel")));
    }

    private currentReferenceCount(): number {
        return this.matches.files.find(file => file.path === this.currentNotePath)?.matches.length ?? 0;
    }

    private choose(choice: "replace-current" | "replace-all" | "replace-all-delete" | "cancel"): void {
        if (this.settled) return;
        this.settled = true;
        this.close();
        this.onChoice(choice);
    }
}
