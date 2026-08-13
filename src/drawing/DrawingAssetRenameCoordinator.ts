import { App, TFile, normalizePath } from "obsidian";
import { t } from "../lang/helpers";
import { AsyncLock } from "../utils/AsyncLock";
import type {
    ImageRenameMoveCoordinator,
    ImageRenameMoveResult
} from "../utils/ImageRenameMoveCoordinator";
import type { DrawingFileSemantics } from "./DrawingContracts";
import {
    EXCALIDRAW_SOURCE_SUFFIXES,
    getExcalidrawAssetFamily
} from "./DrawingFileSemantics";

interface RenameStep {
    readonly file: TFile;
    readonly from: string;
    readonly to: string;
}

/** Coordinates a logical Excalidraw source and its same-stem native previews. */
export class DrawingAssetRenameCoordinator {
    private static readonly lock = new AsyncLock();

    constructor(
        private readonly app: App,
        private readonly singleFile: Pick<ImageRenameMoveCoordinator, "execute">,
        private readonly moveFile: (file: TFile, targetPath: string) => Promise<boolean>
    ) {}

    async execute(
        semantics: DrawingFileSemantics,
        requestedTargetPath: string
    ): Promise<ImageRenameMoveResult> {
        if (semantics.providerId !== "excalidraw" || !semantics.sourceFile) {
            return failure(t("MSG_DRAWING_RENAME_UNSUPPORTED"));
        }
        return DrawingAssetRenameCoordinator.lock.acquire(
            `excalidraw-family:${semantics.sourceFile.path}`,
            () => this.executeLocked(semantics, requestedTargetPath)
        );
    }

    private async executeLocked(
        semantics: DrawingFileSemantics,
        requestedTargetPath: string
    ): Promise<ImageRenameMoveResult> {
        const family = getExcalidrawAssetFamily(this.app, semantics);
        const source = semantics.sourceFile!;
        const sourceSuffix = suffixOf(source.path, EXCALIDRAW_SOURCE_SUFFIXES);
        const clickedSuffix = semantics.compoundSuffix;
        if (!sourceSuffix || !clickedSuffix
            || !requestedTargetPath.toLowerCase().endsWith(clickedSuffix)) {
            return failure(t("MSG_DRAWING_RENAME_UNSUPPORTED"));
        }
        const oldStem = source.path.slice(0, -sourceSuffix.length);
        const newStem = normalizePath(
            requestedTargetPath.slice(0, -clickedSuffix.length)
        );
        const familyPaths = new Set(family.map(file => file.path.toLowerCase()));
        const steps: RenameStep[] = family.map(file => {
            const suffix = file.path.startsWith(oldStem)
                ? file.path.slice(oldStem.length)
                : "";
            return {
                file,
                from: file.path,
                to: normalizePath(`${newStem}${suffix}`)
            };
        }).filter(step => step.from !== step.to);

        const duplicateTargets = new Set<string>();
        for (const step of steps) {
            const key = step.to.toLowerCase();
            if (duplicateTargets.has(key)) {
                return failure(t("MSG_DRAWING_RENAME_TARGET_CONFLICT", [step.to]));
            }
            duplicateTargets.add(key);
            const occupied = this.findCaseInsensitive(step.to);
            if (occupied && !familyPaths.has(occupied.path.toLowerCase())) {
                return failure(t("MSG_DRAWING_RENAME_TARGET_CONFLICT", [step.to]));
            }
        }

        // Moving derivatives first prevents Excalidraw's optional keepInSync
        // listener from racing us when the source rename event is emitted.
        steps.sort((a, b) => Number(a.file === source) - Number(b.file === source));
        const completed: RenameStep[] = [];
        const aggregate = emptyAggregate();
        for (const step of steps) {
            const result = await this.singleFile.execute({
                file: step.file,
                targetPath: step.to,
                rename: () => this.moveFile(step.file, step.to)
            });
            merge(aggregate, result);
            if (!result.complete) {
                // A single-file coordinator can report a partial result after
                // the physical move succeeded but reference repair did not.
                // Include that step in rollback instead of misreporting it as
                // unmoved.
                if (result.fileMoved) completed.push(step);
                const rollback = await this.rollback(completed);
                merge(aggregate, rollback);
                return {
                    ...aggregate,
                    complete: false,
                    fileMoved: !rollback.complete,
                    error: rollback.complete
                        ? result.error ?? t("MSG_RENAME_NOT_COMPLETED")
                        : t("MSG_DRAWING_RENAME_ROLLBACK_PARTIAL", [
                            result.error ?? t("MSG_RENAME_NOT_COMPLETED")
                        ])
                };
            }
            completed.push(step);
        }
        return { ...aggregate, complete: true, fileMoved: completed.length > 0 };
    }

    private async rollback(completed: readonly RenameStep[]): Promise<ImageRenameMoveResult> {
        const aggregate = emptyAggregate();
        let complete = true;
        for (const step of [...completed].reverse()) {
            const current = this.app.vault.getAbstractFileByPath(step.to);
            if (!(current instanceof TFile)) {
                complete = false;
                aggregate.failedFiles.push(step.to);
                continue;
            }
            const result = await this.singleFile.execute({
                file: current,
                targetPath: step.from,
                rename: () => this.moveFile(current, step.from)
            });
            merge(aggregate, result);
            complete = complete && result.complete;
        }
        return { ...aggregate, complete, fileMoved: !complete };
    }

    private findCaseInsensitive(path: string): TFile | null {
        const exact = this.app.vault.getAbstractFileByPath(path);
        if (exact instanceof TFile) return exact;
        const lower = path.toLowerCase();
        return this.app.vault.getFiles().find(file => file.path.toLowerCase() === lower) ?? null;
    }
}

function suffixOf(path: string, suffixes: readonly string[]): string | null {
    const lower = path.toLowerCase();
    return suffixes.find(suffix => lower.endsWith(suffix)) ?? null;
}

function emptyAggregate(): MutableResult {
    return {
        complete: true,
        fileMoved: false,
        compatibilityCopyCreated: false,
        compatibilityCopyPreserved: false,
        repairedReferences: 0,
        failedFiles: [],
        uncertainFiles: []
    };
}

interface MutableResult {
    complete: boolean;
    fileMoved: boolean;
    compatibilityCopyCreated: boolean;
    compatibilityCopyPreserved: boolean;
    repairedReferences: number;
    failedFiles: string[];
    uncertainFiles: string[];
    error?: string;
}

function merge(target: MutableResult, result: ImageRenameMoveResult): void {
    target.compatibilityCopyCreated ||= result.compatibilityCopyCreated;
    target.compatibilityCopyPreserved ||= result.compatibilityCopyPreserved;
    target.repairedReferences += result.repairedReferences;
    target.failedFiles.push(...result.failedFiles);
    target.uncertainFiles.push(...result.uncertainFiles);
}

function failure(error: string): ImageRenameMoveResult {
    return { ...emptyAggregate(), complete: false, error };
}
