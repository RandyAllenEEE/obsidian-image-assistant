import { Setting, setIcon } from "obsidian";
import ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { SettingsUIState } from "../types";

export function renderCleanerSettingsSection(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    settingsUIState: SettingsUIState,
    refreshDisplay: () => void
): void {
    // --- Unused File Cleaner Settings Section ---
    const cleanerSection = containerEl.createDiv("image-converter-settings-section");
    cleanerSection.addClass("unused-file-cleaner-settings-section");

    const settingsContentWrapper = cleanerSection.createDiv("settings-section-content");

    // --- Collapsible Header ---
    const headerSetting = new Setting(cleanerSection)
        .setName(t("SETTING_CLEANER_SECTION"))
        .setHeading();

    // Move header to top
    cleanerSection.prepend(headerSetting.settingEl);

    // Style the header
    headerSetting.settingEl.addClass("settings-section-header");
    headerSetting.settingEl.style.cursor = "pointer";

    // Add Chevron Icon
    const chevronContainer = headerSetting.nameEl.createSpan("settings-chevron-container");
    chevronContainer.style.marginRight = "8px";
    const chevronIcon = chevronContainer.createDiv();
    // Prepend chevron
    headerSetting.nameEl.prepend(chevronContainer);

    // Function to update chevron state
    const updateChevron = () => {
        if (settingsUIState.cleanerSectionCollapsed) {
            setIcon(chevronIcon, "chevron-right");
            settingsContentWrapper.style.display = "none";
        } else {
            setIcon(chevronIcon, "chevron-down");
            settingsContentWrapper.style.display = "block";
        }
    };

    // Initial State
    updateChevron();

    // Click handler for collapse/expand
    headerSetting.settingEl.onclick = () => {
        settingsUIState.cleanerSectionCollapsed = !settingsUIState.cleanerSectionCollapsed;
        updateChevron();
    };

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
