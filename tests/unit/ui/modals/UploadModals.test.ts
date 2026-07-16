import { describe, expect, it, vi } from "vitest";
import { fakeTFile } from "../../../factories/obsidian";
import {
    MultiReferenceUploadDialog,
    NoReferenceUploadDialog,
    SingleReferenceUploadDialog,
    UploadErrorDialog
} from "../../../../src/ui/modals/UploadModals";

describe("upload confirmation modals", () => {
    it("reports retry and cancel choices from upload errors", () => {
        const onChoice = vi.fn();
        const retryDialog = new UploadErrorDialog({} as any, "image.png", "offline", onChoice);
        retryDialog.onOpen();
        retryDialog.contentEl.querySelectorAll<HTMLButtonElement>("button")[0].click();

        const cancelDialog = new UploadErrorDialog({} as any, "image.png", "offline", onChoice);
        cancelDialog.onOpen();
        cancelDialog.contentEl.querySelectorAll<HTMLButtonElement>("button")[1].click();

        expect(onChoice.mock.calls.map(call => call[0])).toEqual(["retry", "cancel"]);
        retryDialog.onClose();
        cancelDialog.onClose();
        expect(retryDialog.contentEl.children).toHaveLength(0);
        expect(cancelDialog.contentEl.children).toHaveLength(0);
    });

    it("treats closing an upload error dialog as cancel exactly once", () => {
        const onChoice = vi.fn();
        const dialog = new UploadErrorDialog({} as any, "image.png", "offline", onChoice);
        dialog.onOpen();

        dialog.onClose();
        dialog.onClose();

        expect(onChoice).toHaveBeenCalledTimes(1);
        expect(onChoice).toHaveBeenCalledWith("cancel");
    });

    it("reports all no-reference choices", () => {
        const onChoice = vi.fn();
        for (let index = 0; index < 3; index++) {
            const dialog = new NoReferenceUploadDialog(
                {} as any,
                "image.png",
                "https://cdn.example/image.png",
                fakeTFile({ path: "assets/image.png" }),
                onChoice
            );
            dialog.onOpen();
            dialog.contentEl.querySelectorAll<HTMLButtonElement>("button")[index].click();
        }
        expect(onChoice.mock.calls.map(call => call[0])).toEqual(["keep-cloud", "delete-all", "keep-all"]);
    });

    it("reports all single-reference choices", () => {
        const onChoice = vi.fn();
        for (let index = 0; index < 4; index++) {
            const dialog = new SingleReferenceUploadDialog(
                {} as any,
                "image.png",
                "https://cdn.example/image.png",
                { file: "notes/current.md", line: 8 },
                onChoice
            );
            dialog.onOpen();
            dialog.contentEl.querySelectorAll<HTMLButtonElement>("button")[index].click();
        }
        expect(onChoice.mock.calls.map(call => call[0])).toEqual(["replace", "replace-delete", "cancel", "undo"]);
    });

    it("renders current and other references, caps details, and reports all choices", () => {
        const onChoice = vi.fn();
        const files = Array.from({ length: 11 }, (_, index) => ({
            path: index === 0 ? "notes/current.md" : `notes/${index}.md`,
            matches: [{ lineNumber: index, line: "line", original: "![[image.png]]" }]
        }));
        for (let index = 0; index < 4; index++) {
            const dialog = new MultiReferenceUploadDialog(
                {} as any,
                "image.png",
                "https://cdn.example/image.png",
                { totalCount: 11, files },
                "notes/current.md",
                onChoice
            );
            dialog.onOpen();
            expect(dialog.contentEl.querySelectorAll("li")).toHaveLength(11);
            dialog.contentEl.querySelectorAll<HTMLButtonElement>("button")[index].click();
        }
        expect(onChoice.mock.calls.map(call => call[0])).toEqual([
            "replace-current",
            "replace-all",
            "replace-all-delete",
            "cancel"
        ]);
    });

    it("settles an upload result dialog only once", () => {
        const onChoice = vi.fn();
        const dialog = new SingleReferenceUploadDialog(
            {} as any,
            "image.png",
            "https://cdn.example/image.png",
            { file: "notes/current.md", line: 8 },
            onChoice
        );
        dialog.onOpen();
        const buttons = dialog.contentEl.querySelectorAll<HTMLButtonElement>("button");

        buttons[0].click();
        buttons[1].click();

        expect(onChoice).toHaveBeenCalledOnce();
        expect(onChoice).toHaveBeenCalledWith("replace");
    });

    it("renders totals without a current note", () => {
        const dialog = new MultiReferenceUploadDialog(
            {} as any,
            "image.png",
            "https://cdn.example/image.png",
            { totalCount: 1, files: [{ path: "notes/a.md", matches: [] }] },
            undefined,
            vi.fn()
        );
        dialog.onOpen();
        expect(dialog.contentEl.querySelectorAll("button")).toHaveLength(3);
    });
});
