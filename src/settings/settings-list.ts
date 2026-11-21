import * as obsidian from 'obsidian';

type NativeSettingGroup = new (container: HTMLElement) => {
    listEl?: HTMLElement;
    setHeading(name: string): void;
    addClass(...classes: string[]): void;
    addSetting(callback: (setting: obsidian.Setting) => void): void;
};

export function createSettingsList(container: HTMLElement, heading?: string): HTMLElement {
    const { SettingGroup } = obsidian as { SettingGroup?: NativeSettingGroup };
    if (typeof SettingGroup === 'function') {
        const group = new SettingGroup(container);
        group.addClass('assistant-settings-group');
        if (heading) group.setHeading(heading);
        let list = group.listEl;
        if (!list) {
            group.addSetting(setting => {
                list = setting.settingEl.parentElement as HTMLElement;
                setting.settingEl.remove();
            });
        }
        if (list) {
            list.addClass('assistant-settings-list');
            return list;
        }
    }

    const group = container.createDiv('assistant-settings-group');
    if (heading) group.createEl('h3', { text: heading, cls: 'assistant-settings-heading' });
    return group.createDiv('assistant-settings-list');
}
