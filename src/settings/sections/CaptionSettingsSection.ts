import { Setting, setIcon, Notice } from "obsidian";
import ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { PresetUIState } from "../types";

export function renderCaptionSettingsSection(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    presetUIState: PresetUIState,
    refreshDisplay: () => void
): void {
    // --- Image Captions Settings Section ---
    const imageCaptionSection = containerEl.createDiv("image-converter-settings-section");
    imageCaptionSection.addClass("image-caption-settings-section");

    const settingsContentWrapper = imageCaptionSection.createDiv("settings-section-content");

    // --- Header Setting ---
    const headerSetting = new Setting(imageCaptionSection)
        .setName(t("SETTING_IMG_CAPTION_SECTION"))
        .setHeading()
        .addToggle((toggle) =>
            toggle
                .setValue(plugin.settings.captions.enabled)
                .onChange(async (value) => {
                    plugin.settings.captions.enabled = value;
                    await plugin.saveSettings();
                    refreshDisplay();

                    if (!value) {
                        new Notice("Image captions disabled.", 2000);
                    }
                })
        );

    // Move header to top
    imageCaptionSection.prepend(headerSetting.settingEl);

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
        if (presetUIState.imageCaptionSectionCollapsed) {
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

        presetUIState.imageCaptionSectionCollapsed = !presetUIState.imageCaptionSectionCollapsed;
        updateChevron();
    };

    if (plugin.settings.captions.enabled) {
        // --- Skip Extensions ---
        new Setting(settingsContentWrapper)
            .setName(t("SETTING_CAPTION_SKIP_EXT"))
            .setDesc(t("SETTING_CAPTION_SKIP_EXT_DESC"))
            .addText(text => text
                .setPlaceholder("pdf,svg")
                .setValue(plugin.settings.captions.skipExtensions)
                .onChange(async (value) => {
                    plugin.settings.captions.skipExtensions = value;
                    await plugin.saveSettings();
                }));

        // --- Font Size ---
        new Setting(settingsContentWrapper)
            .setName(t("SETTING_CAPTION_FONT_SIZE"))
            .addText(text => text
                .setPlaceholder("12px")
                .setValue(plugin.settings.captions.fontSize)
                .onChange(async (value) => {
                    plugin.settings.captions.fontSize = value;
                    await plugin.saveSettings();
                }));

        // --- Color ---
        new Setting(settingsContentWrapper)
            .setName(t("SETTING_CAPTION_COLOR"))
            .addText(text => text
                .setPlaceholder("var(--text-muted)")
                .setValue(plugin.settings.captions.color)
                .onChange(async (value) => {
                    plugin.settings.captions.color = value;
                    await plugin.saveSettings();
                }));

        // --- Alignment ---
        new Setting(settingsContentWrapper)
            .setName(t("SETTING_CAPTION_ALIGN"))
            .addDropdown(dropdown => dropdown
                .addOption("left", "Left")
                .addOption("center", "Center")
                .addOption("right", "Right")
                .setValue(plugin.settings.captions.alignment)
                .onChange(async (value) => {
                    plugin.settings.captions.alignment = value;
                    await plugin.saveSettings();
                }));
    } else {
        settingsContentWrapper.empty();
    }
}
