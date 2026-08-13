import * as obsidian from "obsidian";
import { Setting } from "obsidian";
import ImageConverterPlugin from "../main";
import { t } from "../lang/helpers";
import { SettingsUIState } from "./types";
import { createCollapsibleSettingsSection } from "./components/CollapsibleSettingsSection";

interface SecretInputComponent {
    setValue(value: string): void;
    onChange(callback: (value: string) => void | Promise<void>): void;
}

type SecretInputComponentConstructor = new (
    app: obsidian.App,
    containerEl: HTMLElement
) => SecretInputComponent;

type ObsidianWithSecrets = typeof obsidian & {
    SecretComponent?: SecretInputComponentConstructor;
};

type AppWithSecretStorage = obsidian.App & {
    secretStorage?: unknown;
};

/**
 * 渲染 OCR & LaTeX 设置区域
 * @param containerEl 容器元素
 * @param plugin 插件实例
 * @param settingsUIState UI 状态
 * @param refreshDisplay 回调函数，用于刷新界面
 */
export function renderOCRSettingsSection(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    settingsUIState: SettingsUIState,
    refreshDisplay: () => void
): void {
    const SecretComponent = (obsidian as ObsidianWithSecrets).SecretComponent;
    const hasSecretStorage = Boolean((plugin.app as AppWithSecretStorage).secretStorage);
    const { header: headerSetting, contentEl: settingsContentWrapper } =
        createCollapsibleSettingsSection(containerEl, {
            title: t("SETTING_OCR_SECTION"),
            sectionClass: "ocr-settings-section",
            isCollapsed: () => settingsUIState.ocrSectionCollapsed,
            setCollapsed: collapsed => {
                settingsUIState.ocrSectionCollapsed = collapsed;
            }
        });
    headerSetting.addToggle(toggle => toggle
        .setValue(plugin.settings.ocrSettings.enabled)
        .onChange(async value => {
            plugin.settings.ocrSettings.enabled = value;
            await plugin.saveSettings();
            refreshDisplay();
        }));

    if (!plugin.settings.ocrSettings.enabled) return;


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
                .addOption("SimpleTex", t("SETTING_OCR_LATEX_PROVIDER_SIMPLETEX"))
                .addOption("Pix2Tex", t("SETTING_OCR_LATEX_PROVIDER_PIX2TEX"))
                .addOption("Texify", t("SETTING_OCR_LATEX_PROVIDER_TEXIFY"))
                .addOption("LLM", t("SETTING_OCR_LATEX_PROVIDER_LLM"))
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
                .addOption("Texify", t("SETTING_OCR_MARKDOWN_PROVIDER_TEXIFY"))
                .addOption("LLM", t("SETTING_OCR_MARKDOWN_PROVIDER_LLM"))
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

    const appIdSecretId = plugin.settings.ocrSettings.simpleTex.appIdSecretId;
    const appIdSetting = new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_APP_ID"))
        .setDesc(t("SETTING_OCR_APP_ID_DESC") + (appIdSecretId ? " (" + t("SETTING_OCR_LINKED_ID") + ": " + appIdSecretId + ")" : ""));

    if (hasSecretStorage && SecretComponent) {
        try {
            const sc = new SecretComponent(plugin.app, appIdSetting.controlEl);
            sc.setValue(plugin.settings.ocrSettings.simpleTex.appIdSecretId || "");
            sc.onChange(async (id: string) => {
                plugin.settings.ocrSettings.simpleTex.appIdSecretId = id;
                await plugin.saveSettings();
            });
        } catch (e) {
            console.error("Failed to initialize SecretComponent for App ID", e);
        }
    } else if (hasSecretStorage) {
        // Fallback to password text if SecretComponent is missing (e.g. older Obsidian)
        // But still use SecretStorage to avoid data.json leakage
        appIdSetting.addText(text => {
            text.setPlaceholder(t("SETTING_OCR_APP_ID"))
                .setValue(plugin.settings.ocrSettings.simpleTex.appIdSecretId || "")
                .onChange(async (v) => {
                    plugin.settings.ocrSettings.simpleTex.appIdSecretId = v;
                    await plugin.saveSettings();
                });
            text.inputEl.type = "password";
        });
    }

    const appSecretSecretId = plugin.settings.ocrSettings.simpleTex.appSecretSecretId;
    const appSecretSetting = new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_APP_SECRET"))
        .setDesc(t("SETTING_OCR_APP_SECRET_DESC") + (appSecretSecretId ? " (" + t("SETTING_OCR_LINKED_ID") + ": " + appSecretSecretId + ")" : ""));

    if (hasSecretStorage && SecretComponent) {
        try {
            const sc = new SecretComponent(plugin.app, appSecretSetting.controlEl);
            sc.setValue(plugin.settings.ocrSettings.simpleTex.appSecretSecretId || "");
            sc.onChange(async (id: string) => {
                plugin.settings.ocrSettings.simpleTex.appSecretSecretId = id;
                await plugin.saveSettings();
            });
        } catch (e) {
            console.error("Failed to initialize SecretComponent for App Secret", e);
        }
    } else if (hasSecretStorage) {
        appSecretSetting.addText(text => {
            text.setPlaceholder(t("SETTING_OCR_APP_SECRET"))
                .setValue(plugin.settings.ocrSettings.simpleTex.appSecretSecretId || "")
                .onChange(async (v) => {
                    plugin.settings.ocrSettings.simpleTex.appSecretSecretId = v;
                    await plugin.saveSettings();
                });
            text.inputEl.type = "password";
        });
    }

    const tokenSecretId = plugin.settings.ocrSettings.simpleTex.tokenSecretId;
    const tokenSetting = new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_TOKEN"))
        .setDesc(t("SETTING_OCR_TOKEN_DESC") + (tokenSecretId ? " (" + t("SETTING_OCR_LINKED_ID") + ": " + tokenSecretId + ")" : ""));

    if (hasSecretStorage && SecretComponent) {
        try {
            const sc = new SecretComponent(plugin.app, tokenSetting.controlEl);
            sc.setValue(plugin.settings.ocrSettings.simpleTex.tokenSecretId || "");
            sc.onChange(async (id: string) => {
                plugin.settings.ocrSettings.simpleTex.tokenSecretId = id;
                await plugin.saveSettings();
            });
        } catch (e) {
            console.error("Failed to initialize SecretComponent for Token", e);
        }
    } else if (hasSecretStorage) {
        tokenSetting.addText(text => {
            text.setPlaceholder(t("SETTING_OCR_TOKEN"))
                .setValue(plugin.settings.ocrSettings.simpleTex.tokenSecretId || "")
                .onChange(async (v) => {
                    plugin.settings.ocrSettings.simpleTex.tokenSecretId = v;
                    await plugin.saveSettings();
                });
            text.inputEl.type = "password";
        });
    }

    // ... (Pix2Tex and Texify omitted - no secrets there) ...
    // --- Pix2Tex Config ---
    settingsContentWrapper.createEl("div", { text: t("SETTING_OCR_PIX2TEX_SETTINGS"), cls: "setting-item-heading" });
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_PL_URL"))
        .setDesc(t("SETTING_OCR_PL_URL_DESC"))
        .addText(text => text
            .setPlaceholder(t("PLACEHOLDER_PIX2TEX_URL"))
            .setValue(plugin.settings.ocrSettings.pix2tex.url)
            .onChange(async v => { plugin.settings.ocrSettings.pix2tex.url = v; await plugin.saveSettings(); })
        );
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_USERNAME"))
        .setDesc(t("SETTING_OCR_USERNAME_DESC"))
        .addText(text => text
            .setValue(plugin.settings.ocrSettings.pix2tex.username)
            .onChange(async value => {
                plugin.settings.ocrSettings.pix2tex.username = value;
                await plugin.saveSettings();
            })
        );
    const pix2texPasswordSetting = new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_PASSWORD"))
        .setDesc(t("SETTING_OCR_PASSWORD_DESC"));
    if (hasSecretStorage && SecretComponent) {
        const component = new SecretComponent(plugin.app, pix2texPasswordSetting.controlEl);
        component.setValue(plugin.settings.ocrSettings.pix2tex.passwordSecretId || "");
        component.onChange(async (id: string) => {
            plugin.settings.ocrSettings.pix2tex.passwordSecretId = id;
            await plugin.saveSettings();
        });
    }

    // --- Texify Config ---
    settingsContentWrapper.createEl("div", { text: t("SETTING_OCR_TEXIFY_SETTINGS"), cls: "setting-item-heading" });
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_TEXIFY_URL"))
        .setDesc(t("SETTING_OCR_PL_URL_DESC")) // Kept original desc
        .addText(text => text
            .setPlaceholder(t("PLACEHOLDER_TEXIFY_URL"))
            .setValue(plugin.settings.ocrSettings.texify.url)
            .onChange(async v => { plugin.settings.ocrSettings.texify.url = v; await plugin.saveSettings(); })
        );
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_USERNAME"))
        .setDesc(t("SETTING_OCR_USERNAME_DESC"))
        .addText(text => text
            .setValue(plugin.settings.ocrSettings.texify.username)
            .onChange(async value => {
                plugin.settings.ocrSettings.texify.username = value;
                await plugin.saveSettings();
            })
        );
    const texifyPasswordSetting = new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_PASSWORD"))
        .setDesc(t("SETTING_OCR_PASSWORD_DESC"));
    if (hasSecretStorage && SecretComponent) {
        const component = new SecretComponent(plugin.app, texifyPasswordSetting.controlEl);
        component.setValue(plugin.settings.ocrSettings.texify.passwordSecretId || "");
        component.onChange(async (id: string) => {
            plugin.settings.ocrSettings.texify.passwordSecretId = id;
            await plugin.saveSettings();
        });
    }


    // --- LLM Config ---
    settingsContentWrapper.createEl("div", { text: t("SETTING_OCR_LLM_SETTINGS"), cls: "setting-item-heading" });

    // Provider Type Setting
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_LLM_PROVIDER_TYPE"))
        .setDesc(t("SETTING_OCR_LLM_PROVIDER_TYPE_DESC"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("openai", t("SETTING_OCR_LLM_PROVIDER_OPENAI"))
                .addOption("ollama", t("SETTING_OCR_LLM_PROVIDER_OLLAMA"))
                .setValue(plugin.settings.ocrSettings.aiModel.providerType || "openai")
                .onChange(async (value: "openai" | "ollama") => {
                    plugin.settings.ocrSettings.aiModel.providerType = value;
                    await plugin.saveSettings();
                    refreshDisplay(); // Re-render to update placeholders
                });
        });

    const isOllama = plugin.settings.ocrSettings.aiModel.providerType === "ollama";

    // Endpoint Setting
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_LLM_ENDPOINT"))
        .setDesc(t("SETTING_OCR_LLM_ENDPOINT_DESC"))
        .addText(text => text
            .setPlaceholder(isOllama ? t("SETTING_OCR_LLM_ENDPOINT_PLACEHOLDER_OLLAMA") : t("SETTING_OCR_LLM_ENDPOINT_PLACEHOLDER_OPENAI"))
            .setValue(plugin.settings.ocrSettings.aiModel.endpoint)
            .onChange(async v => { plugin.settings.ocrSettings.aiModel.endpoint = v; await plugin.saveSettings(); })
        );

    // Model Setting
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_LLM_MODEL"))
        .setDesc(t("SETTING_OCR_LLM_MODEL_DESC"))
        .addText(text => text
            .setPlaceholder(isOllama ? t("SETTING_OCR_LLM_MODEL_PLACEHOLDER_OLLAMA") : t("SETTING_OCR_LLM_MODEL_PLACEHOLDER_OPENAI"))
            .setValue(plugin.settings.ocrSettings.aiModel.model)
            .onChange(async v => { plugin.settings.ocrSettings.aiModel.model = v; await plugin.saveSettings(); })
        );

    const apiKeySecretId = plugin.settings.ocrSettings.aiModel.apiKeySecretId;
    const matchSetting = new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_LLM_KEY"))
        .setDesc(t("SETTING_OCR_LLM_KEY_DESC") + (apiKeySecretId ? " (" + t("SETTING_OCR_LINKED_ID") + ": " + apiKeySecretId + ")" : "") + (isOllama ? t("SETTING_OCR_LLM_KEY_OPTIONAL") : ""));

    if (hasSecretStorage && SecretComponent) {
        try {
            const sc = new SecretComponent(plugin.app, matchSetting.controlEl);
            sc.setValue(plugin.settings.ocrSettings.aiModel.apiKeySecretId || "");
            sc.onChange(async (id: string) => {
                plugin.settings.ocrSettings.aiModel.apiKeySecretId = id;
                await plugin.saveSettings();
            });
        } catch (e) {
            console.error("Failed to initialize SecretComponent for LLM Key", e);
        }
    } else if (hasSecretStorage) {
        matchSetting.addText(text => {
            text.setPlaceholder(t("SETTING_OCR_LLM_KEY"))
                .setValue(plugin.settings.ocrSettings.aiModel.apiKeySecretId || "")
                .onChange(async v => {
                    plugin.settings.ocrSettings.aiModel.apiKeySecretId = v;
                    await plugin.saveSettings();
                });
            text.inputEl.type = "password";
        });
    }

    new Setting(settingsContentWrapper)
        .setName(t("SETTING_OCR_LLM_MAX_TOKENS"))
        .setDesc(t("SETTING_OCR_LLM_MAX_TOKENS_DESC"))
        .addText(text => {
            text
                .setPlaceholder(t("PLACEHOLDER_MAX_TOKENS"))
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
