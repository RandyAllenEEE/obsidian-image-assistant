import { Setting, setIcon, Notice } from "obsidian";
import ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { PresetUIState } from "../types";

export function renderAlignmentSettingsSection(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    presetUIState: PresetUIState,
    refreshDisplay: () => void
): void {
    // --- Image Alignment Settings Section ---
    // --- Image Alignment Settings Section ---
    const imageAlignmentSection = containerEl.createDiv("image-converter-settings-section");
    // Add marker class for potential CSS styling
    // imageAlignmentSection.addClass("image-alignment-settings-section");

    // Wrapper for child settings to support collapsing
    const settingsContentWrapper = imageAlignmentSection.createDiv("settings-section-content");

    // --- Header Setting ---
    const headerSetting = new Setting(imageAlignmentSection)
        .setName(t("SETTING_IMG_ALIGNMENT_SECTION"))
        .setHeading()
        .addToggle((toggle) =>
            toggle
                .setValue(plugin.settings.alignment.enabled)
                .onChange(async (value) => {
                    plugin.settings.alignment.enabled = value;
                    await plugin.saveSettings();
                    // Force refresh to update child settings visibility
                    refreshDisplay();

                    if (!value) {
                        new Notice("Image alignment disabled.", 2000);
                    }
                })
        );

    // Move header to top (Setting appends to container by default, we want it before content)
    imageAlignmentSection.prepend(headerSetting.settingEl);

    // Style the header
    headerSetting.settingEl.addClass("settings-section-header");
    headerSetting.settingEl.style.cursor = "pointer";
    headerSetting.settingEl.style.alignItems = "center"; // Force vertical center alignment

    // Add Chevron Icon
    const chevronContainer = headerSetting.nameEl.createSpan("settings-chevron-container");
    chevronContainer.style.marginRight = "8px";
    const chevronIcon = chevronContainer.createDiv();
    // Prepend chevron to name so it appears first
    headerSetting.nameEl.prepend(chevronContainer);

    // Function to update chevron state
    const updateChevron = () => {
        if (presetUIState.imageAlignmentSectionCollapsed) {
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
    headerSetting.settingEl.onclick = (e) => {
        // Prevent collapse when clicking the toggle
        if ((e.target as HTMLElement).closest(".checkbox-container")) return;

        presetUIState.imageAlignmentSectionCollapsed = !presetUIState.imageAlignmentSectionCollapsed;
        updateChevron();
    };

    // --- Content Settings ---
    if (plugin.settings.alignment.enabled) {
        // --- Default Alignment Setting ---
        new Setting(settingsContentWrapper)
            .setName(t("SETTING_DEFAULT_ALIGN"))
            .setDesc(t("SETTING_DEFAULT_ALIGN_DESC"))
            .addDropdown(dropdown => dropdown
                .addOption("left", t("ALIGN_LEFT"))
                .addOption("center", t("ALIGN_CENTER"))
                .addOption("right", t("ALIGN_RIGHT"))
                .setValue(plugin.settings.alignment.default)
                .onChange(async (value: 'left' | 'center' | 'right') => {
                    plugin.settings.alignment.default = value;
                    await plugin.saveSettings();
                    // Refresh images if possible
                    if (plugin.imageStateManager) {
                        plugin.imageStateManager.refreshAllImages();
                    }
                })
            );

        // --- Enable Wrap in Edit Mode Setting ---
        new Setting(settingsContentWrapper)
            .setName(t("SETTING_ENABLE_WRAP_IN_EDIT"))
            .setDesc(t("SETTING_ENABLE_WRAP_IN_EDIT_DESC"))
            .addToggle(toggle => toggle
                .setValue(plugin.settings.alignment.enableEditModeWrap)
                .onChange(async (value) => {
                    plugin.settings.alignment.enableEditModeWrap = value;
                    await plugin.saveSettings();
                    // Update body class
                    if (value) {
                        document.body.addClass('image-assistant-wrap-in-edit-mode');
                    } else {
                        document.body.removeClass('image-assistant-wrap-in-edit-mode');
                    }
                })
            );
    } else {
        // If disabled, maybe show a small message or just nothing?
        // keeping empty for cleaner look, valid behavior.
        settingsContentWrapper.empty();
    }
}
