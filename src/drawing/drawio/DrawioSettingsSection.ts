import { Notice, Setting } from "obsidian";
import type ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { addSecretSettingControl } from "../../settings/components/SecretSettingControl";
import { createCollapsibleSettingsSection } from "../../settings/components/CollapsibleSettingsSection";
import type { DrawioTheme, SettingsUIState } from "../../settings/types";
import { buildDrawioEmbedUrl } from "./DrawioEmbedUrl";

export function renderDrawioSettingsSection(
    contentEl: HTMLElement,
    plugin: ImageConverterPlugin,
    state: SettingsUIState,
    refreshDisplay: () => void
): void {
    const drawio = plugin.settings.drawing.drawio;
    const urlSetting = new Setting(contentEl)
        .setName(t("SETTING_DRAWING_EMBED_URL"))
        .setDesc(t("SETTING_DRAWING_EMBED_URL_DESC"))
        .addText(text => {
            text.setPlaceholder("https://embed.diagrams.net/")
                .setValue(drawio.embedUrl)
                .onChange(async value => {
                    drawio.embedUrl = value;
                    await plugin.saveSettings();
                    plugin.drawingModule.notifyEmbedUrlChanged();
                });
            text.inputEl.addClass("image-assistant-drawing-url-input");
        });
    try {
        const result = buildDrawioEmbedUrl(drawio.embedUrl);
        if (result.warning) urlSetting.descEl.createDiv({
            cls: "image-assistant-drawing-setting-warning",
            text: result.warning
        });
    } catch (error) {
        urlSetting.descEl.createDiv({
            cls: "image-assistant-drawing-setting-error",
            text: error instanceof Error ? error.message : String(error)
        });
    }
    new Setting(contentEl)
        .setName(t("SETTING_DRAWING_THEME"))
        .setDesc(t("SETTING_DRAWING_THEME_DESC"))
        .addDropdown(dropdown => dropdown
            .addOption("kennedy", t("SETTING_DRAWING_THEME_KENNEDY"))
            .addOption("atlas", t("SETTING_DRAWING_THEME_ATLAS"))
            .addOption("dark", t("SETTING_DRAWING_THEME_DARK"))
            .addOption("minimal", t("SETTING_DRAWING_THEME_MINIMAL"))
            .addOption("sketch", t("SETTING_DRAWING_THEME_SKETCH"))
            .addOption("simple", t("SETTING_DRAWING_THEME_SIMPLE"))
            .setValue(drawio.theme)
            .onChange(async value => {
                drawio.theme = value as DrawioTheme;
                await plugin.saveSettings();
                await plugin.drawingModule.refreshAppearance();
            }));
    new Setting(contentEl)
        .setName(t("SETTING_DRAWING_FOLLOW_THEME"))
        .setDesc(t("SETTING_DRAWING_FOLLOW_THEME_DESC"))
        .addToggle(toggle => toggle
            .setValue(drawio.followObsidianTheme)
            .onChange(async value => {
                drawio.followObsidianTheme = value;
                await plugin.saveSettings();
                await plugin.drawingModule.refreshAppearance();
            }));
    new Setting(contentEl)
        .setName(t("SETTING_DRAWING_TEST"))
        .setDesc(t("SETTING_DRAWING_TEST_DESC"))
        .addButton(button => button
            .setButtonText(t("SETTING_DRAWING_TEST_BUTTON"))
            .onClick(async () => {
                button.setDisabled(true);
                try {
                    const completed = await plugin.drawingModule.testDrawioConnection(contentEl);
                    if (completed) new Notice(t("NOTICE_DRAWING_CONNECTION_OK"));
                } catch (error) {
                    new Notice(t("NOTICE_DRAWING_CONNECTION_FAILED", [
                        error instanceof Error ? error.message : String(error)
                    ]));
                } finally {
                    button.setDisabled(false);
                }
            }));

    const nextAi = drawio.nextAi;
    const nested = createCollapsibleSettingsSection(contentEl, {
        title: t("SETTING_NEXT_AI_SECTION"),
        sectionClass: "image-assistant-next-ai-settings-section",
        isCollapsed: () => state.nextAiSectionCollapsed,
        setCollapsed: collapsed => {
            state.nextAiSectionCollapsed = collapsed;
        }
    });
    nested.header.addToggle(toggle => toggle
        .setValue(nextAi.enabled)
        .onChange(async value => {
            nextAi.enabled = value;
            await plugin.saveSettings();
            plugin.drawingModule.refreshNextAi();
            refreshDisplay();
        }));
    if (!nextAi.enabled) return;

    nested.contentEl.createDiv({
        cls: "image-assistant-drawing-setting-warning",
        text: t("SETTING_NEXT_AI_SECURITY_WARNING")
    });
    new Setting(nested.contentEl)
        .setName(t("SETTING_NEXT_AI_SERVICE_URL"))
        .setDesc(t("SETTING_NEXT_AI_SERVICE_URL_DESC"))
        .addText(text => text
            .setPlaceholder("https://next-ai-drawio.example.com/")
            .setValue(nextAi.serviceUrl)
            .onChange(async value => {
                nextAi.serviceUrl = value;
                await plugin.saveSettings();
            }));

    const accessSetting = new Setting(nested.contentEl)
        .setName(t("SETTING_NEXT_AI_ACCESS_CODE"))
        .setDesc(t("SETTING_NEXT_AI_ACCESS_CODE_DESC"));
    addSecretSettingControl(accessSetting, plugin.app, nextAi.accessCodeSecretId, async value => {
        nextAi.accessCodeSecretId = value;
        await plugin.saveSettings();
    }, "image-assistant-next-ai-access-code");

    new Setting(nested.contentEl)
        .setName(t("SETTING_NEXT_AI_API_BASE_URL"))
        .setDesc(t("SETTING_NEXT_AI_API_BASE_URL_DESC"))
        .addText(text => text
            .setPlaceholder("https://api.openai.com/v1")
            .setValue(nextAi.apiBaseUrl)
            .onChange(async value => {
                nextAi.apiBaseUrl = value;
                await plugin.saveSettings();
            }));
    const keySetting = new Setting(nested.contentEl)
        .setName(t("SETTING_NEXT_AI_API_KEY"))
        .setDesc(t("SETTING_NEXT_AI_API_KEY_DESC"));
    addSecretSettingControl(keySetting, plugin.app, nextAi.apiKeySecretId, async value => {
        nextAi.apiKeySecretId = value;
        await plugin.saveSettings();
    }, "image-assistant-next-ai-api-key");
    new Setting(nested.contentEl)
        .setName(t("SETTING_NEXT_AI_MODEL"))
        .setDesc(t("SETTING_NEXT_AI_MODEL_DESC"))
        .addText(text => text
            .setPlaceholder("gpt-4.1")
            .setValue(nextAi.model)
            .onChange(async value => {
                nextAi.model = value;
                await plugin.saveSettings();
            }));
    new Setting(nested.contentEl)
        .setName(t("SETTING_NEXT_AI_SYSTEM_MESSAGE"))
        .setDesc(t("SETTING_NEXT_AI_SYSTEM_MESSAGE_DESC"))
        .addTextArea(text => {
            text.setValue(nextAi.customSystemMessage)
                .onChange(async value => {
                    nextAi.customSystemMessage = value;
                    await plugin.saveSettings();
                });
            text.inputEl.rows = 3;
        });
    new Setting(nested.contentEl)
        .setName(t("SETTING_NEXT_AI_MINIMAL_STYLE"))
        .setDesc(t("SETTING_NEXT_AI_MINIMAL_STYLE_DESC"))
        .addToggle(toggle => toggle
            .setValue(nextAi.minimalStyle)
            .onChange(async value => {
                nextAi.minimalStyle = value;
                await plugin.saveSettings();
            }));
    new Setting(nested.contentEl)
        .setName(t("SETTING_NEXT_AI_VISUAL_VALIDATION"))
        .setDesc(t("SETTING_NEXT_AI_VISUAL_VALIDATION_DESC"))
        .addDropdown(dropdown => dropdown
            .addOption("disabled", t("SETTING_NEXT_AI_VISUAL_VALIDATION_DISABLED"))
            .addOption("user-model", t("SETTING_NEXT_AI_VISUAL_VALIDATION_USER_MODEL"))
            .addOption("next-ai-server", t("SETTING_NEXT_AI_VISUAL_VALIDATION_SERVER"))
            .setValue(nextAi.visualValidationMode)
            .onChange(async value => {
                nextAi.visualValidationMode = value === "user-model"
                    ? "user-model"
                    : value === "next-ai-server" ? "next-ai-server" : "disabled";
                await plugin.saveSettings();
            }));
    new Setting(nested.contentEl)
        .setName(t("SETTING_NEXT_AI_SEND_SHORTCUT"))
        .setDesc(t("SETTING_NEXT_AI_SEND_SHORTCUT_DESC"))
        .addDropdown(dropdown => dropdown
            .addOption("mod-enter", t("SETTING_NEXT_AI_SEND_MOD_ENTER"))
            .addOption("enter", t("SETTING_NEXT_AI_SEND_ENTER"))
            .setValue(nextAi.sendShortcut)
            .onChange(async value => {
                nextAi.sendShortcut = value === "enter" ? "enter" : "mod-enter";
                await plugin.saveSettings();
            }));
    new Setting(nested.contentEl)
        .setName(t("SETTING_NEXT_AI_ALLOW_HTTP"))
        .setDesc(t("SETTING_NEXT_AI_ALLOW_HTTP_DESC"))
        .addToggle(toggle => toggle
            .setValue(nextAi.allowInsecureRemoteHttp)
            .onChange(async value => {
                nextAi.allowInsecureRemoteHttp = value;
                await plugin.saveSettings();
            }));
    new Setting(nested.contentEl)
        .setName(t("SETTING_NEXT_AI_TEST"))
        .setDesc(t("SETTING_NEXT_AI_TEST_DESC"))
        .addButton(button => button
            .setButtonText(t("SETTING_NEXT_AI_TEST_BUTTON"))
            .onClick(async () => {
                button.setDisabled(true);
                try {
                    await plugin.drawingModule.testNextAiConnection();
                    new Notice(t("NOTICE_NEXT_AI_CONNECTION_OK"));
                } catch (error) {
                    new Notice(t("NOTICE_NEXT_AI_CONNECTION_FAILED", [
                        error instanceof Error ? error.message : String(error)
                    ]));
                } finally {
                    button.setDisabled(false);
                }
            }));
}
