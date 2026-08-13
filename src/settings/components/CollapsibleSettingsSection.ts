import { Setting, setIcon } from "obsidian";

export interface CollapsibleSettingsSectionOptions {
    readonly title: string;
    readonly sectionClass?: string;
    readonly isCollapsed: () => boolean;
    readonly setCollapsed: (collapsed: boolean) => void;
    readonly ignoreSelectors?: readonly string[];
}

export interface CollapsibleSettingsSection {
    readonly sectionEl: HTMLDivElement;
    readonly header: Setting;
    readonly contentEl: HTMLDivElement;
    update(): void;
}

/** Shared visual shell for the settings sections that opt into collapse behavior. */
export function createCollapsibleSettingsSection(
    containerEl: HTMLElement,
    options: CollapsibleSettingsSectionOptions
): CollapsibleSettingsSection {
    const sectionEl = containerEl.createDiv("image-converter-settings-section");
    if (options.sectionClass) sectionEl.addClass(options.sectionClass);

    const header = new Setting(sectionEl)
        .setName(options.title)
        .setHeading();
    header.settingEl.addClass("settings-section-header");
    header.settingEl.style.cursor = "pointer";

    const chevronContainer = header.nameEl.createSpan("settings-chevron-container");
    chevronContainer.style.marginRight = "8px";
    const chevronIcon = chevronContainer.createDiv();
    header.nameEl.prepend(chevronContainer);

    const contentEl = sectionEl.createDiv("settings-section-content");
    const update = (): void => {
        const collapsed = options.isCollapsed();
        setIcon(chevronIcon, collapsed ? "chevron-right" : "chevron-down");
        contentEl.style.display = collapsed ? "none" : "block";
    };
    const ignored = options.ignoreSelectors ?? [
        ".dropdown",
        ".checkbox-container",
        "button",
        "input",
        "textarea",
        "select",
        "a"
    ];
    header.settingEl.addEventListener("click", event => {
        const target = event.target;
        if (target instanceof Element && ignored.some(selector => target.closest(selector))) {
            return;
        }
        options.setCollapsed(!options.isCollapsed());
        update();
    });
    update();

    return { sectionEl, header, contentEl, update };
}
