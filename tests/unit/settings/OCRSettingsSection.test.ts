import { describe, expect, it, vi } from "vitest";
import { renderOCRSettingsSection } from "../../../src/settings/OCRSettingsSection";
import { DEFAULT_SETTINGS } from "../../../src/settings/defaults";

describe("OCRSettingsSection", () => {
    it("hides providers and secrets when OCR is disabled", () => {
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.ocrSettings.enabled = false;
        const plugin = {
            app: {},
            settings,
            saveSettings: vi.fn(async () => undefined)
        } as any;
        const container = document.createElement("div");

        renderOCRSettingsSection(container, plugin, { ocrSectionCollapsed: false } as any, vi.fn());

        expect(container.textContent).not.toContain("LaTeX provider");
        expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    });

    it("exposes Pix2Tex and Texify Basic Auth through Secret Storage controls", async () => {
        const settings = structuredClone(DEFAULT_SETTINGS);
        settings.ocrSettings.pix2tex.passwordSecretId = "pix-password";
        settings.ocrSettings.texify.passwordSecretId = "tex-password";
        const plugin = {
            app: { secretStorage: { getSecret: vi.fn(), setSecret: vi.fn(), listSecrets: vi.fn(() => []) } },
            settings,
            saveSettings: vi.fn(async () => undefined)
        } as any;
        const container = document.createElement("div");

        renderOCRSettingsSection(
            container,
            plugin,
            { ocrSectionCollapsed: false } as any,
            vi.fn()
        );

        const usernames = container.querySelectorAll<HTMLElement>('[data-setting-name="Username"]');
        const passwords = container.querySelectorAll<HTMLElement>('[data-setting-name="Password"]');
        expect(usernames).toHaveLength(2);
        expect(passwords).toHaveLength(2);
        expect(Array.from(passwords).map(setting =>
            setting.querySelector<HTMLInputElement>('input[type="password"]')?.value
        )).toEqual(["pix-password", "tex-password"]);

        const pixUsername = usernames[0].querySelector<HTMLInputElement>("input")!;
        pixUsername.value = "pix-user";
        pixUsername.dispatchEvent(new Event("change"));
        const texPassword = passwords[1].querySelector<HTMLInputElement>("input")!;
        texPassword.value = "new-tex-secret-id";
        texPassword.dispatchEvent(new Event("change"));
        await Promise.resolve();

        expect(settings.ocrSettings.pix2tex.username).toBe("pix-user");
        expect(settings.ocrSettings.texify.passwordSecretId).toBe("new-tex-secret-id");
        expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
    });
});
