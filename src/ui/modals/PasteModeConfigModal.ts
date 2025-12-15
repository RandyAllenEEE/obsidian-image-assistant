import { App, Modal, Notice } from "obsidian";
import type ImageAssistantPlugin from "../../main";

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
        
        contentEl.createEl("h2", { text: "Configure Paste Mode" });
        contentEl.createEl("p", { 
            text: "Set image paste mode for current note (overrides global settings)",
            cls: "setting-item-description"
        });

        const buttonContainer = contentEl.createDiv({ cls: "paste-mode-button-container" });
        buttonContainer.style.display = "flex";
        buttonContainer.style.gap = "10px";
        buttonContainer.style.marginTop = "20px";

        // 选项1：本地模式
        const localBtn = buttonContainer.createEl("button", {
            text: "📁 Set to Local Mode",
            cls: "mod-cta"
        });
        localBtn.onclick = () => this.setPasteMode("local");

        // 选项2：图床模式
        const cloudBtn = buttonContainer.createEl("button", {
            text: "☁️ Set to Cloud Mode",
            cls: "mod-cta"
        });
        cloudBtn.onclick = () => this.setPasteMode("cloud");

        // 选项3：恢复全局设置
        const resetBtn = buttonContainer.createEl("button", {
            text: "🔄 Use Global Settings"
        });
        resetBtn.onclick = () => this.removePasteMode();
    }

    async setPasteMode(mode: "local" | "cloud") {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
            new Notice("No active file");
            return;
        }
        
        await this.app.fileManager.processFrontMatter(file, (fm) => {
            fm["image_paste_mode"] = mode;
        });
        
        const modeText = mode === "local" ? "Local" : "Cloud";
        new Notice(`Paste mode set to ${modeText} for current note`);
        this.close();
    }

    async removePasteMode() {
        const file = this.app.workspace.getActiveFile();
        if (!file) {
            new Notice("No active file");
            return;
        }
        
        await this.app.fileManager.processFrontMatter(file, (fm) => {
            delete fm["image_paste_mode"];
        });
        
        new Notice("Using global paste mode settings");
        this.close();
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}
