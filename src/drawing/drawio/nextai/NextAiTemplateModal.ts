import { App, Modal, Notice, Setting } from "obsidian";
import type { NextAiPromptTemplate } from "../../../settings/types";
import { t } from "../../../lang/helpers";
import type { NextAiTemplateStore } from "./NextAiTemplateStore";

export class NextAiTemplateModal extends Modal {
    private templates: NextAiPromptTemplate[] = [];
    private editingId = "";
    private title = "";
    private description = "";
    private body = "";
    private pinned = false;
    private query = "";
    private builtInListEl: HTMLDivElement | null = null;
    private savedListEl: HTMLDivElement | null = null;

    constructor(
        app: App,
        private readonly store: NextAiTemplateStore,
        private readonly useTemplate: (body: string) => void
    ) {
        super(app);
    }

    onOpen(): void {
        this.setTitle(t("NEXT_AI_TEMPLATE_TITLE"));
        this.contentEl.createEl("p", { text: t("NEXT_AI_TEMPLATE_LOADING") });
        void this.reload();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private async reload(): Promise<void> {
        try {
            this.templates = await this.store.list();
            this.render();
        } catch (error) {
            this.contentEl.empty();
            this.contentEl.createEl("p", {
                cls: "mod-warning",
                text: t("NEXT_AI_TEMPLATE_LOAD_FAILED", [errorMessage(error)])
            });
        }
    }

    private render(): void {
        this.contentEl.empty();
        const toolbar = this.contentEl.createDiv("image-assistant-next-ai-template-toolbar");
        new Setting(toolbar)
            .setName(t("NEXT_AI_SEARCH"))
            .addSearch(search => search
                .setPlaceholder(t("NEXT_AI_TEMPLATE_SEARCH_PLACEHOLDER"))
                .setValue(this.query)
                .onChange(value => {
                    this.query = value.trim().toLocaleLowerCase();
                    this.renderTemplateLists();
                }));
        const io = toolbar.createDiv("image-assistant-next-ai-template-io");
        const importInput = io.createEl("input", {
            type: "file",
            attr: { accept: "application/json,.json" }
        });
        importInput.addClass("image-assistant-drawing-chat-file-input");
        importInput.addEventListener("change", () => {
            const file = importInput.files?.[0];
            importInput.value = "";
            if (file) void this.importTemplates(file);
        });
        const importButton = io.createEl("button", { text: t("NEXT_AI_TEMPLATE_IMPORT") });
        importButton.addEventListener("click", () => importInput.click());
        const exportButton = io.createEl("button", { text: t("NEXT_AI_TEMPLATE_EXPORT") });
        exportButton.addEventListener("click", () => void this.exportTemplates());

        this.contentEl.createEl("h3", { text: t("NEXT_AI_TEMPLATE_EXAMPLES") });
        this.builtInListEl = this.contentEl.createDiv(
            "image-assistant-next-ai-template-list is-built-in"
        );
        this.contentEl.createEl("h3", { text: t("NEXT_AI_TEMPLATE_SAVED") });
        this.savedListEl = this.contentEl.createDiv("image-assistant-next-ai-template-list");
        this.renderTemplateLists();
        this.renderEditor();
    }

    private renderTemplateLists(): void {
        const builtIns = this.builtInListEl;
        const saved = this.savedListEl;
        if (!builtIns || !saved) return;
        builtIns.empty();
        saved.empty();
        const visibleBuiltIns = builtInTemplates()
            .filter(template => matchesTemplate(template, this.query));
        if (visibleBuiltIns.length === 0) {
            builtIns.createEl("p", { text: t("NEXT_AI_TEMPLATE_EMPTY") });
        }
        for (const template of visibleBuiltIns) this.renderTemplateRow(builtIns, template, true);
        const visibleSaved = this.templates.filter(template => matchesTemplate(template, this.query));
        if (visibleSaved.length === 0) {
            saved.createEl("p", { text: t("NEXT_AI_TEMPLATE_EMPTY") });
        }
        for (const template of visibleSaved) this.renderTemplateRow(saved, template, false);
    }

    private renderTemplateRow(
        list: HTMLDivElement,
        template: NextAiPromptTemplate,
        builtIn: boolean
    ): void {
        const row = list.createDiv("image-assistant-next-ai-template-row");
        const details = row.createDiv("image-assistant-next-ai-template-details");
        details.createEl("strong", {
            text: `${template.pinned ? "★ " : ""}${template.title}`
        });
        if (template.description) details.createDiv({ text: template.description });
        if (!builtIn) details.createDiv({
            cls: "image-assistant-next-ai-template-meta",
            text: t("NEXT_AI_TEMPLATE_META", [
                template.useCount,
                new Date(template.updatedAt).toLocaleString()
            ])
        });
        const actions = row.createDiv("image-assistant-next-ai-template-actions");
        const use = actions.createEl("button", { text: t("NEXT_AI_TEMPLATE_USE") });
        use.addEventListener("click", () => void this.runAction(() => this.use(template, builtIn)));
        const copy = actions.createEl("button", { text: t("NEXT_AI_TEMPLATE_COPY") });
        copy.addEventListener("click", () => void this.runAction(() => this.copy(template)));
        if (builtIn) return;
        const pin = actions.createEl("button", {
            text: template.pinned ? t("NEXT_AI_TEMPLATE_UNPIN") : t("NEXT_AI_TEMPLATE_PIN")
        });
        pin.addEventListener("click", () => void this.runAction(() => this.togglePinned(template)));
        const edit = actions.createEl("button", { text: t("NEXT_AI_EDIT_MESSAGE") });
        edit.addEventListener("click", () => {
            this.editingId = template.id;
            this.title = template.title;
            this.description = template.description;
            this.body = template.body;
            this.pinned = template.pinned;
            this.render();
        });
        const remove = actions.createEl("button", { text: t("NEXT_AI_DELETE"), cls: "mod-warning" });
        remove.addEventListener("click", () => void this.runAction(() => this.remove(template.id)));
    }

    private renderEditor(): void {
        this.contentEl.createEl("h3", {
            text: this.editingId ? t("NEXT_AI_TEMPLATE_EDIT") : t("NEXT_AI_TEMPLATE_NEW")
        });
        new Setting(this.contentEl)
            .setName(t("NEXT_AI_TEMPLATE_NAME"))
            .addText(text => text.setValue(this.title).onChange(value => { this.title = value; }));
        new Setting(this.contentEl)
            .setName(t("NEXT_AI_TEMPLATE_DESCRIPTION"))
            .addText(text => text.setValue(this.description).onChange(value => { this.description = value; }));
        new Setting(this.contentEl)
            .setName(t("NEXT_AI_TEMPLATE_PROMPT"))
            .addTextArea(text => {
                text.setValue(this.body).onChange(value => { this.body = value; });
                text.inputEl.rows = 5;
            });
        new Setting(this.contentEl)
            .setName(t("NEXT_AI_TEMPLATE_PINNED"))
            .addToggle(toggle => toggle.setValue(this.pinned).onChange(value => { this.pinned = value; }));
        const footer = this.contentEl.createDiv("image-assistant-next-ai-template-footer");
        if (this.editingId) {
            const cancel = footer.createEl("button", { text: t("DRAWING_CONFIRM_CANCEL") });
            cancel.addEventListener("click", () => {
                this.resetEditor();
                this.render();
            });
        }
        const save = footer.createEl("button", { text: t("NEXT_AI_TEMPLATE_SAVE"), cls: "mod-cta" });
        save.addEventListener("click", () => void this.runAction(() => this.save()));
    }

    private async use(template: NextAiPromptTemplate, builtIn: boolean): Promise<void> {
        if (!builtIn) await this.store.recordUse(template.id);
        this.useTemplate(template.body);
        this.close();
    }

    private async copy(template: NextAiPromptTemplate): Promise<void> {
        const now = Date.now();
        await this.store.save({
            ...template,
            id: createId(),
            title: t("NEXT_AI_TEMPLATE_COPY_NAME", [template.title]),
            pinned: false,
            createdAt: now,
            updatedAt: now,
            useCount: 0
        });
        await this.reload();
    }

    private async togglePinned(template: NextAiPromptTemplate): Promise<void> {
        await this.store.save({ ...template, pinned: !template.pinned, updatedAt: Date.now() });
        await this.reload();
    }

    private async save(): Promise<void> {
        const title = this.title.trim().slice(0, 100);
        const body = this.body.trim().slice(0, 20_000);
        if (!title || !body) {
            new Notice(t("NEXT_AI_TEMPLATE_REQUIRED"));
            return;
        }
        const original = this.templates.find(template => template.id === this.editingId);
        const now = Date.now();
        await this.store.save({
            id: original?.id ?? createId(),
            title,
            description: this.description.trim().slice(0, 500),
            body,
            pinned: this.pinned,
            createdAt: original?.createdAt ?? now,
            updatedAt: now,
            useCount: original?.useCount ?? 0
        });
        this.resetEditor();
        await this.reload();
    }

    private async remove(id: string): Promise<void> {
        await this.store.delete(id);
        if (this.editingId === id) this.resetEditor();
        await this.reload();
    }

    private async importTemplates(file: File): Promise<void> {
        try {
            const count = await this.store.importJson(await file.text());
            new Notice(t("NEXT_AI_TEMPLATE_IMPORTED", [count]));
            await this.reload();
        } catch (error) {
            new Notice(t("NEXT_AI_TEMPLATE_IMPORT_FAILED", [errorMessage(error)]));
        }
    }

    private async exportTemplates(): Promise<void> {
        try {
            const ownerWindow = this.contentEl.ownerDocument.defaultView;
            if (!ownerWindow) throw new Error("Window unavailable");
            const blob = new Blob([await this.store.exportJson()], { type: "application/json" });
            const url = ownerWindow.URL.createObjectURL(blob);
            const link = this.contentEl.ownerDocument.createElement("a");
            link.href = url;
            link.download = "next-ai-templates.json";
            link.click();
            ownerWindow.setTimeout(() => ownerWindow.URL.revokeObjectURL(url), 0);
        } catch (error) {
            new Notice(t("NEXT_AI_TEMPLATE_EXPORT_FAILED", [errorMessage(error)]));
        }
    }

    private resetEditor(): void {
        this.editingId = "";
        this.title = "";
        this.description = "";
        this.body = "";
        this.pinned = false;
    }

    private async runAction(operation: () => Promise<void>): Promise<void> {
        try {
            await operation();
        } catch (error) {
            new Notice(t("NEXT_AI_TEMPLATE_ACTION_FAILED", [errorMessage(error)]));
        }
    }
}

function builtInTemplates(): NextAiPromptTemplate[] {
    const now = 0;
    return [
        {
            id: "builtin-flowchart",
            title: t("NEXT_AI_TEMPLATE_EXAMPLE_FLOWCHART"),
            description: t("NEXT_AI_TEMPLATE_EXAMPLE_FLOWCHART_DESC"),
            body: t("NEXT_AI_TEMPLATE_EXAMPLE_FLOWCHART_BODY"),
            pinned: false,
            createdAt: now,
            updatedAt: now,
            useCount: 0
        },
        {
            id: "builtin-architecture",
            title: t("NEXT_AI_TEMPLATE_EXAMPLE_ARCHITECTURE"),
            description: t("NEXT_AI_TEMPLATE_EXAMPLE_ARCHITECTURE_DESC"),
            body: t("NEXT_AI_TEMPLATE_EXAMPLE_ARCHITECTURE_BODY"),
            pinned: false,
            createdAt: now,
            updatedAt: now,
            useCount: 0
        }
    ];
}

function matchesTemplate(template: NextAiPromptTemplate, query: string): boolean {
    return !query || `${template.title}\n${template.description}\n${template.body}`
        .toLocaleLowerCase()
        .includes(query);
}

function createId(): string {
    return globalThis.crypto?.randomUUID?.() ?? `template-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
