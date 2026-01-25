import { ButtonComponent, Setting } from "obsidian";
import { BatchResult } from "../../../../types/BatchTypes";
import { ReviewAction } from "../modes/IBatchMode";
import { t } from "../../../../lang/helpers";

export class ReviewRenderer {
    constructor() { }

    public render(
        container: HTMLElement,
        result: BatchResult,
        actions: ReviewAction[],
        onAction: (actionId: string) => void
    ): void {
        container.empty();

        container.createEl("h2", { text: t("BATCH_REVIEW_TITLE") });

        // 1. Result Summary
        const summary = container.createDiv("batch-result-summary");
        const successCount = result.successful.length;
        const failCount = result.failed.length;

        summary.createDiv({ text: t("BATCH_SUCCESS_COUNT").replace("{0}", successCount.toString()), cls: "summary-item success" });
        if (failCount > 0) {
            summary.createDiv({ text: t("BATCH_FAIL_COUNT").replace("{0}", failCount.toString()), cls: "summary-item error" });

            // Detailed Failure Log
            const details = container.createEl("details");
            details.open = true;
            details.createEl("summary", { text: t("BATCH_FAILURE_DETAILS") });
            const errorLog = details.createDiv("batch-error-log");
            result.failed.forEach(f => {
                const name = typeof f.item === 'string' ? f.item : (f.item as any).name || 'Unknown';
                errorLog.createDiv({ text: `${name}: ${f.error}`, cls: "error-line" });
            });
        }

        // 2. Action Buttons
        container.createEl("hr");
        const actionContainer = container.createDiv("batch-post-actions");

        actions.forEach(action => {
            const btn = new ButtonComponent(actionContainer)
                .setButtonText(action.label)
                .onClick(() => onAction(action.id));

            if (action.style === 'primary') btn.setCta();
            else if (action.style === 'danger') btn.setWarning();
            // default is default styling
        });
    }
}
