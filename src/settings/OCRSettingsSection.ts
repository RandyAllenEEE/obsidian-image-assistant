import { Setting, setIcon } from "obsidian";
import ImageConverterPlugin from "../main";
import { t } from "../lang/helpers";
import { PresetUIState } from "./types";

/**
 * 渲染 OCR & LaTeX 设置区域
 * @param containerEl 容器元素
 * @param plugin 插件实例
 * @param presetUIState UI 状态
 * @param refreshDisplay 回调函数，用于刷新界面
 */
export function renderOCRSettingsSection(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    presetUIState: PresetUIState,
    refreshDisplay: () => void
): void {
    const ocrSection = containerEl.createDiv({ cls: "ocr-settings-section" });
    ocrSection.addClass("image-converter-settings-section");

    const settingsContentWrapper = ocrSection.createDiv("settings-section-content");

    // --- Collapsible Header ---
    const headerSetting = new Setting(ocrSection)
        .setName(t("SETTING_OCR_SECTION"))
        .setHeading();

    ocrSection.prepend(headerSetting.settingEl);
    headerSetting.settingEl.addClass("settings-section-header");
    headerSetting.settingEl.style.cursor = "pointer";

    // Add Chevron Icon
    const chevronContainer = headerSetting.nameEl.createSpan("settings-chevron-container");
    const chevronIcon = chevronContainer.createDiv();
    chevronContainer.style.marginRight = "8px";
    headerSetting.nameEl.prepend(chevronContainer);

    // Initial State & Toggle
    const updateChevron = () => {
        if (presetUIState.ocrSectionCollapsed) {
            setIcon(chevronIcon, "chevron-right");
            settingsContentWrapper.style.display = "none";
        } else {
            setIcon(chevronIcon, "chevron-down");
            settingsContentWrapper.style.display = "block";
        }
    };
    updateChevron();

    headerSetting.settingEl.onclick = (e) => {
        if ((e.target as HTMLElement).tagName === 'A') return;
        presetUIState.ocrSectionCollapsed = !presetUIState.ocrSectionCollapsed;
        updateChevron();
    };


    // ========== General Settings (Provider Selection) ==========
    const generalHeader = settingsContentWrapper.createEl("h4", {
        text: "⚙️ " + t("SETTING_OCR_SUBSECTION_GENERAL"),
        cls: "ocr-subsection-header"
    });
    generalHeader.style.marginTop = "0"; // Tighten top spacing

    // LaTeX Provider
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_LATEX_PROVIDER"))
        .setDesc(t("SETTING_OCR_LATEX_PROVIDER_DESC"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("SimpleTex", "SimpleTex (Online)")
                .addOption("Pix2Tex", "Pix2Tex (Self-hosted)")
                .addOption("Texify", "Texify (Self-hosted)")
                .addOption("LLM", "LLM (AI Model)")
                .setValue(plugin.settings.ocrSettings.latexProvider)
                .onChange(async (value: any) => {
                    plugin.settings.ocrSettings.latexProvider = value;
                    await plugin.saveSettings();
                    refreshDisplay(); // Re-render to show relevant config
                });
        });

    // Markdown Provider
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_MARKDOWN_PROVIDER"))
        .setDesc(t("SETTING_OCR_MARKDOWN_PROVIDER_DESC"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("Texify", "Texify")
                .addOption("LLM", "LLM")
                .setValue(plugin.settings.ocrSettings.markdownProvider)
                .onChange(async (value: any) => {
                    plugin.settings.ocrSettings.markdownProvider = value;
                    await plugin.saveSettings();
                    refreshDisplay(); // Re-render
                });
        });

    // ========== Configuration Section ==========
    settingsContentWrapper.createEl("h4", {
        text: "🔧 " + t("SETTING_OCR_SUBSECTION_CONFIG"),
        cls: "ocr-subsection-header"
    });

    // --- SimpleTex Config ---
    settingsContentWrapper.createEl("div", { text: t("SETTING_OCR_SIMPLETEX_SETTINGS"), cls: "setting-item-heading" });

    // App ID
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_APP_ID"))
        .setDesc(t("SETTING_OCR_APP_ID_DESC"))
        .addText(text => text
            .setPlaceholder("Your SimpleTex App ID")
            .setValue(plugin.settings.ocrSettings.simpleTexAppId)
            .onChange(async (v) => {
                plugin.settings.ocrSettings.simpleTexAppId = v;
                await plugin.saveSettings();
            })
        );

    // App Secret
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_APP_SECRET"))
        .setDesc(t("SETTING_OCR_APP_SECRET_DESC"))
        .addText(text => text
            .setPlaceholder("Your SimpleTex App Secret")
            .setValue(plugin.settings.ocrSettings.simpleTexAppSecret)
            .onChange(async (v) => {
                plugin.settings.ocrSettings.simpleTexAppSecret = v;
                await plugin.saveSettings();
            })
        );

    // Token (Optional/Legacy)
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_TOKEN"))
        .setDesc(t("SETTING_OCR_TOKEN_DESC"))
        .addText(text => text
            .setPlaceholder("Optional Token")
            .setValue(plugin.settings.ocrSettings.simpleTexToken)
            .onChange(async (v) => {
                plugin.settings.ocrSettings.simpleTexToken = v;
                await plugin.saveSettings();
            })
        );

    // --- Pix2Tex Config ---
    settingsContentWrapper.createEl("div", { text: t("SETTING_OCR_PIX2TEX_SETTINGS"), cls: "setting-item-heading" });
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_PL_URL"))
        .setDesc(t("SETTING_OCR_PL_URL_DESC"))
        .addText(text => text
            .setPlaceholder("http://127.0.0.1:8502/predict/")
            .setValue(plugin.settings.ocrSettings.pix2tex.url)
            .onChange(async v => { plugin.settings.ocrSettings.pix2tex.url = v; await plugin.saveSettings(); })
        );

    // --- Texify Config ---
    settingsContentWrapper.createEl("div", { text: t("SETTING_OCR_TEXIFY_SETTINGS"), cls: "setting-item-heading" });
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_TEXIFY_URL"))
        .setDesc(t("SETTING_OCR_PL_URL_DESC")) // Kept original desc
        .addText(text => text
            .setPlaceholder("http://127.0.0.1:5000/predict")
            .setValue(plugin.settings.ocrSettings.texify.url)
            .onChange(async v => { plugin.settings.ocrSettings.texify.url = v; await plugin.saveSettings(); })
        );

    // --- LLM Config ---
    settingsContentWrapper.createEl("div", { text: t("SETTING_OCR_LLM_SETTINGS"), cls: "setting-item-heading" });
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_LLM_ENDPOINT"))
        .setDesc(t("SETTING_OCR_LLM_ENDPOINT_DESC"))
        .addText(text => text
            .setPlaceholder("https://api.openai.com/v1/chat/completions")
            .setValue(plugin.settings.ocrSettings.aiModel.endpoint)
            .onChange(async v => { plugin.settings.ocrSettings.aiModel.endpoint = v; await plugin.saveSettings(); })
        );

    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_LLM_MODEL"))
        .setDesc(t("SETTING_OCR_LLM_MODEL_DESC"))
        .addText(text => text
            .setPlaceholder("gpt-4-vision-preview")
            .setValue(plugin.settings.ocrSettings.aiModel.model)
            .onChange(async v => { plugin.settings.ocrSettings.aiModel.model = v; await plugin.saveSettings(); })
        );

    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_LLM_KEY"))
        .setDesc(t("SETTING_OCR_LLM_KEY_DESC"))
        .addText(text => {
            text
                .setPlaceholder("sk-...")
                .setValue(plugin.settings.ocrSettings.aiModel.apiKey)
                .onChange(async v => { plugin.settings.ocrSettings.aiModel.apiKey = v; await plugin.saveSettings(); });
            text.inputEl.type = "password";
        });

    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_LLM_MAX_TOKENS"))
        .setDesc(t("SETTING_OCR_LLM_MAX_TOKENS_DESC"))
        .addText(text => {
            text
                .setPlaceholder("300")
                .setValue(String(plugin.settings.ocrSettings.aiModel.maxTokens))
                .onChange(async (value) => {
                    const num = parseInt(value);
                    if (!isNaN(num) && num > 0) {
                        plugin.settings.ocrSettings.aiModel.maxTokens = num;
                        await plugin.saveSettings();
                    }
                });
        });

    // Prompts
    settingsContentWrapper.createEl("div", { text: "  ▪ " + t("SETTING_OCR_PROMPTS_LABEL"), cls: "ocr-prompts-label" });

    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_PROMPTS_LATEX"))
        .setDesc(t("SETTING_OCR_PROMPTS_LATEX_DESC"))
        .addTextArea(text => {
            text
                .setValue(plugin.settings.ocrSettings.aiModel.prompts.latex)
                .onChange(async v => { plugin.settings.ocrSettings.aiModel.prompts.latex = v; await plugin.saveSettings(); });
            text.inputEl.style.width = "100%";
            text.inputEl.rows = 3;
        });

    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_PROMPTS_MARKDOWN"))
        .setDesc(t("SETTING_OCR_PROMPTS_MARKDOWN_DESC"))
        .addTextArea(text => {
            text
                .setValue(plugin.settings.ocrSettings.aiModel.prompts.markdown)
                .onChange(async v => { plugin.settings.ocrSettings.aiModel.prompts.markdown = v; await plugin.saveSettings(); });
            text.inputEl.style.width = "100%";
            text.inputEl.rows = 3;
        });
}
