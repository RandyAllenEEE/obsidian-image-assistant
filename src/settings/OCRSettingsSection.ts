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
                    // 不再触发 display()，避免刷新打断交互
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
                    // 不再触发 display()，避免刷新打断交互
                });
        });

    // ========== Config Section ==========
    const configHeader = ocrContentEl.createEl("h4", { 
        text: "🔧 Config", 
        cls: "ocr-subsection-header" 
    });

    // SimpleTex 配置（永久显示）
    const simpleTexLabel = ocrContentEl.createEl("div", { 
        text: "▸ SimpleTex", 
        cls: "ocr-provider-label" 
    });

    new Setting(ocrContentEl)
        .setName("Token")
        .setDesc("输入 SimpleTex API Token")
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
