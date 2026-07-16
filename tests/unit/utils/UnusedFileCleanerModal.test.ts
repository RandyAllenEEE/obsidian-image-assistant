import { describe, expect, it, vi } from "vitest";
import { UnusedFileCleanerModal } from "../../../src/utils/UnusedFileCleanerModal";
import { fakeTFile } from "../../factories/obsidian";

async function flush(): Promise<void> {
    await Promise.resolve();
    await Promise.resolve();
}

function makeModal() {
    const plugin = {
        settings: {
            cleanerSettings: {
                basePath: "assets",
                fileTypes: "png,jpg",
                trashMode: "obsidian",
                customTrashPath: ".trash"
            }
        }
    } as any;
    const modal = new UnusedFileCleanerModal({} as any, plugin);
    modal.onOpen();
    return { modal, plugin };
}

describe("UnusedFileCleanerModal", () => {
    it("scans, renders grouped references, toggles details, and deletes unused files", async () => {
        const { modal, plugin } = makeModal();
        const unused = fakeTFile({ path: "assets/unused.png", name: "unused.png", extension: "png" });
        const used = fakeTFile({ path: "assets/used.jpg", name: "used.jpg", extension: "jpg" });
        const result = {
            scannedFiles: 2,
            unreferencedFiles: [{ file: unused, isReferenced: false, references: [] }],
            referencedFiles: [{
                file: used,
                isReferenced: true,
                references: [
                    { notePath: "notes/a.md", lineNumber: 1, lineContent: "first" },
                    { notePath: "notes/a.md", lineNumber: 4, lineContent: "second" },
                    { notePath: "notes/b.md", lineNumber: 2, lineContent: "third" }
                ]
            }]
        };
        const cleaner = {
            scanFolder: vi.fn(async (_path, _types, progress) => {
                progress(1, 2, unused.path);
                progress(2, 2, used.path);
                return result;
            }),
            deleteFiles: vi.fn(async () => 1)
        };
        (modal as any).cleaner = cleaner;

        await (modal as any).startScan();

        expect(cleaner.scanFolder).toHaveBeenCalledWith("assets", ["png", "jpg"], expect.any(Function));
        expect(modal.contentEl.querySelectorAll(".file-item")).toHaveLength(2);
        expect(modal.contentEl.querySelectorAll(".note-item")).toHaveLength(2);
        const toggle = modal.contentEl.querySelector(".toggle-button") as HTMLButtonElement;
        toggle.click();
        toggle.click();

        for (const mode of ["system", "custom", "obsidian"] as const) {
            plugin.settings.cleanerSettings.trashMode = mode;
            (modal as any).showDeleteActions();
        }
        const actions = modal.contentEl.querySelector(".cleaner-actions") as HTMLElement;
        const buttons = actions.querySelectorAll<HTMLButtonElement>("button");
        buttons[1].click();
        expect(actions.style.display).toBe("none");

        (modal as any).showDeleteActions();
        actions.querySelector<HTMLButtonElement>("button")?.click();
        await flush();
        expect(cleaner.deleteFiles).toHaveBeenCalledWith([unused], "obsidian", ".trash");
        expect((modal.contentEl.querySelector(".cleaner-result") as HTMLElement).style.display).toBe("none");
    });

    it("validates path and file type configuration and ignores a duplicate scan", async () => {
        const { modal, plugin } = makeModal();
        const input = (modal as any).folderInputEl as HTMLInputElement;
        input.value = "";
        plugin.settings.cleanerSettings.basePath = "";
        await (modal as any).startScan();

        input.value = "assets";
        plugin.settings.cleanerSettings.fileTypes = " , ";
        await (modal as any).startScan();

        (modal as any).isScanning = true;
        await (modal as any).startScan();
        expect((modal as any).cleanupResult).toBeNull();
    });

    it("renders scan and delete failures without leaving the modal busy", async () => {
        const { modal } = makeModal();
        const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
        (modal as any).cleaner = {
            scanFolder: vi.fn().mockRejectedValue(new Error("scan failed")),
            deleteFiles: vi.fn().mockRejectedValue(new Error("delete failed"))
        };

        await (modal as any).startScan();
        expect((modal as any).isScanning).toBe(false);
        expect(modal.contentEl.querySelector(".status-error")?.textContent).toContain("scan failed");

        (modal as any).cleanupResult = {
            scannedFiles: 1,
            unreferencedFiles: [{ file: fakeTFile(), isReferenced: false, references: [] }],
            referencedFiles: []
        };
        await (modal as any).confirmDelete();
        expect(modal.contentEl.querySelector(".status-error")?.textContent).toContain("delete failed");
        expect(error).toHaveBeenCalledTimes(2);

        modal.onClose();
        expect(modal.contentEl.children).toHaveLength(0);
    });

    it("ignores duplicate delete confirmation while deletion is in progress", async () => {
        const { modal } = makeModal();
        const file = fakeTFile({ path: "assets/unused.png", name: "unused.png", extension: "png" });
        (modal as any).cleanupResult = {
            scannedFiles: 1,
            unreferencedFiles: [{ file, isReferenced: false, references: [] }],
            referencedFiles: [],
            unknownFiles: [],
            scanComplete: true,
            uncertainFiles: []
        };
        let finish!: () => void;
        const deleteFiles = vi.fn(() => new Promise<number>(resolve => {
            finish = () => resolve(1);
        }));
        (modal as any).cleaner = { deleteFiles };

        const first = (modal as any).confirmDelete();
        const duplicate = (modal as any).confirmDelete();
        expect(deleteFiles).toHaveBeenCalledOnce();
        finish();
        await Promise.all([first, duplicate]);

        expect((modal as any).isDeleting).toBe(false);
    });
});
