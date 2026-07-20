import { describe, expect, it, vi } from "vitest";
import {
    isValidBatchOperationRequest
} from "../../../../../src/ui/contextMenu/batch/BatchOperationLauncher";
import {
    registerBatchCommands
} from "../../../../../src/ui/contextMenu/batch/registerBatchCommands";
import {
    fakeApp,
    fakeTFile,
    fakeTFolder,
    fakeVault
} from "../../../../factories/obsidian";

describe("batch operation commands", () => {
    it("registers the compatible three-by-three command matrix", () => {
        const commands: Array<{ id: string; callback: () => void }> = [];
        const plugin = {
            addCommand: vi.fn((command: { id: string; callback: () => void }) => {
                commands.push(command);
            })
        } as any;
        const launcher = {
            open: vi.fn(),
            openCurrentNote: vi.fn(),
            chooseFolder: vi.fn()
        } as any;

        registerBatchCommands(plugin, launcher);

        expect(commands.map(command => command.id)).toEqual([
            "process-all-vault-images",
            "process-all-images-current-note",
            "process-folder-images",
            "upload-all-vault-images",
            "upload-all-images-current-note",
            "upload-folder-images",
            "download-network-images-current-note",
            "download-network-images-folder",
            "download-network-images-vault"
        ]);
        commands.forEach(command => command.callback());
        expect(launcher.open).toHaveBeenNthCalledWith(
            1,
            { scope: "vault", target: null, mode: "local_process" }
        );
        expect(launcher.open).toHaveBeenNthCalledWith(
            2,
            { scope: "vault", target: null, mode: "upload" }
        );
        expect(launcher.open).toHaveBeenNthCalledWith(
            3,
            { scope: "vault", target: null, mode: "download" }
        );
        expect(launcher.openCurrentNote.mock.calls.map(([mode]: [string]) => mode))
            .toEqual(["local_process", "upload", "download"]);
        expect(launcher.chooseFolder.mock.calls.map(([mode]: [string]) => mode))
            .toEqual(["local_process", "upload", "download"]);
    });

    it("validates the discriminated scope and target combinations", () => {
        const folder = fakeTFolder({ path: "projects" });
        const root = fakeTFolder({ path: "/" });
        const vault = fakeVault({ folders: [folder, root] });
        const app = fakeApp({ vault }) as any;
        const note = fakeTFile({ path: "notes/source.md", extension: "md" });
        const canvas = fakeTFile({ path: "boards/source.canvas", extension: "canvas" });
        const image = fakeTFile({ path: "assets/photo.png", extension: "png" });

        expect(isValidBatchOperationRequest(app, {
            scope: "note",
            target: note,
            mode: "download"
        })).toBe(true);
        expect(isValidBatchOperationRequest(app, {
            scope: "note",
            target: canvas,
            mode: "upload"
        })).toBe(true);
        expect(isValidBatchOperationRequest(app, {
            scope: "note",
            target: image,
            mode: "local_process"
        })).toBe(false);
        expect(isValidBatchOperationRequest(app, {
            scope: "folder",
            target: folder,
            mode: "local_process"
        })).toBe(true);
        expect(isValidBatchOperationRequest(app, {
            scope: "folder",
            target: root,
            mode: "upload"
        })).toBe(false);
        expect(isValidBatchOperationRequest(app, {
            scope: "vault",
            target: null,
            mode: "download"
        })).toBe(true);
    });
});
