import type { TFile, TFolder } from "obsidian";
import type { BatchOperationRequest } from "../batch/BatchOperationLauncher";

export type FileContextMenuTargetKind = "image" | "note" | "folder" | "vault";

export type FileContextMenuContext =
    | {
        readonly kind: "image";
        readonly file: TFile;
    }
    | {
        readonly kind: Exclude<FileContextMenuTargetKind, "image">;
        readonly target: TFile | TFolder | null;
        readonly request: BatchOperationRequest;
    };
