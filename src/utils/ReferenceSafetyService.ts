import { App, TFile } from "obsidian";
import {
    CanvasFileReference,
    getCanvasFileReferenceIndexDetailed,
    getCanvasUrlReferencesDetailed,
    type CanvasReferenceScanOptions
} from "./CanvasReferenceUtils";
import {
    ReferenceLocation,
    ReferenceScanResult,
    VaultReferenceManager
} from "./VaultReferenceManager";

export interface ReferenceSafetyReport {
    complete: boolean;
    markdown: ReferenceLocation[];
    canvas: CanvasFileReference[];
    uncertainFiles: string[];
    referenceCount: number;
    safeToDelete: boolean;
}

export interface ReferenceSafetyOptions {
    ignoreMarkdownPaths?: Iterable<string>;
}

export class ReferenceSafetyService {
    constructor(
        private readonly app: App,
        private readonly referenceManager: VaultReferenceManager,
        private readonly canvasScanOptions: CanvasReferenceScanOptions = {}
    ) { }

    async inspectLocalFile(
        file: TFile,
        options: ReferenceSafetyOptions = {}
    ): Promise<ReferenceSafetyReport> {
        const ignored = new Set(options.ignoreMarkdownPaths ?? []);
        const uncertainFiles = new Set<string>();
        const markdown = new Map<string, ReferenceLocation>();

        const rawScan = await this.safeRawScan(file.path);
        rawScan.uncertainFiles.forEach(path => uncertainFiles.add(path));
        if (!rawScan.complete && rawScan.uncertainFiles.length === 0) uncertainFiles.add("Raw Markdown scan");
        this.addMarkdownLocations(markdown, rawScan.locations, ignored);

        try {
            const indexed = await this.referenceManager.getFilesReferencingImage(file.path);
            this.addMarkdownLocations(markdown, indexed, ignored);
        } catch (error) {
            console.warn(`[ReferenceSafetyService] Indexed reference scan failed for ${file.path}:`, error);
            uncertainFiles.add("Markdown reference index");
        }

        const canvasScan = await getCanvasFileReferenceIndexDetailed(
            this.app,
            [file],
            this.canvasScanOptions
        );
        canvasScan.uncertainFiles.forEach(path => uncertainFiles.add(path));
        if (!canvasScan.complete && canvasScan.uncertainFiles.length === 0) uncertainFiles.add("Canvas scan");
        const canvas = canvasScan.references.get(file.path) ?? [];

        return this.createReport(
            [...markdown.values()],
            canvas,
            [...uncertainFiles]
        );
    }

    async inspectUrl(
        url: string,
        options: ReferenceSafetyOptions = {}
    ): Promise<ReferenceSafetyReport> {
        const ignored = new Set(options.ignoreMarkdownPaths ?? []);
        const uncertainFiles = new Set<string>();
        const markdown = new Map<string, ReferenceLocation>();

        const rawScan = await this.safeRawScan(url);
        rawScan.uncertainFiles.forEach(path => uncertainFiles.add(path));
        if (!rawScan.complete && rawScan.uncertainFiles.length === 0) uncertainFiles.add("Raw Markdown scan");
        this.addMarkdownLocations(markdown, rawScan.locations, ignored);

        try {
            const indexed = await this.referenceManager.getFilesReferencingUrl(url);
            this.addMarkdownLocations(markdown, indexed, ignored);
        } catch (error) {
            console.warn(`[ReferenceSafetyService] Indexed URL scan failed for ${url}:`, error);
            uncertainFiles.add("Markdown URL reference index");
        }

        const canvasScan = await getCanvasUrlReferencesDetailed(this.app, url, this.canvasScanOptions);
        canvasScan.uncertainFiles.forEach(path => uncertainFiles.add(path));
        if (!canvasScan.complete && canvasScan.uncertainFiles.length === 0) uncertainFiles.add("Canvas scan");

        return this.createReport([...markdown.values()], canvasScan.references, [...uncertainFiles]);
    }

    private async safeRawScan(target: string): Promise<ReferenceScanResult> {
        try {
            return await this.referenceManager.scanReferencesDetailed(target);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return {
                locations: [],
                complete: false,
                uncertainFiles: [`Raw Markdown scan: ${message}`]
            };
        }
    }

    private addMarkdownLocations(
        target: Map<string, ReferenceLocation>,
        locations: ReferenceLocation[],
        ignored: Set<string>
    ): void {
        for (const location of locations) {
            if (ignored.has(location.file.path)) continue;
            const key = `${location.file.path}:${location.start}-${location.end}`;
            target.set(key, location);
        }
    }

    private createReport(
        markdown: ReferenceLocation[],
        canvas: CanvasFileReference[],
        uncertainFiles: string[]
    ): ReferenceSafetyReport {
        const complete = uncertainFiles.length === 0;
        const referenceCount = markdown.length + canvas.length;
        return {
            complete,
            markdown,
            canvas,
            uncertainFiles,
            referenceCount,
            safeToDelete: complete && referenceCount === 0
        };
    }
}
