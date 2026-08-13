import { App, Modal, Setting, TFile } from "obsidian";
import { t } from "../../lang/helpers";

export type ExcalidrawTemplateSelection = TFile | null | undefined;

export function selectExcalidrawTemplate(
    app: App,
    templates: readonly TFile[]
): Promise<ExcalidrawTemplateSelection> {
    if (templates.length === 0) return Promise.resolve(null);
    return new Promise(resolve => new ExcalidrawTemplateModal(app, templates, resolve).open());
}

class ExcalidrawTemplateModal extends Modal {
    private selectedPath = "";
    private resolver: ((value: ExcalidrawTemplateSelection) => void) | null;

    constructor(
        app: App,
        private readonly templates: readonly TFile[],
        resolve: (value: ExcalidrawTemplateSelection) => void
    ) {
        super(app);
        this.resolver = resolve;
    }

    onOpen(): void {
        this.titleEl.setText(t("EXCALIDRAW_TEMPLATE_TITLE"));
        new Setting(this.contentEl)
            .setName(t("EXCALIDRAW_TEMPLATE_NAME"))
            .setDesc(t("EXCALIDRAW_TEMPLATE_DESC"))
            .addDropdown(dropdown => {
                dropdown.addOption("", t("EXCALIDRAW_TEMPLATE_BLANK"));
                for (const template of this.templates) {
                    dropdown.addOption(template.path, template.basename);
                }
                dropdown.onChange(value => {
                    this.selectedPath = value;
                });
            });
        new Setting(this.contentEl)
            .addButton(button => button
                .setButtonText(t("DRAWING_CONFIRM_CANCEL"))
                .onClick(() => this.finish(undefined)))
            .addButton(button => button
                .setButtonText(t("EXCALIDRAW_TEMPLATE_CREATE"))
                .setCta()
                .onClick(() => this.finish(
                    this.templates.find(file => file.path === this.selectedPath) ?? null
                )));
    }

    onClose(): void {
        this.resolver?.(undefined);
        this.resolver = null;
        this.contentEl.empty();
    }

    private finish(value: ExcalidrawTemplateSelection): void {
        const resolve = this.resolver;
        this.resolver = null;
        resolve?.(value);
        this.close();
    }
}
