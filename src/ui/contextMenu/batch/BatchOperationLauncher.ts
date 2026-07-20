import { App, Notice, TFile, TFolder } from "obsidian";
import type ImageConverterPlugin from "../../../main";
import type { BatchMode } from "../../../types/BatchTypes";
import { t } from "../../../lang/helpers";
import { UnifiedBatchProcessModal } from "../../modals/UnifiedBatchProcessModal";
import { FolderSelectorModal } from "../../modals/FolderSelectorModal";

export type BatchOperationRequest =
    | { readonly scope: "note"; readonly target: TFile; readonly mode: BatchMode }
    | { readonly scope: "folder"; readonly target: TFolder; readonly mode: BatchMode }
    | { readonly scope: "vault"; readonly target: null; readonly mode: BatchMode };

export class BatchOperationLauncher {
    constructor(
        private readonly app: App,
        private readonly plugin: ImageConverterPlugin
    ) {}

    open(request: BatchOperationRequest): void {
        void this.openWhenReady(request);
    }

    openCurrentNote(mode: BatchMode): void {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile || (activeFile.extension !== "md" && activeFile.extension !== "canvas")) {
            new Notice(t("MSG_OPEN_NOTE_OR_CANVAS"));
            return;
        }
        this.open({ scope: "note", target: activeFile, mode });
    }

    chooseFolder(mode: BatchMode): void {
        new FolderSelectorModal(this.app, folder => {
            this.open({ scope: "folder", target: folder, mode });
        }).open();
    }

    private async openWhenReady(request: BatchOperationRequest): Promise<void> {
        try {
            await this.plugin.componentsReady;
            if (!isValidBatchOperationRequest(this.app, request)) {
                new Notice(t("MSG_BATCH_INVALID_TARGET"));
                return;
            }
            new UnifiedBatchProcessModal(
                this.app,
                this.plugin,
                request.scope,
                request.target,
                request.mode
            ).open();
        } catch (error) {
            console.error("[Image Assistant] Batch components are unavailable:", error);
            new Notice(t("MSG_PROCESSING_FAILED"));
        }
    }
}

export function isValidBatchOperationRequest(
    app: App,
    request: BatchOperationRequest
): boolean {
    if (request.scope === "note") {
        return request.target instanceof TFile
            && (request.target.extension === "md" || request.target.extension === "canvas");
    }
    if (request.scope === "folder") {
        return request.target instanceof TFolder
            && request.target !== app.vault.getRoot()
            && request.target.isRoot?.() !== true
            && request.target.path.replace(/[\\/]+/g, "") !== "";
    }
    return request.scope === "vault" && request.target === null;
}
