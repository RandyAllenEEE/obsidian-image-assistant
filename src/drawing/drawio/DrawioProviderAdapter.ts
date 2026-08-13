import type { TFile } from "obsidian";
import type ImageConverterPlugin from "../../main";
import { DrawioEmbedPort } from "./DrawioEmbedPort";
import { isDrawioDiagramPath } from "./DiagramFile";
import type { DiagramEditorPort, DrawioEditorProviderAdapter } from "./DrawioTypes";
import type { DrawioEmbedAppearance } from "./DrawioEmbedUrl";

export class DrawioProviderAdapter implements DrawioEditorProviderAdapter {
    readonly id = "drawio" as const;

    constructor(private readonly plugin: ImageConverterPlugin) { }

    supports(file: TFile): boolean {
        return isDrawioDiagramPath(file.path);
    }

    createEditor(ownerDocument?: Document): DiagramEditorPort {
        const settings = this.plugin.settings.drawing.drawio;
        return new DrawioEmbedPort(settings.embedUrl, this.getAppearance(ownerDocument));
    }

    getAppearance(ownerDocument?: Document): DrawioEmbedAppearance {
        const settings = this.plugin.settings.drawing.drawio;
        return {
            theme: settings.theme,
            dark: settings.theme === "dark"
                || (settings.followObsidianTheme && isObsidianDark(ownerDocument))
        };
    }

    getAppearanceKey(ownerDocument?: Document): string {
        const appearance = this.getAppearance(ownerDocument);
        return `${appearance.theme}:${appearance.dark ? "dark" : "light"}`;
    }
}

function isObsidianDark(ownerDocument?: Document): boolean {
    const documentToCheck = ownerDocument ?? document;
    return documentToCheck.body.classList.contains("theme-dark")
        || documentToCheck.documentElement.classList.contains("theme-dark");
}
