import { App, TFile } from "obsidian";
import { assertCanvasOutputMatchesExtension } from "./CanvasImageOutput";
import { AsyncLock } from "./AsyncLock";
import {
    captureImageFileRevision,
    type ImageFileRevision,
    verifyImageFileRevision
} from "./ImageFileRevision";

export interface ImageEditCommitRequest {
    readonly file: TFile;
    readonly expectedRevision: ImageFileRevision;
    readonly data: ArrayBuffer;
}

export interface ImageEditCommitResult {
    readonly success: boolean;
    readonly written: boolean;
    readonly stale: boolean;
    readonly revision?: ImageFileRevision;
    readonly error?: string;
}

/** Serializes verified in-place image writes by immutable vault path. */
export class ImageEditCommitService {
    private static readonly writeLock = new AsyncLock();

    constructor(private readonly app: App) { }

    async commit(request: ImageEditCommitRequest): Promise<ImageEditCommitResult> {
        return ImageEditCommitService.writeLock.acquire(
            request.expectedRevision.path,
            () => this.commitUnlocked(request)
        );
    }

    private async commitUnlocked(
        request: ImageEditCommitRequest
    ): Promise<ImageEditCommitResult> {
        if (request.data.byteLength === 0) {
            return failure("Image output was empty");
        }

        const revisionCheck = await verifyImageFileRevision(
            this.app,
            request.expectedRevision
        );
        if (!revisionCheck.matches) {
            return {
                success: false,
                written: false,
                stale: true,
                error: revisionCheck.error ?? revisionCheck.reason ?? "Image source changed"
            };
        }

        const currentFile = this.app.vault.getAbstractFileByPath(
            request.expectedRevision.path
        );
        if (!(currentFile instanceof TFile) || currentFile.path !== request.file.path) {
            return {
                success: false,
                written: false,
                stale: true,
                error: "Image source is no longer available at its original path"
            };
        }

        try {
            await assertCanvasOutputMatchesExtension(
                request.data,
                currentFile.extension
            );
            await this.app.vault.modifyBinary(currentFile, request.data);
            return {
                success: true,
                written: true,
                stale: false,
                revision: await captureImageFileRevision(
                    this.app,
                    currentFile,
                    request.data
                )
            };
        } catch (error) {
            return failure(getErrorMessage(error));
        }
    }
}

function failure(error: string): ImageEditCommitResult {
    return {
        success: false,
        written: false,
        stale: false,
        error
    };
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
