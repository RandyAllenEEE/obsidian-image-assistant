import { App, TFile, TFolder } from "obsidian";

export function buildAllowedPathSet(
    scope: "note" | "folder" | "vault",
    target: TFile | TFolder | null,
    app: App
): Set<string> {
    const pathSet = new Set<string>();

    if (scope === "note" && target instanceof TFile) {
        pathSet.add(target.path);
    } else if (scope === "folder" && target instanceof TFolder) {
        const collect = (folder: TFolder) => {
            for (const child of folder.children) {
                if (child instanceof TFile) pathSet.add(child.path);
                else if (child instanceof TFolder) collect(child);
            }
        };
        collect(target);
    } else {
        for (const file of app.vault.getFiles()) {
            if (file.extension === "md" || file.extension === "canvas") {
                pathSet.add(file.path);
            }
        }
    }

    return pathSet;
}
