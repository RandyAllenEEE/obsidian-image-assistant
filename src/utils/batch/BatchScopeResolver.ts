import { App, TFile, TFolder } from "obsidian";
import type ImageConverterPlugin from "../../main";
import type { BatchScope } from "../../types/BatchTypes";
import { t } from "../../lang/helpers";
import { getContextualReferenceLinks } from "../MarkdownSourceContext";
import { LocalImageTargetResolver } from "../LocalImageTargetResolver";
import { isHttpUrl } from "../NetworkPolicy";
import { ImageFileCollector } from "./ImageFileCollector";

export interface BatchScopeDiscovery<T> {
    readonly items: T[];
    readonly complete: boolean;
    readonly failedFiles: string[];
    readonly uncertainFiles: string[];
}

export class BatchScopeResolver {
    private readonly imageCollector: ImageFileCollector;
    private readonly localTargetResolver: LocalImageTargetResolver;

    constructor(
        private readonly app: App,
        private readonly plugin: ImageConverterPlugin
    ) {
        this.imageCollector = new ImageFileCollector(app, plugin);
        this.localTargetResolver = new LocalImageTargetResolver(app);
    }

    collectSourceDocuments(
        scope: BatchScope,
        target: TFile | TFolder | null
    ): BatchScopeDiscovery<TFile> {
        const failedFiles: string[] = [];
        const uncertainFiles: string[] = [];
        let items: TFile[] = [];

        if (scope === "note" && target instanceof TFile
            && (target.extension === "md" || target.extension === "canvas")) {
            items = [target];
        } else if (scope === "folder" && target instanceof TFolder) {
            items = this.app.vault.getFiles().filter(file =>
                isDocument(file) && isFileInFolder(file, target)
            );
        } else if (scope === "vault") {
            items = this.app.vault.getFiles().filter(isDocument);
        } else {
            const label = target?.path || scope;
            failedFiles.push(t("BATCH_INVALID_SCOPE_TARGET", [label]));
            uncertainFiles.push(label);
        }

        return discovery(sortAndDedupe(items), failedFiles, uncertainFiles);
    }

    async collectLocalAssets(
        scope: BatchScope,
        target: TFile | TFolder | null
    ): Promise<BatchScopeDiscovery<TFile>> {
        if (scope === "folder" && target instanceof TFolder) {
            return discovery(
                sortAndDedupe(this.imageCollector.getImageFilesInFolder(target, true)),
                [],
                []
            );
        }
        if (scope === "vault") {
            return discovery(
                sortAndDedupe(this.app.vault.getFiles().filter(file =>
                    this.plugin.supportedImageFormats.isSupported(file.extension, file.name)
                )),
                [],
                []
            );
        }
        if (scope !== "note" || !(target instanceof TFile)
            || (target.extension !== "md" && target.extension !== "canvas")) {
            const label = target?.path || scope;
            return discovery(
                [],
                [t("BATCH_INVALID_SCOPE_TARGET", [label])],
                [label]
            );
        }
        return target.extension === "canvas"
            ? this.collectCanvasAssets(target)
            : this.collectMarkdownAssets(target);
    }

    getAllowedDocumentPaths(
        scope: BatchScope,
        target: TFile | TFolder | null
    ): Set<string> {
        return new Set(
            this.collectSourceDocuments(scope, target).items.map(file => file.path)
        );
    }

    getImageCollector(): ImageFileCollector {
        return this.imageCollector;
    }

    private async collectCanvasAssets(canvasFile: TFile): Promise<BatchScopeDiscovery<TFile>> {
        const result = await this.imageCollector.getImagesFromCanvasDetailed(canvasFile);
        const items: TFile[] = [];
        const uncertainFiles: string[] = [];
        for (const path of result.paths) {
            const file = this.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile
                && this.plugin.supportedImageFormats.isSupported(file.extension, file.name)) {
                items.push(file);
            } else if (this.plugin.supportedImageFormats.isSupported(undefined, path)) {
                uncertainFiles.push(`${canvasFile.path}: ${path}`);
            }
        }
        const failedFiles = result.complete
            ? []
            : [`${canvasFile.path}: ${result.error ?? t("MSG_UNKNOWN_ERROR")}`];
        return discovery(
            sortAndDedupe(items),
            failedFiles,
            uniqueSorted([
                ...uncertainFiles,
                ...(result.complete ? [] : [canvasFile.path])
            ])
        );
    }

    private async collectMarkdownAssets(noteFile: TFile): Promise<BatchScopeDiscovery<TFile>> {
        const files = new Map<string, TFile>();
        const failedFiles: string[] = [];
        const uncertainFiles: string[] = [];
        const add = (file: TFile | null): void => {
            if (file && this.plugin.supportedImageFormats.isSupported(file.extension, file.name)) {
                files.set(file.path, file);
            }
        };

        const cache = this.app.metadataCache.getFileCache(noteFile);
        for (const link of [...(cache?.embeds ?? []), ...(cache?.links ?? [])]) {
            add(this.app.metadataCache.getFirstLinkpathDest(link.link, noteFile.path));
        }

        let content: string;
        try {
            content = await this.app.vault.read(noteFile);
        } catch (error) {
            return discovery(
                sortAndDedupe([...files.values()]),
                [`${noteFile.path}: ${error instanceof Error ? error.message : String(error)}`],
                [noteFile.path]
            );
        }

        for (const link of getContextualReferenceLinks(content, {
            includeFencedCode: this.plugin.settings.global.codeBlockImageLinkIndexing
        })) {
            if (isHttpUrl(link.path)) continue;
            const resolution = this.localTargetResolver.resolve(link.path, noteFile, {
                syntax: link.syntax === "markdown" ? "markdown" : "wiki"
            });
            if (resolution.status === "resolved" && resolution.file) {
                add(resolution.file);
                continue;
            }
            if (resolution.status !== "resolved"
                && this.plugin.supportedImageFormats.isSupported(undefined, link.path)) {
                uncertainFiles.push(`${noteFile.path}: ${link.path}`);
            }
        }

        return discovery(
            sortAndDedupe([...files.values()]),
            failedFiles,
            uniqueSorted(uncertainFiles)
        );
    }
}

function isDocument(file: TFile): boolean {
    return file.extension === "md" || file.extension === "canvas";
}

function isFileInFolder(file: TFile, folder: TFolder): boolean {
    const folderPath = folder.path.replace(/\\/g, "/").replace(/\/+$/, "");
    if (!folderPath) return true;
    return file.path.replace(/\\/g, "/").startsWith(`${folderPath}/`);
}

function sortAndDedupe(files: readonly TFile[]): TFile[] {
    return [...new Map(files.map(file => [file.path, file])).values()]
        .sort((left, right) => left.path.localeCompare(right.path));
}

function uniqueSorted(values: readonly string[]): string[] {
    return [...new Set(values)].sort();
}

function discovery<T>(
    items: T[],
    failedFiles: string[],
    uncertainFiles: string[]
): BatchScopeDiscovery<T> {
    return {
        items,
        complete: failedFiles.length === 0 && uncertainFiles.length === 0,
        failedFiles,
        uncertainFiles
    };
}
