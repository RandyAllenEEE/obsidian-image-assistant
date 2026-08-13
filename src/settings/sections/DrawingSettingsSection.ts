import type ImageConverterPlugin from "../../main";
import { renderDrawioSettingsSection } from "../../drawing/drawio/DrawioSettingsSection";
import { renderExcalidrawSettingsSection } from "../../drawing/excalidraw/ExcalidrawSettingsSection";
import { t } from "../../lang/helpers";
import { createCollapsibleSettingsSection } from "../components/CollapsibleSettingsSection";
import type { DrawingProvider, SettingsUIState } from "../types";

export function renderDrawingSettingsSection(
    containerEl: HTMLElement,
    plugin: ImageConverterPlugin,
    state: SettingsUIState,
    refreshDisplay: () => void
): void {
    const { header, contentEl } = createCollapsibleSettingsSection(containerEl, {
        title: t("SETTING_DRAWING_SECTION"),
        sectionClass: "image-assistant-drawing-settings-section",
        isCollapsed: () => state.drawingSectionCollapsed,
        setCollapsed: collapsed => {
            state.drawingSectionCollapsed = collapsed;
        }
    });
    header.addDropdown(dropdown => dropdown
        .addOption("disabled", t("SETTING_DRAWING_DISABLED"))
        .addOption("drawio", t("SETTING_DRAWING_DRAWIO"))
        .addOption("excalidraw", t("SETTING_DRAWING_EXCALIDRAW"))
        .setValue(plugin.settings.drawing.provider)
        .onChange(async (value: DrawingProvider) => {
            plugin.settings.drawing.provider = value;
            await plugin.saveSettings();
            if (value === "disabled") await plugin.drawingModule.disable();
            refreshDisplay();
        }));

    if (plugin.settings.drawing.provider === "drawio") {
        renderDrawioSettingsSection(contentEl, plugin, state, refreshDisplay);
    } else if (plugin.settings.drawing.provider === "excalidraw") {
        renderExcalidrawSettingsSection(contentEl, plugin, refreshDisplay);
    }
}
