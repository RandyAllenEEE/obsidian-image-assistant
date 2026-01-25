import { Setting, setIcon } from "obsidian";
import { BatchTask } from "../../../../types/BatchTypes";
import { t } from "../../../../lang/helpers";

export class TaskRenderer {
    private listScrollContainer: HTMLElement;

    constructor() { }

    public render(container: HTMLElement, tasks: BatchTask[]): void {
        container.empty();

        if (tasks.length === 0) {
            container.createDiv({ cls: "batch-empty", text: t("BATCH_NO_ITEMS") });
            return;
        }

        const listHeader = container.createDiv("batch-list-header");
        let masterToggle: any = null;

        new Setting(listHeader)
            .setName(t("BATCH_ITEMS_FOUND").replace("{0}", tasks.length.toString()))
            .addToggle(toggle => {
                masterToggle = toggle;
                toggle
                    .setValue(tasks.every(t => t.selected))
                    .setTooltip(t("BATCH_SELECT_ALL_NONE"))
                    .onChange(val => {
                        tasks.forEach(t => t.selected = val);
                        this.renderListItems(tasks, masterToggle);
                    });
            });

        const listScroll = container.createDiv("batch-list-scroll");
        this.listScrollContainer = listScroll;
        this.renderListItems(tasks, masterToggle);
    }

    private renderListItems(tasks: BatchTask[], masterToggle?: any) {
        this.listScrollContainer.empty();
        tasks.forEach(task => {
            const item = this.listScrollContainer.createDiv("batch-task-item");

            const checkbox = item.createEl("input", { type: "checkbox" });
            checkbox.checked = task.selected;
            checkbox.onclick = () => {
                task.selected = checkbox.checked;
                // Sync master toggle
                if (masterToggle) {
                    const allSelected = tasks.every(t => t.selected);
                    masterToggle.setValue(allSelected);
                }
            };

            const labelInfo = item.createDiv("batch-item-info");
            labelInfo.createDiv({ text: task.name, cls: "batch-item-name" });
            labelInfo.createDiv({ text: task.path, cls: "batch-item-path" });

            if (task.message) {
                labelInfo.createDiv({ text: task.message, cls: "batch-item-message" }); // e.g. "Found in Note A"
            }

            // Optional: Icon based on status?
            // if (task.status === 'success') setIcon(item, "check");
        });
    }
}
