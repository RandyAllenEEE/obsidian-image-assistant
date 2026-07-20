import { App, FileSystemAdapter } from "obsidian";
import ImageConverterPlugin from "../main";
import { AsyncLock } from "./AsyncLock";

const HISTORY_FILE_NAME = "upload_history.json";

export interface UploadRecord {
    url: string;
    imgUrl?: string;
    localPath?: string;
    [key: string]: unknown;
}

interface HistoryReadResult {
    readonly exists: boolean;
    readonly valid: boolean;
    readonly records: UploadRecord[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneRecord(record: UploadRecord): UploadRecord {
    return JSON.parse(JSON.stringify(record)) as UploadRecord;
}

export class UploadHistoryManager {
    private history: UploadRecord[] = [];
    private loaded = false;
    private readonly lock = new AsyncLock();

    constructor(
        private readonly app: App,
        private readonly plugin: ImageConverterPlugin
    ) { }

    async init(): Promise<void> {
        await this.lock.acquire("history", async () => {
            await this.loadHistory();
            await this.migrateFromSettings();
        });
    }

    async addRecord(record: UploadRecord): Promise<void> {
        const normalized = this.normalizeRecord(record);
        if (!normalized) throw new Error("Upload history record has no valid URL");

        await this.lock.acquire("history", async () => {
            if (!this.loaded) await this.loadHistory();
            const next = this.history.map(cloneRecord);
            const existingIndex = next.findIndex(existing => this.isMatch(normalized.url, existing));
            if (existingIndex >= 0) next[existingIndex] = { ...next[existingIndex], ...normalized };
            else next.push(normalized);

            const deduped = this.dedupe(next);
            await this.saveHistory(deduped);
            this.history = deduped;
        });
    }

    async removeRecord(url: string): Promise<void> {
        await this.lock.acquire("history", async () => {
            if (!this.loaded) await this.loadHistory();
            const next = this.history.filter(record => !this.isMatch(url, record)).map(cloneRecord);
            await this.saveHistory(next);
            this.history = next;
        });
    }

    getRecord(url: string): UploadRecord | undefined {
        const record = this.history.find(candidate => this.isMatch(url, candidate));
        return record ? cloneRecord(record) : undefined;
    }

    getHistory(): UploadRecord[] {
        return this.history.map(cloneRecord);
    }

    isUrlUploaded(url: string): boolean {
        return this.history.some(record => this.isMatch(url, record));
    }

    isLocalPathUploaded(path: string): boolean {
        return this.history.some(record => record.localPath === path);
    }

    private getAdapter(): FileSystemAdapter {
        return this.app.vault.adapter as FileSystemAdapter;
    }

    private getHistoryFilePath(): string {
        return `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}/${HISTORY_FILE_NAME}`;
    }

    private async loadHistory(): Promise<void> {
        const filePath = this.getHistoryFilePath();
        const primary = await this.readHistoryCandidate(filePath);
        let selected = primary;
        let recoveredFrom: string | null = null;

        if (!primary.valid) {
            for (const recoveryPath of [`${filePath}.tmp`, `${filePath}.bak`]) {
                const candidate = await this.readHistoryCandidate(recoveryPath);
                if (!candidate.valid) continue;
                selected = candidate;
                recoveredFrom = recoveryPath;
                break;
            }
        }

        if (recoveredFrom) {
            console.warn(
                `[Image Assistant] Upload history recovered from ${recoveredFrom}.`
            );
        } else if (primary.exists && !primary.valid) {
            console.warn(
                "Upload history was invalid and no valid recovery file was available."
            );
        }

        this.history = this.dedupe(selected.valid ? selected.records : []);
        this.loaded = true;
    }

    private async readHistoryCandidate(path: string): Promise<HistoryReadResult> {
        const adapter = this.getAdapter();
        try {
            if (!await adapter.exists(path)) {
                return { exists: false, valid: false, records: [] };
            }
            const parsed = JSON.parse(await adapter.read(path)) as unknown;
            if (!Array.isArray(parsed)) {
                return { exists: true, valid: false, records: [] };
            }
            const records = parsed
                .map(value => this.normalizeRecord(value))
                .filter((value): value is UploadRecord => !!value);
            return {
                exists: true,
                valid: parsed.length === 0 || records.length > 0,
                records
            };
        } catch (error) {
            console.warn(
                `[Image Assistant] Failed to read upload history candidate ${path}:`,
                error
            );
            return { exists: true, valid: false, records: [] };
        }
    }

    private async saveHistory(records: UploadRecord[]): Promise<void> {
        const adapter = this.getAdapter();
        const filePath = this.getHistoryFilePath();
        const tempPath = `${filePath}.tmp`;
        const backupPath = `${filePath}.bak`;
        const content = JSON.stringify(records, null, 2);

        if (typeof adapter.rename !== "function" || typeof adapter.remove !== "function") {
            await adapter.write(filePath, content);
            return;
        }

        if (await adapter.exists(tempPath)) await adapter.remove(tempPath);
        await adapter.write(tempPath, content);

        let movedExisting = false;
        let committed = false;
        try {
            if (await adapter.exists(filePath)) {
                if (await adapter.exists(backupPath)) {
                    await adapter.remove(backupPath);
                }
                await adapter.rename(filePath, backupPath);
                movedExisting = true;
            }
            await adapter.rename(tempPath, filePath);
            committed = true;
        } catch (error) {
            try {
                if (!await adapter.exists(filePath) && movedExisting && await adapter.exists(backupPath)) {
                    await adapter.rename(backupPath, filePath);
                }
            } catch (recoveryError) {
                throw new AggregateError(
                    [error, recoveryError],
                    "Upload history write failed and the previous history could not be restored"
                );
            }
            throw error;
        } finally {
            try {
                if (await adapter.exists(tempPath)) await adapter.remove(tempPath);
            } catch (cleanupError) {
                console.warn("Failed to clean up the temporary upload history file:", cleanupError);
            }
        }

        if (committed && movedExisting) {
            try {
                if (await adapter.exists(backupPath)) await adapter.remove(backupPath);
            } catch (cleanupError) {
                console.warn("Upload history was saved, but its backup could not be removed:", cleanupError);
            }
        }
    }

    private async migrateFromSettings(): Promise<void> {
        const legacy = typeof this.plugin.consumeLegacyUploadHistory === "function"
            ? this.plugin.consumeLegacyUploadHistory()
            : Array.isArray((this.plugin.settings as unknown as Record<string, unknown>).uploadedImages)
                ? (this.plugin.settings as unknown as { uploadedImages: unknown[] }).uploadedImages
                : [];
        if (legacy.length === 0) return;

        const migrated = legacy
            .map(value => this.normalizeRecord(value))
            .filter((value): value is UploadRecord => !!value);
        const next = this.dedupe([...this.history, ...migrated]);
        await this.saveHistory(next);
        this.history = next;
        delete (this.plugin.settings as unknown as Record<string, unknown>).uploadedImages;
        await this.plugin.saveSettings();
    }

    private normalizeRecord(value: unknown): UploadRecord | null {
        if (!isRecord(value)) return null;
        const rawUrl = typeof value.url === "string" && value.url.trim()
            ? value.url.trim()
            : typeof value.imgUrl === "string" && value.imgUrl.trim()
                ? value.imgUrl.trim()
                : "";
        const url = this.normalizeHttpTemplateUrl(rawUrl);
        if (!url) return null;

        const record = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
        record.url = url;
        if (typeof record.imgUrl === "string") {
            const imgUrl = this.normalizeHttpTemplateUrl(record.imgUrl);
            if (imgUrl) record.imgUrl = imgUrl;
            else delete record.imgUrl;
        } else {
            delete record.imgUrl;
        }
        if (typeof record.localPath !== "string") delete record.localPath;
        return record as UploadRecord;
    }

    private normalizeHttpTemplateUrl(value: string): string | null {
        const raw = value.trim();
        if (!raw || /\s/.test(raw)) return null;

        const schemeSeparator = raw.indexOf("://");
        if (schemeSeparator <= 0) return null;
        const authorityStart = schemeSeparator + 3;
        const firstPathMarker = [raw.indexOf("/", authorityStart), raw.indexOf("?", authorityStart), raw.indexOf("#", authorityStart)]
            .filter(index => index >= 0)
            .reduce((minimum, index) => Math.min(minimum, index), raw.length);
        const schemeAndAuthority = raw.slice(0, firstPathMarker);
        const fragmentStart = raw.indexOf("#", authorityStart);
        const fragment = fragmentStart >= 0 ? raw.slice(fragmentStart) : "";
        if (/[{}]/.test(schemeAndAuthority) || /[{}]/.test(fragment)) return null;

        const parseable = raw.replace(/{[^{}]+}/g, "image-assistant-template");
        if (/[{}]/.test(parseable)) return null;
        let parsed: URL;
        try {
            parsed = new URL(parseable);
        } catch {
            return null;
        }
        if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
            || !parsed.hostname
            || parsed.username
            || parsed.password) {
            return null;
        }
        return raw;
    }

    private dedupe(records: UploadRecord[]): UploadRecord[] {
        const result: UploadRecord[] = [];
        for (const record of records) {
            const existingIndex = result.findIndex(existing => this.isMatch(record.url, existing));
            if (existingIndex >= 0) result[existingIndex] = { ...result[existingIndex], ...cloneRecord(record) };
            else result.push(cloneRecord(record));
        }
        return result;
    }

    private isMatch(url: string, record: UploadRecord): boolean {
        if (record.url === url || record.imgUrl === url) return true;
        if (record.url.includes("{") && this.matchUrlWithPattern(url, record.url)) return true;
        if (typeof record.imgUrl === "string" && record.imgUrl.includes("{")
            && this.matchUrlWithPattern(url, record.imgUrl)) return true;
        return false;
    }

    private matchUrlWithPattern(url: string, pattern: string): boolean {
        try {
            let regexText = pattern.replace(/[.*+?^${}()|[\]\\]/g, match => {
                if (match === "{" || match === "}") return match;
                return `\\${match}`;
            });
            regexText = regexText.replace(/{year}|{month}|{day}|{hour}|{minute}|{second}/g, "\\d+");
            regexText = regexText.replace(/{MD5}|{uuid}|{fileName}|{extName}/g, "[a-zA-Z0-9\\-_]+");
            regexText = regexText.replace(/{[\w:]+}/g, ".*?");
            return new RegExp(`^${regexText}$`).test(url);
        } catch (error) {
            console.error("[UploadHistoryManager] Pattern match error:", error);
            return false;
        }
    }
}
