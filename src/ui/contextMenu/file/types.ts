import type { TFile, TFolder } from "obsidian";
import type { BatchOperationRequest } from "../batch/BatchOperationLauncher";

export type FileContextMenuTargetKind = "drawing" | "image" | "note" | "folder" | "vault";

export type FileContextMenuContext =
    | {
        readonly kind: "drawing";
        readonly file: TFile;
    }
    | {
        readonly kind: "image";
        readonly file: TFile;
    }
    | {
        readonly kind: Exclude<FileContextMenuTargetKind, "drawing" | "image">;
        readonly target: TFile | TFolder | null;
        readonly request: BatchOperationRequest;
    };
