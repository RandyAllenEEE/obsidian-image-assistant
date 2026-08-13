import { renderDrawingSettingsSection } from "../../../src/settings/sections/DrawingSettingsSection";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";
import type { SettingsUIState } from "../../../src/settings/types";

describe("DrawingSettingsSection", () => {
    it("uses a provider dropdown and leaves drawing details hidden while disabled", async () => {
        const fixture = makeFixture();
        renderDrawingSettingsSection(fixture.container, fixture.plugin, fixture.state, fixture.refresh);

        expect(fixture.container.querySelectorAll("select")).toHaveLength(1);
        expect(fixture.container.textContent).not.toContain("Draw.io embed URL");
        const provider = fixture.container.querySelector("select")!;
        provider.value = "drawio";
        provider.dispatchEvent(new Event("change", { bubbles: true }));
        await Promise.resolve();

        expect(fixture.plugin.settings.drawing.provider).toBe("drawio");
        expect(fixture.refresh).toHaveBeenCalledOnce();
    });

    it("nests a live Next AI master toggle without collapsing on control clicks", async () => {
        const fixture = makeFixture();
        fixture.plugin.settings.drawing.provider = "drawio";
        renderDrawingSettingsSection(fixture.container, fixture.plugin, fixture.state, fixture.refresh);

        expect(fixture.container.textContent).toContain("Draw.io embed URL");
        expect(fixture.container.textContent).toContain("Next AI Draw.io");
        expect(fixture.container.textContent).not.toContain("OpenAI-compatible base URL");
        const toggle = fixture.container.querySelector<HTMLInputElement>(
            '.image-assistant-next-ai-settings-section input[type="checkbox"]'
        )!;
        toggle.checked = true;
        toggle.dispatchEvent(new Event("change", { bubbles: true }));
        await Promise.resolve();

        expect(fixture.plugin.settings.drawing.drawio.nextAi.enabled).toBe(true);
        expect(fixture.state.nextAiSectionCollapsed).toBe(false);
        expect(fixture.plugin.drawingModule.refreshNextAi).toHaveBeenCalledOnce();
    });

    it("does not redraw disabled settings until managed Draw.io views finish preparing", async () => {
        const fixture = makeFixture();
        fixture.plugin.settings.drawing.provider = "drawio";
        let finishDisable!: () => void;
        fixture.plugin.drawingModule.disable.mockReturnValue(
            new Promise<void>(resolve => { finishDisable = resolve; })
        );
        renderDrawingSettingsSection(fixture.container, fixture.plugin, fixture.state, fixture.refresh);
        const provider = fixture.container.querySelector("select")!;

        provider.value = "disabled";
        provider.dispatchEvent(new Event("change", { bubbles: true }));
        await vi.waitFor(() => expect(fixture.plugin.drawingModule.disable).toHaveBeenCalledOnce());
        expect(fixture.refresh).not.toHaveBeenCalled();

        finishDisable();
        await vi.waitFor(() => expect(fixture.refresh).toHaveBeenCalledOnce());
    });

    it("renders Secret Storage and connection controls only inside enabled Next AI", () => {
        const fixture = makeFixture();
        fixture.plugin.settings.drawing.provider = "drawio";
        fixture.plugin.settings.drawing.drawio.nextAi.enabled = true;
        renderDrawingSettingsSection(fixture.container, fixture.plugin, fixture.state, fixture.refresh);

        expect(fixture.container.textContent).toContain("OpenAI-compatible base URL");
        expect(fixture.container.textContent).toContain("Test configuration");
        expect(fixture.container.querySelectorAll('input[type="password"]')).toHaveLength(2);
        const options = Array.from(fixture.container.querySelectorAll("option"))
            .map(option => option.textContent);
        expect(options).toEqual(expect.arrayContaining([
            "Disabled",
            "Configured user model (recommended)",
            "Next AI server"
        ]));
    });

    it("renders the external Excalidraw capability status and embed ownership setting", async () => {
        const fixture = makeFixture();
        fixture.plugin.settings.drawing.provider = "excalidraw";
        renderDrawingSettingsSection(fixture.container, fixture.plugin, fixture.state, fixture.refresh);

        expect(fixture.container.textContent).toContain("External Excalidraw plugin");
        expect(fixture.container.textContent).toContain("Create: available");
        expect(fixture.container.textContent).toContain("Use Image Assistant file management");
        expect(fixture.container.textContent).toContain("SVG preview requires both the editable");
        const managementToggle = fixture.container.querySelector<HTMLInputElement>(
            'input[type="checkbox"]'
        )!;
        expect(managementToggle.checked).toBe(true);
        managementToggle.checked = false;
        managementToggle.dispatchEvent(new Event("change", { bubbles: true }));
        await Promise.resolve();
        expect(fixture.plugin.settings.drawing.excalidraw.manageCreatedFileLocation)
            .toBe(false);
        const embedSelect = Array.from(fixture.container.querySelectorAll("select"))
            .find(select => Array.from(select.options).some(option => option.value === "auto-export-preview"))!;
        embedSelect.value = "auto-export-preview";
        embedSelect.dispatchEvent(new Event("change", { bubbles: true }));
        await Promise.resolve();

        expect(fixture.plugin.settings.drawing.excalidraw.embedMode).toBe("auto-export-preview");
        expect(fixture.plugin.saveSettings).toHaveBeenCalledTimes(2);
    });
});

function makeFixture() {
    const settings = structuredClone(DEFAULT_SETTINGS);
    const plugin = {
        app: {
            secretStorage: {
                getSecret: vi.fn(),
                setSecret: vi.fn(),
                listSecrets: vi.fn(() => [])
            }
        },
        settings,
        saveSettings: vi.fn(async () => undefined),
        drawingModule: {
            disable: vi.fn(async () => undefined),
            testDrawioConnection: vi.fn(async () => undefined),
            testNextAiConnection: vi.fn(async () => undefined),
            refreshNextAi: vi.fn(),
            refreshAppearance: vi.fn(async () => undefined),
            notifyEmbedUrlChanged: vi.fn(),
            getExcalidrawCapabilities: vi.fn(() => ({
                available: true,
                canRecognize: true,
                canCreate: true,
                canListTemplates: true,
                canCreateSvgPreview: true,
                reason: "ready"
            }))
        }
    } as any;
    const state: SettingsUIState = {
        pasteHandlingSectionCollapsed: false,
        imageAlignmentSectionCollapsed: false,
        imageCaptionSectionCollapsed: false,
        cleanerSectionCollapsed: false,
        ocrSectionCollapsed: false,
        drawingSectionCollapsed: false,
        nextAiSectionCollapsed: false,
        otherSectionCollapsed: false
    };
    return {
        plugin,
        state,
        container: document.createElement("div"),
        refresh: vi.fn()
    };
}
