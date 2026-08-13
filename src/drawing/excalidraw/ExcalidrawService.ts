import { Notice, TFile, normalizePath } from "obsidian";
import type ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { confirmDrawingAction } from "../DrawingConfirmModal";
import {
    EXCALIDRAW_PREVIEW_SUFFIXES,
    type DrawingFileInspector
} from "../DrawingFileSemantics";
import { ExcalidrawBridge } from "./ExcalidrawBridge";
import { selectExcalidrawTemplate } from "./ExcalidrawTemplateModal";

const EXCALIDRAW_SOURCE_SUFFIX = ".excalidraw.md";
const DEFAULT_PREVIEW_WAIT_MS = 2_000;
const DEFAULT_PREVIEW_POLL_MS = 100;

export interface ExcalidrawServiceTiming {
    readonly delay?: (milliseconds: number) => Promise<void>;
    readonly previewWaitMs?: number;
    readonly previewPollMs?: number;
}

export interface ExcalidrawCreationResult {
    readonly sourceFile: TFile;
    readonly embedFile: TFile;
    readonly previewFallback: boolean;
}

export class ExcalidrawService {
    private readonly wait: (milliseconds: number) => Promise<void>;
    private readonly previewWaitMs: number;
    private readonly previewPollMs: number;
    private readonly previewWaitConsumed = new WeakSet<TFile>();

    constructor(
        private readonly plugin: ImageConverterPlugin,
        readonly bridge: ExcalidrawBridge,
        private readonly inspector: DrawingFileInspector,
        timing: ExcalidrawServiceTiming = {}
    ) {
        this.wait = timing.delay ?? delay;
        this.previewWaitMs = nonNegativeInteger(
            timing.previewWaitMs,
            DEFAULT_PREVIEW_WAIT_MS
        );
        this.previewPollMs = Math.max(1, nonNegativeInteger(
            timing.previewPollMs,
            DEFAULT_PREVIEW_POLL_MS
        ));
    }

    async create(activeFile: TFile): Promise<ExcalidrawCreationResult | null> {
        await this.plugin.componentsReady;
        const capabilities = this.bridge.probe();
        if (!capabilities.canCreate) throw new Error(explainUnavailable(capabilities.reason));
        const templates = capabilities.canListTemplates ? await this.bridge.listTemplates() : [];
        const template = await selectExcalidrawTemplate(this.plugin.app, templates);
        if (template === undefined) return null;

        const previewMode = this.plugin.settings.drawing.excalidraw.embedMode === "auto-export-preview";
        const created = this.plugin.settings.drawing.excalidraw.manageCreatedFileLocation
            ? await this.createUsingImageAssistantPlan(
                activeFile,
                template?.path,
                previewMode
            )
            : await this.createUsingExcalidrawDefaults(template?.path, previewMode);
        if (!created) return null;

        let autoexportReady = previewMode;
        if (previewMode) {
            try {
                await this.ensureSvgAutoexport(created);
            } catch {
                autoexportReady = false;
                new Notice(t("NOTICE_EXCALIDRAW_AUTOEXPORT_SETUP_FAILED"));
            }
        }
        const preview = autoexportReady
            ? await this.waitForPreferredPreview(created)
            : null;
        if (!preview && autoexportReady) {
            new Notice(t("NOTICE_EXCALIDRAW_PREVIEW_FALLBACK"));
        }
        return {
            sourceFile: created,
            embedFile: preview ?? created,
            previewFallback: previewMode && !preview
        };
    }

    private async createUsingImageAssistantPlan(
        activeFile: TFile,
        templatePath: string | undefined,
        previewMode: boolean
    ): Promise<TFile | null> {
        const settings = this.plugin.settings.localProcessing;
        const source = new File([""], `Drawing${EXCALIDRAW_SOURCE_SUFFIX}`, {
            type: "text/markdown"
        });
        const plan = await this.plugin.folderAndFilenameManagement.determineAssetDestination(
            source,
            activeFile,
            settings.filename,
            settings.destination,
            EXCALIDRAW_SOURCE_SUFFIX
        );
        await this.plugin.folderAndFilenameManagement.ensureFolderExists(plan.destinationPath);
        return this.createWithConflictPolicy(
            joinVaultPath(plan.destinationPath, plan.newFilename),
            settings.filename.conflictResolution,
            templatePath,
            previewMode
        );
    }

    private async createUsingExcalidrawDefaults(
        templatePath: string | undefined,
        previewMode: boolean
    ): Promise<TFile> {
        const returned = await this.bridge.create({
            ...(templatePath ? { templatePath } : {}),
            ...(previewMode ? {
                frontmatterKeys: { "excalidraw-autoexport": "svg" as const }
            } : {}),
            silent: true
        });
        const returnedPath = normalizeReturnedPath(returned);
        const file = await this.waitForReturnedFile(returnedPath);
        if (!file) throw new Error(t("NOTICE_EXCALIDRAW_RETURNED_PATH_INVALID", [returnedPath]));
        if (!await this.waitUntilRecognized(file)) {
            throw new Error(t("NOTICE_EXCALIDRAW_NOT_RECOGNIZED", [file.path]));
        }
        return file;
    }

    async open(file: TFile): Promise<void> {
        const semantics = this.inspector.inspect(file);
        const source = semantics?.providerId === "excalidraw" ? semantics.sourceFile : null;
        if (!source) throw new Error(t("NOTICE_EXCALIDRAW_SOURCE_UNRESOLVED"));
        if (this.plugin.settings.drawing.excalidraw.embedMode === "auto-export-preview"
            && this.getSvgPreview(source)) {
            try {
                await this.ensureSvgAutoexport(source);
            } catch {
                new Notice(t("NOTICE_EXCALIDRAW_AUTOEXPORT_SETUP_FAILED"));
            }
        }
        await this.bridge.openFile(source);
    }

    private async createWithConflictPolicy(
        targetPath: string,
        policy: "reuse" | "increment" | "skip" | "overwrite",
        templatePath: string | undefined,
        previewMode: boolean
    ): Promise<TFile | null> {
        const existing = this.plugin.app.vault.getAbstractFileByPath(targetPath);
        if (!existing) return this.createViaApi(targetPath, templatePath, previewMode);
        if (!(existing instanceof TFile)) {
            return this.createViaApi(this.findIncrementedPath(targetPath), templatePath, previewMode);
        }
        if (policy === "skip") {
            new Notice(t("NOTICE_DRAWING_EXISTS_SKIP", [existing.name]));
            return null;
        }
        if (policy === "reuse") {
            if (this.bridge.isExcalidrawFile(existing)) return existing;
            return this.createViaApi(this.findIncrementedPath(targetPath), templatePath, previewMode);
        }
        if (policy === "increment") {
            return this.createViaApi(this.findIncrementedPath(targetPath), templatePath, previewMode);
        }
        if (!this.bridge.isExcalidrawFile(existing)) {
            throw new Error(t("NOTICE_EXCALIDRAW_OVERWRITE_REFUSED", [existing.path]));
        }
        if (this.isOpenInAnyLeaf(existing)) {
            throw new Error(t("NOTICE_EXCALIDRAW_OVERWRITE_OPEN", [existing.path]));
        }
        const confirmed = await confirmDrawingAction(
            this.plugin.app,
            t("DRAWING_CREATE_OVERWRITE_TITLE"),
            t("DRAWING_CREATE_OVERWRITE_DESC", [existing.path])
        );
        if (!confirmed) return null;

        const baseline = await this.plugin.app.vault.read(existing);
        const previewBaselines = await this.snapshotSvgPreviews(existing.path);
        const stagingPath = this.findIncrementedPath(
            targetPath.replace(/\.excalidraw\.md$/i, `-image-assistant-staging-${Date.now()}.excalidraw.md`)
        );
        const staging = await this.createViaApi(stagingPath, templatePath, previewMode);
        const stagingSourcePath = staging.path;
        try {
            if (previewMode) {
                await this.waitForPreferredPreview(staging);
            }
            const stagedContent = await this.plugin.app.vault.read(staging);
            await this.plugin.app.vault.process(existing, current => {
                if (current !== baseline) throw new Error(t("NOTICE_EXCALIDRAW_OVERWRITE_CHANGED"));
                return stagedContent;
            });
        } catch (error) {
            await this.deletePreviewFamily(stagingSourcePath);
            throw new Error(`${String(error)} ${t("NOTICE_EXCALIDRAW_STAGING_RETAINED", [staging.path])}`);
        }
        await this.promoteAvailablePreviews(
            stagingSourcePath,
            existing.path,
            previewBaselines
        );
        await this.deletePreviewFamily(stagingSourcePath);
        try {
            await this.plugin.app.vault.delete(staging);
        } catch {
            new Notice(t("NOTICE_EXCALIDRAW_STAGING_RETAINED", [staging.path]));
        }
        return existing;
    }

    private async createViaApi(
        targetPath: string,
        templatePath: string | undefined,
        previewMode: boolean
    ): Promise<TFile> {
        const normalized = this.findAvailableFamilyPath(normalizeReturnedPath(targetPath));
        const slash = normalized.lastIndexOf("/");
        const foldername = slash >= 0 ? normalized.slice(0, slash) : "";
        const filename = (slash >= 0 ? normalized.slice(slash + 1) : normalized)
            .replace(/\.excalidraw\.md$/i, "");
        const returned = await this.bridge.create({
            filename,
            foldername,
            ...(templatePath ? { templatePath } : {}),
            ...(previewMode ? {
                frontmatterKeys: { "excalidraw-autoexport": "svg" as const }
            } : {}),
            silent: true
        });
        const returnedPath = normalizeReturnedPath(returned);
        const file = await this.waitForReturnedFile(returnedPath);
        if (!file) throw new Error(t("NOTICE_EXCALIDRAW_RETURNED_PATH_INVALID", [returnedPath]));
        if (!await this.waitUntilRecognized(file)) {
            throw new Error(t("NOTICE_EXCALIDRAW_NOT_RECOGNIZED", [file.path]));
        }
        return this.reconcileCreatedPath(file, normalized, previewMode);
    }

    private async reconcileCreatedPath(
        file: TFile,
        plannedPath: string,
        previewMode: boolean
    ): Promise<TFile> {
        if (file.path === plannedPath) return file;
        const originalSourcePath = file.path;
        if (previewMode) {
            await this.waitForPreferredPreview(file);
            this.previewWaitConsumed.add(file);
        }
        const family = this.getAssetFamily(originalSourcePath, file);
        const destination = this.findAvailableFamilyPath(plannedPath, family);
        const moves = family
            .filter(member => member !== file)
            .concat(file)
            .map(member => ({
                file: member,
                from: member.path,
                to: mapFamilyPath(member.path, originalSourcePath, destination)
            }))
            .filter(move => move.from !== move.to);
        const completed: typeof moves = [];
        try {
            for (const move of moves) {
                await this.plugin.app.fileManager.renameFile(move.file, move.to);
                completed.push(move);
            }
            const resolved = this.plugin.app.vault.getAbstractFileByPath(destination);
            return resolved instanceof TFile ? resolved : file;
        } catch (error) {
            let rollbackFailed = false;
            for (const move of completed.reverse()) {
                try {
                    await this.plugin.app.fileManager.renameFile(move.file, move.from);
                } catch {
                    rollbackFailed = true;
                }
            }
            if (rollbackFailed) throw error;
            new Notice(t("NOTICE_EXCALIDRAW_RELOCATE_FAILED", [file.path]));
            return file;
        }
    }

    private async waitForReturnedFile(path: string): Promise<TFile | null> {
        for (let attempt = 0; attempt < 20; attempt++) {
            const target = this.plugin.app.vault.getAbstractFileByPath(path);
            if (target instanceof TFile) return target;
            await this.wait(100);
        }
        return null;
    }

    private async waitUntilRecognized(file: TFile): Promise<boolean> {
        for (let attempt = 0; attempt < 20; attempt++) {
            if (this.bridge.isExcalidrawFile(file)) return true;
            await this.wait(100);
        }
        return false;
    }

    private findIncrementedPath(path: string): string {
        if (!this.plugin.app.vault.getAbstractFileByPath(path)) return path;
        const suffix = EXCALIDRAW_SOURCE_SUFFIX;
        const stem = path.toLowerCase().endsWith(suffix)
            ? path.slice(0, -suffix.length)
            : path;
        let counter = 1;
        let candidate = `${stem}-${counter}${suffix}`;
        while (this.plugin.app.vault.getAbstractFileByPath(candidate)) {
            counter += 1;
            candidate = `${stem}-${counter}${suffix}`;
        }
        return candidate;
    }

    private isOpenInAnyLeaf(file: TFile): boolean {
        let open = false;
        this.plugin.app.workspace.iterateAllLeaves(leaf => {
            if ((leaf.view as { file?: TFile }).file?.path === file.path) open = true;
        });
        return open;
    }

    private async waitForPreferredPreview(source: TFile): Promise<TFile | null> {
        const waitMs = this.previewWaitConsumed.delete(source) ? 0 : this.previewWaitMs;
        let elapsed = 0;
        while (true) {
            const preview = await this.findPreferredPreview(source.path);
            if (preview || elapsed >= waitMs) return preview;
            const step = Math.min(this.previewPollMs, waitMs - elapsed);
            await this.wait(step);
            elapsed += step;
        }
    }

    private getSvgPreview(source: TFile): TFile | null {
        const path = normalizePath(source.path.replace(/\.md$/i, ".svg"));
        const file = this.plugin.app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : null;
    }

    private async findPreferredPreview(sourcePath: string): Promise<TFile | null> {
        for (const suffix of getPreviewPreferenceOrder()) {
            const path = previewPathForSource(sourcePath, suffix);
            const file = this.plugin.app.vault.getAbstractFileByPath(path);
            if (file instanceof TFile && await this.isValidPreview(file)) return file;
        }
        return null;
    }

    private async isValidPreview(file: TFile): Promise<boolean> {
        try {
            if (file.extension.toLowerCase() === "svg") {
                return isSvg(await this.plugin.app.vault.read(file));
            }
            if (file.extension.toLowerCase() === "png") {
                return isPng(await this.plugin.app.vault.readBinary(file));
            }
        } catch {
            // A preview may still be in the middle of an external atomic write.
        }
        return false;
    }

    private getAssetFamily(sourcePath: string, source?: TFile): TFile[] {
        const files: TFile[] = [];
        if (source) files.push(source);
        for (const suffix of EXCALIDRAW_PREVIEW_SUFFIXES) {
            const candidate = this.plugin.app.vault.getAbstractFileByPath(
                previewPathForSource(sourcePath, suffix)
            );
            if (candidate instanceof TFile && !files.includes(candidate)) files.push(candidate);
        }
        return files;
    }

    private findAvailableFamilyPath(path: string, moving: readonly TFile[] = []): string {
        if (this.isFamilyDestinationAvailable(path, moving)) return path;
        const suffix = EXCALIDRAW_SOURCE_SUFFIX;
        const stem = path.toLowerCase().endsWith(suffix)
            ? path.slice(0, -suffix.length)
            : path;
        let counter = 1;
        let candidate = `${stem}-${counter}${suffix}`;
        while (!this.isFamilyDestinationAvailable(candidate, moving)) {
            counter += 1;
            candidate = `${stem}-${counter}${suffix}`;
        }
        return candidate;
    }

    private isFamilyDestinationAvailable(path: string, moving: readonly TFile[]): boolean {
        const candidatePaths = [
            path,
            ...EXCALIDRAW_PREVIEW_SUFFIXES.map(suffix => previewPathForSource(path, suffix))
        ];
        return candidatePaths.every(candidatePath => {
            const occupied = this.plugin.app.vault.getAbstractFileByPath(candidatePath);
            return !occupied || moving.includes(occupied as TFile);
        });
    }

    private async snapshotSvgPreviews(sourcePath: string): Promise<ReadonlyMap<string, string>> {
        const snapshots = new Map<string, string>();
        for (const suffix of EXCALIDRAW_PREVIEW_SUFFIXES) {
            if (!suffix.endsWith(".svg")) continue;
            const path = previewPathForSource(sourcePath, suffix);
            const file = this.plugin.app.vault.getAbstractFileByPath(path);
            if (!(file instanceof TFile)) continue;
            try {
                snapshots.set(path, await this.plugin.app.vault.read(file));
            } catch {
                // An unreadable existing preview must be preserved, never replaced.
            }
        }
        return snapshots;
    }

    private async promoteAvailablePreviews(
        fromSourcePath: string,
        toSourcePath: string,
        targetSvgBaselines: ReadonlyMap<string, string>
    ): Promise<void> {
        for (const suffix of EXCALIDRAW_PREVIEW_SUFFIXES) {
            const from = previewPathForSource(fromSourcePath, suffix);
            const file = this.plugin.app.vault.getAbstractFileByPath(from);
            if (!(file instanceof TFile)) continue;
            const to = previewPathForSource(toSourcePath, suffix);
            const target = this.plugin.app.vault.getAbstractFileByPath(to);
            if (target instanceof TFile && suffix.endsWith(".svg")) {
                const baseline = targetSvgBaselines.get(to);
                if (baseline === undefined) continue;
                try {
                    const stagedContent = await this.plugin.app.vault.read(file);
                    await this.plugin.app.vault.process(target, current =>
                        current === baseline ? stagedContent : current
                    );
                } catch {
                    // A concurrent target update wins; staging cleanup remains isolated.
                }
                continue;
            }
            if (target) continue;
            try {
                await this.plugin.app.fileManager.renameFile(file, to);
            } catch {
                // The target family won a race. Cleanup below removes only our staging file.
            }
        }
    }

    private async deletePreviewFamily(sourcePath: string): Promise<void> {
        for (const suffix of EXCALIDRAW_PREVIEW_SUFFIXES) {
            const file = this.plugin.app.vault.getAbstractFileByPath(
                previewPathForSource(sourcePath, suffix)
            );
            if (!(file instanceof TFile)) continue;
            try {
                await this.plugin.app.vault.delete(file);
            } catch {
                new Notice(t("NOTICE_EXCALIDRAW_STAGING_RETAINED", [file.path]));
            }
        }
    }

    private async ensureSvgAutoexport(source: TFile): Promise<void> {
        await this.plugin.app.fileManager.processFrontMatter(source, frontmatter => {
            const current = String(frontmatter["excalidraw-autoexport"] ?? "").toLowerCase();
            if (current === "svg" || current === "both") return;
            frontmatter["excalidraw-autoexport"] = current === "png" ? "both" : "svg";
        });
    }
}

function explainUnavailable(reason: ReturnType<ExcalidrawBridge["probe"]>["reason"]): string {
    if (reason === "outdated") return t("NOTICE_EXCALIDRAW_API_OUTDATED");
    if (reason === "initializing") return t("NOTICE_EXCALIDRAW_API_INITIALIZING");
    return t("NOTICE_EXCALIDRAW_API_MISSING");
}

function joinVaultPath(folder: string, filename: string): string {
    return normalizePath(folder ? `${folder}/${filename}` : filename);
}

function normalizeReturnedPath(path: string): string {
    const trimmed = path.trim().replace(/\\/g, "/");
    if (!trimmed || trimmed.startsWith("/") || trimmed.startsWith("../")
        || /^(?:[a-z]+:|\.\.\/)/i.test(trimmed)) {
        throw new Error("Excalidraw returned an unsafe Vault path.");
    }
    return normalizePath(trimmed);
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => globalThis.setTimeout(resolve, ms));
}

function isSvg(content: string): boolean {
    if (!content.trim() || content.length > 16 * 1024 * 1024) return false;
    const document = new DOMParser().parseFromString(content, "image/svg+xml");
    const root = document.documentElement;
    if (document.querySelector("parsererror") || root.localName.toLowerCase() !== "svg") {
        return false;
    }
    const width = parseSvgLength(root.getAttribute("width"));
    const height = parseSvgLength(root.getAttribute("height"));
    if (width === 0 || height === 0) return false;
    const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
    if (viewBox?.length === 4 && (viewBox[2] <= 0 || viewBox[3] <= 0)) return false;
    return width !== null || height !== null || viewBox?.length === 4 || root.children.length > 0;
}

function isPng(content: ArrayBuffer): boolean {
    if (content.byteLength < 24) return false;
    const bytes = new Uint8Array(content, 0, 24);
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (!signature.every((byte, index) => bytes[index] === byte)) return false;
    const view = new DataView(content, 0, 24);
    return view.getUint32(16) > 0 && view.getUint32(20) > 0;
}

function parseSvgLength(value: string | null): number | null {
    if (value === null || !/^\s*\d+(?:\.\d+)?(?:px)?\s*$/i.test(value)) return null;
    return Number.parseFloat(value);
}

function previewPathForSource(sourcePath: string, previewSuffix: string): string {
    const stem = sourcePath.toLowerCase().endsWith(EXCALIDRAW_SOURCE_SUFFIX)
        ? sourcePath.slice(0, -EXCALIDRAW_SOURCE_SUFFIX.length)
        : sourcePath.replace(/\.excalidraw$/i, "");
    return normalizePath(`${stem}${previewSuffix}`);
}

function mapFamilyPath(memberPath: string, fromSourcePath: string, toSourcePath: string): string {
    if (memberPath === fromSourcePath) return toSourcePath;
    for (const suffix of EXCALIDRAW_PREVIEW_SUFFIXES) {
        if (memberPath === previewPathForSource(fromSourcePath, suffix)) {
            return previewPathForSource(toSourcePath, suffix);
        }
    }
    throw new Error(`Unexpected Excalidraw asset-family member: ${memberPath}`);
}

function getPreviewPreferenceOrder(): readonly string[] {
    const dark = globalThis.document?.body?.classList.contains("theme-dark") === true;
    const preferredTheme = dark ? "dark" : "light";
    const alternateTheme = dark ? "light" : "dark";
    return [
        ".excalidraw.svg",
        `.excalidraw.${preferredTheme}.svg`,
        `.excalidraw.${alternateTheme}.svg`,
        ".excalidraw.png",
        `.excalidraw.${preferredTheme}.png`,
        `.excalidraw.${alternateTheme}.png`
    ];
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
    return Number.isFinite(value) && value! >= 0 ? Math.floor(value!) : fallback;
}
