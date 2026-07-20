import { Modal, Setting } from "obsidian";
import { t } from "../../lang/helpers";

export type ReferenceWorkflowProgressStage =
    | "index"
    | "verify"
    | "mutate"
    | "delete";

/** Small lifecycle surface shown while a reference workflow awaits I/O. */
export class ReferenceWorkflowProgressModal extends Modal {
    private stageEl: HTMLElement | null = null;
    private cancelButton: HTMLButtonElement | null = null;
    private cancelled = false;
    private locked = false;
    private completed = false;

    onOpen(): void {
        this.contentEl.empty();
        this.contentEl.createEl("h2", {
            text: t("REFERENCE_WORKFLOW_PROGRESS_TITLE")
        });
        this.stageEl = this.contentEl.createEl("p");
        this.setStage("index");
        new Setting(this.contentEl).addButton(button => {
            button
                .setButtonText(t("BUTTON_CANCEL"))
                .onClick(() => this.close());
            this.cancelButton = button.buttonEl;
        });
    }

    onClose(): void {
        if (!this.completed && !this.locked) this.cancelled = true;
        this.stageEl = null;
        this.cancelButton = null;
        this.contentEl.empty();
    }

    setStage(stage: ReferenceWorkflowProgressStage): void {
        if (this.stageEl) this.stageEl.setText(t(getStageKey(stage)));
    }

    lock(): void {
        this.locked = true;
        if (this.cancelButton) this.cancelButton.disabled = true;
    }

    isCancelled(): boolean {
        return this.cancelled;
    }

    finish(): void {
        this.completed = true;
        this.close();
    }
}

function getStageKey(
    stage: ReferenceWorkflowProgressStage
): Parameters<typeof t>[0] {
    switch (stage) {
        case "index":
            return "REFERENCE_WORKFLOW_PROGRESS_INDEX";
        case "verify":
            return "REFERENCE_WORKFLOW_PROGRESS_VERIFY";
        case "mutate":
            return "REFERENCE_WORKFLOW_PROGRESS_MUTATE";
        case "delete":
            return "REFERENCE_WORKFLOW_PROGRESS_DELETE";
    }
}
