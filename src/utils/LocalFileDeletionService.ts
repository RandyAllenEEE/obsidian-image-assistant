import { App, TFile, TFolder, normalizePath } from "obsidian";
import { t } from "../lang/helpers";
import { normalizeVaultFolderPath } from "./VaultPathUtils";

export type LocalFileDeletionMode =
    | "follow-obsidian"
    | "system"
    | "obsidian"
    | "custom";

export interface LocalFileDeletionSettings {
    readonly trashMode: LocalFileDeletionMode;
    readonly customTrashPath: string;
}

export type LocalFileDeletionDisposition =
    | "obsidian-preference"
    | "system-trash"
    | "obsidian-trash"
    | "custom-folder";

export interface LocalFileDeletionResult {
    readonly disposition: LocalFileDeletionDisposition;
    readonly destinationPath?: string;
}

export function describeLocalFileDeletion(
    settings: LocalFileDeletionSettings
): string {
    switch (settings.trashMode) {
        case "follow-obsidian":
            return t("CLEANER_DELETE_MODE_FOLLOW_OBSIDIAN");
        case "system":
            return t("CLEANER_DELETE_MODE_SYSTEM");
        case "obsidian":
            return t("CLEANER_DELETE_MODE_OBSIDIAN");
        case "custom":
            return t("CLEANER_DELETE_MODE_CUSTOM", [
                settings.customTrashPath
            ]);
    }
}

/**
 * Applies the configured destination after a caller has completed its own
 * reference and revision safety checks.
 */
export class LocalFileDeletionService {
    constructor(
        private readonly app: App,
        private readonly settingsProvider: () => LocalFileDeletionSettings
    ) { }

    async delete(file: TFile): Promise<LocalFileDeletionResult> {
        const settings = this.settingsProvider();
        switch (settings.trashMode) {
            case "follow-obsidian":
                await this.app.fileManager.trashFile(file);
                return { disposition: "obsidian-preference" };
            case "system":
                await this.app.vault.trash(file, true);
                return { disposition: "system-trash" };
            case "obsidian":
                await this.app.vault.trash(file, false);
                return { disposition: "obsidian-trash" };
            case "custom": {
                const destinationPath = await this.moveToCustomTrash(
                    file,
                    settings.customTrashPath
                );
                return {
                    disposition: "custom-folder",
                    destinationPath
                };
            }
        }
    }

    private async moveToCustomTrash(
        file: TFile,
        customTrashPath: string
    ): Promise<string> {
        const normalizedTrashPath = normalizeVaultFolderPath(customTrashPath);
        if (!normalizedTrashPath || normalizedTrashPath === "/") {
            throw new Error("Custom trash path must be a non-root vault folder");
        }
        if (file.path === normalizedTrashPath
            || file.path.startsWith(`${normalizedTrashPath}/`)) {
            throw new Error("File is already inside the custom trash folder");
        }

        await this.ensureFolderPathExists(normalizedTrashPath);
        const extension = file.extension ? `.${file.extension}` : "";
        const baseName = file.basename || file.name;
        let destinationPath = normalizePath(
            `${normalizedTrashPath}/${baseName}${extension}`
        );
        let counter = 1;
        while (this.app.vault.getAbstractFileByPath(destinationPath)) {
            destinationPath = normalizePath(
                `${normalizedTrashPath}/${baseName}_${counter}${extension}`
            );
            counter++;
        }

        await this.app.fileManager.renameFile(file, destinationPath);
        return destinationPath;
    }

    private async ensureFolderPathExists(folderPath: string): Promise<void> {
        let currentPath = "";
        for (const segment of folderPath.split("/").filter(Boolean)) {
            currentPath = currentPath ? `${currentPath}/${segment}` : segment;
            const existing = this.app.vault.getAbstractFileByPath(currentPath);
            if (existing) {
                if (!(existing instanceof TFolder)) {
                    throw new Error(
                        `Trash path segment is not a folder: ${currentPath}`
                    );
                }
                continue;
            }
            await this.app.vault.createFolder(currentPath);
        }
    }
}
