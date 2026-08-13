import {
    getToolName,
    isToolUIPart,
    type UIMessage
} from "ai";
import { Notice, setIcon } from "obsidian";
import type ImageConverterPlugin from "../../../main";
import type { DrawioEditorView } from "../DrawioEditorView";
import type { DrawingAiAttachment } from "../DrawioTypes";
import {
    NextAiSession,
    type NextAiSessionSnapshot,
    type NextAiValidationSnapshot
} from "./NextAiSession";
import {
    createCanvasAttachment,
    createUrlAttachment,
    isSupportedNextAiFile,
    NEXT_AI_MAX_FILES,
    processNextAiFiles
} from "./NextAiAttachments";
import { NextAiHttpClient } from "./NextAiHttpClient";
import { NextAiTemplateModal } from "./NextAiTemplateModal";
import { requestNextAiUrl } from "./NextAiUrlModal";
import type { NextAiSessionStore } from "./NextAiSessionStore";
import { NextAiRecentChatsModal } from "./NextAiRecentChatsModal";
import { t } from "../../../lang/helpers";
import type { NextAiTemplateStore } from "./NextAiTemplateStore";

export class NextAiChatPanel {
    private readonly session: NextAiSession;
    private readonly messagesEl: HTMLDivElement;
    private readonly statusEl: HTMLDivElement;
    private readonly inputEl: HTMLTextAreaElement;
    private readonly attachmentsEl: HTMLDivElement;
    private readonly sendButton: HTMLButtonElement;
    private readonly stopButton: HTMLButtonElement;
    private readonly retryButton: HTMLButtonElement;
    private readonly urlButton: HTMLButtonElement;
    private removeListener: (() => void) | null;
    private attachments: DrawingAiAttachment[] = [];
    private processingAttachments = false;
    private lastSnapshot: NextAiSessionSnapshot | null = null;
    private readonly http: NextAiHttpClient;
    private editingMessageId: string | null = null;

    constructor(
        private readonly containerEl: HTMLDivElement,
        private readonly plugin: ImageConverterPlugin,
        private readonly host: DrawioEditorView,
        sessionStore: NextAiSessionStore,
        private readonly templateStore: NextAiTemplateStore,
        onCollapse: () => void
    ) {
        this.session = new NextAiSession(plugin, host, sessionStore);
        this.http = new NextAiHttpClient(plugin);
        containerEl.empty();
        containerEl.addClass("image-assistant-drawing-chat");

        const header = containerEl.createDiv("image-assistant-drawing-chat-header");
        header.createEl("strong", { text: "Next AI Draw.io" });
        const collapse = header.createEl("button", {
            cls: "clickable-icon",
            attr: { "aria-label": t("NEXT_AI_COLLAPSE") }
        });
        setIcon(collapse, "panel-right-close");
        collapse.addEventListener("click", onCollapse);

        this.statusEl = containerEl.createDiv("image-assistant-drawing-chat-status");
        this.messagesEl = containerEl.createDiv("image-assistant-drawing-chat-messages");
        const composer = containerEl.createDiv("image-assistant-drawing-chat-composer");
        this.attachmentsEl = composer.createDiv("image-assistant-drawing-chat-attachments");
        const attachmentActions = composer.createDiv("image-assistant-drawing-chat-attachment-actions");
        const fileInput = attachmentActions.createEl("input", {
            type: "file",
            attr: {
                accept: "image/*,.pdf,application/pdf,text/*,.md,.markdown,.json,.csv,.xml,.yaml,.yml,.toml",
                multiple: ""
            }
        });
        fileInput.addClass("image-assistant-drawing-chat-file-input");
        fileInput.addEventListener("change", () => {
            const files = Array.from(fileInput.files ?? []);
            fileInput.value = "";
            void this.addFiles(files);
        });
        const attachButton = attachmentActions.createEl("button", {
            cls: "clickable-icon",
            attr: { "aria-label": t("NEXT_AI_ATTACH_FILE"), type: "button" }
        });
        setIcon(attachButton, "paperclip");
        attachButton.addEventListener("click", () => fileInput.click());
        this.urlButton = attachmentActions.createEl("button", {
            cls: "clickable-icon",
            attr: { "aria-label": t("NEXT_AI_ATTACH_URL"), type: "button" }
        });
        setIcon(this.urlButton, "link");
        this.urlButton.addEventListener("click", () => void this.addUrl());
        const canvasButton = attachmentActions.createEl("button", {
            cls: "clickable-icon",
            attr: { "aria-label": t("NEXT_AI_ATTACH_CANVAS"), type: "button" }
        });
        setIcon(canvasButton, "scan");
        canvasButton.addEventListener("click", () => void this.addCanvas());
        const templateButton = attachmentActions.createEl("button", {
            cls: "clickable-icon",
            attr: { "aria-label": t("NEXT_AI_TEMPLATES"), type: "button" }
        });
        setIcon(templateButton, "bookmark-plus");
        templateButton.addEventListener("click", () => this.openTemplates());
        const recentButton = attachmentActions.createEl("button", {
            cls: "clickable-icon",
            attr: { "aria-label": t("NEXT_AI_RECENT_CHATS"), type: "button" }
        });
        setIcon(recentButton, "messages-square");
        recentButton.addEventListener("click", () => void this.openRecentChats());
        this.inputEl = composer.createEl("textarea", {
            attr: {
                placeholder: t("NEXT_AI_PLACEHOLDER"),
                rows: "3",
                "aria-label": t("NEXT_AI_MESSAGE")
            }
        });
        this.inputEl.addEventListener("keydown", event => {
            const shortcut = this.plugin.settings.drawing.drawio.nextAi.sendShortcut;
            const shouldSend = event.key === "Enter"
                && !event.shiftKey
                && (shortcut === "enter"
                    ? !event.ctrlKey && !event.metaKey && !event.altKey
                    : event.ctrlKey || event.metaKey);
            if (shouldSend) {
                event.preventDefault();
                void this.send();
            }
        });
        this.inputEl.addEventListener("paste", event => {
            const files = Array.from(event.clipboardData?.files ?? [])
                .filter(isSupportedNextAiFile);
            if (files.length === 0) return;
            event.preventDefault();
            void this.addFiles(files);
        });
        containerEl.addEventListener("dragover", event => {
            if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
        });
        containerEl.addEventListener("drop", event => {
            const files = Array.from(event.dataTransfer?.files ?? [])
                .filter(isSupportedNextAiFile);
            if (files.length === 0) return;
            event.preventDefault();
            event.stopPropagation();
            void this.addFiles(files);
        });
        const actions = composer.createDiv("image-assistant-drawing-chat-actions");
        const clearButton = actions.createEl("button", { text: t("NEXT_AI_CLEAR") });
        clearButton.addEventListener("click", () => void this.clear());
        this.retryButton = actions.createEl("button", { text: t("NEXT_AI_RETRY") });
        this.retryButton.addEventListener("click", () => void this.session.retry());
        this.stopButton = actions.createEl("button", { text: t("NEXT_AI_STOP") });
        this.stopButton.addEventListener("click", () => this.session.stop());
        this.sendButton = actions.createEl("button", {
            cls: "mod-cta",
            text: t("NEXT_AI_SEND")
        });
        this.sendButton.addEventListener("click", () => void this.send());
        this.removeListener = this.session.subscribe(snapshot => this.render(snapshot));
        this.renderPendingAttachments();
    }

    destroy(): void {
        this.removeListener?.();
        this.removeListener = null;
        this.session.destroy();
        this.containerEl.empty();
    }

    persist(): Promise<void> {
        return this.session.persistNow();
    }

    restoreSession(id: string): Promise<void> {
        return this.session.restoreStoredSession(id);
    }

    private async send(): Promise<void> {
        const value = this.inputEl.value;
        if (!value.trim() && this.attachments.length === 0) return;
        if (this.editingMessageId) {
            const id = this.editingMessageId;
            this.editingMessageId = null;
            this.inputEl.value = "";
            await this.session.editUserMessage(id, value);
            return;
        }
        this.inputEl.value = "";
        const attachments = this.attachments;
        this.attachments = [];
        this.renderPendingAttachments();
        await this.session.send({ text: value, attachments });
    }

    private async clear(): Promise<void> {
        this.session.stop();
        try {
            await this.host.resetForNewAiChat();
            this.session.startNew();
            this.attachments = [];
            this.renderPendingAttachments();
        } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
        }
    }

    private render(snapshot: NextAiSessionSnapshot): void {
        this.lastSnapshot = snapshot;
        const busy = snapshot.status === "submitted" || snapshot.status === "streaming";
        this.sendButton.disabled = busy || this.processingAttachments;
        this.stopButton.disabled = !busy;
        this.retryButton.disabled = busy || snapshot.messages.length === 0;
        this.statusEl.empty();
        if (snapshot.notice) {
            this.statusEl.createSpan({ text: snapshot.notice });
        }
        if (snapshot.error) {
            this.statusEl.createSpan({
                cls: "image-assistant-drawing-chat-error",
                text: snapshot.error
            });
        } else if (busy) {
            this.statusEl.createSpan({
                text: snapshot.status === "submitted"
                    ? t("NEXT_AI_SENDING")
                    : t("NEXT_AI_STREAMING")
            });
        }

        this.messagesEl.empty();
        if (snapshot.messages.length === 0) {
            this.messagesEl.createDiv({
                cls: "image-assistant-drawing-chat-empty",
                text: t("NEXT_AI_EMPTY")
            });
        }
        for (const message of snapshot.messages) this.renderMessage(message, snapshot);
        this.renderValidation(snapshot.validation);
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    private renderMessage(message: UIMessage, snapshot: NextAiSessionSnapshot): void {
        const messageEl = this.messagesEl.createDiv(
            `image-assistant-drawing-chat-message is-${message.role}`
        );
        messageEl.createDiv({
            cls: "image-assistant-drawing-chat-role",
            text: message.role === "user" ? t("NEXT_AI_YOU") : "Next AI"
        });
        const presentation = snapshot.userPresentation[message.id];
        if (message.role === "user" && presentation) {
            messageEl.createDiv({
                cls: "image-assistant-drawing-chat-text",
                text: presentation.text
            });
            this.renderAttachmentNames(messageEl, presentation.attachments);
            this.renderMessageActions(messageEl, message, presentation.text);
            return;
        }
        for (const part of message.parts) this.renderPart(messageEl, part);
        if (message.role === "assistant") this.renderMessageActions(messageEl, message, "");
    }

    private renderMessageActions(container: HTMLElement, message: UIMessage, userText: string): void {
        const actions = container.createDiv("image-assistant-drawing-chat-message-actions");
        if (message.role === "user") {
            const edit = actions.createEl("button", { text: t("NEXT_AI_EDIT_MESSAGE") });
            edit.addEventListener("click", () => {
                this.editingMessageId = message.id;
                this.inputEl.value = userText;
                this.inputEl.focus();
            });
            const regenerate = actions.createEl("button", { text: t("NEXT_AI_REGENERATE") });
            regenerate.addEventListener("click", () => void this.session.regenerateFromUserMessage(message.id));
            return;
        }
        const copy = actions.createEl("button", { text: t("NEXT_AI_COPY_RESPONSE") });
        copy.addEventListener("click", () => void copyMessageText(message));
    }

    private renderPart(container: HTMLElement, part: UIMessage["parts"][number]): void {
        if (part.type === "text" && part.text) {
            container.createDiv({
                cls: "image-assistant-drawing-chat-text",
                text: part.text
            });
            return;
        }
        if (part.type === "reasoning" && part.text) {
            const details = container.createEl("details", {
                cls: "image-assistant-drawing-chat-reasoning"
            });
            details.createEl("summary", { text: t("NEXT_AI_REASONING") });
            details.createDiv({ text: part.text });
            return;
        }
        if (part.type === "file") {
            this.renderAttachmentNames(container, [{
                name: part.filename ?? "image",
                kind: "image",
                dataUrl: part.url
            }]);
            return;
        }
        if (isToolUIPart(part)) {
            const name = getToolName(part);
            const state = part.state === "output-available"
                ? t("NEXT_AI_TOOL_COMPLETED")
                : part.state === "output-error"
                    ? t("NEXT_AI_TOOL_FAILED", [part.errorText])
                    : part.state === "input-streaming"
                        ? t("NEXT_AI_TOOL_RECEIVING")
                        : t("NEXT_AI_TOOL_APPLYING");
            const card = container.createDiv({
                cls: `image-assistant-drawing-chat-tool is-${part.state}`,
                text: `${toolLabel(name)} — ${state}`
            });
            const detailsValue = "input" in part && part.input !== undefined
                ? part.input
                : "output" in part
                    ? part.output
                    : undefined;
            if (detailsValue !== undefined) {
                const details = card.createEl("details");
                details.createEl("summary", { text: t("NEXT_AI_TOOL_DETAILS") });
                details.createEl("pre", { text: formatToolDetails(detailsValue) });
            }
            return;
        }
        container.createDiv({
            cls: "image-assistant-drawing-chat-unknown-part",
            text: t("NEXT_AI_UNKNOWN_PART", [part.type])
        });
    }

    private async addFiles(files: readonly File[]): Promise<void> {
        if (files.length === 0) return;
        if (this.attachments.length + files.length > NEXT_AI_MAX_FILES) {
            new Notice(t("NEXT_AI_ATTACHMENT_LIMIT", [NEXT_AI_MAX_FILES]));
            return;
        }
        await this.withAttachmentProgress(async () => {
            this.attachments.push(...await processNextAiFiles(files));
        });
    }

    private async addUrl(): Promise<void> {
        if (this.attachments.length >= NEXT_AI_MAX_FILES) {
            new Notice(t("NEXT_AI_ATTACHMENT_LIMIT", [NEXT_AI_MAX_FILES]));
            return;
        }
        const url = await requestNextAiUrl(this.host.app);
        if (!url) return;
        await this.withAttachmentProgress(async () => {
            const result = await this.http.extractUrl(url);
            this.attachments.push(createUrlAttachment(
                url,
                result.title,
                result.content,
                result.charCount
            ));
        });
        if (this.http.getCapabilityState("parse-url") === "unavailable") {
            this.urlButton.disabled = true;
            this.urlButton.setAttribute("aria-label", t("NEXT_AI_URL_UNAVAILABLE"));
        }
    }

    private async addCanvas(): Promise<void> {
        if (this.attachments.length >= NEXT_AI_MAX_FILES) {
            new Notice(t("NEXT_AI_ATTACHMENT_LIMIT", [NEXT_AI_MAX_FILES]));
            return;
        }
        await this.withAttachmentProgress(async () => {
            this.attachments.push(createCanvasAttachment(await this.host.exportPng()));
        });
    }

    private openTemplates(): void {
        new NextAiTemplateModal(
            this.plugin.app,
            this.templateStore,
            body => {
                this.inputEl.value = body;
                this.inputEl.focus();
            }
        ).open();
    }

    private async openRecentChats(): Promise<void> {
        try {
            const sessions = await this.session.listStoredSessions("vault");
            new NextAiRecentChatsModal(
                this.plugin.app,
                sessions,
                this.host.file?.path ?? "",
                stored => stored.filePath === this.host.file?.path
                    ? this.session.restoreStoredSession(stored.id)
                    : this.plugin.drawingModule.openNextAiSession(stored.filePath, stored.id),
                id => this.session.deleteStoredSession(id),
                () => this.clear()
            ).open();
        } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
        }
    }

    private async withAttachmentProgress(operation: () => Promise<void>): Promise<void> {
        if (this.processingAttachments) return;
        this.processingAttachments = true;
        this.renderPendingAttachments();
        if (this.lastSnapshot) this.render(this.lastSnapshot);
        try {
            await operation();
        } catch (error) {
            new Notice(error instanceof Error ? error.message : String(error));
        } finally {
            this.processingAttachments = false;
            this.renderPendingAttachments();
            if (this.lastSnapshot) this.render(this.lastSnapshot);
        }
    }

    private renderPendingAttachments(): void {
        this.attachmentsEl.empty();
        if (this.processingAttachments) {
            this.attachmentsEl.createSpan({ text: t("NEXT_AI_PROCESSING_ATTACHMENT") });
        }
        for (const attachment of this.attachments) {
            const chip = this.attachmentsEl.createDiv("image-assistant-drawing-chat-attachment");
            if (attachment.dataUrl) chip.createEl("img", {
                attr: { src: attachment.dataUrl, alt: "" }
            });
            chip.createSpan({ text: attachment.name });
            const remove = chip.createEl("button", {
                cls: "clickable-icon",
                attr: {
                    "aria-label": t("NEXT_AI_REMOVE_ATTACHMENT", [attachment.name]),
                    type: "button"
                }
            });
            setIcon(remove, "x");
            remove.addEventListener("click", () => {
                this.attachments = this.attachments.filter(value => value.id !== attachment.id);
                this.renderPendingAttachments();
            });
        }
    }

    private renderValidation(validation: NextAiValidationSnapshot): void {
        if (validation.status === "idle") return;
        const card = this.messagesEl.createDiv(
            `image-assistant-drawing-validation-card is-${validation.status}`
        );
        card.createEl("strong", { text: validationStatusLabel(validation.status) });
        if (validation.previewDataUrl) card.createEl("img", {
            attr: {
                src: validation.previewDataUrl,
                alt: t("NEXT_AI_VALIDATION_PREVIEW")
            }
        });
        if (validation.message) card.createDiv({ text: validation.message });
        if (validation.issues.length > 0) {
            card.createEl("strong", { text: t("NEXT_AI_VALIDATION_ISSUES") });
            const list = card.createEl("ul");
            for (const issue of validation.issues) list.createEl("li", { text: issue });
        }
        if (validation.suggestions.length > 0) {
            card.createEl("strong", { text: t("NEXT_AI_VALIDATION_SUGGESTIONS") });
            const list = card.createEl("ul");
            for (const suggestion of validation.suggestions) list.createEl("li", { text: suggestion });
        }
    }

    private renderAttachmentNames(
        container: HTMLElement,
        attachments: readonly Pick<DrawingAiAttachment, "name" | "kind" | "dataUrl">[]
    ): void {
        if (attachments.length === 0) return;
        const list = container.createDiv("image-assistant-drawing-chat-message-attachments");
        for (const attachment of attachments) {
            const item = list.createDiv("image-assistant-drawing-chat-message-attachment");
            if (attachment.dataUrl) item.createEl("img", {
                attr: { src: attachment.dataUrl, alt: attachment.name }
            });
            item.createSpan({ text: attachment.name });
        }
    }
}

function toolLabel(value: string): string {
    if (value === "display_diagram") return t("NEXT_AI_TOOL_CREATE");
    if (value === "edit_diagram") return t("NEXT_AI_TOOL_EDIT");
    if (value === "append_diagram") return t("NEXT_AI_TOOL_CONTINUE");
    return value;
}

function validationStatusLabel(status: NextAiValidationSnapshot["status"]): string {
    if (status === "capturing") return t("NEXT_AI_VALIDATION_CAPTURING");
    if (status === "validating") return t("NEXT_AI_VALIDATION_VALIDATING");
    if (status === "passed") return t("NEXT_AI_VALIDATION_PASSED");
    if (status === "server-reported") return t("NEXT_AI_VALIDATION_SERVER_REPORTED");
    if (status === "failed") return t("NEXT_AI_VALIDATION_FAILED");
    if (status === "accepted-with-issues") return t("NEXT_AI_VALIDATION_ACCEPTED");
    return t("NEXT_AI_VALIDATION_UNAVAILABLE");
}

function formatToolDetails(value: unknown): string {
    let result: string;
    try {
        result = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    } catch {
        result = String(value);
    }
    const limit = 50_000;
    return result.length <= limit ? result : `${result.slice(0, limit)}\n…`;
}

async function copyMessageText(message: UIMessage): Promise<void> {
    const text = message.parts
        .filter((part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text")
        .map(part => part.text)
        .join("\n\n");
    if (!text) return;
    await navigator.clipboard.writeText(text);
    new Notice(t("NEXT_AI_RESPONSE_COPIED"));
}
