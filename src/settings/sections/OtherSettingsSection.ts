import { Setting, setIcon } from "obsidian";
import ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { SettingsUIState } from "../types";

export function renderOtherSettingsSection(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    settingsUIState: SettingsUIState,
    refreshDisplay: () => void
): void {
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
        if (settingsUIState.otherSectionCollapsed) {
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
        settingsUIState.otherSectionCollapsed = !settingsUIState.otherSectionCollapsed;
        updateChevron();
    };

    new Setting(settingsContentWrapper)
        .setName(t("SETTING_ENABLE_CONTEXT_MENU_NAME"))
        .setDesc(t("SETTING_ENABLE_CONTEXT_MENU_DESC"))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.global.enableContextMenu)
            .onChange(async (value) => {
                plugin.setContextMenuEnabled(value);
                await plugin.saveSettings();
                refreshDisplay();
            })
        );

    // Rendered callouts and Admonition blocks are always indexed; this toggle
    // controls only source-only fenced code blocks.
    new Setting(settingsContentWrapper)
        .setName(t("SETTING_CODE_BLOCK_IMAGE_LINK_INDEXING_NAME"))
        .setDesc(t("SETTING_CODE_BLOCK_IMAGE_LINK_INDEXING_DESC"))
        .addToggle(toggle => toggle
            .setValue(plugin.settings.global.codeBlockImageLinkIndexing)
            .onChange(async (value) => {
                plugin.settings.global.codeBlockImageLinkIndexing = value;
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
        .setName(t("SETTING_CONCURRENCY_NAME"))
        .setDesc(t("SETTING_CONCURRENCY_DESC"))
        .addSlider(slider => slider
            .setLimits(1, 10, 1)
            .setValue(plugin.settings.global.batchConcurrency)
            .setDynamicTooltip()
            .onChange(async value => {
                plugin.settings.global.batchConcurrency = value;
                plugin.updateConcurrentQueue(value);
                await plugin.saveSettings();
            })
        );

    new Setting(settingsContentWrapper)
        .setName(t("SETTING_REVERT_IF_LARGER_NAME"))
        .setDesc(t("SETTING_REVERT_IF_LARGER_DESC"))
        .addToggle(toggle => toggle
            .setValue(!plugin.settings.localProcessing.conversion.allowLargerFiles)
            .onChange(async (value) => {
                plugin.settings.localProcessing.conversion.allowLargerFiles = !value;
                await plugin.saveSettings();
            })
        );
}
