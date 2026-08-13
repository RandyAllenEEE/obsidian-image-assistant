import { App, normalizePath } from "obsidian";
import * as path from "path";
import { t } from "../../../lang/helpers";
import type ImageConverterPlugin from "../../../main";
import type { FolderAndFilenameManagement } from "../../../local/FolderAndFilenameManagement";
import type {
    VariableContext,
    VariableProcessor
} from "../../../local/VariableProcessor";
import {
    pipeSyntaxParser,
    type PipeSyntaxData,
    type SizeData
} from "../../../utils/PipeSyntaxParser";
import {
    resolveCanonicalImageSize,
    resolveElementIntrinsicDimensions
} from "../../../utils/CanonicalImageSize";
import { normalizeVaultFolderPath } from "../../../utils/VaultPathUtils";
import type {
    ImageContextMenuContext,
    ImagePropertyChanges,
    ImagePropertyUpdateResult
} from "../types";
import { EditorRangeMutationTransaction } from "../../../utils/EditorRangeMutationTransaction";
import {
    ImageRenameMoveCoordinator,
    type ImageRenameMoveResult
} from "../../../utils/ImageRenameMoveCoordinator";
import { inspectDrawingFile, stripDrawingCompoundSuffix } from "../../../drawing/DrawingFileSemantics";
import { DrawingAssetRenameCoordinator } from "../../../drawing/DrawingAssetRenameCoordinator";

/** Applies exact-link property changes before optionally renaming a local file. */
export class RenameHandler {
    private readonly editorTransaction = new EditorRangeMutationTransaction();
    constructor(
        private readonly app: App,
        private readonly plugin: ImageConverterPlugin,
        private readonly folderManagement: FolderAndFilenameManagement,
        private readonly variableProcessor: VariableProcessor,
        private readonly renameCoordinator: Pick<
            ImageRenameMoveCoordinator,
            "execute"
        > = new ImageRenameMoveCoordinator(app, plugin)
    ) {}

    async applyProperties(
        context: ImageContextMenuContext,
        changes: ImagePropertyChanges
    ): Promise<ImagePropertyUpdateResult> {
        const viewContext = context.viewContext;
        if (!viewContext || context.resolution !== "resolved") {
            return failure(t("MSG_IMAGE_CONTEXT_UNRESOLVED"));
        }

        const currentLine = viewContext.editor.getLine(viewContext.match.line);
        if (!this.isExactLinkCurrent(context, currentLine)) {
            return failure(t("MSG_IMAGE_PROPERTIES_SOURCE_CHANGED"));
        }

        const parsed = pipeSyntaxParser.parsePipeSyntax(
            viewContext.match.linkText
        );
        if (!parsed) return failure(t("MSG_IMAGE_PROPERTIES_PARSE_FAILED"));

        const dimensionError = validateDimensions(changes);
        if (dimensionError) return failure(dimensionError);

        const size = resolveCanonicalImageSize({
            width: changes.width,
            height: changes.height,
            intrinsic: resolveElementIntrinsicDimensions(
                context.image ?? context.mediaElement
            )
        });
        if (changes.height !== null && changes.width === null && !size) {
            return failure(t("MSG_DIMENSIONS_RATIO_REQUIRED"));
        }

        const updatedLink = this.buildUpdatedLink(
            viewContext.match.linkText,
            parsed,
            changes,
            size
        );
        let linkUpdated = false;
        if (updatedLink !== viewContext.match.linkText) {
            const mutation = await this.editorTransaction.run(viewContext, {
                line: viewContext.match.line,
                start: viewContext.match.start,
                end: viewContext.match.end,
                expectedText: viewContext.match.linkText,
                replacement: updatedLink
            });
            if (!mutation.saved) {
                return failure(mutation.stale
                    ? t("MSG_IMAGE_PROPERTIES_SOURCE_CHANGED")
                    : mutation.uncertain
                        ? t("MSG_EDITOR_SAVE_UNCERTAIN")
                    : mutation.error ?? t("MSG_UNKNOWN_ERROR"));
            }
            linkUpdated = true;
        }

        if (context.sourceKind !== "local" || !context.localFile) {
            this.refreshViews();
            return success(linkUpdated, false);
        }

        const renameResult = await this.renameLocalFile(
            context,
            changes.fileName ?? context.localFile.basename,
            changes.directory ?? context.localFile.parent?.path ?? "/"
        );
        this.refreshViews();
        if (!renameResult.complete) {
            return {
                complete: false,
                linkUpdated,
                fileMoved: renameResult.fileMoved,
                sourcePath: renameResult.sourcePath,
                targetPath: renameResult.targetPath,
                compatibilityCopyPreserved:
                    renameResult.compatibilityCopyPreserved,
                repairedReferences: renameResult.repairedReferences,
                failedFiles: renameResult.failedFiles,
                uncertainFiles: renameResult.uncertainFiles,
                error: renameResult.error
            };
        }
        return success(linkUpdated, renameResult.fileMoved);
    }

    private buildUpdatedLink(
        originalLink: string,
        parsed: PipeSyntaxData,
        changes: ImagePropertyChanges,
        size: SizeData | undefined
    ): string {
        parsed.alt = changes.caption
            ? changes.caption.replace(/\|/g, "\\|")
            : " ";
        parsed.align = changes.alignment;
        parsed.size = size;
        return pipeSyntaxParser.rewritePipeAttributes(originalLink, parsed)
            ?? originalLink;
    }

    private isExactLinkCurrent(
        context: ImageContextMenuContext,
        line: string
    ): boolean {
        const match = context.viewContext?.match;
        const owner = context.owner;
        if (!match || !owner) return false;
        if (owner.view.file?.path !== owner.file.path) return false;
        if (match.line < 0 || match.start < 0 || match.end < match.start) {
            return false;
        }
        return match.end <= line.length
            && line.slice(match.start, match.end) === match.linkText;
    }

    private async renameLocalFile(
        context: ImageContextMenuContext,
        requestedName: string,
        requestedDirectory: string
    ): Promise<ImageRenameMoveResult & {
        readonly sourcePath?: string;
        readonly targetPath?: string;
    }> {
        const file = context.localFile;
        const activeFile = context.owner?.file;
        if (!file || !activeFile) {
            return {
                complete: false,
                fileMoved: false,
                compatibilityCopyCreated: false,
                compatibilityCopyPreserved: false,
                repairedReferences: 0,
                failedFiles: [],
                uncertainFiles: [],
                error: t("MSG_FILE_NOT_FOUND")
            };
        }
        const sourcePath = file.path;

        const variableContext: VariableContext = { file, activeFile };
        const createSession = this.variableProcessor.createSession?.bind(
            this.variableProcessor
        );
        const namingSession = createSession?.(variableContext);
        const directory = namingSession
            ? await namingSession.evaluate(requestedDirectory, {
                counterScope: activeFile.parent?.path ?? "/"
            })
            : await this.variableProcessor.processTemplate(
                requestedDirectory,
                variableContext
            );
        let fileName = namingSession
            ? await namingSession.evaluate(requestedName, {
                counterScope: directory
            })
            : await this.variableProcessor.processTemplate(
                requestedName,
                variableContext
            );
        fileName = this.folderManagement.sanitizeFilename(fileName);
        const drawing = inspectDrawingFile(this.plugin, file);
        const compoundSuffix = drawing?.compoundSuffix ?? null;
        if (drawing) fileName = stripDrawingCompoundSuffix(fileName, drawing).trim();
        if (!fileName.trim() || /^[.]+$/.test(fileName.trim())) {
            return {
                complete: false,
                fileMoved: false,
                compatibilityCopyCreated: false,
                compatibilityCopyPreserved: false,
                repairedReferences: 0,
                failedFiles: [],
                uncertainFiles: [],
                error: t("MSG_ENTER_VALID_NAME")
            };
        }
        if (!directory.trim()) {
            return {
                complete: false,
                fileMoved: false,
                compatibilityCopyCreated: false,
                compatibilityCopyPreserved: false,
                repairedReferences: 0,
                failedFiles: [],
                uncertainFiles: [],
                error: t("MSG_ENTER_NEW_PATH")
            };
        }

        let targetPath: string;
        try {
            targetPath = this.buildVaultPath(
                directory,
                `${fileName}${compoundSuffix ?? (file.extension ? `.${file.extension}` : "")}`
            );
        } catch (error) {
            return {
                complete: false,
                fileMoved: false,
                compatibilityCopyCreated: false,
                compatibilityCopyPreserved: false,
                repairedReferences: 0,
                failedFiles: [],
                uncertainFiles: [],
                error: getErrorMessage(error)
            };
        }
        if (targetPath === file.path) {
            return {
                complete: true,
                fileMoved: false,
                compatibilityCopyCreated: false,
                compatibilityCopyPreserved: false,
                repairedReferences: 0,
                failedFiles: [],
                uncertainFiles: [],
                sourcePath,
                targetPath
            };
        }

        if (drawing?.providerId === "excalidraw") {
            const coordinator = new DrawingAssetRenameCoordinator(
                this.app,
                this.renameCoordinator,
                async (target, destination) => {
                    if (destination.toLowerCase() === target.path.toLowerCase()) {
                        return this.folderManagement.safeRenameFile(target, destination);
                    }
                    await this.app.fileManager.renameFile(target, destination);
                    return true;
                }
            );
            const result = await coordinator.execute(drawing, targetPath);
            return { ...result, sourcePath, targetPath };
        }

        const result = await this.renameCoordinator.execute({
            file,
            targetPath,
            rename: async () => {
                await this.ensureTargetFolder(directory);
                if (targetPath.toLowerCase() === file.path.toLowerCase()) {
                    return this.folderManagement.safeRenameFile(file, targetPath);
                }
                await this.app.fileManager.renameFile(file, targetPath);
                return true;
            }
        });
        return { ...result, sourcePath, targetPath };
    }

    private buildVaultPath(directoryPath: string, filename: string): string {
        const normalizedDirectory = normalizeVaultFolderPath(directoryPath);
        const joined = normalizedDirectory === "/" || normalizedDirectory === ""
            ? filename
            : path.join(normalizedDirectory, filename);
        return normalizePath(joined).replace(/^\/+/, "");
    }

    private async ensureTargetFolder(directoryPath: string): Promise<void> {
        const normalizedDirectory = normalizeVaultFolderPath(directoryPath);
        if (normalizedDirectory && normalizedDirectory !== "/") {
            await this.folderManagement.ensureFolderExists(normalizedDirectory);
        }
    }

    private refreshViews(): void {
        this.plugin.imageStateManager?.refreshAllImages();
        this.plugin.imageCaption?.refreshAllViews();
    }
}

function validateDimensions(changes: ImagePropertyChanges): string | null {
    for (const value of [changes.width, changes.height]) {
        if (value !== null && (!Number.isInteger(value) || value <= 0)) {
            return t("MSG_DIMENSIONS_POSITIVE");
        }
    }
    return null;
}

function success(
    linkUpdated: boolean,
    fileMoved: boolean
): ImagePropertyUpdateResult {
    return { complete: true, linkUpdated, fileMoved };
}

function failure(error: string): ImagePropertyUpdateResult {
    return {
        complete: false,
        linkUpdated: false,
        fileMoved: false,
        error
    };
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
