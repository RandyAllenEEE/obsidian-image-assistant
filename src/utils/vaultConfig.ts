import type { App } from "obsidian";

export function getVaultConfigString(app: App, key: string, defaultValue = ""): string {
    const value = getVaultConfigValue(app, key);
    return typeof value === "string" ? value : defaultValue;
}

export function getVaultConfigBoolean(app: App, key: string, defaultValue = false): boolean {
    const value = getVaultConfigValue(app, key);
    return typeof value === "boolean" ? value : defaultValue;
}

function getVaultConfigValue(app: App, key: string): unknown {
    try {
        return (app.vault as { getConfig?: (key: string) => unknown })?.getConfig?.(key);
    } catch (error) {
        console.warn(`[Image Assistant] Failed to read vault config "${key}"`, error);
        return undefined;
    }
}
