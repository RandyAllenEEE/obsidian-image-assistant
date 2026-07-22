import { describe, expect, it } from "vitest";
import { fakeApp } from "../../../factories/obsidian";
import {
    ReferenceWorkflowProgressModal
} from "../../../../src/ui/modals/ReferenceWorkflowProgressModal";

describe("ReferenceWorkflowProgressModal", () => {
    it("aborts cancellable preflight when closed", () => {
        const modal = new ReferenceWorkflowProgressModal(fakeApp() as any);
        modal.onOpen();

        modal.onClose();

        expect(modal.isCancelled()).toBe(true);
        expect(modal.signal.aborted).toBe(true);
    });

    it("refuses to close after the first write until the workflow finishes", () => {
        const modal = new ReferenceWorkflowProgressModal(fakeApp() as any);
        modal.onOpen();
        modal.lock();

        modal.close();
        expect(modal.isCancelled()).toBe(false);
        expect(modal.signal.aborted).toBe(false);
        expect(modal.contentEl.textContent).not.toBe("");

        modal.finish();
        modal.onClose();
        expect(modal.contentEl.textContent).toBe("");
        expect(modal.signal.aborted).toBe(false);
    });
});
