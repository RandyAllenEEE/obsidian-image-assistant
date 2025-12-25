import { App, PluginSettingTab } from "obsidian";
import ImageConverterPlugin from "../main";
import { LinkFormatPreset } from "./LinkFormatSettings";
import { NonDestructiveResizePreset } from "./NonDestructiveResizeSettings";
import { renderOCRSettingsSection } from "./OCRSettingsSection";

export type { LinkFormatPreset, NonDestructiveResizePreset };

// --- Typedefs and Interfaces ---
import { PresetUIState, ActivePresetSetting } from "./types";

// --- Settings Tab Class ---

import { renderLocalPresetsSection } from "./sections/LocalPresetsSection";
import { renderCloudSettingsSection } from "./sections/CloudSettingsSection";
import { renderAlignmentSettingsSection } from "./sections/AlignmentSettingsSection";
import { renderInteractiveResizeSettingsSection } from "./sections/InteractiveResizeSettingsSection";
import { renderCaptionSettingsSection } from "./sections/CaptionSettingsSection";
import { renderCleanerSettingsSection } from "./sections/CleanerSettingsSection";
import { renderOtherSettingsSection } from "./sections/OtherSettingsSection";

export class ImageConverterSettingTab extends PluginSettingTab {
    activeTab: "folder" | "filename" | "conversion" | "linkformat" | "resize" = "folder";
    presetUIState: PresetUIState;
    editingPresetKey: ActivePresetSetting | string | null = null;
    formContainer: HTMLElement;

    constructor(app: App, private plugin: ImageConverterPlugin) {
        super(app, plugin);
        this.presetUIState = {
            folder: { editingPreset: null, newPreset: null },
            filename: { editingPreset: null, newPreset: null },
            conversion: { editingPreset: null, newPreset: null },
            linkformat: { editingPreset: null, newPreset: null },
            globalPresetVisible: true,
            resize: { editingPreset: null, newPreset: null },
            pasteHandlingSectionCollapsed: false,
            imageAlignmentSectionCollapsed: true,
            imageDragResizeSectionCollapsed: true,
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
        const pasteHandlingContent = renderCloudSettingsSection(containerEl, this.plugin, this.presetUIState, () => this.display());

        // --- Local Presets (if local mode) ---
        renderLocalPresetsSection({
            app: this.app,
            plugin: this.plugin,
            containerEl: pasteHandlingContent, // Render into the content wrapper so it collapses with the section
            presetUIState: this.presetUIState,
            refreshDisplay: () => this.display(),
            getFormContainer: () => this.formContainer,
            setFormContainer: (el: HTMLElement) => { this.formContainer = el; },
            getEditingPresetKey: () => this.editingPresetKey,
            setEditingPresetKey: (key) => { this.editingPresetKey = key; },
            activeTab: this.activeTab,
            setActiveTab: (tab) => { this.activeTab = tab; }
        });

        // --- Image Alignment ---
        renderAlignmentSettingsSection(containerEl, this.plugin, this.presetUIState, () => this.display());

        // --- Interactive Resize ---
        renderInteractiveResizeSettingsSection(containerEl, this.plugin, this.presetUIState, () => this.display());

        // --- Image Captions ---
        renderCaptionSettingsSection(containerEl, this.plugin, this.presetUIState, () => this.display());

        // --- Unused File Cleaner ---
        renderCleanerSettingsSection(containerEl, this.plugin, this.presetUIState);

        // --- OCR & LaTeX ---
        // --- OCR & LaTeX ---
        renderOCRSettingsSection(containerEl, this.plugin, this.presetUIState, () => this.display());

        // --- Interaction / Other ---
        renderOtherSettingsSection(containerEl, this.plugin, this.presetUIState);
    }
























    onClose() {
        // Reset the form state when settings are closed
        if (this.formContainer) {
            this.formContainer.removeClass("visible"); // Hide the form
            this.formContainer.empty(); // Clear any form content
        }

        // Reset UI state
        this.editingPresetKey = null;
        this.presetUIState = {
            folder: { editingPreset: null, newPreset: null },
            filename: { editingPreset: null, newPreset: null },
            conversion: { editingPreset: null, newPreset: null },
            linkformat: { editingPreset: null, newPreset: null },
            resize: { editingPreset: null, newPreset: null },
            globalPresetVisible: true,
            pasteHandlingSectionCollapsed: false,
            imageAlignmentSectionCollapsed: false,
            imageDragResizeSectionCollapsed: false,
            imageCaptionSectionCollapsed: false,
            cleanerSectionCollapsed: false,
            ocrSectionCollapsed: true,
            otherSectionCollapsed: false
        };
    }
}


