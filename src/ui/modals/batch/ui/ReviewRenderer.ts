import { ButtonComponent, Notice } from "obsidian";
import { BatchResult } from "../../../../types/BatchTypes";
import { ReviewAction } from "../modes/IBatchMode";
import { t } from "../../../../lang/helpers";

export class ReviewRenderer {
    constructor() { }

    public render(
        container: HTMLElement,
        result: BatchResult,
        actions: ReviewAction[],
        onAction: (actionId: string) => Promise<void>
    ): void {
        container.empty();

        container.createEl("h2", { text: t("BATCH_REVIEW_TITLE") });

        // 1. Result Summary
        const summary = container.createDiv("batch-result-summary");
        const successCount = result.successful.length;
        const failCount = result.failed.length;
        const skippedCount = result.skipped.length;

        summary.createDiv({ text: t("BATCH_SUCCESS_COUNT", [successCount.toString()]), cls: "summary-item success" });
        if (result.discovery && !result.discovery.complete) {
            summary.createDiv({
                text: t("BATCH_DISCOVERY_REVIEW_WARNING", [
                    (result.discovery.failedFiles.length + result.discovery.uncertainFiles.length).toString()
                ]),
                cls: "summary-item error"
            });
            const discoveryDetails = container.createEl("details");
            discoveryDetails.createEl("summary", { text: t("BATCH_DISCOVERY_DETAILS") });
            const log = discoveryDetails.createDiv("batch-error-log");
            [...new Set([...result.discovery.failedFiles, ...result.discovery.uncertainFiles])]
                .forEach(message => log.createDiv({ text: message, cls: "error-line" }));
        }
        if (skippedCount > 0) {
            summary.createDiv({ text: t("BATCH_SKIP_COUNT", [skippedCount.toString()]), cls: "summary-item" });
        }
        if (failCount > 0) {
            summary.createDiv({ text: t("BATCH_FAIL_COUNT", [failCount.toString()]), cls: "summary-item error" });

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

        const buttons: ButtonComponent[] = [];
        let actionRunning = false;
        actions.forEach(action => {
            const btn = new ButtonComponent(actionContainer)
                .setButtonText(action.label)
                .onClick(async () => {
                    if (actionRunning) return;
                    actionRunning = true;
                    buttons.forEach(button => button.setDisabled(true));
                    try {
                        await onAction(action.id);
                    } catch (error) {
                        const message = error instanceof Error ? error.message : String(error);
                        console.error(`[Image Assistant] Batch review action ${action.id} failed:`, error);
                        new Notice(message);
                    } finally {
                        actionRunning = false;
                        buttons.forEach(button => button.setDisabled(false));
                    }
                });

            if (action.style === 'primary') btn.setCta();
            else if (action.style === 'danger') btn.setWarning();
            buttons.push(btn);
        });
    }
}
