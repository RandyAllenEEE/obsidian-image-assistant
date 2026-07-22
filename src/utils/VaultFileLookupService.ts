import { App, normalizePath, TFile, type TAbstractFile } from "obsidian";

const LOOKUP_SLICE_MS = 2;
const sharedServices = new WeakMap<App, VaultFileLookupService>();

export class VaultFileLookupService {
    private readonly byBasename = new Map<string, TFile[]>();
    private readonly byPath = new Map<string, TFile>();
    private buildPromise: Promise<void> | null = null;
    private ready = false;
    private topologyGeneration = 0;

    constructor(private readonly app: App) { }

    isReady(): boolean {
        return this.ready;
    }

    getGeneration(): number {
        return this.topologyGeneration;
    }

    getCandidates(basename: string): readonly TFile[] | null {
        if (!this.ready) return null;
        return [...(this.byBasename.get(basename.toLowerCase()) ?? [])];
    }

    async ensureReady(signal?: AbortSignal): Promise<void> {
        if (this.ready) return;
        if (!this.buildPromise) {
            this.buildPromise = this.build(signal).finally(() => {
                this.buildPromise = null;
            });
        }
        await waitForPromise(this.buildPromise, signal);
    }

    /**
     * Reconciles missed or delayed Vault topology events without rebuilding on
     * ordinary indexed queries. Source-deletion workflows call this explicitly.
     */
    async reconcile(signal?: AbortSignal): Promise<boolean> {
        await this.ensureReady(signal);
        while (true) {
            const startedAtGeneration = this.topologyGeneration;
            const snapshot = await this.createSnapshot(signal);
            if (startedAtGeneration !== this.topologyGeneration) continue;
            if (this.matchesSnapshot(snapshot.byPath)) return false;

            this.topologyGeneration++;
            this.applySnapshot(snapshot);
            return true;
        }
    }

    handleCreate(file: TAbstractFile): void {
        this.topologyGeneration++;
        if (this.ready && file instanceof TFile) this.add(file);
    }

    handleDelete(file: TAbstractFile): void {
        this.topologyGeneration++;
        if (this.ready && file instanceof TFile) this.remove(file.path, file);
    }

    handleRename(file: TAbstractFile, oldPath: string): void {
        this.topologyGeneration++;
        if (!this.ready || !(file instanceof TFile)) return;
        this.remove(oldPath, file);
        this.add(file);
    }

    private async build(signal?: AbortSignal): Promise<void> {
        while (true) {
            const startedAtGeneration = this.topologyGeneration;
            const snapshot = await this.createSnapshot(signal);
            if (startedAtGeneration !== this.topologyGeneration) continue;
            this.applySnapshot(snapshot);
            this.ready = true;
            return;
        }
    }

    private async createSnapshot(signal?: AbortSignal): Promise<{
        byBasename: Map<string, TFile[]>;
        byPath: Map<string, TFile>;
    }> {
        const byBasename = new Map<string, TFile[]>();
        const byPath = new Map<string, TFile>();
        const files = [...(this.app.vault.getFiles?.() ?? [])];
        let sliceStartedAt = performance.now();
        for (const file of files) {
            throwIfAborted(signal);
            const path = normalizePath(file.path);
            byPath.set(path, file);
            const key = file.name.toLowerCase();
            const values = byBasename.get(key) ?? [];
            values.push(file);
            byBasename.set(key, values);
            if (performance.now() - sliceStartedAt >= LOOKUP_SLICE_MS) {
                await yieldToMainThread();
                sliceStartedAt = performance.now();
            }
        }
        byBasename.forEach(values => values.sort((left, right) =>
            left.path.localeCompare(right.path)));
        return { byBasename, byPath };
    }

    private applySnapshot(snapshot: {
        byBasename: ReadonlyMap<string, TFile[]>;
        byPath: ReadonlyMap<string, TFile>;
    }): void {
        this.byBasename.clear();
        snapshot.byBasename.forEach((values, key) =>
            this.byBasename.set(key, values));
        this.byPath.clear();
        snapshot.byPath.forEach((file, path) => this.byPath.set(path, file));
    }

    private matchesSnapshot(snapshot: ReadonlyMap<string, TFile>): boolean {
        if (snapshot.size !== this.byPath.size) return false;
        for (const [path, file] of snapshot) {
            if (this.byPath.get(path) !== file) return false;
        }
        return true;
    }

    private add(file: TFile): void {
        this.byPath.set(normalizePath(file.path), file);
        const key = file.name.toLowerCase();
        const values = this.byBasename.get(key) ?? [];
        if (!values.some(value => value.path === file.path)) values.push(file);
        values.sort((left, right) => left.path.localeCompare(right.path));
        this.byBasename.set(key, values);
    }

    private remove(path: string, file?: TFile): void {
        const normalized = normalizePath(path);
        this.byPath.delete(normalized);
        const key = getBasename(normalized).toLowerCase();
        const values = this.byBasename.get(key);
        if (!values) return;
        const filtered = values.filter(value =>
            value !== file && normalizePath(value.path) !== normalized);
        if (filtered.length === 0) this.byBasename.delete(key);
        else if (filtered.length !== values.length) this.byBasename.set(key, filtered);
    }
}

export function getSharedVaultFileLookupService(app: App): VaultFileLookupService {
    const existing = sharedServices.get(app);
    if (existing) return existing;
    const service = new VaultFileLookupService(app);
    sharedServices.set(app, service);
    return service;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw toAbortError(signal);
}

async function waitForPromise<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise;
    throwIfAborted(signal);
    return new Promise<T>((resolve, reject) => {
        const abort = (): void => reject(toAbortError(signal));
        signal.addEventListener("abort", abort, { once: true });
        promise.then(
            value => {
                signal.removeEventListener("abort", abort);
                resolve(value);
            },
            error => {
                signal.removeEventListener("abort", abort);
                reject(error);
            }
        );
    });
}

function toAbortError(signal?: AbortSignal): Error {
    return signal?.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
}

function yieldToMainThread(): Promise<void> {
    return new Promise(resolve => window.setTimeout(resolve, 0));
}

function getBasename(path: string): string {
    const slash = path.lastIndexOf("/");
    return slash < 0 ? path : path.slice(slash + 1);
}
