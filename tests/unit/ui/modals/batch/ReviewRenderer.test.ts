import { describe, expect, it, vi } from "vitest";
import { ReviewRenderer } from "../../../../../src/ui/modals/batch/ui/ReviewRenderer";

describe("ReviewRenderer", () => {
    it("prevents duplicate destructive actions while an action is pending", async () => {
        let resolve!: () => void;
        const onAction = vi.fn(() => new Promise<void>(done => { resolve = done; }));
        const container = document.createElement("div");
        new ReviewRenderer().render(container, {
            successful: [], failed: [], skipped: [], cancelled: false
        }, [
            { id: "replace_delete", label: "Replace and delete", style: "danger" },
            { id: "done", label: "Done", style: "default" }
        ], onAction);

        const buttons = Array.from(container.querySelectorAll("button"));
        buttons[0].click();
        buttons[0].click();

        expect(onAction).toHaveBeenCalledOnce();
        expect(buttons.every(button => button.disabled)).toBe(true);
        resolve();
        await vi.waitFor(() => expect(buttons.every(button => !button.disabled)).toBe(true));
    });
});
