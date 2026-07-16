import { describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../../../src/settings/SettingsModals";

describe("ConfirmDialog", () => {
    it("contains a rejected asynchronous confirmation action", async () => {
        const failure = new Error("write failed");
        const callback = vi.fn(async () => { throw failure; });
        const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const dialog = new ConfirmDialog({} as any, "Confirm", "Message", "Run", callback);
        dialog.onOpen();

        dialog.contentEl.querySelectorAll<HTMLButtonElement>("button")[1].click();
        await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled());

        expect(callback).toHaveBeenCalledOnce();
        expect(errorSpy).toHaveBeenCalledWith("[Image Assistant] Confirmed action failed:", failure);
    });

    it("settles cancellation only once when closed without a button choice", () => {
        const cancel = vi.fn();
        const dialog = new ConfirmDialog({} as any, "Confirm", "Message", "Run", vi.fn(), cancel);

        dialog.onClose();
        dialog.onClose();

        expect(cancel).toHaveBeenCalledOnce();
    });

    it("runs the confirmed action only once when confirmation is dispatched repeatedly", async () => {
        const callback = vi.fn(async () => undefined);
        const dialog = new ConfirmDialog({} as any, "Confirm", "Message", "Run", callback);
        dialog.onOpen();
        const confirm = dialog.contentEl.querySelectorAll<HTMLButtonElement>("button")[1];

        confirm.click();
        confirm.click();
        await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());

        expect(callback).toHaveBeenCalledOnce();
    });

    it("does not confirm after cancellation has already settled the dialog", async () => {
        const callback = vi.fn(async () => undefined);
        const cancel = vi.fn();
        const dialog = new ConfirmDialog({} as any, "Confirm", "Message", "Run", callback, cancel);
        dialog.onOpen();
        const [cancelButton, confirmButton] = dialog.contentEl.querySelectorAll<HTMLButtonElement>("button");

        cancelButton.click();
        confirmButton.click();
        await Promise.resolve();

        expect(cancel).toHaveBeenCalledOnce();
        expect(callback).not.toHaveBeenCalled();
    });
});
