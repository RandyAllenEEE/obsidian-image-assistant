import { normalizePath, Notice, TFile } from "obsidian";
import type ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { confirmDrawingAction } from "../DrawingConfirmModal";
import {
    assertValidDiagramXml,
    assertValidDrawioSvg,
    assertValidSvg,
    buildCompoundFilename,
    DRAWIO_SVG_SUFFIX,
    EMPTY_DRAWIO_SVG,
    isDrawioSvgPath
} from "./DiagramFile";

export class DrawingSaveConflictError extends Error {
    constructor(message = "The diagram changed outside Image Assistant.") {
        super(message);
        this.name = "DrawingSaveConflictError";
    }
}

export interface DrawingSaveResult {
    readonly file: TFile;
    readonly baseline: string;
    readonly migrated: boolean;
}

export type DrawingNativeExportFormat = "drawio" | "drawio-svg" | "svg" | "png";

export class DrawingFileService {
    private readonly saveQueues = new Map<string, Promise<unknown>>();

    constructor(private readonly plugin: ImageConverterPlugin) { }

    async createDrawing(activeFile: TFile): Promise<TFile | null> {
        await this.plugin.componentsReady;
        const manager = this.plugin.folderAndFilenameManagement;
        const settings = this.plugin.settings.localProcessing;
        const source = new File([EMPTY_DRAWIO_SVG], "Drawing.svg", {
            type: "image/svg+xml"
        });
        const plan = await manager.determineAssetDestination(
            source,
            activeFile,
            settings.filename,
            settings.destination,
            DRAWIO_SVG_SUFFIX
        );
        await manager.ensureFolderExists(plan.destinationPath);
        return this.createWithConflictPolicy(
            plan.destinationPath,
            plan.newFilename,
            settings.filename.conflictResolution
        );
    }

    async save(
        file: TFile,
        baseline: string,
        rawXml: string,
        svg: string
    ): Promise<DrawingSaveResult> {
        assertValidDiagramXml(rawXml);
        assertValidDrawioSvg(svg);
        return this.withFileLock(file.path, async () => {
            if (isDrawioSvgPath(file.path)) {
                await this.compareAndSwap(file, baseline, svg);
                return { file, baseline: svg, migrated: false };
            }
            return this.migrateRawDiagram(file, baseline, svg);
        });
    }

    async overwrite(file: TFile, rawXml: string, svg: string): Promise<DrawingSaveResult> {
        assertValidDiagramXml(rawXml);
        assertValidDrawioSvg(svg);
        return this.withFileLock(file.path, async () => {
            // Confirmation only authorizes replacing the version that is current when this
            // transaction starts. A later external write must still win the CAS race.
            const current = await this.plugin.app.vault.read(file);
            if (isDrawioSvgPath(file.path)) {
                await this.compareAndSwap(file, current, svg);
                return { file, baseline: svg, migrated: false };
            }

            // A legacy .drawio is never allowed to contain SVG bytes. Reuse the same
            // rename/link-update/CAS/rollback transaction as an ordinary first save.
            return this.migrateRawDiagram(file, current, svg);
        });
    }

    async saveCopy(file: TFile, svg: string, label = "recovery"): Promise<TFile> {
        assertValidDrawioSvg(svg);
        const parent = file.parent?.path ?? "";
        const stem = file.name.replace(/\.drawio(?:\.svg)?$/i, "");
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const desired = `${stem}-${label}-${timestamp}${DRAWIO_SVG_SUFFIX}`;
        return this.createIncremented(parent, desired, svg);
    }

    async saveRecoveryCopy(
        file: TFile,
        rawXml: string,
        svg = "",
        label = "recovery"
    ): Promise<TFile> {
        if (svg) {
            let validSvg = true;
            try {
                assertValidDrawioSvg(svg);
            } catch {
                validSvg = false;
            }
            // A valid SVG that cannot be written is a storage failure, not a reason to
            // silently switch recovery formats.
            if (validSvg) return this.saveCopy(file, svg, label);
        }

        assertValidDiagramXml(rawXml);
        const parent = file.parent?.path ?? "";
        const stem = file.name.replace(/\.drawio(?:\.svg)?$/i, "");
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const desired = `${stem}-${label}-${timestamp}.drawio`;
        const path = combineVaultPath(parent, desired);
        if (!this.plugin.app.vault.getAbstractFileByPath(path)) {
            return this.plugin.app.vault.create(path, rawXml);
        }
        return this.createIncrementedExport(parent, desired, rawXml);
    }

    async saveExportCopy(
        file: TFile,
        format: DrawingNativeExportFormat,
        data: string
    ): Promise<TFile | null> {
        const value = validateExportData(format, data);
        const folder = file.parent?.path ?? "";
        const stem = file.name.replace(/\.drawio(?:\.svg)?$/i, "").trim() || "Drawing";
        const suffix = exportSuffix(format);
        const desired = `${stem}-export${suffix}`;
        return this.createExportWithConflictPolicy(
            folder,
            desired,
            value,
            this.plugin.settings.localProcessing.filename.conflictResolution
        );
    }

    private async createWithConflictPolicy(
        folder: string,
        filename: string,
        policy: "reuse" | "increment" | "skip" | "overwrite"
    ): Promise<TFile | null> {
        const path = combineVaultPath(folder, filename);
        const existing = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!existing) return this.plugin.app.vault.create(path, EMPTY_DRAWIO_SVG);
        if (!(existing instanceof TFile)) return this.createIncremented(folder, filename, EMPTY_DRAWIO_SVG);

        if (policy === "skip") {
            new Notice(t("NOTICE_DRAWING_EXISTS_SKIP", [filename]));
            return null;
        }
        if (policy === "reuse") {
            try {
                assertValidDrawioSvg(await this.plugin.app.vault.read(existing));
                return existing;
            } catch {
                return this.createIncremented(folder, filename, EMPTY_DRAWIO_SVG);
            }
        }
        if (policy === "overwrite") {
            const confirmed = await confirmDrawingAction(
                this.plugin.app,
                t("DRAWING_CREATE_OVERWRITE_TITLE"),
                t("DRAWING_CREATE_OVERWRITE_DESC", [existing.path])
            );
            if (!confirmed) return null;
            await this.plugin.app.vault.modify(existing, EMPTY_DRAWIO_SVG);
            return existing;
        }
        return this.createIncremented(folder, filename, EMPTY_DRAWIO_SVG);
    }

    private async createExportWithConflictPolicy(
        folder: string,
        filename: string,
        data: string | ArrayBuffer,
        policy: "reuse" | "increment" | "skip" | "overwrite"
    ): Promise<TFile | null> {
        const path = combineVaultPath(folder, filename);
        const existing = this.plugin.app.vault.getAbstractFileByPath(path);
        if (!existing) return this.createExport(path, data);
        if (!(existing instanceof TFile)) return this.createIncrementedExport(folder, filename, data);
        if (policy === "skip") {
            new Notice(t("NOTICE_DRAWING_EXPORT_EXISTS_SKIP", [filename]));
            return null;
        }
        if (policy === "reuse") {
            if (await this.exportDataMatches(existing, data)) return existing;
            return this.createIncrementedExport(folder, filename, data);
        }
        if (policy === "overwrite") {
            const confirmed = await confirmDrawingAction(
                this.plugin.app,
                t("DRAWING_EXPORT_OVERWRITE_TITLE"),
                t("DRAWING_EXPORT_OVERWRITE_DESC", [existing.path])
            );
            if (!confirmed) return null;
            if (typeof data === "string") await this.plugin.app.vault.modify(existing, data);
            else await this.plugin.app.vault.modifyBinary(existing, data);
            return existing;
        }
        return this.createIncrementedExport(folder, filename, data);
    }

    private async createIncrementedExport(
        folder: string,
        desired: string,
        data: string | ArrayBuffer
    ): Promise<TFile> {
        const suffix = readKnownExportSuffix(desired);
        const stem = desired.slice(0, -suffix.length);
        for (let index = 1; index < 10_000; index++) {
            const path = combineVaultPath(folder, `${stem}-${index}${suffix}`);
            if (this.plugin.app.vault.getAbstractFileByPath(path)) continue;
            try {
                return await this.createExport(path, data);
            } catch (error) {
                if (!String(error).toLowerCase().includes("already exists")) throw error;
            }
        }
        throw new Error("Unable to find an available drawing export filename.");
    }

    private createExport(path: string, data: string | ArrayBuffer): Promise<TFile> {
        return typeof data === "string"
            ? this.plugin.app.vault.create(path, data)
            : this.plugin.app.vault.createBinary(path, data);
    }

    private async exportDataMatches(file: TFile, data: string | ArrayBuffer): Promise<boolean> {
        if (typeof data === "string") return await this.plugin.app.vault.read(file) === data;
        const existing = new Uint8Array(await this.plugin.app.vault.readBinary(file));
        const candidate = new Uint8Array(data);
        return existing.length === candidate.length
            && existing.every((value, index) => value === candidate[index]);
    }

    private async migrateRawDiagram(
        file: TFile,
        baseline: string,
        svg: string
    ): Promise<DrawingSaveResult> {
        const current = await this.plugin.app.vault.read(file);
        if (current !== baseline) throw new DrawingSaveConflictError();
        const originalPath = file.path;
        const folder = file.parent?.path ?? "";
        const desired = buildCompoundFilename(file.name);
        const targetPath = await this.findAvailablePath(folder, desired);
        let renamed = false;
        try {
            await this.plugin.app.fileManager.renameFile(file, targetPath);
            renamed = true;
            await this.compareAndSwap(file, baseline, svg);
            return { file, baseline: svg, migrated: true };
        } catch (error) {
            if (renamed) {
                try {
                    const renamedContent = await this.plugin.app.vault.read(file);
                    if (renamedContent === baseline) {
                        await this.plugin.app.fileManager.renameFile(file, originalPath);
                    } else {
                        const recovery = await this.saveCopy(file, svg, "migration-recovery");
                        throw new Error(
                            `The .drawio migration conflicted with an external change. `
                            + `External content was preserved at ${file.path}; the editable recovery is ${recovery.path}.`,
                            { cause: error }
                        );
                    }
                } catch (rollbackError) {
                    if (rollbackError instanceof Error
                        && rollbackError.message.includes("editable recovery")) {
                        throw rollbackError;
                    }
                    console.error("[Image Assistant Drawing] Migration rollback failed:", rollbackError);
                }
            }
            throw error;
        }
    }

    private async compareAndSwap(file: TFile, baseline: string, replacement: string): Promise<void> {
        await this.plugin.app.vault.process(file, current => {
            if (current !== baseline) throw new DrawingSaveConflictError();
            return replacement;
        });
    }

    private async createIncremented(folder: string, desired: string, content: string): Promise<TFile> {
        const stem = desired.replace(/\.drawio\.svg$/i, "");
        for (let index = 0; index < 10_000; index++) {
            const filename = buildCompoundFilename(stem, index);
            const path = combineVaultPath(folder, filename);
            if (this.plugin.app.vault.getAbstractFileByPath(path)) continue;
            try {
                return await this.plugin.app.vault.create(path, content);
            } catch (error) {
                if (!String(error).toLowerCase().includes("already exists")) throw error;
            }
        }
        throw new Error("Unable to find an available drawing filename.");
    }

    private async findAvailablePath(folder: string, desired: string): Promise<string> {
        const stem = desired.replace(/\.drawio\.svg$/i, "");
        for (let index = 0; index < 10_000; index++) {
            const path = combineVaultPath(folder, buildCompoundFilename(stem, index));
            if (!this.plugin.app.vault.getAbstractFileByPath(path)) return path;
        }
        throw new Error("Unable to find an available migration filename.");
    }

    private async withFileLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
        const key = path.toLowerCase();
        const previous = this.saveQueues.get(key) ?? Promise.resolve();
        const current = previous.catch(() => undefined).then(operation);
        this.saveQueues.set(key, current);
        try {
            return await current;
        } finally {
            if (this.saveQueues.get(key) === current) this.saveQueues.delete(key);
        }
    }
}

function validateExportData(
    format: DrawingNativeExportFormat,
    data: string
): string | ArrayBuffer {
    if (format === "drawio") {
        assertValidDiagramXml(data);
        return data;
    }
    if (format === "drawio-svg") {
        assertValidDrawioSvg(data);
        return data;
    }
    if (format === "svg") {
        assertValidSvg(data);
        return data;
    }
    return decodePngDataUrl(data);
}

function decodePngDataUrl(value: string): ArrayBuffer {
    const match = /^data:image\/png(?:;[^,]*)?,(.*)$/is.exec(value);
    if (!match) throw new Error("Draw.io did not return a PNG image.");
    const header = value.slice(0, value.indexOf(",")).toLowerCase();
    const bytes = header.includes(";base64")
        ? Uint8Array.from(atob(match[1]), character => character.charCodeAt(0))
        : new TextEncoder().encode(decodeURIComponent(match[1]));
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function exportSuffix(format: DrawingNativeExportFormat): string {
    if (format === "drawio") return ".drawio";
    if (format === "drawio-svg") return ".drawio.svg";
    if (format === "svg") return ".svg";
    return ".png";
}

function readKnownExportSuffix(filename: string): string {
    for (const suffix of [".drawio.svg", ".drawio", ".svg", ".png"]) {
        if (filename.toLowerCase().endsWith(suffix)) return suffix;
    }
    throw new Error("Unsupported drawing export filename.");
}

function combineVaultPath(folder: string, filename: string): string {
    return normalizePath(folder ? `${folder}/${filename}` : filename);
}
