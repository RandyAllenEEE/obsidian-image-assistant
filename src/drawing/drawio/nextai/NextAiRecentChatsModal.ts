import { App, Modal, Notice, Setting, TFile } from "obsidian";
import type { NextAiStoredSession } from "./NextAiSessionStore";
import { t } from "../../../lang/helpers";

type RecentScope = "file" | "vault";

export class NextAiRecentChatsModal extends Modal {
    private scopeFilter: RecentScope = "file";
    private query = "";
    private listEl: HTMLDivElement | null = null;

    constructor(
        app: App,
        private sessions: NextAiStoredSession[],
        private readonly currentFilePath: string,
        private readonly openSession: (session: NextAiStoredSession) => Promise<void>,
        private readonly deleteSession: (id: string) => Promise<void>,
        private readonly newSession: () => Promise<void>
    ) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.empty();
        this.setTitle(t("NEXT_AI_RECENT_TITLE"));
        const create = this.contentEl.createEl("button", {
            text: t("NEXT_AI_NEW_CHAT"),
            cls: "mod-cta image-assistant-next-ai-new-chat"
        });
        create.addEventListener("click", () => void this.createSession());
        new Setting(this.contentEl)
            .setName(t("NEXT_AI_RECENT_SCOPE"))
            .addDropdown(dropdown => dropdown
                .addOption("file", t("NEXT_AI_RECENT_CURRENT_FILE"))
                .addOption("vault", t("NEXT_AI_RECENT_ENTIRE_VAULT"))
                .setValue(this.scopeFilter)
                .onChange(value => {
                    this.scopeFilter = value === "vault" ? "vault" : "file";
                    this.renderList();
                }));
        new Setting(this.contentEl)
            .setName(t("NEXT_AI_SEARCH"))
            .addSearch(search => search
                .setPlaceholder(t("NEXT_AI_RECENT_SEARCH_PLACEHOLDER"))
                .onChange(value => {
                    this.query = value.trim().toLocaleLowerCase();
                    this.renderList();
                }));
        this.listEl = this.contentEl.createDiv("image-assistant-next-ai-recent-list");
        this.renderList();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private renderList(): void {
        const list = this.listEl;
        if (!list) return;
        list.empty();
        const visible = this.sessions.filter(session => {
            if (this.scopeFilter === "file" && session.filePath !== this.currentFilePath) return false;
            return !this.query || `${session.title}\n${session.filePath}`.toLocaleLowerCase().includes(this.query);
        });
        if (visible.length === 0) {
            list.createEl("p", { text: t("NEXT_AI_RECENT_EMPTY") });
            return;
        }
        for (const session of visible) {
            const row = list.createDiv("image-assistant-next-ai-recent-row");
            const preview = row.createDiv("image-assistant-next-ai-recent-preview");
            const drawing = this.app.vault.getAbstractFileByPath(session.filePath);
            if (session.thumbnailDataUrl) {
                preview.createEl("img", {
                    attr: { src: session.thumbnailDataUrl, alt: "" }
                });
            } else if (drawing instanceof TFile && drawing.path.toLowerCase().endsWith(".drawio.svg")) {
                preview.createEl("img", {
                    attr: {
                        src: this.app.vault.getResourcePath(drawing),
                        alt: ""
                    }
                });
            } else {
                preview.createSpan({ text: "◇" });
            }
            const details = row.createDiv("image-assistant-next-ai-recent-details");
            details.createEl("strong", { text: session.title });
            details.createDiv({
                cls: "image-assistant-next-ai-recent-path",
                text: session.filePath
            });
            details.createDiv({
                cls: "image-assistant-next-ai-recent-time",
                text: new Date(session.updatedAt).toLocaleString()
            });
            const actions = row.createDiv("image-assistant-next-ai-recent-actions");
            const open = actions.createEl("button", { text: t("NEXT_AI_OPEN") });
            open.addEventListener("click", () => void this.openStoredSession(session));
            const remove = actions.createEl("button", { text: t("NEXT_AI_DELETE"), cls: "mod-warning" });
            remove.addEventListener("click", () => void this.remove(session.id));
        }
    }

    private async remove(id: string): Promise<void> {
        try {
            await this.deleteSession(id);
            this.sessions = this.sessions.filter(session => session.id !== id);
            this.renderList();
        } catch (error) {
            new Notice(t("NEXT_AI_HISTORY_ACTION_FAILED", [errorMessage(error)]));
        }
    }

    private async openStoredSession(session: NextAiStoredSession): Promise<void> {
        try {
            await this.openSession(session);
            this.close();
        } catch (error) {
            new Notice(t("NEXT_AI_HISTORY_ACTION_FAILED", [errorMessage(error)]));
        }
    }

    private async createSession(): Promise<void> {
        try {
            await this.newSession();
            this.close();
        } catch (error) {
            new Notice(t("NEXT_AI_HISTORY_ACTION_FAILED", [errorMessage(error)]));
        }
    }
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
