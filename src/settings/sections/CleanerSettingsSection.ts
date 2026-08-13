import { Setting } from "obsidian";
import ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { SettingsUIState } from "../types";
import { createCollapsibleSettingsSection } from "../components/CollapsibleSettingsSection";

export function renderCleanerSettingsSection(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    settingsUIState: SettingsUIState,
    refreshDisplay: () => void
): void {
    const { header: headerSetting, contentEl: settingsContentWrapper } =
        createCollapsibleSettingsSection(containerEl, {
            title: t("SETTING_CLEANER_SECTION"),
            sectionClass: "unused-file-cleaner-settings-section",
            isCollapsed: () => settingsUIState.cleanerSectionCollapsed,
            setCollapsed: collapsed => {
                settingsUIState.cleanerSectionCollapsed = collapsed;
            }
        });
    headerSetting.addToggle(toggle => toggle
        .setValue(plugin.settings.cleanerSettings.enabled)
        .onChange(async value => {
            plugin.settings.cleanerSettings.enabled = value;
            await plugin.saveSettings();
            refreshDisplay();
        }));

    if (!plugin.settings.cleanerSettings.enabled) return;

    if (plugin.settings.global.enableContextMenu) {
        new Setting(settingsContentWrapper)
            .setName(t("SETTING_CLEANER_CONTEXT_DELETE"))
            .setDesc(t("SETTING_CLEANER_CONTEXT_DELETE_DESC"))
            .addToggle(toggle => toggle
                .setValue(plugin.settings.cleanerSettings.enableDeleteContextMenu)
                .onChange(async (value) => {
                    plugin.settings.cleanerSettings.enableDeleteContextMenu = value;
                    await plugin.saveSettings();
                }));
    }

    // Base Path
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_CLEANER_BASE_PATH"))
        .setDesc(t("SETTING_CLEANER_BASE_PATH_DESC"))
        .addText(text => text
            .setPlaceholder("attachments")
            .setValue(plugin.settings.cleanerSettings.basePath)
            .onChange(async (value) => {
                plugin.settings.cleanerSettings.basePath = value;
                await plugin.saveSettings();
            }));

    new Setting(settingsContentWrapper)
        .setName(t("SETTING_CLEANER_FILE_TYPES"))
        .setDesc(t("SETTING_CLEANER_FILE_TYPES_DESC"))
        .addText(text => text
            .setPlaceholder("jpg,jpeg,png,webp,pdf")
            .setValue(plugin.settings.cleanerSettings.fileTypes)
            .onChange(async (value) => {
                plugin.settings.cleanerSettings.fileTypes = value;
                await plugin.saveSettings();
            }));

    // Trash Mode
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_CLEANER_TRASH_MODE"))
        .setDesc(t("SETTING_CLEANER_TRASH_MODE_DESC"))
        .addDropdown(dropdown => dropdown
            .addOption("follow-obsidian", t("SETTING_CLEANER_TRASH_FOLLOW_OBSIDIAN"))
            .addOption("obsidian", t("SETTING_CLEANER_TRASH_OBSIDIAN"))
            .addOption("system", t("SETTING_CLEANER_TRASH_SYSTEM"))
            .addOption("custom", t("SETTING_CLEANER_TRASH_CUSTOM"))
            .setValue(plugin.settings.cleanerSettings.trashMode)
            .onChange(async (
                value: 'follow-obsidian' | 'system' | 'obsidian' | 'custom'
            ) => {
                plugin.settings.cleanerSettings.trashMode = value;
                await plugin.saveSettings();
                refreshDisplay();
            }));

    if (plugin.settings.cleanerSettings.trashMode === "custom") {
        new Setting(settingsContentWrapper)
            .setName(t("SETTING_CLEANER_CUSTOM_PATH"))
            .setDesc(t("SETTING_CLEANER_CUSTOM_PATH_DESC"))
            .addText(text => text
                .setPlaceholder(".trash")
                .setValue(plugin.settings.cleanerSettings.customTrashPath)
                .onChange(async (value) => {
                    plugin.settings.cleanerSettings.customTrashPath = value;
                    await plugin.saveSettings();
                }));
    }
}
