import { normalizePath } from "obsidian";
import type { UIMessage } from "ai";
import type ImageConverterPlugin from "../../../main";
import type { DrawingAiAttachment } from "../DrawioTypes";
import { AsyncLock } from "../../../utils/AsyncLock";
import { AtomicJsonSidecar } from "../../../utils/AtomicJsonSidecar";
import type { DrawingHistoryEntry } from "./DrawingHistoryModal";

const STORE_VERSION = 2;
const LEGACY_STORE_VERSION = 1;
const MAX_SESSIONS = 25;
const MAX_STORE_CHARS = 32 * 1024 * 1024;

export type NextAiStoredAttachment = Pick<DrawingAiAttachment,
    "name" | "kind" | "mediaType" | "size" | "dataUrl" | "extractedText" | "sourceUrl">;

export interface NextAiStoredPresentation {
    readonly text: string;
    readonly attachments: readonly NextAiStoredAttachment[];
}

export interface NextAiStoredSession {
    readonly id: string;
    readonly filePath: string;
    readonly title: string;
    readonly updatedAt: number;
    readonly messages: readonly UIMessage[];
    readonly userPresentation: Readonly<Record<string, NextAiStoredPresentation>>;
    readonly previousXml: string;
    readonly lastUserText: string;
    readonly diagramXml: string;
    readonly userXmlSnapshots: Readonly<Record<string, string>>;
    readonly diagramHistory: readonly DrawingHistoryEntry[];
    readonly thumbnailDataUrl?: string;
}

export class NextAiSessionStore {
    private readonly lock = new AsyncLock();
    private loaded = false;
    private sessions: NextAiStoredSession[] = [];

    constructor(private readonly plugin: ImageConverterPlugin) { }

    async list(filePath?: string): Promise<NextAiStoredSession[]> {
        await this.load();
        return this.sessions
            .filter(session => !filePath || session.filePath === filePath)
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map(cloneSession);
    }

    async get(id: string): Promise<NextAiStoredSession | null> {
        await this.load();
        const found = this.sessions.find(session => session.id === id);
        return found ? cloneSession(found) : null;
    }

    async save(session: NextAiStoredSession): Promise<void> {
        await this.lock.acquire("next-ai-sessions", async () => {
            await this.load();
            const normalized = normalizeSession(session);
            const next = this.sessions.filter(value => value.id !== normalized.id);
            next.push(normalized);
            next.sort((a, b) => b.updatedAt - a.updatedAt);
            this.sessions = fitStore(next.slice(0, MAX_SESSIONS));
            await this.write();
        });
    }

    async delete(id: string): Promise<void> {
        await this.lock.acquire("next-ai-sessions", async () => {
            await this.load();
            this.sessions = this.sessions.filter(session => session.id !== id);
            await this.write();
        });
    }

    private async load(): Promise<void> {
        if (this.loaded) return;
        const value = await this.sidecar().read();
        this.sessions = parseDocument(value);
        this.loaded = true;
    }

    private async write(): Promise<void> {
        await this.sidecar().write(serializeDocument(this.sessions));
    }

    private path(): string {
        const directory = this.plugin.manifest.dir;
        if (!directory) throw new Error("The plugin directory is unavailable for Next AI history.");
        return normalizePath(`${directory}/next-ai-sessions.json`);
    }

    private sidecar(): AtomicJsonSidecar {
        return new AtomicJsonSidecar(
            this.plugin.app.vault.adapter,
            this.path(),
            MAX_STORE_CHARS
        );
    }
}

function parseDocument(value: unknown): NextAiStoredSession[] {
    if (!isRecord(value) || !Array.isArray(value.sessions)) return [];
    let candidates: unknown[];
    if (value.version === STORE_VERSION) {
        candidates = hydrateSessions(value.sessions, readAttachmentTable(value.attachments));
    } else if (value.version === LEGACY_STORE_VERSION) {
        candidates = value.sessions;
    } else {
        return [];
    }
    const sessions: NextAiStoredSession[] = [];
    for (const candidate of candidates) {
        try {
            sessions.push(normalizeSession(candidate as NextAiStoredSession));
        } catch {
            // Ignore malformed individual sessions without discarding valid history.
        }
    }
    return fitStore(sessions.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS));
}

function normalizeSession(value: NextAiStoredSession): NextAiStoredSession {
    if (!value || typeof value !== "object") throw new Error("Invalid Next AI session.");
    const id = String(value.id ?? "").trim().slice(0, 200);
    const filePath = normalizePath(String(value.filePath ?? "").trim());
    if (!id || !filePath || !Array.isArray(value.messages)) throw new Error("Invalid Next AI session identity.");
    const messages = value.messages.filter(isUiMessage).map(message => structuredClone(message));
    const presentation = normalizePresentation(value.userPresentation);
    return {
        id,
        filePath,
        title: String(value.title ?? "Next AI chat").trim().slice(0, 120) || "Next AI chat",
        updatedAt: Number.isFinite(value.updatedAt) ? Math.trunc(value.updatedAt) : Date.now(),
        messages,
        userPresentation: presentation,
        previousXml: String(value.previousXml ?? "").slice(0, 16 * 1024 * 1024),
        lastUserText: String(value.lastUserText ?? "").slice(0, 20_000),
        diagramXml: String(value.diagramXml ?? "").slice(0, 16 * 1024 * 1024),
        userXmlSnapshots: normalizeXmlSnapshots(value.userXmlSnapshots),
        diagramHistory: normalizeDiagramHistory(value.diagramHistory),
        thumbnailDataUrl: typeof value.thumbnailDataUrl === "string"
            && /^data:image\/(?:png|jpeg|webp);/i.test(value.thumbnailDataUrl)
            ? value.thumbnailDataUrl.slice(0, 2 * 1024 * 1024)
            : undefined
    };
}

function normalizePresentation(value: unknown): Record<string, NextAiStoredPresentation> {
    if (!isRecord(value)) return {};
    const result: Record<string, NextAiStoredPresentation> = {};
    for (const [id, candidate] of Object.entries(value).slice(0, 1_000)) {
        if (!isRecord(candidate) || typeof candidate.text !== "string" || !Array.isArray(candidate.attachments)) continue;
        result[id] = {
            text: candidate.text.slice(0, 20_000),
            attachments: candidate.attachments.flatMap(attachment => {
                if (!isRecord(attachment)
                    || typeof attachment.name !== "string"
                    || !["image", "pdf", "text", "url", "canvas"].includes(String(attachment.kind))) return [];
                return [{
                    name: attachment.name.slice(0, 255),
                    kind: attachment.kind as DrawingAiAttachment["kind"],
                    mediaType: typeof attachment.mediaType === "string"
                        ? attachment.mediaType.slice(0, 255)
                        : "application/octet-stream",
                    size: typeof attachment.size === "number" && Number.isFinite(attachment.size)
                        ? Math.max(0, Math.trunc(attachment.size))
                        : 0,
                    dataUrl: typeof attachment.dataUrl === "string"
                        ? attachment.dataUrl.slice(0, 3 * 1024 * 1024)
                        : undefined,
                    extractedText: typeof attachment.extractedText === "string"
                        ? attachment.extractedText.slice(0, 150_000)
                        : undefined,
                    sourceUrl: typeof attachment.sourceUrl === "string"
                        ? attachment.sourceUrl.slice(0, 4_096)
                        : undefined
                }];
            }).slice(0, NEXT_AI_PRESENTATION_ATTACHMENT_LIMIT)
        };
    }
    return result;
}

const NEXT_AI_PRESENTATION_ATTACHMENT_LIMIT = 5;

function isUiMessage(value: unknown): value is UIMessage {
    return isRecord(value)
        && typeof value.id === "string"
        && ["user", "assistant", "system"].includes(String(value.role))
        && Array.isArray(value.parts);
}

function fitStore(sessions: NextAiStoredSession[]): NextAiStoredSession[] {
    const fitted = sessions.map(cloneSession);
    let measuredBytes = serializedBytes(fitted);
    if (measuredBytes <= MAX_STORE_CHARS) return fitted;

    if (fitted.length > 1) {
        // Sessions are newest-first. Find the largest prefix that fits with at
        // most log2(MAX_SESSIONS) full serializations instead of repeatedly
        // cloning and hashing a near-32 MiB document for every eviction.
        let low = 1;
        let high = fitted.length - 1;
        let keep = 1;
        let keepBytes = serializedBytes(fitted.slice(0, 1));
        while (low <= high) {
            const midpoint = Math.floor((low + high) / 2);
            const candidateBytes = serializedBytes(fitted.slice(0, midpoint));
            if (candidateBytes <= MAX_STORE_CHARS) {
                keep = midpoint;
                keepBytes = candidateBytes;
                low = midpoint + 1;
            } else {
                high = midpoint - 1;
            }
        }
        fitted.length = keep;
        measuredBytes = keepBytes;
    }
    if (measuredBytes <= MAX_STORE_CHARS) return fitted;

    // Presentation previews are redundant with file parts and are discarded first.
    for (const session of fitted) {
        for (const presentation of Object.values(session.userPresentation)) {
            for (const attachment of presentation.attachments) {
                delete (attachment as { dataUrl?: string }).dataUrl;
            }
        }
    }
    measuredBytes = serializedBytes(fitted);
    if (measuredBytes <= MAX_STORE_CHARS) return fitted;
    for (const session of fitted) {
        (session as { previousXml: string }).previousXml = "";
    }
    measuredBytes = serializedBytes(fitted);
    if (measuredBytes <= MAX_STORE_CHARS) return fitted;
    for (const session of fitted) {
        for (const message of session.messages) {
            (message as UIMessage).parts = message.parts.filter(part => part.type !== "file");
        }
    }
    measuredBytes = serializedBytes(fitted);
    if (measuredBytes <= MAX_STORE_CHARS) return fitted;

    const first = fitted[0];
    if (first?.messages.length) {
        trimOldestMessagesToFit(first);
        measuredBytes = serializedBytes(fitted);
    }
    if (first?.diagramHistory.length && measuredBytes > MAX_STORE_CHARS) {
        trimOldestHistoryToFit(first);
        measuredBytes = serializedBytes(fitted);
    }
    if (first && measuredBytes > MAX_STORE_CHARS) {
        for (const key of Object.keys(fitted[0].userPresentation)) {
            delete (fitted[0].userPresentation as Record<string, NextAiStoredPresentation>)[key];
        }
        for (const key of Object.keys(fitted[0].userXmlSnapshots)) {
            delete (fitted[0].userXmlSnapshots as Record<string, string>)[key];
        }
    }
    return fitted;
}

function trimOldestMessagesToFit(session: NextAiStoredSession): void {
    const messages = [...session.messages];
    let low = 1;
    let high = messages.length;
    let removeCount = messages.length;
    while (low <= high) {
        const midpoint = Math.floor((low + high) / 2);
        const candidate = sessionWithoutOldestMessages(session, midpoint);
        if (serializedBytes([candidate]) <= MAX_STORE_CHARS) {
            removeCount = midpoint;
            high = midpoint - 1;
        } else {
            low = midpoint + 1;
        }
    }
    const removed = (session.messages as UIMessage[]).splice(0, removeCount);
    const presentation = session.userPresentation as Record<string, NextAiStoredPresentation>;
    const snapshots = session.userXmlSnapshots as Record<string, string>;
    for (const message of removed) {
        delete presentation[message.id];
        delete snapshots[message.id];
    }
}

function sessionWithoutOldestMessages(
    session: NextAiStoredSession,
    removeCount: number
): NextAiStoredSession {
    const removedIds = new Set(session.messages.slice(0, removeCount).map(message => message.id));
    return {
        ...session,
        messages: session.messages.slice(removeCount),
        userPresentation: Object.fromEntries(
            Object.entries(session.userPresentation).filter(([id]) => !removedIds.has(id))
        ),
        userXmlSnapshots: Object.fromEntries(
            Object.entries(session.userXmlSnapshots).filter(([id]) => !removedIds.has(id))
        )
    };
}

function trimOldestHistoryToFit(session: NextAiStoredSession): void {
    const history = session.diagramHistory;
    let low = 1;
    let high = history.length;
    let removeCount = history.length;
    while (low <= high) {
        const midpoint = Math.floor((low + high) / 2);
        const candidate = { ...session, diagramHistory: history.slice(midpoint) };
        if (serializedBytes([candidate]) <= MAX_STORE_CHARS) {
            removeCount = midpoint;
            high = midpoint - 1;
        } else {
            low = midpoint + 1;
        }
    }
    (session.diagramHistory as DrawingHistoryEntry[]).splice(0, removeCount);
}

function serializeDocument(sessions: readonly NextAiStoredSession[]): Record<string, unknown> {
    const attachments: Record<string, string> = {};
    const idsByValue = new Map<string, string>();
    const serialized = sessions.map(session => {
        const value = cloneSession(session);
        for (const message of value.messages) {
            for (const part of message.parts) {
                if (part.type === "file" && isDataUrl(part.url)) {
                    (part as { url: string }).url = attachmentReference(
                        part.url,
                        attachments,
                        idsByValue
                    );
                }
            }
        }
        for (const presentation of Object.values(value.userPresentation)) {
            for (const attachment of presentation.attachments) {
                if (!attachment.dataUrl || !isDataUrl(attachment.dataUrl)) continue;
                (attachment as { dataUrl: string }).dataUrl = attachmentReference(
                    attachment.dataUrl,
                    attachments,
                    idsByValue
                );
            }
        }
        return value;
    });
    return { version: STORE_VERSION, attachments, sessions: serialized };
}

function hydrateSessions(values: unknown[], attachments: Record<string, string>): unknown[] {
    return values.map(value => {
        const clone = structuredClone(value);
        walkRecords(clone, record => {
            for (const key of ["url", "dataUrl"] as const) {
                const candidate = record[key];
                if (typeof candidate !== "string" || !candidate.startsWith(ATTACHMENT_REFERENCE_PREFIX)) continue;
                record[key] = attachments[candidate.slice(ATTACHMENT_REFERENCE_PREFIX.length)] ?? "";
            }
        });
        return clone;
    });
}

function readAttachmentTable(value: unknown): Record<string, string> {
    if (!isRecord(value)) return {};
    const result: Record<string, string> = {};
    for (const [id, dataUrl] of Object.entries(value)) {
        if (id.length <= 100 && typeof dataUrl === "string" && isDataUrl(dataUrl)) {
            result[id] = dataUrl.slice(0, 3 * 1024 * 1024);
        }
    }
    return result;
}

const ATTACHMENT_REFERENCE_PREFIX = "image-assistant-attachment:";

function attachmentReference(
    dataUrl: string,
    attachments: Record<string, string>,
    idsByValue: Map<string, string>
): string {
    const known = idsByValue.get(dataUrl);
    if (known) return `${ATTACHMENT_REFERENCE_PREFIX}${known}`;
    const base = `${hashString(dataUrl)}-${dataUrl.length}`;
    let id = base;
    let suffix = 1;
    while (attachments[id] !== undefined && attachments[id] !== dataUrl) id = `${base}-${suffix++}`;
    attachments[id] = dataUrl;
    idsByValue.set(dataUrl, id);
    return `${ATTACHMENT_REFERENCE_PREFIX}${id}`;
}

function hashString(value: string): string {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

function walkRecords(value: unknown, visit: (record: Record<string, unknown>) => void): void {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
        value.forEach(item => walkRecords(item, visit));
        return;
    }
    const record = value as Record<string, unknown>;
    visit(record);
    Object.values(record).forEach(item => walkRecords(item, visit));
}

function normalizeXmlSnapshots(value: unknown): Record<string, string> {
    if (!isRecord(value)) return {};
    const result: Record<string, string> = {};
    for (const [id, xml] of Object.entries(value).slice(0, 1_000)) {
        if (typeof xml === "string") result[id] = xml.slice(0, 16 * 1024 * 1024);
    }
    return result;
}

function normalizeDiagramHistory(value: unknown): DrawingHistoryEntry[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap(candidate => {
        if (!isRecord(candidate)
            || typeof candidate.id !== "string"
            || typeof candidate.xml !== "string") return [];
        return [{
            id: candidate.id.slice(0, 200),
            createdAt: typeof candidate.createdAt === "number" && Number.isFinite(candidate.createdAt)
                ? Math.trunc(candidate.createdAt)
                : Date.now(),
            label: typeof candidate.label === "string"
                ? candidate.label.slice(0, 80)
                : "AI edit",
            xml: candidate.xml.slice(0, 16 * 1024 * 1024),
            previewSvg: typeof candidate.previewSvg === "string"
                && candidate.previewSvg.trimStart().startsWith("<svg")
                ? candidate.previewSvg.slice(0, 512 * 1024)
                : undefined
        }];
    }).slice(-20);
}

function serializedBytes(sessions: readonly NextAiStoredSession[]): number {
    return new TextEncoder().encode(JSON.stringify(serializeDocument(sessions))).byteLength;
}

function isDataUrl(value: string): boolean {
    return /^data:[^,]{1,255},/i.test(value);
}

function cloneSession(session: NextAiStoredSession): NextAiStoredSession {
    return structuredClone(session);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
