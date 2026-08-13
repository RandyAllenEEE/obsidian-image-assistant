import { App, Modal, Setting } from "obsidian";
import { t } from "../../../lang/helpers";

export function requestNextAiUrl(app: App): Promise<string | null> {
    return new Promise(resolve => new NextAiUrlModal(app, resolve).open());
}

class NextAiUrlModal extends Modal {
    private settled = false;
    private value = "";

    constructor(app: App, private readonly resolveResult: (value: string | null) => void) {
        super(app);
    }

    onOpen(): void {
        this.setTitle(t("NEXT_AI_URL_TITLE"));
        this.contentEl.createEl("p", {
            text: t("NEXT_AI_URL_DESC")
        });
        const setting = new Setting(this.contentEl)
            .setName(t("NEXT_AI_URL_LABEL"))
            .addText(text => {
                text.setPlaceholder("https://example.com/article")
                    .onChange(value => { this.value = value; });
                text.inputEl.addEventListener("keydown", event => {
                    if (event.key === "Enter") {
                        event.preventDefault();
                        this.submit();
                    }
                });
                setTimeout(() => text.inputEl.focus(), 0);
            });
        setting.controlEl.createEl("button", { text: t("NEXT_AI_URL_ADD"), cls: "mod-cta" })
            .addEventListener("click", () => this.submit());
    }

    onClose(): void {
        this.contentEl.empty();
        if (!this.settled) this.resolveResult(null);
    }

    private submit(): void {
        let parsed: URL;
        try {
            parsed = new URL(this.value.trim());
        } catch {
            return;
        }
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return;
        this.settled = true;
        this.resolveResult(parsed.toString());
        this.close();
    }
}
