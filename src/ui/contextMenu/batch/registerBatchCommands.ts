import type ImageConverterPlugin from "../../../main";
import { t } from "../../../lang/helpers";
import type { BatchOperationLauncher } from "./BatchOperationLauncher";

interface BatchCommandDefinition {
    readonly id: string;
    readonly name: Parameters<ImageConverterPlugin["addCommand"]>[0]["name"];
    readonly run: (launcher: BatchOperationLauncher) => void;
}

const BATCH_COMMANDS: readonly BatchCommandDefinition[] = [
    {
        id: "process-all-vault-images",
        name: t("CMD_PROCESS_ALL_VAULT"),
        run: launcher => launcher.open({ scope: "vault", target: null, mode: "local_process" })
    },
    {
        id: "process-all-images-current-note",
        name: t("CMD_PROCESS_CURRENT_NOTE"),
        run: launcher => launcher.openCurrentNote("local_process")
    },
    {
        id: "process-folder-images",
        name: t("MENU_PROCESS_FOLDER_IMAGES"),
        run: launcher => launcher.chooseFolder("local_process")
    },
    {
        id: "upload-all-vault-images",
        name: t("CMD_UPLOAD_ALL_VAULT"),
        run: launcher => launcher.open({ scope: "vault", target: null, mode: "upload" })
    },
    {
        id: "upload-all-images-current-note",
        name: t("CMD_UPLOAD_CURRENT_NOTE"),
        run: launcher => launcher.openCurrentNote("upload")
    },
    {
        id: "upload-folder-images",
        name: t("MENU_UPLOAD_FOLDER_IMAGES"),
        run: launcher => launcher.chooseFolder("upload")
    },
    {
        id: "download-network-images-current-note",
        name: t("CMD_DOWNLOAD_CURRENT_NOTE"),
        run: launcher => launcher.openCurrentNote("download")
    },
    {
        id: "download-network-images-folder",
        name: t("CMD_DOWNLOAD_FOLDER"),
        run: launcher => launcher.chooseFolder("download")
    },
    {
        id: "download-network-images-vault",
        name: t("CMD_DOWNLOAD_ALL_VAULT"),
        run: launcher => launcher.open({ scope: "vault", target: null, mode: "download" })
    }
];

export function registerBatchCommands(
    plugin: ImageConverterPlugin,
    launcher: BatchOperationLauncher
): void {
    for (const definition of BATCH_COMMANDS) {
        plugin.addCommand({
            id: definition.id,
            name: definition.name,
            callback: () => definition.run(launcher)
        });
    }
}
