import { Setting } from "obsidian";
import type ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import type { ExcalidrawEmbedMode } from "../../settings/types";

export function renderExcalidrawSettingsSection(
    contentEl: HTMLElement,
    plugin: ImageConverterPlugin,
    refreshDisplay: () => void
): void {
    const capabilities = plugin.drawingModule.getExcalidrawCapabilities();
    new Setting(contentEl)
        .setName(t("SETTING_EXCALIDRAW_STATUS"))
        .setDesc(t(statusDescriptionKey(capabilities.reason)))
        .addButton(button => button
            .setButtonText(t("SETTING_EXCALIDRAW_REDETECT"))
            .onClick(() => refreshDisplay()));
    new Setting(contentEl)
        .setName(t("SETTING_EXCALIDRAW_CAPABILITIES"))
        .setDesc(t("SETTING_EXCALIDRAW_CAPABILITIES_DESC", [
            yesNo(capabilities.canCreate),
            yesNo(capabilities.canRecognize),
            yesNo(capabilities.canListTemplates),
            yesNo(capabilities.canCreateSvgPreview)
        ]));
    new Setting(contentEl)
        .setName(t("SETTING_EXCALIDRAW_MANAGE_FILE_LOCATION"))
        .setDesc(t("SETTING_EXCALIDRAW_MANAGE_FILE_LOCATION_DESC"))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.drawing.excalidraw.manageCreatedFileLocation)
            .onChange(async value => {
                plugin.settings.drawing.excalidraw.manageCreatedFileLocation = value;
                await plugin.saveSettings();
            }));
    new Setting(contentEl)
        .setName(t("SETTING_EXCALIDRAW_EMBED_MODE"))
        .setDesc(t("SETTING_EXCALIDRAW_EMBED_MODE_DESC"))
        .addDropdown(dropdown => dropdown
            .addOption("source", t("SETTING_EXCALIDRAW_EMBED_SOURCE"))
            .addOption("auto-export-preview", t("SETTING_EXCALIDRAW_EMBED_PREVIEW"))
            .setValue(plugin.settings.drawing.excalidraw.embedMode)
            .onChange(async value => {
                plugin.settings.drawing.excalidraw.embedMode = value === "auto-export-preview"
                    ? "auto-export-preview"
                    : "source" as ExcalidrawEmbedMode;
                await plugin.saveSettings();
            }));
    contentEl.createDiv({
        cls: "image-assistant-drawing-setting-warning",
        text: t("SETTING_EXCALIDRAW_OWNERSHIP_NOTICE")
    });
}

function statusDescriptionKey(reason: ReturnType<ImageConverterPlugin["drawingModule"]["getExcalidrawCapabilities"]>["reason"]): Parameters<typeof t>[0] {
    if (reason === "ready") return "SETTING_EXCALIDRAW_STATUS_READY";
    if (reason === "outdated") return "SETTING_EXCALIDRAW_STATUS_OUTDATED";
    if (reason === "initializing") return "SETTING_EXCALIDRAW_STATUS_INITIALIZING";
    if (reason === "invalid-api") return "SETTING_EXCALIDRAW_STATUS_INVALID";
    return "SETTING_EXCALIDRAW_STATUS_MISSING";
}

function yesNo(value: boolean): string {
    return t(value ? "SETTING_EXCALIDRAW_CAPABILITY_YES" : "SETTING_EXCALIDRAW_CAPABILITY_NO");
}
