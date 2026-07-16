import { App, TFile } from "obsidian";
import type { LocalLinkSettings } from "../settings/types";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { LocalImageReferenceSerializer } from "./LocalImageReferenceSerializer";
import type { VaultReferenceManager } from "./VaultReferenceManager";

export class ImageReferenceReplacer {
    private readonly serializer: LocalImageReferenceSerializer;

    constructor(
        private app: App,
        private referenceManager: VaultReferenceManager,
        private readonly settingsProvider: () => LocalLinkSettings = () => DEFAULT_SETTINGS.localProcessing.link
    ) {
        this.serializer = new LocalImageReferenceSerializer(app);
    }

    toLinkTextForFile(target: string | TFile, noteFile: TFile): string {
        return this.serializer.formatPath(this.requireTargetFile(target), noteFile, this.settingsProvider());
    }

    serializeReference(originalLink: string, target: string | TFile, noteFile: TFile): string {
        return this.serializer.serialize({
            target: this.requireTargetFile(target),
            sourceFile: noteFile,
            settings: this.settingsProvider(),
            originalLink
        });
    }

    async replaceUrlInFile(noteFile: TFile, oldUrl: string, newTarget: string | TFile): Promise<number> {
        return this.referenceManager.updateReferencesInFile(
            noteFile,
            oldUrl,
            (location) => this.serializeReference(location.original, newTarget, noteFile)
        );
    }

    async replacePathInFile(noteFile: TFile, oldPath: string, newTarget: string | TFile): Promise<number> {
        return this.referenceManager.updateReferencesInFile(
            noteFile,
            oldPath,
            (location) => this.serializeReference(location.original, newTarget, noteFile)
        );
    }

    async replaceUrlInFiles(noteFiles: TFile[], oldUrl: string, newTarget: string | TFile): Promise<number> {
        let count = 0;
        for (const noteFile of noteFiles) {
            count += await this.replaceUrlInFile(noteFile, oldUrl, newTarget);
        }
        return count;
    }

    private requireTargetFile(target: string | TFile): TFile {
        const targetFile = typeof target === "string"
            ? this.app.vault.getAbstractFileByPath(target)
            : target;
        if (!(targetFile instanceof TFile)) {
            throw new Error(`Local image target not found: ${typeof target === "string" ? target : target.path}`);
        }
        return targetFile;
    }
}
