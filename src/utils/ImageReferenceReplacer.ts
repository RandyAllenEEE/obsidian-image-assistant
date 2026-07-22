import { App, TFile } from "obsidian";
import type { LocalLinkSettings } from "../settings/types";
import { DEFAULT_SETTINGS } from "../settings/defaults";
import { LocalImageReferenceSerializer } from "./LocalImageReferenceSerializer";
import type { VaultReferenceManager } from "./VaultReferenceManager";
import {
    getFixedPixelResizePipe,
    type EmbedResizeSettings
} from "../settings/NonDestructiveResizeSettings";
import { pipeSyntaxParser } from "./PipeSyntaxParser";

export interface SerializeImageReferenceOptions {
    readonly applyInitialSize?: boolean;
}

export class ImageReferenceReplacer {
    private readonly serializer: LocalImageReferenceSerializer;

    constructor(
        private app: App,
        private referenceManager: VaultReferenceManager,
        private readonly settingsProvider: () => LocalLinkSettings = () => DEFAULT_SETTINGS.localProcessing.link,
        private readonly resizeSettingsProvider?: () => EmbedResizeSettings
    ) {
        this.serializer = new LocalImageReferenceSerializer(app);
    }

    toLinkTextForFile(target: string | TFile, noteFile: TFile): string {
        return this.serializer.formatPath(this.requireTargetFile(target), noteFile, this.getSettings());
    }

    async prepare(): Promise<void> {
        await this.serializer.preparePathFormat(this.getSettings().pathFormat);
    }

    serializeReference(
        originalLink: string,
        target: string | TFile,
        noteFile: TFile,
        options: SerializeImageReferenceOptions = {}
    ): string {
        const source = options.applyInitialSize
            ? this.applyInitialSize(originalLink)
            : originalLink;
        return this.serializer.serialize({
            target: this.requireTargetFile(target),
            sourceFile: noteFile,
            settings: this.getSettings(),
            originalLink: source
        });
    }

    async replaceUrlInFile(noteFile: TFile, oldUrl: string, newTarget: string | TFile): Promise<number> {
        await this.prepare();
        return this.referenceManager.updateReferencesInFile(
            noteFile,
            oldUrl,
            (location) => this.serializeReference(location.original, newTarget, noteFile)
        );
    }

    async replacePathInFile(noteFile: TFile, oldPath: string, newTarget: string | TFile): Promise<number> {
        await this.prepare();
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

    private getSettings(): LocalLinkSettings {
        return this.settingsProvider?.() ?? DEFAULT_SETTINGS.localProcessing.link;
    }

    private applyInitialSize(originalLink: string): string {
        const settings = this.resizeSettingsProvider?.();
        if (!settings) return originalLink;
        const existing = pipeSyntaxParser.parsePipeSyntax(originalLink, {
            attributeMode: "display"
        });
        if (!existing || existing.size) return originalLink;
        const pipe = getFixedPixelResizePipe(settings);
        if (!pipe) return originalLink;
        const size = pipeSyntaxParser.parsePipeAttributes(
            pipe.slice(1),
            false,
            "display"
        ).size;
        if (!size) return originalLink;
        const patch = pipeSyntaxParser.updateSizePreservingSyntax(originalLink, {
            width: size.width ?? null,
            height: size.height ?? null
        });
        return patch.status === "updated" ? patch.linkText : originalLink;
    }
}
