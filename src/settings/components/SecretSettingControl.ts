import * as obsidian from "obsidian";
import { Setting } from "obsidian";

interface SecretInputComponent {
    setValue(value: string): void;
    onChange(callback: (value: string) => void | Promise<void>): void;
}

type SecretInputComponentConstructor = new (
    app: obsidian.App,
    containerEl: HTMLElement
) => SecretInputComponent;

type ObsidianWithSecrets = typeof obsidian & {
    SecretComponent?: SecretInputComponentConstructor;
};

export function addSecretSettingControl(
    setting: Setting,
    app: obsidian.App,
    secretId: string,
    onChange: (secretId: string) => void | Promise<void>,
    placeholder: string
): void {
    const SecretComponent = (obsidian as ObsidianWithSecrets).SecretComponent;
    const hasSecretStorage = Boolean((app as obsidian.App & { secretStorage?: unknown }).secretStorage);
    if (hasSecretStorage && SecretComponent) {
        const component = new SecretComponent(app, setting.controlEl);
        component.setValue(secretId);
        component.onChange(onChange);
        return;
    }
    if (!hasSecretStorage) {
        setting.descEl.createDiv({ text: "Secret Storage is unavailable." });
        return;
    }
    setting.addText(text => {
        text.setPlaceholder(placeholder)
            .setValue(secretId)
            .onChange(onChange);
        text.inputEl.type = "password";
    });
}
