import { App, Modal, Notice } from "obsidian";
import type ImageAssistantPlugin from "../../main";
import { t } from "../../lang/helpers";

export class PasteModeConfigModal extends Modal {
    plugin: ImageAssistantPlugin;

    constructor(app: App, plugin: ImageAssistantPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;

        contentEl.empty();
        contentEl.addClass("image-assistant-paste-mode-modal");

        contentEl.createEl("h2", { text: t("MODAL_PASTE_MODE_TITLE") });
        contentEl.createEl("p", {
            text: t("MODAL_PASTE_MODE_DESC"),
            cls: "setting-item-description"
        });

        const buttonContainer = contentEl.createDiv({ cls: "paste-mode-button-container" });
        buttonContainer.style.display = "flex";
        buttonContainer.style.gap = "10px";
        buttonContainer.style.marginTop = "20px";

        // 选项1：本地模式
        const localBtn = buttonContainer.createEl("button", {
            text: t("MODAL_PASTE_MODE_LOCAL"),
            cls: "mod-cta"
        });
        localBtn.onclick = () => this.setPasteMode("local");

        // 选项2：图床模式
        const cloudBtn = buttonContainer.createEl("button", {
            text: t("MODAL_PASTE_MODE_CLOUD"),
            cls: "mod-cta"
        });
        cloudBtn.onclick = () => this.setPasteMode("cloud");

        // 选项3：恢复全局设置
        const resetBtn = buttonContainer.createEl("button", {
            text: t("MODAL_PASTE_MODE_GLOBAL")
        });
        resetBtn.onclick = () => this.removePasteMode();
    }

    async setPasteMode(mode: "local" | "cloud") {
        // Validate input parameter
        if (mode !== "local" && mode !== "cloud") {
            new Notice(t("NOTICE_INVALID_PASTE_MODE"));
            return;
        }

        const file = this.app.workspace.getActiveFile();
        if (!file) {
            new Notice(t("NOTICE_NO_ACTIVE_FILE"));
            return;
        }

        await this.app.fileManager.processFrontMatter(file, (fm) => {
            fm["image_paste_mode"] = mode;
        });

        const modeText = mode === "local" ? "Local" : "Cloud";
        new Notice(t("NOTICE_PASTE_MODE_SET").replace("{0}", modeText));
        this.close();
    }

    async removePasteMode() {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
            new Notice(t("NOTICE_NO_ACTIVE_FILE"));
            return;
        }

        await this.app.fileManager.processFrontMatter(file, (fm) => {
            delete fm["image_paste_mode"];
        });

        new Notice(t("NOTICE_PASTE_MODE_GLOBAL"));
        this.close();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
