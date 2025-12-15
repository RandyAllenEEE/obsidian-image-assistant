import { Setting, setIcon } from "obsidian";
import ImageConverterPlugin from "../main";

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
    ocrHeaderEl.createEl("span", { text: "🤖 OCR & LaTeX 设置", cls: "settings-section-title" });

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
        .setName("LaTeX Provider")
        .setDesc("选择 LaTeX 公式识别服务提供商")
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
        .setName("Markdown Provider")
        .setDesc("选择文本识别服务提供商")
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
        .setName("认证方式")
        .setDesc("选择 SimpleTeX 认证方式")
        .addDropdown(dropdown => {
            dropdown
                .addOption("token", "Token (不推荐，可能会遇到CORS问题)")
                .addOption("app", "App ID & Secret (推荐，避免CORS问题)")
                .setValue(plugin.settings.ocrSettings.simpleTexAppId && plugin.settings.ocrSettings.simpleTexAppSecret ? "app" : "token")
                .onChange(async (value: "token" | "app") => {
                    // 不需要保存认证方式到设置中，只需在调用时判断使用哪种方式
                    // 这里可以添加 UI 切换逻辑，但目前我们只保存设置值
                    await plugin.saveSettings();
                });
        });

    // Token 配置
    new Setting(simpletexContentEl)
        .setName("Token")
        .setDesc("输入 SimpleTex API Token (不推荐，可能会遇到CORS问题)")
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
        .setName("App ID")
        .setDesc("输入 SimpleTex App ID (推荐，避免CORS问题)")
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
        .setName("App Secret")
        .setDesc("输入 SimpleTex App Secret (推荐，避免CORS问题)")
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
        .setName("认证方式说明")
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
        .setName("URL")
        .setDesc("Pix2Tex 服务的 URL 地址")
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
        .setName("Username (Self-hosted optional)")
        .setDesc("如果服务需要认证，输入用户名")
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
        .setName("Password (Self-hosted optional)")
        .setDesc("如果服务需要认证，输入密码")
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
        .setName("URL")
        .setDesc("Texify 服务的 URL 地址")
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
        .setName("Username (Self-hosted optional)")
        .setDesc("如果服务需要认证，输入用户名")
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
        .setName("Password (Self-hosted optional)")
        .setDesc("如果服务需要认证，输入密码")
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
        .setName("Endpoint")
        .setDesc("支持 OpenAI 兼容的 API 端点")
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
        .setName("Model")
        .setDesc("模型名称，例如 gpt-4-vision-preview")
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
        .setName("API Key")
        .setDesc("输入 API Key")
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
        .setName("Max Tokens")
        .setDesc("最大生成 token 数")
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
        .setName("LaTeX Prompt")
        .setDesc("用于 LaTeX 转换的提示词")
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
        .setName("Markdown Prompt")
        .setDesc("用于 Markdown 转换的提示词")
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
