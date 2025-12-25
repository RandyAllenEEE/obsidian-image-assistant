import { Setting, setIcon } from "obsidian";
import ImageConverterPlugin from "../../main";
import { t } from "../../lang/helpers";
import { PasteHandlingMode, PresetUIState } from "../types";

export function renderCloudSettingsSection(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    presetUIState: PresetUIState,
    refreshDisplay: () => void
): HTMLElement {
    // --- Paste Handling Settings Section ---
    const pasteHandlingSection = containerEl.createDiv("image-converter-settings-section");
    pasteHandlingSection.addClass("paste-handling-settings-section");

    // Add Section Header with Dropdown
    const header = new Setting(pasteHandlingSection)
        .setName(t("SETTING_PASTE_MODE_HEADER") || "Image Processing")
        .setHeading()
        .addDropdown(dropdown => dropdown
            .addOption("local", t("SETTING_PASTE_MODE_LOCAL"))
            .addOption("cloud", t("SETTING_PASTE_MODE_CLOUD"))
            .addOption("disabled", t("SETTING_PASTE_MODE_DISABLED"))
            .setValue(plugin.settings.pasteHandling.mode)
            .onChange(async (value: PasteHandlingMode) => {
                plugin.settings.pasteHandling.mode = value;
                await plugin.saveSettings();
                refreshDisplay(); // Re-render to show/hide cloud settings
            })
        );
    header.settingEl.addClass("settings-section-header");
    header.settingEl.style.cursor = "pointer";

    // Add Chevron Icon
    const chevronContainer = header.nameEl.createSpan("settings-chevron-container");
    chevronContainer.style.marginRight = "8px";
    const chevronIcon = chevronContainer.createDiv();
    // Prepend chevron
    header.nameEl.prepend(chevronContainer);

    // Content Wrapper
    const contentWrapper = pasteHandlingSection.createDiv("settings-section-content");

    // Function to update chevron state
    const updateChevron = () => {
        if (presetUIState.pasteHandlingSectionCollapsed) {
            setIcon(chevronIcon, "chevron-right");
            contentWrapper.style.display = "none";
        } else {
            setIcon(chevronIcon, "chevron-down");
            contentWrapper.style.display = "block";
        }
    };

    // Initial State
    updateChevron();

    // Click handler for collapse/expand
    header.settingEl.onclick = (e) => {
        // Prevent collapse when clicking the dropdown
        if ((e.target as HTMLElement).closest(".dropdown")) return;

        presetUIState.pasteHandlingSectionCollapsed = !presetUIState.pasteHandlingSectionCollapsed;
        updateChevron();
    };

    // --- Cloud Upload Settings (only show when cloud mode is selected) ---
    if (plugin.settings.pasteHandling.mode === "cloud") {
        const cloudSettingsContainer = contentWrapper.createDiv("cloud-settings-container");

        // Uploader Type
        new Setting(cloudSettingsContainer)
            .setName(t("SETTING_UPLOADER_NAME"))
            .setDesc(t("SETTING_UPLOADER_DESC"))
            .addDropdown(dropdown => dropdown
                .addOption("PicGo", "PicGo")
                .addOption("PicGo-Core", "PicGo-Core")
                .addOption("PicList", "PicList")
                .setValue(plugin.settings.pasteHandling.cloud.uploader)
                .onChange(async (value: string) => {
                    plugin.settings.pasteHandling.cloud.uploader = value;
                    await plugin.saveSettings();
                    refreshDisplay(); // Re-render to show/hide relevant settings
                })
            );

        // Show PicGo server settings for PicGo and PicList
        if (plugin.settings.pasteHandling.cloud.uploader === "PicGo" ||
            plugin.settings.pasteHandling.cloud.uploader === "PicList") {

            new Setting(cloudSettingsContainer)
                .setName(t("SETTING_UPLOAD_SERVER_NAME"))
                .setDesc(t("SETTING_UPLOAD_SERVER_DESC"))
                .addText(text => text
                    .setPlaceholder("http://127.0.0.1:36677/upload")
                    .setValue(plugin.settings.pasteHandling.cloud.uploadServer)
                    .onChange(async (value) => {
                        plugin.settings.pasteHandling.cloud.uploadServer = value;
                        await plugin.saveSettings();
                    })
                );

            if (plugin.settings.pasteHandling.cloud.uploader === "PicList") {
                new Setting(cloudSettingsContainer)
                    .setName(t("SETTING_DELETE_SERVER_NAME"))
                    .setDesc(t("SETTING_DELETE_SERVER_DESC"))
                    .addText(text => text
                        .setPlaceholder("http://127.0.0.1:36677/delete")
                        .setValue(plugin.settings.pasteHandling.cloud.deleteServer)
                        .onChange(async (value) => {
                            plugin.settings.pasteHandling.cloud.deleteServer = value;
                            await plugin.saveSettings();
                        })
                    );
            }
        }

        // Show PicGo-Core path for PicGo-Core
        if (plugin.settings.pasteHandling.cloud.uploader === "PicGo-Core") {
            new Setting(cloudSettingsContainer)
                .setName(t("SETTING_PICGO_CORE_PATH_NAME"))
                .setDesc(t("SETTING_PICGO_CORE_PATH_DESC"))
                .addText(text => text
                    .setPlaceholder("/path/to/picgo")
                    .setValue(plugin.settings.pasteHandling.cloud.picgoCorePath)
                    .onChange(async (value) => {
                        plugin.settings.pasteHandling.cloud.picgoCorePath = value;
                        await plugin.saveSettings();
                    })
                );
        }

        // --- Cloud Link Format Setting ---
        new Setting(cloudSettingsContainer)
            .setName(t("LABEL_CLOUD_LINK_FORMAT"))
            .setDesc(t("DESC_CLOUD_LINK_FORMAT"))
            .addDropdown(dropdown => dropdown
                .addOption("markdown", "Markdown (![alt](url))")
                .addOption("wikilink", "WikiLink (![[url]])")
                .setValue(plugin.settings.pasteHandling.cloud.cloudLinkFormat || "markdown")
                .onChange(async (value: "markdown" | "wikilink") => {
                    plugin.settings.pasteHandling.cloud.cloudLinkFormat = value;
                    await plugin.saveSettings();
                })
            );

        // Image Size Settings
        new Setting(cloudSettingsContainer)
            .setName(t("SETTING_IMG_SIZE_SOURCE_NAME"))
            .setDesc(t("SETTING_IMG_SIZE_SOURCE_DESC"))
            .setTooltip(t("SETTING_IMG_SIZE_SOURCE_TOOLTIP"))
            .addDropdown(dropdown => dropdown
                .addOption("settings", t("SETTING_IMG_SIZE_SETTINGS"))
                .addOption("actual", t("SETTING_IMG_SIZE_ACTUAL"))
                .setValue(plugin.settings.pasteHandling.cloud.imageSizeSource)
                .onChange(async (value: 'settings' | 'actual') => {
                    plugin.settings.pasteHandling.cloud.imageSizeSource = value;
                    await plugin.saveSettings();
                    refreshDisplay(); // Refresh to show/hide width/height inputs
                })
            );

        // Only show width/height inputs when using 'settings' mode
        if (plugin.settings.pasteHandling.cloud.imageSizeSource === 'settings') {
            new Setting(cloudSettingsContainer)
                .setName(t("SETTING_IMG_WIDTH"))
                .setDesc(t("SETTING_IMG_WIDTH_DESC"))
                .addText(text => text
                    .setPlaceholder("例如：800")
                    .setValue(plugin.settings.pasteHandling.cloud.imageSizeWidth?.toString() || "")
                    .onChange(async (value) => {
                        plugin.settings.pasteHandling.cloud.imageSizeWidth = value ? parseInt(value) : undefined;
                        await plugin.saveSettings();
                    })
                );

            new Setting(cloudSettingsContainer)
                .setName(t("SETTING_IMG_HEIGHT"))
                .setDesc(t("SETTING_IMG_HEIGHT_DESC"))
                .addText(text => text
                    .setPlaceholder("例如：600")
                    .setValue(plugin.settings.pasteHandling.cloud.imageSizeHeight?.toString() || "")
                    .onChange(async (value) => {
                        plugin.settings.pasteHandling.cloud.imageSizeHeight = value ? parseInt(value) : undefined;
                        await plugin.saveSettings();
                    })
                );
        }

        // Network Image Settings
        new Setting(cloudSettingsContainer)
            .setName(t("SETTING_WORK_ON_NETWORK"))
            .setDesc(t("SETTING_WORK_ON_NETWORK_DESC"))
            .addToggle(toggle => toggle
                .setValue(plugin.settings.pasteHandling.cloud.workOnNetWork)
                .onChange(async (value) => {
                    plugin.settings.pasteHandling.cloud.workOnNetWork = value;
                    await plugin.saveSettings();
                    refreshDisplay();
                })
            );

        if (plugin.settings.pasteHandling.cloud.workOnNetWork) {
            new Setting(cloudSettingsContainer)
                .setName(t("SETTING_NETWORK_BLACKLIST"))
                .setDesc(t("SETTING_NETWORK_BLACKLIST_DESC"))
                .addTextArea(text => text
                    .setPlaceholder("example.com, test.org")
                    .setValue(plugin.settings.pasteHandling.cloud.newWorkBlackDomains)
                    .onChange(async (value) => {
                        plugin.settings.pasteHandling.cloud.newWorkBlackDomains = value;
                        await plugin.saveSettings();
                    })
                );
        }

        // Apply Image Settings
        new Setting(cloudSettingsContainer)
            .setName(t("SETTING_APPLY_IMAGE"))
            .setDesc(t("SETTING_APPLY_IMAGE_DESC"))
            .addToggle(toggle => toggle
                .setValue(plugin.settings.pasteHandling.cloud.applyImage)
                .onChange(async (value) => {
                    plugin.settings.pasteHandling.cloud.applyImage = value;
                    await plugin.saveSettings();
                })
            );

        // Delete Source Settings
        new Setting(cloudSettingsContainer)
            .setName(t("SETTING_DELETE_SOURCE"))
            .setDesc(t("SETTING_DELETE_SOURCE_DESC"))
            .addToggle(toggle => toggle
                .setValue(plugin.settings.pasteHandling.cloud.deleteSource)
                .onChange(async (value) => {
                    plugin.settings.pasteHandling.cloud.deleteSource = value;
                    await plugin.saveSettings();
                })
            );

        // Upload Concurrency Settings
        new Setting(cloudSettingsContainer)
            .setName(t("SETTING_CONCURRENCY_NAME"))
            .setDesc(t("SETTING_CONCURRENCY_DESC"))
            .addSlider(slider => slider
                .setLimits(1, 10, 1)
                .setValue(plugin.settings.pasteHandling.cloud.uploadConcurrency)
                .setDynamicTooltip()
                .onChange(async (value) => {
                    plugin.settings.pasteHandling.cloud.uploadConcurrency = value;
                    await plugin.saveSettings();
                    // 更新并发队列
                    plugin.updateConcurrentQueue(value);
                })
            );
    }
    return contentWrapper;
}
