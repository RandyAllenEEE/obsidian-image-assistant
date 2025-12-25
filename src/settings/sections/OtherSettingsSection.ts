import { Setting, setIcon } from "obsidian";
import ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { ModalBehavior, PresetUIState } from "../types";

export function renderOtherSettingsSection(containerEl: HTMLElement, plugin: ImageConverterPlugin, presetUIState: PresetUIState): void {
    const otherSection = containerEl.createDiv("image-converter-settings-section");
    otherSection.addClass("other-settings-section");

    const settingsContentWrapper = otherSection.createDiv("settings-section-content");

    // --- Collapsible Header ---
    const headerSetting = new Setting(otherSection)
        .setName(t("SETTING_OTHER_SECTION"))
        .setHeading();

    // Move header to top
    otherSection.prepend(headerSetting.settingEl);

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
        if (presetUIState.otherSectionCollapsed) {
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
        presetUIState.otherSectionCollapsed = !presetUIState.otherSectionCollapsed;
        updateChevron();
    };

    // --- Interaction Settings ---
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_MODAL_BEHAVIOR_NAME"))
        .setDesc(t("SETTING_MODAL_BEHAVIOR_DESC"))
        .addDropdown(dropdown => dropdown
            .addOption("always", t("SETTING_MODAL_BEHAVIOR_ALWAYS"))
            .addOption("never", t("SETTING_MODAL_BEHAVIOR_NEVER"))
            .addOption("ask", t("SETTING_MODAL_BEHAVIOR_ASK"))
            .setValue(plugin.settings.global.modalBehavior)
            .onChange(async (value: ModalBehavior) => {
                plugin.settings.global.modalBehavior = value;
                await plugin.saveSettings();
            })
        );

    new Setting(settingsContentWrapper)
        .setName(t("SETTING_ENABLE_CONTEXT_MENU_NAME"))
        .setDesc(t("SETTING_ENABLE_CONTEXT_MENU_DESC"))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.global.enableContextMenu)
            .onChange(async (value) => {
                plugin.settings.global.enableContextMenu = value;
                await plugin.saveSettings();
            })
        );

    new Setting(settingsContentWrapper)
        .setName(t("SETTING_SHOW_NOTIFICATION_NAME"))
        .setDesc(t("SETTING_SHOW_NOTIFICATION_DESC"))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.global.showSpaceSavedNotification)
            .onChange(async (value) => {
                plugin.settings.global.showSpaceSavedNotification = value;
                await plugin.saveSettings();
            })
        );

    new Setting(settingsContentWrapper)
        .setName(t("SETTING_REVERT_IF_LARGER_NAME"))
        .setDesc(t("SETTING_REVERT_IF_LARGER_DESC"))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.global.revertToOriginalIfLarger)
            .onChange(async (value) => {
                plugin.settings.global.revertToOriginalIfLarger = value;
                await plugin.saveSettings();
            })
        );
}
