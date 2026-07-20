import { App, TFile } from "obsidian";
import type ImageConverterPlugin from "../main";
import { collectUsableMarkdownViews } from "../ui/MarkdownViewRegistry";
import { ImageViewContextResolver } from "../ui/contextMenu/utils/ImageViewContextResolver";
import {
    inferLocalReferenceSyntax,
    LocalImageTargetResolver
} from "./LocalImageTargetResolver";

type RefreshDependencies = Pick<
    ImageConverterPlugin,
    "imageStateManager" | "imageCaption"
>;

export interface ImageResourceRefreshResult {
    readonly matched: number;
    readonly refreshed: number;
}

/** Refreshes only rendered images whose source link resolves to a target vault file. */
export class ImageResourceRefreshService {
    private readonly viewResolver: ImageViewContextResolver;
    private readonly targetResolver: LocalImageTargetResolver;

    constructor(
        private readonly app: App,
        private readonly dependencies?: Partial<RefreshDependencies>
    ) {
        this.viewResolver = new ImageViewContextResolver(app);
        this.targetResolver = new LocalImageTargetResolver(app);
    }

    async refreshFile(target: TFile): Promise<ImageResourceRefreshResult> {
        let matched = 0;
        let refreshed = 0;
        const baseResourcePath = this.getResourcePath(target);

        for (const view of collectUsableMarkdownViews(this.app)) {
            if (!(view.file instanceof TFile)) continue;
            const sourceIndex = this.viewResolver.prepareEditor(view.editor);
            for (const image of Array.from(view.contentEl.querySelectorAll("img"))) {
                const resolution = this.viewResolver.resolveDetailed(
                    image,
                    sourceIndex,
                    Object.freeze({
                        view,
                        file: view.file,
                        editor: view.editor
                    })
                );
                const exactSourceMatch = resolution.status === "resolved"
                    && this.descriptorTargetsFile(
                        resolution.context.match.descriptor.path,
                        resolution.context.match.descriptor.source,
                        resolution.context.file,
                        target
                    );
                const exactResourceMatch = !!baseResourcePath
                    && resourceUrlsTargetSameFile(
                        image.getAttribute("src") ?? image.src,
                        baseResourcePath
                    );
                if (!exactSourceMatch && !exactResourceMatch) continue;

                matched++;
                const resourcePath = this.getVersionedResourcePath(
                    target,
                    exactResourceMatch ? image.getAttribute("src") ?? image.src : undefined
                );
                if (resourcePath && image.getAttribute("src") !== resourcePath) {
                    image.setAttribute("src", resourcePath);
                    refreshed++;
                }
            }
        }

        this.dependencies?.imageStateManager?.refreshAllImages();
        this.dependencies?.imageCaption?.refreshAllViews();
        return Object.freeze({ matched, refreshed });
    }

    private descriptorTargetsFile(
        path: string,
        source: string,
        ownerFile: TFile,
        target: TFile
    ): boolean {
        const targetResolution = this.targetResolver.resolve(
            path,
            ownerFile,
            { syntax: inferLocalReferenceSyntax(source) }
        );
        return targetResolution.status === "resolved"
            && targetResolution.file?.path === target.path;
    }

    private getResourcePath(file: TFile): string | null {
        const getResourcePath = this.app.vault?.getResourcePath;
        if (typeof getResourcePath !== "function") return null;
        return getResourcePath.call(this.app.vault, file) || null;
    }

    private getVersionedResourcePath(file: TFile, currentSrc?: string): string | null {
        const base = this.getResourcePath(file);
        if (!base) return null;
        const candidate = currentSrc && resourceUrlsTargetSameFile(currentSrc, base)
            ? currentSrc
            : base;
        const hashIndex = candidate.indexOf("#");
        const hash = hashIndex >= 0 ? candidate.slice(hashIndex) : "";
        const beforeHash = hashIndex >= 0 ? candidate.slice(0, hashIndex) : candidate;
        const withoutOldVersion = beforeHash
            .replace(/([?&])image-assistant-mtime=[^&#]*/g, "$1")
            .replace("?&", "?")
            .replace(/&&+/g, "&")
            .replace(/[?&]$/, "");
        const separator = withoutOldVersion.includes("?") ? "&" : "?";
        return `${withoutOldVersion}${separator}image-assistant-mtime=${file.stat.mtime}${hash}`;
    }
}

function resourceUrlsTargetSameFile(left: string, right: string): boolean {
    return normalizeResourceIdentity(left) === normalizeResourceIdentity(right);
}

function normalizeResourceIdentity(value: string): string {
    const withoutFragment = value.split("#", 1)[0] ?? value;
    const withoutQuery = withoutFragment.split("?", 1)[0] ?? withoutFragment;
    try {
        return decodeURIComponent(withoutQuery).replace(/\\/g, "/");
    } catch {
        return withoutQuery.replace(/\\/g, "/");
    }
}
