import { App, PluginSettingTab } from "obsidian";
import ImageConverterPlugin from "../main";
import { renderOCRSettingsSection } from "./OCRSettingsSection";

import { SettingsUIState } from "./types";
import { renderLocalProcessingSection } from "./sections/LocalProcessingSection";
import { renderCloudSettingsSection } from "./sections/CloudSettingsSection";
import { renderAlignmentSettingsSection } from "./sections/AlignmentSettingsSection";
import { renderCaptionSettingsSection } from "./sections/CaptionSettingsSection";
import { renderCleanerSettingsSection } from "./sections/CleanerSettingsSection";
import { renderOtherSettingsSection } from "./sections/OtherSettingsSection";
import { renderDrawingSettingsSection } from "./sections/DrawingSettingsSection";

export class ImageConverterSettingTab extends PluginSettingTab {
    activeTab: "folder" | "filename" | "conversion" | "linkformat" | "resize" = "folder";
    settingsUIState: SettingsUIState;

    constructor(app: App, private plugin: ImageConverterPlugin) {
        super(app, plugin);
        this.settingsUIState = {
            pasteHandlingSectionCollapsed: false,
            drawingSectionCollapsed: false,
            nextAiSectionCollapsed: false,
            imageAlignmentSectionCollapsed: true,
            imageCaptionSectionCollapsed: true,
            cleanerSectionCollapsed: false,
            ocrSectionCollapsed: true,
            otherSectionCollapsed: false
        };
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.addClass("image-assistant-settings-tab");

        // --- Paste Handling / Cloud Settings ---
        const pasteHandlingContent = renderCloudSettingsSection(containerEl, this.plugin, this.settingsUIState, () => this.display());

        // --- Local processing settings (if local mode) ---
        renderLocalProcessingSection({
            plugin: this.plugin,
            containerEl: pasteHandlingContent, // Render into the content wrapper so it collapses with the section
            refreshDisplay: () => this.display(),
            activeTab: this.activeTab,
            setActiveTab: (tab) => { this.activeTab = tab; }
        });

        // --- Drawing ---
        renderDrawingSettingsSection(containerEl, this.plugin, this.settingsUIState, () => this.display());

        // --- Image Alignment ---
        renderAlignmentSettingsSection(containerEl, this.plugin, this.settingsUIState, () => this.display());

        // --- Image Captions ---
        renderCaptionSettingsSection(containerEl, this.plugin, this.settingsUIState, () => this.display());

        // --- Unused File Cleaner ---
        renderCleanerSettingsSection(containerEl, this.plugin, this.settingsUIState, () => this.display());

        // --- OCR & LaTeX ---
        renderOCRSettingsSection(containerEl, this.plugin, this.settingsUIState, () => this.display());

        // --- Interaction / Other ---
        renderOtherSettingsSection(
            containerEl,
            this.plugin,
            this.settingsUIState,
            () => this.display()
        );
    }
























    onClose() {
        // Reset UI state
        this.settingsUIState = {
            pasteHandlingSectionCollapsed: false,
            drawingSectionCollapsed: false,
            nextAiSectionCollapsed: false,
            imageAlignmentSectionCollapsed: false,
            imageCaptionSectionCollapsed: false,
            cleanerSectionCollapsed: false,
            ocrSectionCollapsed: true,
            otherSectionCollapsed: false
        };
    }
}


