import { Setting, setIcon } from "obsidian";
import ImageConverterPlugin from "../main";
import { t } from "../lang/helpers";

/**
 * 渲染 OCR & LaTeX 设置区域
 * @param containerEl 容器元素
 * @param plugin 插件实例
 */
export function renderOCRSettingsSection(containerEl: HTMLElement, plugin: ImageConverterPlugin): void {
    const ocrSection = containerEl.createDiv({ cls: "ocr-settings-section" });

    // 标题和折叠控制
    const ocrHeaderEl = ocrSection.createDiv({ cls: "ocr-settings-header" });
    const chevronIcon = ocrHeaderEl.createEl("i");
    setIcon(chevronIcon, "chevron-down");
    chevronIcon.addClass("ocr-chevron-icon");
    ocrHeaderEl.createEl("span", { text: t("SETTING_OCR_SECTION"), cls: "settings-section-title" });

    // 设置内容容器
    const ocrContentEl = ocrSection.createDiv({ cls: "ocr-settings-content" });

    // 默认折叠状态
    let isCollapsed = true;
    ocrContentEl.hide();
    setIcon(chevronIcon, "chevron-right");

    // 点击标题切换折叠
    ocrHeaderEl.onClickEvent((event: MouseEvent) => {
        event.stopPropagation();
        isCollapsed = !isCollapsed;

        if (isCollapsed) {
            ocrContentEl.hide();
            setIcon(chevronIcon, "chevron-right");
        } else {
            ocrContentEl.show();
            setIcon(chevronIcon, "chevron-down");
        }
    });

    // ========== General Section ==========
    const generalHeader = ocrContentEl.createEl("h4", {
        text: "⚙️ General",
        cls: "ocr-subsection-header"
    });

    // LaTeX Provider 选择
    new Setting(ocrContentEl)
        .setName(t("SETTING_OCR_LATEX_PROVIDER"))
        .setDesc(t("SETTING_OCR_LATEX_PROVIDER_DESC"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("SimpleTex", "SimpleTex (在线服务)")
                .addOption("Pix2Tex", "Pix2Tex (自托管)")
                .addOption("Texify", "Texify (自托管)")
                .addOption("LLM", "LLM (AI 模型)")
                .setValue(plugin.settings.ocrSettings.latexProvider)
                .onChange(async (value: "SimpleTex" | "Pix2Tex" | "Texify" | "LLM") => {
                    plugin.settings.ocrSettings.latexProvider = value;
                    await plugin.saveSettings();
                });
        });

    // Markdown Provider 选择
    new Setting(ocrContentEl)
        .setName(t("SETTING_OCR_MARKDOWN_PROVIDER"))
        .setDesc(t("SETTING_OCR_MARKDOWN_PROVIDER_DESC"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("Texify", "Texify")
                .addOption("LLM", "LLM")
                .setValue(plugin.settings.ocrSettings.markdownProvider)
                .onChange(async (value: "Texify" | "LLM") => {
                    plugin.settings.ocrSettings.markdownProvider = value;
                    await plugin.saveSettings();
                });
        });

    // ========== Config Section ==========
    const configHeader = ocrContentEl.createEl("h4", {
        text: "🔧 Config",
        cls: "ocr-subsection-header"
    });

    // SimpleTex 配置
    const simpletexLabel = ocrContentEl.createEl("div", {
        text: "▸ SimpleTex",
        cls: "ocr-provider-label"
    });

    // 添加折叠功能
    const simpletexContentEl = ocrContentEl.createDiv({ cls: "ocr-provider-content" });
    simpletexContentEl.hide();

    simpletexLabel.addEventListener("click", () => {
        const isVisible = !simpletexContentEl.isShown();
        // 修复：使用正确的 toggle 方法
        if (simpletexContentEl.isShown()) {
            simpletexContentEl.hide();
        } else {
            simpletexContentEl.show();
        }
        simpletexLabel.textContent = isVisible ? "▾ SimpleTex" : "▸ SimpleTex";
    });

    // 添加认证方式开关
    new Setting(simpletexContentEl)
        .setName(t("SETTING_OCR_AUTH_TYPE"))
        .setDesc(t("SETTING_OCR_AUTH_TYPE_DESC"))
        .addDropdown(dropdown => {
            dropdown
                .addOption("token", t("SETTING_OCR_AUTH_TOKEN"))
                .addOption("app", t("SETTING_OCR_AUTH_APP"))
                .setValue(plugin.settings.ocrSettings.simpleTexAppId && plugin.settings.ocrSettings.simpleTexAppSecret ? "app" : "token")
                .onChange(async (value: "token" | "app") => {
                    // 不需要保存认证方式到设置中，只需在调用时判断使用哪种方式
                    // 这里可以添加 UI 切换逻辑，但目前我们只保存设置值
                    await plugin.saveSettings();
                });
        });

    // Token 配置
    new Setting(simpletexContentEl)
        .setName(t("SETTING_OCR_TOKEN"))
        .setDesc(t("SETTING_OCR_TOKEN_DESC"))
        .addText(text => {
            text
                .setPlaceholder("Your SimpleTex token")
                .setValue(plugin.settings.ocrSettings.simpleTexToken)
                .onChange(async (value) => {
                    plugin.settings.ocrSettings.simpleTexToken = value;
                    await plugin.saveSettings();
                });
            text.inputEl.style.width = "100%";
        });

    // 新增：SimpleTex APP ID 和 Secret 配置（推荐方式）
    new Setting(simpletexContentEl)
        .setName(t("SETTING_OCR_APP_ID"))
        .setDesc(t("SETTING_OCR_APP_ID_DESC"))
        .addText(text => {
            text
                .setPlaceholder("Your SimpleTex App ID")
                .setValue(plugin.settings.ocrSettings.simpleTexAppId)
                .onChange(async (value) => {
                    plugin.settings.ocrSettings.simpleTexAppId = value;
                    await plugin.saveSettings();
                });
            text.inputEl.style.width = "100%";
        });

    new Setting(simpletexContentEl)
        .setName(t("SETTING_OCR_APP_SECRET"))
        .setDesc(t("SETTING_OCR_APP_SECRET_DESC"))
        .addText(text => {
            text
                .setPlaceholder("Your SimpleTex App Secret")
                .setValue(plugin.settings.ocrSettings.simpleTexAppSecret)
                .onChange(async (value) => {
                    plugin.settings.ocrSettings.simpleTexAppSecret = value;
                    await plugin.saveSettings();
                });
            text.inputEl.style.width = "100%";
            text.inputEl.type = "password"; // 隐藏密码输入
        });

    new Setting(simpletexContentEl)
        .setName(t("SETTING_OCR_AUTH_HELP"))
        .setDesc(createFragment((frag) => {
            frag.createEl("p", { text: "推荐使用 App ID + App Secret 方式，可以避免 CORS 问题。" });
            frag.createEl("p", { text: "获取方式：" });
            const ol = frag.createEl("ol");
            ol.createEl("li", { text: "访问 SimpleTeX 开发者平台: https://simpletex.cn/open_platform" });
            ol.createEl("li", { text: "登录账号并创建应用" });
            ol.createEl("li", { text: "获取 App ID 和 App Secret" });
            frag.createEl("p", { text: "Token 方式可能会遇到 CORS 问题，仅供临时测试使用。" });
        }));

    // Pix2Tex 配置（永久显示）
    const pix2texLabel = ocrContentEl.createEl("div", {
        text: "▸ Pix2Tex",
        cls: "ocr-provider-label"
    });

    new Setting(ocrContentEl)
        .setName(t("SETTING_OCR_PL_URL"))
        .setDesc(t("SETTING_OCR_PL_URL_DESC"))
        .addText(text => {
            text
                .setPlaceholder("http://127.0.0.1:8502/predict/")
                .setValue(plugin.settings.ocrSettings.pix2tex.url)
                .onChange(async (value) => {
                    plugin.settings.ocrSettings.pix2tex.url = value;
                    await plugin.saveSettings();
                });
            text.inputEl.style.width = "100%";
        });

    new Setting(ocrContentEl)
        .setName(t("SETTING_OCR_PL_USER"))
        .setDesc(t("SETTING_OCR_PL_USER_DESC"))
        .addText(text => {
            text
                .setValue(plugin.settings.ocrSettings.pix2tex.username)
                .onChange(async (value) => {
                    plugin.settings.ocrSettings.pix2tex.username = value;
                    await plugin.saveSettings();
                });
            text.inputEl.style.width = "100%";
        });

    new Setting(ocrContentEl)
        .setName(t("SETTING_OCR_PL_PASS"))
        .setDesc(t("SETTING_OCR_PL_PASS_DESC"))
        .addText(text => {
            text
                .setValue(plugin.settings.ocrSettings.pix2tex.password)
                .onChange(async (value) => {
                    plugin.settings.ocrSettings.pix2tex.password = value;
                    await plugin.saveSettings();
                });
            text.inputEl.style.width = "100%";
            text.inputEl.type = "password";
        });

    // Texify 配置（永久显示）
    const texifyLabel = ocrContentEl.createEl("div", {
        text: "▸ Texify",
        cls: "ocr-provider-label"
    });

    new Setting(ocrContentEl)
        .setName(t("SETTING_OCR_PL_URL"))
        .setDesc(t("SETTING_OCR_PL_URL_DESC"))
        .addText(text => {
            text
                .setPlaceholder("http://127.0.0.1:5000/predict")
                .setValue(plugin.settings.ocrSettings.texify.url)
                .onChange(async (value) => {
                    plugin.settings.ocrSettings.texify.url = value;
                    await plugin.saveSettings();
                });
            text.inputEl.style.width = "100%";
        });

    new Setting(ocrContentEl)
        .setName(t("SETTING_OCR_PL_USER"))
        .setDesc(t("SETTING_OCR_PL_USER_DESC"))
        .addText(text => {
            text
                .setValue(plugin.settings.ocrSettings.texify.username)
                .onChange(async (value) => {
                    plugin.settings.ocrSettings.texify.username = value;
                    await plugin.saveSettings();
                });
            text.inputEl.style.width = "100%";
        });

    new Setting(ocrContentEl)
        .setName(t("SETTING_OCR_PL_PASS"))
        .setDesc(t("SETTING_OCR_PL_PASS_DESC"))
        .addText(text => {
            text
                .setValue(plugin.settings.ocrSettings.texify.password)
                .onChange(async (value) => {
                    plugin.settings.ocrSettings.texify.password = value;
                    await plugin.saveSettings();
                });
            text.inputEl.style.width = "100%";
            text.inputEl.type = "password";
        });

    // LLM 配置（永久显示）
    const llmLabel = ocrContentEl.createEl("div", {
        text: "▸ LLM",
        cls: "ocr-provider-label"
    });

    new Setting(ocrContentEl)
        .setName(t("SETTING_OCR_LLM_ENDPOINT"))
        .setDesc(t("SETTING_OCR_LLM_ENDPOINT_DESC"))
        .addText(text => {
            text
                .setPlaceholder("https://api.openai.com/v1/chat/completions")
                .setValue(plugin.settings.ocrSettings.aiModel.endpoint)
                .onChange(async (value) => {
                    plugin.settings.ocrSettings.aiModel.endpoint = value;
                    await plugin.saveSettings();
                });
            text.inputEl.style.width = "100%";
        });

    new Setting(ocrContentEl)
        .setName(t("SETTING_OCR_LLM_MODEL"))
        .setDesc(t("SETTING_OCR_LLM_MODEL_DESC"))
        .addText(text => {
            text
                .setPlaceholder("gpt-4-vision-preview")
                .setValue(plugin.settings.ocrSettings.aiModel.model)
                .onChange(async (value) => {
                    plugin.settings.ocrSettings.aiModel.model = value;
                    await plugin.saveSettings();
                });
            text.inputEl.style.width = "100%";
        });

    new Setting(ocrContentEl)
        .setName(t("SETTING_OCR_LLM_KEY"))
        .setDesc(t("SETTING_OCR_LLM_KEY_DESC"))
        .addText(text => {
            text
                .setPlaceholder("sk-...")
                .setValue(plugin.settings.ocrSettings.aiModel.apiKey)
                .onChange(async (value) => {
                    plugin.settings.ocrSettings.aiModel.apiKey = value;
                    await plugin.saveSettings();
                });
            text.inputEl.style.width = "100%";
            text.inputEl.type = "password";
        });

    new Setting(ocrContentEl)
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

    // Prompts 子标题
    const promptsLabel = ocrContentEl.createEl("div", {
        text: "  ▪ Prompts",
        cls: "ocr-prompts-label"
    });

    new Setting(ocrContentEl)
        .setName(t("SETTING_OCR_PROMPTS_LATEX"))
        .setDesc(t("SETTING_OCR_PROMPTS_LATEX_DESC"))
        .addTextArea(text => {
            text
                .setValue(plugin.settings.ocrSettings.aiModel.prompts.latex)
                .onChange(async (value) => {
                    plugin.settings.ocrSettings.aiModel.prompts.latex = value;
                    await plugin.saveSettings();
                });
            text.inputEl.style.width = "100%";
            text.inputEl.rows = 3;
        });

    new Setting(ocrContentEl)
        .setName(t("SETTING_OCR_PROMPTS_MARKDOWN"))
        .setDesc(t("SETTING_OCR_PROMPTS_MARKDOWN_DESC"))
        .addTextArea(text => {
            text
                .setValue(plugin.settings.ocrSettings.aiModel.prompts.markdown)
                .onChange(async (value) => {
                    plugin.settings.ocrSettings.aiModel.prompts.markdown = value;
                    await plugin.saveSettings();
                });
            text.inputEl.style.width = "100%";
            text.inputEl.rows = 3;
        });
}
