import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";
import { renderLocalProcessingSection } from "../../../src/settings/sections/LocalProcessingSection";

type Tab = "folder" | "filename" | "conversion" | "linkformat" | "resize";

function makePlugin() {
    return {
        app: {},
        settings: structuredClone(DEFAULT_SETTINGS),
        saveSettings: vi.fn().mockResolvedValue(undefined),
        imageProcessor: { detectAvifEncoder: vi.fn().mockResolvedValue("libaom-av1") }
    } as any;
}

function render(plugin: any, activeTab: Tab): HTMLElement {
    const container = document.createElement("div");
    renderLocalProcessingSection({
        plugin,
        containerEl: container,
        refreshDisplay: vi.fn(),
        activeTab,
        setActiveTab: vi.fn()
    });
    return container;
}

async function exerciseControls(container: HTMLElement): Promise<void> {
    for (const select of container.querySelectorAll<HTMLSelectElement>("select")) {
        if (select.options.length > 1) select.selectedIndex = (select.selectedIndex + 1) % select.options.length;
        select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    for (const input of container.querySelectorAll<HTMLInputElement>('input[type="text"]')) {
        input.value = input.value === "42" ? "43" : "42";
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    for (const input of container.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
        input.value = input.min || "1";
        input.dispatchEvent(new Event("input", { bubbles: true }));
    }
    for (const input of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) {
        input.checked = !input.checked;
        input.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await Promise.resolve();
    await Promise.resolve();
}

describe("LocalProcessingSection", () => {
    it("does not render outside local paste mode", () => {
        const plugin = makePlugin();
        plugin.settings.pasteHandling.mode = "cloud";

        expect(render(plugin, "folder").children).toHaveLength(0);
    });

    it("renders all tabs and routes tab clicks through the context", () => {
        const plugin = makePlugin();
        const container = document.createElement("div");
        const setActiveTab = vi.fn();
        const refreshDisplay = vi.fn();
        renderLocalProcessingSection({
            plugin,
            containerEl: container,
            refreshDisplay,
            activeTab: "folder",
            setActiveTab
        });

        const tabs = container.querySelectorAll<HTMLElement>(".image-converter-tab");
        expect(tabs).toHaveLength(5);
        tabs[2].click();
        expect(setActiveTab).toHaveBeenCalledWith("conversion");
        expect(refreshDisplay).toHaveBeenCalledOnce();
    });

    it("renders and updates folder and filename settings", async () => {
        const plugin = makePlugin();
        for (const destinationType of ["DEFAULT", "SUBFOLDER", "CUSTOM"] as const) {
            plugin.settings.localProcessing.destination.type = destinationType;
            await exerciseControls(render(plugin, "folder"));
        }
        await exerciseControls(render(plugin, "filename"));

        expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it("renders conversion controls for every supported conditional format", async () => {
        const plugin = makePlugin();
        const conversion = plugin.settings.localProcessing.conversion;
        const cases = [
            ["WEBP", "Fit"],
            ["PNG", "Fill"],
            ["PNGQUANT", "LongestEdge"],
            ["AVIF", "ShortestEdge"],
            ["ORIGINAL", "Width"]
        ] as const;

        for (const [format, resizeMode] of cases) {
            conversion.outputFormat = format;
            conversion.resizeMode = resizeMode;
            if (format === "AVIF") {
                plugin.settings.localProcessing.externalTools.ffmpegExecutablePath = "ffmpeg";
                plugin.settings.localProcessing.externalTools.ffmpegDetectedEncoder = "libsvtav1";
                plugin.settings.localProcessing.externalTools.ffmpegDetectedEncoderPath = "ffmpeg";
            }
            const container = render(plugin, "conversion");
            expect(container.querySelector("select")).toBeTruthy();
            await exerciseControls(container);
        }
    });

    it("renders link and every conditional embed-resize layout", async () => {
        const plugin = makePlugin();
        await exerciseControls(render(plugin, "linkformat"));

        for (const dimension of ["none", "both", "longest-edge", "shortest-edge"] as const) {
            plugin.settings.localProcessing.embedResize.resizeDimension = dimension;
            await exerciseControls(render(plugin, "resize"));
        }

        expect(plugin.saveSettings).toHaveBeenCalled();
    });

    it("shows the current-directory prefix only for relative paths and preserves its value", async () => {
        const plugin = makePlugin();
        plugin.settings.localProcessing.link.pathFormat = "shortest";
        plugin.settings.localProcessing.link.prependCurrentDir = true;
        const refreshDisplay = vi.fn();
        const renderLinkSettings = () => {
            const container = document.createElement("div");
            renderLocalProcessingSection({
                plugin,
                containerEl: container,
                refreshDisplay,
                activeTab: "linkformat",
                setActiveTab: vi.fn()
            });
            return container;
        };
        const findPathSelect = (container: HTMLElement) => Array.from(
            container.querySelectorAll<HTMLSelectElement>("select")
        ).find(select => Array.from(select.options).some(option => option.value === "absolute"))!;

        let container = renderLinkSettings();
        expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);

        const pathSelect = findPathSelect(container);
        pathSelect.value = "relative";
        pathSelect.dispatchEvent(new Event("change", { bubbles: true }));
        await vi.waitFor(() => expect(refreshDisplay).toHaveBeenCalledOnce());
        expect(plugin.settings.localProcessing.link.pathFormat).toBe("relative");
        expect(plugin.saveSettings).toHaveBeenCalled();

        container = renderLinkSettings();
        const prefixToggle = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
        expect(prefixToggle?.checked).toBe(true);
        expect(container.textContent).toContain("./");
        expect(container.textContent).toContain("../");

        const absoluteSelect = findPathSelect(container);
        absoluteSelect.value = "absolute";
        absoluteSelect.dispatchEvent(new Event("change", { bubbles: true }));
        await vi.waitFor(() => expect(refreshDisplay).toHaveBeenCalledTimes(2));
        expect(plugin.settings.localProcessing.link.prependCurrentDir).toBe(true);
        expect(renderLinkSettings().querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    });
});
