import { App, TFile, type WorkspaceLeaf } from "obsidian";

export const MINIMUM_SILENT_CREATE_VERSION = "1.9.19";

export interface ExcalidrawCreateOptions {
    filename?: string;
    foldername?: string;
    templatePath?: string;
    frontmatterKeys?: {
        "excalidraw-autoexport"?: "svg" | "png" | "both" | "none";
    };
    silent: true;
}

interface ExcalidrawAutomateApi {
    verifyMinimumPluginVersion?(version: string): boolean;
    isExcalidrawFile?(file: TFile): boolean;
    isExcalidrawView?(view: unknown): boolean;
    create?(options: ExcalidrawCreateOptions): Promise<string>;
    getListOfTemplateFiles?(): TFile[] | null | Promise<TFile[] | null>;
    destroy?(): void;
}

interface ExcalidrawAutomateRoot {
    getAPI(): ExcalidrawAutomateApi;
}

interface ExcalidrawWindow extends Window {
    ExcalidrawAutomate?: ExcalidrawAutomateRoot;
}

export interface ExcalidrawCapabilities {
    readonly available: boolean;
    readonly canRecognize: boolean;
    readonly canCreate: boolean;
    readonly canListTemplates: boolean;
    readonly canCreateSvgPreview: boolean;
    readonly reason: "ready" | "missing" | "initializing" | "outdated" | "invalid-api";
}

export class ExcalidrawBridge {
    constructor(private readonly app: App) {}

    probe(): ExcalidrawCapabilities {
        const root = this.findRoot();
        if (!root) return unavailable("missing");
        let api: ExcalidrawAutomateApi | null = null;
        try {
            api = root.getAPI();
            if (!api || typeof api !== "object") return unavailable("invalid-api");
            const canRecognize = typeof api.isExcalidrawFile === "function";
            const hasVerifier = typeof api.verifyMinimumPluginVersion === "function";
            const modernEnough = hasVerifier
                ? api.verifyMinimumPluginVersion!(MINIMUM_SILENT_CREATE_VERSION) === true
                : false;
            return {
                available: true,
                canRecognize,
                canCreate: canRecognize && modernEnough && typeof api.create === "function",
                canListTemplates: typeof api.getListOfTemplateFiles === "function",
                canCreateSvgPreview: canRecognize && modernEnough && typeof api.create === "function",
                reason: !canRecognize ? "initializing" : modernEnough ? "ready" : "outdated"
            };
        } catch {
            return unavailable("initializing");
        } finally {
            destroyApi(api);
        }
    }

    isExcalidrawFile(file: TFile): boolean {
        const api = this.createApi();
        if (!api) return false;
        try {
            return typeof api.isExcalidrawFile === "function"
                && api.isExcalidrawFile(file) === true;
        } catch {
            return false;
        } finally {
            destroyApi(api);
        }
    }

    async listTemplates(): Promise<TFile[]> {
        return this.withApi(async api => {
            if (typeof api.getListOfTemplateFiles !== "function") return [];
            const files = await Promise.resolve(api.getListOfTemplateFiles());
            return Array.isArray(files) ? files.filter((file): file is TFile => file instanceof TFile) : [];
        });
    }

    async create(options: ExcalidrawCreateOptions): Promise<string> {
        return this.withApi(async api => {
            if (typeof api.isExcalidrawFile !== "function"
                || typeof api.create !== "function"
                || typeof api.verifyMinimumPluginVersion !== "function"
                || api.verifyMinimumPluginVersion(MINIMUM_SILENT_CREATE_VERSION) !== true) {
                throw new Error("The Excalidraw API does not support safe silent creation.");
            }
            const result = await api.create(options);
            if (typeof result !== "string" || !result.trim()) {
                throw new Error("Excalidraw returned an invalid file path.");
            }
            return result;
        });
    }

    async openFile(file: TFile): Promise<void> {
        await this.withApi(async api => {
            if (typeof api.isExcalidrawFile !== "function" || !api.isExcalidrawFile(file)) {
                throw new Error("The selected file is not recognized by Excalidraw.");
            }
            let existing: WorkspaceLeaf | null = null;
            if (typeof api.isExcalidrawView === "function") {
                this.app.workspace.iterateAllLeaves(leaf => {
                    const viewFile = (leaf.view as { file?: TFile }).file;
                    if (!existing && viewFile?.path === file.path && api.isExcalidrawView!(leaf.view)) {
                        existing = leaf;
                    }
                });
            }
            if (existing) {
                this.app.workspace.revealLeaf(existing);
                return;
            }
            const leaf = this.app.workspace.getLeaf("tab");
            await leaf.openFile(file, { active: true });
            this.app.workspace.revealLeaf(leaf);
            if (typeof api.isExcalidrawView === "function"
                && !await waitForView(api, leaf, 1_000)) {
                throw new Error("Excalidraw left the file in Markdown view.");
            }
        });
    }

    private async withApi<T>(operation: (api: ExcalidrawAutomateApi) => T | Promise<T>): Promise<T> {
        const api = this.createApi();
        if (!api) throw new Error("Excalidraw Automate is not available.");
        try {
            return await operation(api);
        } finally {
            destroyApi(api);
        }
    }

    private createApi(): ExcalidrawAutomateApi | null {
        const root = this.findRoot();
        if (!root || typeof root.getAPI !== "function") return null;
        try {
            return root.getAPI();
        } catch {
            return null;
        }
    }

    private findRoot(): ExcalidrawAutomateRoot | null {
        const windows: ExcalidrawWindow[] = [];
        this.app.workspace.iterateAllLeaves(leaf => {
            const candidate = leaf.view.containerEl?.ownerDocument?.defaultView as ExcalidrawWindow | null;
            if (candidate && !windows.includes(candidate)) windows.push(candidate);
        });
        const globalWindow = globalThis.window as ExcalidrawWindow | undefined;
        if (globalWindow && !windows.includes(globalWindow)) windows.push(globalWindow);
        for (const candidate of windows) {
            const root = candidate.ExcalidrawAutomate;
            if (root && typeof root.getAPI === "function") return root;
        }
        return null;
    }
}

function unavailable(reason: Exclude<ExcalidrawCapabilities["reason"], "ready" | "outdated">): ExcalidrawCapabilities {
    return {
        available: false,
        canRecognize: false,
        canCreate: false,
        canListTemplates: false,
        canCreateSvgPreview: false,
        reason
    };
}

function destroyApi(api: ExcalidrawAutomateApi | null): void {
    try {
        api?.destroy?.();
    } catch {
        // A concurrent external-plugin unload must not mask the original result.
    }
}

async function waitForView(
    api: ExcalidrawAutomateApi,
    leaf: WorkspaceLeaf,
    timeoutMs: number
): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    do {
        if (api.isExcalidrawView?.(leaf.view) === true) return true;
        await new Promise(resolve => globalThis.setTimeout(resolve, 50));
    } while (Date.now() < deadline);
    return false;
}
