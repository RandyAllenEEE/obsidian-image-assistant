import { App, TFile } from "obsidian";
import { sha256Hex } from "./BinaryHash";

export interface ImageFileRevision {
    readonly path: string;
    readonly size: number;
    readonly mtime: number;
    readonly sha256: string;
}

export interface ImageFileRevisionCheck {
    readonly matches: boolean;
    readonly current?: ImageFileRevision;
    readonly reason?: "missing" | "path-changed" | "content-changed" | "read-failed";
    readonly error?: string;
}

export async function captureImageFileRevision(
    app: App,
    file: TFile,
    data?: ArrayBuffer
): Promise<ImageFileRevision> {
    const bytes = data ?? await app.vault.readBinary(file);
    return Object.freeze({
        path: file.path,
        size: bytes.byteLength,
        mtime: file.stat.mtime,
        sha256: await sha256Hex(bytes)
    });
}

export async function verifyImageFileRevision(
    app: App,
    expected: ImageFileRevision
): Promise<ImageFileRevisionCheck> {
    const currentFile = app.vault.getAbstractFileByPath(expected.path);
    if (!(currentFile instanceof TFile)) {
        return Object.freeze({ matches: false, reason: "missing" });
    }
    if (currentFile.path !== expected.path) {
        return Object.freeze({ matches: false, reason: "path-changed" });
    }

    try {
        const current = await captureImageFileRevision(app, currentFile);
        const matches = current.size === expected.size
            && current.mtime === expected.mtime
            && current.sha256 === expected.sha256;
        return Object.freeze({
            matches,
            current,
            ...(matches
                ? {}
                : { reason: "content-changed" as const })
        });
    } catch (error) {
        return Object.freeze({
            matches: false,
            reason: "read-failed",
            error: getErrorMessage(error)
        });
    }
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
