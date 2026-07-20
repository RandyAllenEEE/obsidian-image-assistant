import { App, TFile } from "obsidian";
import type ImageConverterPlugin from "../main";
import { t } from "../lang/helpers";
import { AsyncLock } from "./AsyncLock";
import {
    ImageReferenceWorkflowCoordinator,
    type ReferenceInventory,
    type ReferenceWorkflowResult
} from "./ImageReferenceWorkflowCoordinator";
import {
    captureImageFileRevision,
    verifyImageFileRevision
} from "./ImageFileRevision";

export interface ImageRenameMoveRequest {
    readonly file: TFile;
    readonly targetPath: string;
    readonly rename: () => Promise<boolean>;
}

export interface ImageRenameMoveResult {
    readonly complete: boolean;
    readonly fileMoved: boolean;
    readonly compatibilityCopyCreated: boolean;
    readonly compatibilityCopyPreserved: boolean;
    readonly repairedReferences: number;
    readonly failedFiles: readonly string[];
    readonly uncertainFiles: readonly string[];
    readonly error?: string;
}

export class ImageRenameMoveCoordinator {
    private static readonly lock = new AsyncLock();
    private readonly workflow: ImageReferenceWorkflowCoordinator;

    constructor(
        private readonly app: App,
        plugin: ImageConverterPlugin,
        workflow?: ImageReferenceWorkflowCoordinator
    ) {
        this.workflow = workflow
            ?? new ImageReferenceWorkflowCoordinator(app, plugin);
    }

    async execute(request: ImageRenameMoveRequest): Promise<ImageRenameMoveResult> {
        const oldPath = request.file.path;
        return ImageRenameMoveCoordinator.lock.acquire(
            `rename:${oldPath}`,
            async () => this.executeLocked(request, oldPath)
        );
    }

    private async executeLocked(
        request: ImageRenameMoveRequest,
        oldPath: string
    ): Promise<ImageRenameMoveResult> {
        const preflight = await this.workflow.inspect({
            kind: "local",
            file: request.file
        });
        const blockers = getInventoryBlockers(preflight);
        if (blockers.length > 0) {
            return failure(false, false, false, blockers, [
                ...preflight.uncertainFiles
            ], t("MSG_RENAME_SAFETY_INCOMPLETE"));
        }

        let backup: ArrayBuffer;
        try {
            backup = await this.app.vault.readBinary(request.file);
        } catch (error) {
            return failure(false, false, false, [oldPath], [], getErrorMessage(error));
        }
        let revisionCheck: Awaited<ReturnType<typeof verifyImageFileRevision>>;
        try {
            const expectedRevision = await captureImageFileRevision(
                this.app,
                request.file,
                backup
            );
            revisionCheck = await verifyImageFileRevision(
                this.app,
                expectedRevision
            );
        } catch (error) {
            return failure(
                false,
                false,
                false,
                [],
                [oldPath],
                getErrorMessage(error)
            );
        }
        if (!revisionCheck.matches) {
            return failure(
                false,
                false,
                false,
                [],
                [oldPath],
                revisionCheck.error
                    ?? revisionCheck.reason
                    ?? t("MSG_RENAME_SOURCE_CHANGED")
            );
        }

        let renamed = false;
        try {
            renamed = await request.rename();
        } catch (error) {
            return failure(false, false, false, [oldPath], [], getErrorMessage(error));
        }
        if (!renamed) {
            return failure(
                false,
                false,
                false,
                [oldPath],
                [],
                t("MSG_RENAME_NOT_COMPLETED")
            );
        }

        const moved = this.app.vault.getAbstractFileByPath(request.targetPath);
        if (!(moved instanceof TFile)) {
            const compatibility = await this.ensureCompatibilityCopy(
                oldPath,
                backup
            );
            return failure(
                true,
                compatibility.created,
                !!compatibility.file,
                [request.targetPath],
                [],
                compatibility.error
                    ?? t("MSG_RENAME_TARGET_UNRESOLVED")
            );
        }

        const compatibility = await this.ensureCompatibilityCopy(oldPath, backup);
        if (!compatibility.file) {
            return failure(
                true,
                false,
                false,
                [oldPath],
                [],
                compatibility.error ?? t("MSG_RENAME_COMPAT_CREATE_FAILED")
            );
        }

        const mutation = await this.repairOldReferences(
            compatibility.file,
            moved
        );
        const mutationComplete = mutation.complete
            && mutation.changed === mutation.found;
        if (!mutationComplete) {
            return {
                complete: false,
                fileMoved: true,
                compatibilityCopyCreated: compatibility.created,
                compatibilityCopyPreserved: true,
                repairedReferences: mutation.changed,
                failedFiles: Object.freeze([...mutation.failedFiles]),
                uncertainFiles: Object.freeze([...mutation.uncertainFiles]),
                error: t("MSG_RENAME_REFERENCES_PARTIAL")
            };
        }

        if (!compatibility.created) {
            return {
                complete: true,
                fileMoved: true,
                compatibilityCopyCreated: false,
                compatibilityCopyPreserved: true,
                repairedReferences: mutation.changed,
                failedFiles: Object.freeze([]),
                uncertainFiles: Object.freeze([])
            };
        }

        const deletion = await this.workflow.deleteSource({
            kind: "local",
            file: compatibility.file
        });
        if (!deletion.sourceDeleted) {
            return {
                complete: false,
                fileMoved: true,
                compatibilityCopyCreated: true,
                compatibilityCopyPreserved: true,
                repairedReferences: mutation.changed,
                failedFiles: Object.freeze([...deletion.failedFiles]),
                uncertainFiles: Object.freeze([...deletion.uncertainFiles]),
                error: t("MSG_RENAME_COMPAT_RETAINED")
            };
        }

        return {
            complete: true,
            fileMoved: true,
            compatibilityCopyCreated: true,
            compatibilityCopyPreserved: false,
            repairedReferences: mutation.changed,
            failedFiles: Object.freeze([]),
            uncertainFiles: Object.freeze([])
        };
    }

    private async ensureCompatibilityCopy(
        oldPath: string,
        data: ArrayBuffer
    ): Promise<{ file: TFile | null; created: boolean; error?: string }> {
        const existing = this.app.vault.getAbstractFileByPath(oldPath);
        if (existing instanceof TFile) {
            try {
                const existingData = await this.app.vault.readBinary(existing);
                return equalBytes(existingData, data)
                    ? { file: existing, created: false }
                    : {
                        file: null,
                        created: false,
                        error: t("MSG_RENAME_ORIGINAL_OCCUPIED_FILE")
                    };
            } catch (error) {
                return {
                    file: null,
                    created: false,
                    error: getErrorMessage(error)
                };
            }
        }
        if (existing) {
            return {
                file: null,
                created: false,
                error: t("MSG_RENAME_ORIGINAL_OCCUPIED_FOLDER")
            };
        }

        try {
            const file = await this.app.vault.createBinary(oldPath, data);
            return { file, created: true };
        } catch (error) {
            return {
                file: null,
                created: false,
                error: getErrorMessage(error)
            };
        }
    }

    private async repairOldReferences(
        oldFile: TFile,
        newFile: TFile
    ): Promise<ReferenceWorkflowResult> {
        let inventory = await this.workflow.inspect({
            kind: "local",
            file: oldFile
        });
        const blockers = getInventoryBlockers(inventory);
        if (blockers.length > 0) {
            return {
                found: inventory.totalReferences,
                changed: 0,
                complete: false,
                failedFiles: blockers,
                uncertainFiles: inventory.uncertainFiles,
                sourceDeleted: false
            };
        }

        let result = await this.workflow.replace(
            inventory,
            { kind: "local", file: newFile },
            "all"
        );
        if (result.staleInventory) {
            inventory = result.staleInventory;
            if (getInventoryBlockers(inventory).length > 0) return result;
            result = await this.workflow.replace(
                inventory,
                { kind: "local", file: newFile },
                "all"
            );
        }
        return result;
    }
}

function getInventoryBlockers(inventory: ReferenceInventory): string[] {
    const blockers = [...inventory.uncertainFiles];
    if (!inventory.safety.complete) {
        blockers.push(t("MSG_RENAME_SAFETY_SCAN_INCOMPLETE"));
    }
    if (!inventory.mutableComplete) {
        blockers.push(t("MSG_RENAME_MUTATION_SCAN_INCOMPLETE"));
    }
    if (inventory.protectedFencedReferences > 0) {
        blockers.push(t("MSG_RENAME_PROTECTED_REFERENCES", [
            inventory.protectedFencedReferences
        ]));
    }
    if (inventory.outOfBoundaryReferences > 0) {
        blockers.push(t("MSG_RENAME_OUT_OF_BOUNDARY_REFERENCES", [
            inventory.outOfBoundaryReferences
        ]));
    }
    return [...new Set(blockers)];
}

function equalBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
    if (left.byteLength !== right.byteLength) return false;
    const leftBytes = new Uint8Array(left);
    const rightBytes = new Uint8Array(right);
    for (let index = 0; index < leftBytes.length; index++) {
        if (leftBytes[index] !== rightBytes[index]) return false;
    }
    return true;
}

function failure(
    fileMoved: boolean,
    compatibilityCopyCreated: boolean,
    compatibilityCopyPreserved: boolean,
    failedFiles: readonly string[],
    uncertainFiles: readonly string[],
    error: string
): ImageRenameMoveResult {
    return {
        complete: false,
        fileMoved,
        compatibilityCopyCreated,
        compatibilityCopyPreserved,
        repairedReferences: 0,
        failedFiles: Object.freeze([...failedFiles]),
        uncertainFiles: Object.freeze([...uncertainFiles]),
        error
    };
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
