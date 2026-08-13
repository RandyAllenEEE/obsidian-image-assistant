import { normalizePath } from "obsidian";
import type ImageConverterPlugin from "../../../main";
import type { NextAiPromptTemplate } from "../../../settings/types";
import { AsyncLock } from "../../../utils/AsyncLock";
import { AtomicJsonSidecar } from "../../../utils/AtomicJsonSidecar";

const STORE_VERSION = 1;
const MAX_TEMPLATES = 100;
const MAX_BYTES = 2 * 1024 * 1024;

export class NextAiTemplateStore {
    private readonly lock = new AsyncLock();
    private loaded = false;
    private templates: NextAiPromptTemplate[] = [];

    constructor(private readonly plugin: ImageConverterPlugin) { }

    async list(): Promise<NextAiPromptTemplate[]> {
        await this.load();
        return sortTemplates(this.templates).map(template => ({ ...template }));
    }

    async save(template: NextAiPromptTemplate): Promise<void> {
        await this.lock.acquire("next-ai-templates", async () => {
            await this.load();
            const normalized = normalizeTemplate(template);
            this.templates = [
                ...this.templates.filter(value => value.id !== normalized.id),
                normalized
            ].slice(-MAX_TEMPLATES);
            await this.write();
        });
    }

    async delete(id: string): Promise<void> {
        await this.lock.acquire("next-ai-templates", async () => {
            await this.load();
            this.templates = this.templates.filter(template => template.id !== id);
            await this.write();
        });
    }

    async recordUse(id: string): Promise<void> {
        await this.lock.acquire("next-ai-templates", async () => {
            await this.load();
            const found = this.templates.find(template => template.id === id);
            if (!found) return;
            found.useCount = Math.min(Number.MAX_SAFE_INTEGER, found.useCount + 1);
            await this.write();
        });
    }

    async importJson(content: string): Promise<number> {
        const parsed = JSON.parse(content) as unknown;
        const values = Array.isArray(parsed)
            ? parsed
            : isRecord(parsed) && Array.isArray(parsed.templates)
                ? parsed.templates
                : null;
        if (!values) throw new Error("Invalid Next AI template JSON.");
        const imported = values.flatMap(value => {
            try {
                return [normalizeTemplate(value)];
            } catch {
                return [];
            }
        }).slice(0, MAX_TEMPLATES);
        if (imported.length === 0) throw new Error("No valid Next AI templates were found.");
        await this.lock.acquire("next-ai-templates", async () => {
            await this.load();
            const byId = new Map(this.templates.map(template => [template.id, template]));
            imported.forEach(template => byId.set(template.id, template));
            this.templates = Array.from(byId.values()).slice(-MAX_TEMPLATES);
            await this.write();
        });
        return imported.length;
    }

    async exportJson(): Promise<string> {
        return JSON.stringify({
            version: STORE_VERSION,
            templates: await this.list()
        }, null, 2);
    }

    private async load(): Promise<void> {
        if (this.loaded) return;
        const value = await this.sidecar().read();
        this.templates = parseDocument(value);
        this.loaded = true;
        const legacy = this.plugin.settings.drawing.drawio.nextAi.promptTemplates;
        if (this.templates.length === 0 && legacy.length > 0) {
            this.templates = legacy.flatMap(value => {
                try {
                    return [normalizeTemplate(value)];
                } catch {
                    return [];
                }
            }).slice(0, MAX_TEMPLATES);
            await this.write();
            this.plugin.settings.drawing.drawio.nextAi.promptTemplates = [];
            await this.plugin.saveSettings();
        }
    }

    private write(): Promise<void> {
        return this.sidecar().write({ version: STORE_VERSION, templates: this.templates });
    }

    private sidecar(): AtomicJsonSidecar {
        const directory = this.plugin.manifest.dir;
        if (!directory) throw new Error("The plugin directory is unavailable for Next AI templates.");
        return new AtomicJsonSidecar(
            this.plugin.app.vault.adapter,
            normalizePath(`${directory}/next-ai-templates.json`),
            MAX_BYTES
        );
    }
}

function parseDocument(value: unknown): NextAiPromptTemplate[] {
    if (!isRecord(value) || value.version !== STORE_VERSION || !Array.isArray(value.templates)) return [];
    return value.templates.flatMap(candidate => {
        try {
            return [normalizeTemplate(candidate)];
        } catch {
            return [];
        }
    }).slice(0, MAX_TEMPLATES);
}

export function normalizeTemplate(value: unknown): NextAiPromptTemplate {
    if (!isRecord(value)) throw new Error("Invalid Next AI template.");
    const id = String(value.id ?? "").trim().slice(0, 100);
    const title = String(value.title ?? value.name ?? "").trim().slice(0, 100);
    const body = String(value.body ?? value.prompt ?? "").trim().slice(0, 20_000);
    if (!id || !title || !body) throw new Error("A template requires an ID, title, and body.");
    const now = Date.now();
    return {
        id,
        title,
        description: String(value.description ?? "").trim().slice(0, 500),
        body,
        pinned: value.pinned === true,
        createdAt: finiteInteger(value.createdAt, now),
        updatedAt: finiteInteger(value.updatedAt, now),
        useCount: Math.max(0, finiteInteger(value.useCount, 0))
    };
}

function sortTemplates(values: readonly NextAiPromptTemplate[]): NextAiPromptTemplate[] {
    return [...values].sort((left, right) => Number(right.pinned) - Number(left.pinned)
        || right.updatedAt - left.updatedAt
        || left.title.localeCompare(right.title));
}

function finiteInteger(value: unknown, fallback: number): number {
    return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
