import { App, TFile } from "obsidian";
import {
    CanvasFileReference,
    getCanvasFileReferenceIndexDetailed,
    getCanvasUrlReferencesDetailed
} from "./CanvasReferenceUtils";
import {
    ReferenceLocation,
    ReferenceScanResult,
    VaultReferenceManager
} from "./VaultReferenceManager";
import { REFERENCE_SAFETY_SCAN_POLICY } from "./ReferenceScanPolicy";
import type { ImageReferenceIndexService } from "./ImageReferenceIndexService";

export interface ReferenceSafetyReport {
    complete: boolean;
    markdown: ReferenceLocation[];
    canvas: CanvasFileReference[];
    uncertainFiles: string[];
    referenceCount: number;
    safeToDelete: boolean;
}

export class ReferenceSafetyService {
    constructor(
        private readonly app: App,
        private readonly referenceManager: VaultReferenceManager,
        private readonly referenceIndex?: ImageReferenceIndexService
    ) { }

    async inspectLocalFile(file: TFile): Promise<ReferenceSafetyReport> {
        if (this.referenceIndex) {
            const snapshot = await this.referenceIndex.inspectLocalFile(file, {
                includeFencedCode: true
            });
            return {
                complete: snapshot.complete,
                markdown: [...snapshot.markdown],
                canvas: [...snapshot.canvas],
                uncertainFiles: [...snapshot.uncertainFiles],
                referenceCount: snapshot.referenceCount,
                safeToDelete: snapshot.safeToDelete
            };
        }
        const uncertainFiles = new Set<string>();
        const markdown = new Map<string, ReferenceLocation>();

        const rawScan = await this.safeRawScan(file.path);
        rawScan.uncertainFiles.forEach(path => uncertainFiles.add(path));
        if (!rawScan.complete && rawScan.uncertainFiles.length === 0) uncertainFiles.add("Raw Markdown scan");
        this.addMarkdownLocations(markdown, rawScan.locations);

        try {
            const indexed = await this.referenceManager.getFilesReferencingImage(file.path);
            this.addMarkdownLocations(markdown, indexed);
        } catch (error) {
            // The raw source scan above is authoritative. Metadata cache is an
            // optional supplement and must not invalidate a complete raw scan.
            console.warn(`[ReferenceSafetyService] Indexed reference scan failed for ${file.path}:`, error);
        }

        let canvas: CanvasFileReference[] = [];
        try {
            const canvasScan = await getCanvasFileReferenceIndexDetailed(
                this.app,
                [file],
                REFERENCE_SAFETY_SCAN_POLICY
            );
            canvasScan.uncertainFiles.forEach(path => uncertainFiles.add(path));
            if (!canvasScan.complete && canvasScan.uncertainFiles.length === 0) {
                uncertainFiles.add("Canvas scan");
            }
            canvas = canvasScan.references.get(file.path) ?? [];
        } catch (error) {
            uncertainFiles.add(`Canvas scan: ${getErrorMessage(error)}`);
        }

        return this.createReport(
            [...markdown.values()],
            canvas,
            [...uncertainFiles]
        );
    }

    async inspectUrl(url: string): Promise<ReferenceSafetyReport> {
        if (this.referenceIndex) {
            const snapshot = await this.referenceIndex.inspectUrl(url, {
                includeFencedCode: true
            });
            return {
                complete: snapshot.complete,
                markdown: [...snapshot.markdown],
                canvas: [...snapshot.canvas],
                uncertainFiles: [...snapshot.uncertainFiles],
                referenceCount: snapshot.referenceCount,
                safeToDelete: snapshot.safeToDelete
            };
        }
        const uncertainFiles = new Set<string>();
        const markdown = new Map<string, ReferenceLocation>();

        const rawScan = await this.safeRawScan(url);
        rawScan.uncertainFiles.forEach(path => uncertainFiles.add(path));
        if (!rawScan.complete && rawScan.uncertainFiles.length === 0) uncertainFiles.add("Raw Markdown scan");
        this.addMarkdownLocations(markdown, rawScan.locations);

        try {
            const indexed = await this.referenceManager.getFilesReferencingUrl(url);
            this.addMarkdownLocations(markdown, indexed);
        } catch (error) {
            // URL safety is also grounded in the raw source scan.
            console.warn(`[ReferenceSafetyService] Indexed URL scan failed for ${url}:`, error);
        }

        let canvas: CanvasFileReference[] = [];
        try {
            const canvasScan = await getCanvasUrlReferencesDetailed(
                this.app,
                url,
                REFERENCE_SAFETY_SCAN_POLICY
            );
            canvasScan.uncertainFiles.forEach(path => uncertainFiles.add(path));
            if (!canvasScan.complete && canvasScan.uncertainFiles.length === 0) {
                uncertainFiles.add("Canvas scan");
            }
            canvas = canvasScan.references;
        } catch (error) {
            uncertainFiles.add(`Canvas scan: ${getErrorMessage(error)}`);
        }

        return this.createReport([...markdown.values()], canvas, [...uncertainFiles]);
    }

    private async safeRawScan(target: string): Promise<ReferenceScanResult> {
        try {
            return await this.referenceManager.scanReferencesDetailed(
                target,
                REFERENCE_SAFETY_SCAN_POLICY
            );
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
        locations: ReferenceLocation[]
    ): void {
        for (const location of locations) {
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

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
