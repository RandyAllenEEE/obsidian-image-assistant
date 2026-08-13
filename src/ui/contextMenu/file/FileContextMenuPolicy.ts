import { App, TAbstractFile, TFile, TFolder } from "obsidian";
import type { SupportedImageFormats } from "../../../local/SupportedImageFormats";
import type { FileContextMenuContext } from "./types";

export class FileContextMenuPolicy {
    constructor(
        private readonly app: App,
        private readonly supportedFormats: SupportedImageFormats,
        private readonly isDrawing: (file: TFile) => boolean = () => false
    ) {}

    resolve(target: TAbstractFile): FileContextMenuContext | null {
        if (target instanceof TFile) {
            if (this.isDrawing(target)) return { kind: "drawing", file: target };
            if (this.supportedFormats.isSupported(undefined, target.name)) {
                return { kind: "image", file: target };
            }
            if (target.extension === "md" || target.extension === "canvas") {
                return {
                    kind: "note",
                    target,
                    request: { scope: "note", target, mode: "local_process" }
                };
            }
            return null;
        }

        if (!(target instanceof TFolder)) return null;
        if (this.isVaultRoot(target)) {
            return {
                kind: "vault",
                target: null,
                request: { scope: "vault", target: null, mode: "local_process" }
            };
        }
        return {
            kind: "folder",
            target,
            request: { scope: "folder", target, mode: "local_process" }
        };
    }

    private isVaultRoot(folder: TFolder): boolean {
        return folder === this.app.vault.getRoot()
            || folder.isRoot?.() === true
            || folder.path.replace(/[\\/]+/g, "") === "";
    }
}
