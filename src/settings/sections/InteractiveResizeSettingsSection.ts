import { Setting, setIcon, Notice } from "obsidian";
import ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { PresetUIState } from "../types";

export function renderInteractiveResizeSettingsSection(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    presetUIState: PresetUIState,
    refreshDisplay: () => void
): void {
    // --- Image Drag & Resize Settings Section ---
    const imageDragResizeSection = containerEl.createDiv("image-converter-settings-section");
    // Removed specific class to align with other sections
    // imageDragResizeSection.addClass("image-drag-resize-settings-section");

    const settingsContentWrapper = imageDragResizeSection.createDiv("settings-section-content");

    // --- Header Setting ---
    const headerSetting = new Setting(imageDragResizeSection)
        .setName(t("SETTING_DRAG_RESIZE_SECTION"))
        .setHeading()
        .addToggle((toggle) =>
            toggle
                .setValue(plugin.settings.interactiveResize.enabled)
                .onChange(async (value) => {
                    plugin.settings.interactiveResize.enabled = value;
                    await plugin.saveSettings();
                    refreshDisplay();

                    if (!value) {
                        // new Notice("Interactive Resize disabled.", 2000); 
                        // Notice is annoying if just toggling to see
                    }
                })
        );

    // Move header to top
    imageDragResizeSection.prepend(headerSetting.settingEl);

    // Style the header
    headerSetting.settingEl.addClass("settings-section-header");
    headerSetting.settingEl.style.cursor = "pointer";
    headerSetting.settingEl.style.alignItems = "center"; // Force vertical center alignment

    // Add Chevron Icon
    const chevronContainer = headerSetting.nameEl.createSpan("settings-chevron-container");
    chevronContainer.style.marginRight = "8px";
    const chevronIcon = chevronContainer.createDiv();
    // Prepend chevron
    headerSetting.nameEl.prepend(chevronContainer);

    // Function to update chevron state
    const updateChevron = () => {
        if (presetUIState.imageDragResizeSectionCollapsed) {
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

        presetUIState.imageDragResizeSectionCollapsed = !presetUIState.imageDragResizeSectionCollapsed;
        updateChevron();
    };


    if (plugin.settings.interactiveResize.enabled) {
        // --- Enable Drag Resize Toggle ---
        new Setting(settingsContentWrapper)
            .setName(t("SETTING_ENABLE_DRAG_RESIZE"))
            .setDesc(t("SETTING_ENABLE_DRAG_RESIZE_DESC"))
            .setTooltip(t("SETTING_ENABLE_DRAG_RESIZE_TOOLTIP"))
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.interactiveResize.dragEnabled)
                    .onChange(async (value) => {
                        plugin.settings.interactiveResize.dragEnabled = value;
                        await plugin.saveSettings();
                        refreshDisplay();
                    })
            );

        // Drag-resize specific settings
        if (plugin.settings.interactiveResize.dragEnabled) {
            const apectRatioSettingsContainer = settingsContentWrapper.createDiv('fix-aspect-ratio-settings');
            // Indent or style this sub-container if needed, for instance:
            apectRatioSettingsContainer.style.paddingLeft = "20px";
            apectRatioSettingsContainer.style.borderLeft = "2px solid var(--background-modifier-border)";


            new Setting(apectRatioSettingsContainer)
                .setName(t("SETTING_DRAG_LOCK_RATIO"))
                .setDesc(t("SETTING_DRAG_LOCK_RATIO_DESC"))
                .addToggle(toggle => toggle
                    .setValue(plugin.settings.interactiveResize.aspectRatioLocked)
                    .onChange(async (value) => {
                        plugin.settings.interactiveResize.aspectRatioLocked = value;
                        await plugin.saveSettings();
                    }));
        }

        // --- Enable Scroll Resize Toggle ---
        new Setting(settingsContentWrapper)
            .setName(t("SETTING_ENABLE_SCROLL_RESIZE"))
            .setDesc(t("SETTING_ENABLE_SCROLL_RESIZE_DESC"))
            .addToggle(toggle => toggle
                .setValue(plugin.settings.interactiveResize.scrollEnabled)
                .onChange(async (value) => {
                    plugin.settings.interactiveResize.scrollEnabled = value;
                    await plugin.saveSettings();
                    refreshDisplay();
                }));

        // Scroll-wheel specific settings
        if (plugin.settings.interactiveResize.scrollEnabled) {
            const scrollSettingsContainer = settingsContentWrapper.createDiv('scroll-resize-settings');
            scrollSettingsContainer.style.paddingLeft = "20px";
            scrollSettingsContainer.style.borderLeft = "2px solid var(--background-modifier-border)";

            new Setting(scrollSettingsContainer)
                .setName(t("SETTING_SCROLL_MODIFIER"))
                .setDesc(t("SETTING_SCROLL_MODIFIER_DESC"))
                .addDropdown(dropdown => dropdown
                    .addOptions({
                        'None': '无',
                        'Shift': 'Shift',
                        'Control': 'Control',
                        'Alt': 'Alt',
                        'Meta': 'Meta'
                    })
                    .setValue(plugin.settings.interactiveResize.scrollModifier)
                    .onChange(async (value: "None" | "Shift" | "Control" | "Alt" | "Meta") => {
                        plugin.settings.interactiveResize.scrollModifier = value;
                        await plugin.saveSettings();
                    }));

            new Setting(scrollSettingsContainer)
                .setName(t("SETTING_RESIZE_SENSITIVITY"))
                .setDesc(t("SETTING_RESIZE_SENSITIVITY_DESC"))
                .addSlider(slider => slider
                    .setLimits(0.01, 1, 0.01)
                    .setValue(plugin.settings.interactiveResize.sensitivity)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        plugin.settings.interactiveResize.sensitivity = value;
                        await plugin.saveSettings();
                    }));
        }

        // --- Resize Cursor Location ---
        new Setting(settingsContentWrapper)
            .setName(t("SETTING_RESIZE_CURSOR_LOC"))
            .setTooltip(t("SETTING_RESIZE_CURSOR_LOC_TOOLTIP"))
            .addDropdown((dropdown) => {
                dropdown
                    .addOption("front", t("SETTING_CURSOR_FRONT"))
                    .addOption("back", t("SETTING_CURSOR_BACK"))
                    .addOption("below", t("SETTING_CURSOR_BELOW"))
                    .addOption("none", t("SETTING_CURSOR_NONE"))
                    .setValue(plugin.settings.resizeCursorLocation)
                    .onChange(async (value: "front" | "back" | "below" | "none") => {
                        plugin.settings.resizeCursorLocation = value;
                        await plugin.saveSettings();
                    });
            });

        // --- Enable in Reading Mode ---
        new Setting(settingsContentWrapper)
            .setName(t("SETTING_RESIZE_IN_READING_MODE"))
            .setDesc(t("SETTING_RESIZE_IN_READING_MODE_DESC"))
            .addToggle((toggle) =>
                toggle
                    .setValue(plugin.settings.interactiveResize.readingModeEnabled)
                    .onChange(async (value) => {
                        plugin.settings.interactiveResize.readingModeEnabled = value;
                        await plugin.saveSettings();
                    })
            );
    }
}
