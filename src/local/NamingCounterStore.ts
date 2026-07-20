import { App, normalizePath } from "obsidian";
import { AsyncLock } from "../utils/AsyncLock";
import { sha256Hex } from "../utils/BinaryHash";

interface NamingCounterState {
    readonly version: 1;
    readonly counters: Record<string, number>;
}

interface NamingCounterRuntimeState {
    readonly counters: Map<string, number>;
    loaded: boolean;
}

const STATE_VERSION = 1;
const STATE_FILENAME = "naming-counters.json";

/**
 * Persistent high-water marks for naming counters. Persistence failure never
 * permits duplicate reservations within the running process.
 */
export class NamingCounterStore {
    private static readonly lock = new AsyncLock();
    private static readonly runtimeStates =
        new WeakMap<object, NamingCounterRuntimeState>();
    private readonly runtimeState: NamingCounterRuntimeState;

    constructor(private readonly app: App) {
        const adapter = app.vault.adapter as object;
        const existing = NamingCounterStore.runtimeStates.get(adapter);
        this.runtimeState = existing ?? {
            counters: new Map<string, number>(),
            loaded: false
        };
        if (!existing) {
            NamingCounterStore.runtimeStates.set(adapter, this.runtimeState);
        }
    }

    async reserve(
        scopePath: string,
        template: string,
        padding: number
    ): Promise<string> {
        const key = await this.createKey(scopePath, template);
        return NamingCounterStore.lock.acquire(`naming-counter:${key}`, async () => {
            await this.load();
            const next = (this.runtimeState.counters.get(key) ?? 0) + 1;
            this.runtimeState.counters.set(key, next);
            await this.persist();
            return next.toString().padStart(padding, "0");
        });
    }

    private async createKey(scopePath: string, template: string): Promise<string> {
        const normalizedScope = normalizePath(scopePath || "/");
        const encoded = new TextEncoder().encode(template).buffer;
        return `${normalizedScope}:${(await sha256Hex(encoded)).slice(0, 16)}`;
    }

    private async load(): Promise<void> {
        if (this.runtimeState.loaded) return;
        this.runtimeState.loaded = true;
        const adapter = this.app.vault.adapter;
        const paths = this.getRecoveryPaths();
        try {
            if (typeof adapter.exists !== "function"
                || typeof adapter.read !== "function") {
                throw new Error("The vault adapter cannot read naming counters.");
            }
            let foundPersistedState = false;
            for (const path of paths) {
                if (!(await adapter.exists(path))) continue;
                const parsed = parseCounterState(await adapter.read(path));
                if (!parsed) continue;
                foundPersistedState = true;
                for (const [key, value] of Object.entries(parsed.counters)) {
                    const current = this.runtimeState.counters.get(key) ?? 0;
                    if (value > current) {
                        this.runtimeState.counters.set(key, value);
                    }
                }
            }
            if (!foundPersistedState && await adapter.exists(paths[0])) {
                throw new Error("The persisted naming counter state is invalid.");
            }
        } catch (error) {
            console.warn("[Image Assistant] Naming counters could not be loaded:", error);
            this.runtimeState.loaded = false;
            throw error;
        }
    }

    private async persist(): Promise<void> {
        const adapter = this.app.vault.adapter;
        if (typeof adapter.write !== "function"
            || typeof adapter.rename !== "function") {
            throw new Error("The vault adapter cannot persist naming counters.");
        }
        const path = this.getStatePath();
        const tempPath = `${path}.tmp`;
        const backupPath = `${path}.bak`;
        const state: NamingCounterState = {
            version: STATE_VERSION,
            counters: Object.fromEntries(this.runtimeState.counters)
        };
        try {
            const parent = path.slice(0, path.lastIndexOf("/"));
            if (parent && typeof adapter.mkdir === "function"
                && !(await adapter.exists(parent))) {
                await adapter.mkdir(parent);
            }
            await adapter.write(tempPath, JSON.stringify(state));
            if (await adapter.exists(backupPath)) await adapter.remove(backupPath);
            if (await adapter.exists(path)) await adapter.rename(path, backupPath);
            await adapter.rename(tempPath, path);
            if (await adapter.exists(backupPath)) await adapter.remove(backupPath);
        } catch (error) {
            console.warn("[Image Assistant] Naming counters could not be persisted:", error);
            try {
                if (!(await adapter.exists(path))
                    && await adapter.exists(backupPath)) {
                    await adapter.rename(backupPath, path);
                }
                if (await adapter.exists(tempPath)) await adapter.remove(tempPath);
            } catch {
                // Best-effort cleanup only.
            }
            throw error;
        }
    }

    private getStatePath(): string {
        const configDir = (this.app.vault as { configDir?: string }).configDir
            ?? ".obsidian";
        return normalizePath(
            `${configDir}/plugins/obsidian-image-assistant/${STATE_FILENAME}`
        );
    }

    private getRecoveryPaths(): readonly string[] {
        const path = this.getStatePath();
        return [path, `${path}.tmp`, `${path}.bak`];
    }
}

function parseCounterState(raw: string): NamingCounterState | null {
    try {
        const parsed = JSON.parse(raw) as Partial<NamingCounterState>;
        if (parsed.version !== STATE_VERSION
            || !parsed.counters
            || typeof parsed.counters !== "object"
            || Array.isArray(parsed.counters)) {
            return null;
        }
        const counters: Record<string, number> = {};
        for (const [key, value] of Object.entries(parsed.counters)) {
            if (!Number.isSafeInteger(value) || value < 0) return null;
            counters[key] = value;
        }
        return { version: STATE_VERSION, counters };
    } catch {
        return null;
    }
}
