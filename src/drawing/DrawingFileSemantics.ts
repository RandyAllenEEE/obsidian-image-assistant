import { App, TFile, normalizePath } from "obsidian";
import type { DrawingFileSemantics } from "./DrawingContracts";
import { getDrawioDiagramSuffix, isDrawioDiagramFile } from "./drawio/DiagramFile";

export interface ExcalidrawFileRecognizer {
    isExcalidrawFile(file: TFile): boolean;
}

export const EXCALIDRAW_SOURCE_SUFFIXES = [".excalidraw.md", ".excalidraw"] as const;
export const EXCALIDRAW_PREVIEW_SUFFIXES = [
    ".excalidraw.dark.svg",
    ".excalidraw.light.svg",
    ".excalidraw.dark.png",
    ".excalidraw.light.png",
    ".excalidraw.svg",
    ".excalidraw.png"
] as const;

export class DrawingFileInspector {
    constructor(
        private readonly app: App,
        private readonly excalidraw: ExcalidrawFileRecognizer
    ) {}

    inspect(file: TFile): DrawingFileSemantics | null {
        const drawio = inspectDrawioFile(file);
        if (drawio) return drawio;

        const previewSuffix = readSuffix(file.name, EXCALIDRAW_PREVIEW_SUFFIXES);
        if (previewSuffix) {
            const candidates = this.resolvePreviewSources(file, previewSuffix);
            if (candidates.length !== 1) return null;
            return {
                providerId: "excalidraw",
                file,
                sourceFile: candidates[0],
                role: "generated-preview",
                compoundSuffix: previewSuffix,
                protectedFromImageMutation: true
            };
        }

        const lowerPath = file.path.toLowerCase();
        const potentialSource = file.extension.toLowerCase() === "md"
            || lowerPath.endsWith(".excalidraw");
        if (potentialSource && this.isExcalidrawSource(file)) {
            return {
                providerId: "excalidraw",
                file,
                sourceFile: file,
                role: "source",
                compoundSuffix: readSuffix(file.name, EXCALIDRAW_SOURCE_SUFFIXES),
                protectedFromImageMutation: true
            };
        }

        return null;
    }

    private resolvePreviewSources(file: TFile, suffix: string): TFile[] {
        const stem = file.path.slice(0, -suffix.length);
        const paths = [
            `${stem}.excalidraw.md`,
            `${stem}.excalidraw`
        ];
        const unique = new Map<string, TFile>();
        for (const path of paths) {
            const candidate = this.app.vault.getAbstractFileByPath(normalizePath(path));
            if (candidate instanceof TFile && this.isExcalidrawSource(candidate)) {
                unique.set(candidate.path, candidate);
            }
        }
        return [...unique.values()];
    }

    private isExcalidrawSource(file: TFile): boolean {
        try {
            if (this.excalidraw.isExcalidrawFile(file)) return true;
        } catch {
            // The external plugin may be reloading. Conservative metadata/path fallback follows.
        }
        const lower = file.path.toLowerCase();
        if (lower.endsWith(".excalidraw")) return true;
        const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
        return lower.endsWith(".excalidraw.md")
            || Boolean(frontmatter && Object.prototype.hasOwnProperty.call(frontmatter, "excalidraw-plugin"));
    }
}

export function isPotentialExcalidrawPreviewFile(file: TFile): boolean {
    return readSuffix(file.name, EXCALIDRAW_PREVIEW_SUFFIXES) !== null;
}

interface DrawingModuleLike {
    inspectFile?(file: TFile): DrawingFileSemantics | null;
    isProtectedFile?(file: TFile): boolean;
    canOpenFile?(file: TFile): boolean;
}

interface DrawingPluginLike {
    drawingModule?: DrawingModuleLike;
    settings?: { drawing?: { provider?: string } };
}

export function inspectDrawingFile(plugin: DrawingPluginLike, file: TFile): DrawingFileSemantics | null {
    const inspect = plugin.drawingModule?.inspectFile;
    if (typeof inspect === "function") return inspect.call(plugin.drawingModule, file);
    return inspectDrawioFile(file);
}

export function isProtectedDrawingFile(plugin: DrawingPluginLike, file: TFile): boolean {
    const inspect = plugin.drawingModule?.isProtectedFile;
    return typeof inspect === "function"
        ? inspect.call(plugin.drawingModule, file)
        : inspectDrawioFile(file)?.protectedFromImageMutation === true;
}

export function canOpenDrawingFile(plugin: DrawingPluginLike, file: TFile): boolean {
    const canOpen = plugin.drawingModule?.canOpenFile;
    if (typeof canOpen === "function") return canOpen.call(plugin.drawingModule, file);
    return plugin.settings?.drawing?.provider !== "disabled" && inspectDrawioFile(file) !== null;
}

export function stripDrawingCompoundSuffix(name: string, semantics: DrawingFileSemantics): string {
    const suffix = semantics.compoundSuffix;
    return suffix && name.toLowerCase().endsWith(suffix.toLowerCase())
        ? name.slice(0, -suffix.length)
        : name.replace(/\.[^.]+$/, "");
}

/** Resolves only the same-stem files that belong to a verified Excalidraw source. */
export function getExcalidrawAssetFamily(
    app: App,
    semantics: DrawingFileSemantics
): readonly TFile[] {
    if (semantics.providerId !== "excalidraw" || !semantics.sourceFile) return [];
    const source = semantics.sourceFile;
    const sourceSuffix = readSuffix(source.name, EXCALIDRAW_SOURCE_SUFFIXES);
    if (!sourceSuffix) return [source];
    const stem = source.path.slice(0, -sourceSuffix.length);
    const files = new Map<string, TFile>([[source.path, source]]);
    for (const suffix of EXCALIDRAW_PREVIEW_SUFFIXES) {
        const candidate = app.vault.getAbstractFileByPath(
            normalizePath(`${stem}${suffix}`)
        );
        if (candidate instanceof TFile) files.set(candidate.path, candidate);
    }
    return Object.freeze([...files.values()]);
}

function readSuffix(name: string, suffixes: readonly string[]): string | null {
    const lower = name.toLowerCase();
    return suffixes.find(suffix => lower.endsWith(suffix)) ?? null;
}

function inspectDrawioFile(file: TFile): DrawingFileSemantics | null {
    if (!isDrawioDiagramFile(file)) return null;
    return {
        providerId: "drawio",
        file,
        sourceFile: file,
        role: file.path.toLowerCase().endsWith(".drawio.svg")
            ? "editable-image"
            : "source",
        compoundSuffix: getDrawioDiagramSuffix(file),
        protectedFromImageMutation: true
    };
}
