import { App, TFile, normalizePath } from 'obsidian';
import type { CaptionLinkDescriptor } from '../../utils/MarkdownSourceContext';
import { isHttpUrl, isSameHttpUrl } from '../../utils/NetworkPolicy';
import { CaptionSourceScanner } from './CaptionSourceScanner';

export interface CaptionSectionBinding {
    sourcePath: string;
    descriptors: CaptionLinkDescriptor[];
    resolveImage(image: HTMLImageElement): CaptionLinkDescriptor | null;
    resolveImages(images: readonly HTMLImageElement[]): ReadonlyMap<HTMLImageElement, CaptionLinkDescriptor>;
    releaseImage(image: HTMLImageElement): void;
}

/** Binds rendered Reading Mode images to exact source links in DOM/source order. */
export class CaptionRenderCoordinator {
    private readonly imageLinks = new WeakMap<HTMLImageElement, CaptionLinkDescriptor>();
    private readonly scanner = new CaptionSourceScanner();

    constructor(private readonly app: App) { }

    createSectionBinding(sourceText: string | null | undefined, sourcePath: string): CaptionSectionBinding | null {
        if (!sourceText) return null;

        const descriptors = this.scanner.scan(sourceText).descriptors;
        if (descriptors.length === 0) return null;

        let trackedImages: HTMLImageElement[] = [];
        const resolveImages = (
            images: readonly HTMLImageElement[]
        ): ReadonlyMap<HTMLImageElement, CaptionLinkDescriptor> => {
            for (const oldImage of trackedImages) {
                if (!images.includes(oldImage)) this.imageLinks.delete(oldImage);
            }
            trackedImages = [...images];
            return this.resolveSectionImages(images, descriptors, sourcePath);
        };

        return {
            sourcePath,
            descriptors,
            resolveImages,
            resolveImage: image => {
                if (!trackedImages.includes(image)) trackedImages.push(image);
                return resolveImages(trackedImages).get(image) ?? null;
            },
            releaseImage: image => {
                trackedImages = trackedImages.filter(candidate => candidate !== image);
                this.imageLinks.delete(image);
            }
        };
    }

    getLinkText(image: HTMLImageElement): string | null {
        return this.imageLinks.get(image)?.source ?? null;
    }

    forgetImage(image: HTMLImageElement): void {
        this.imageLinks.delete(image);
    }

    private resolveSectionImages(
        images: readonly HTMLImageElement[],
        descriptors: CaptionLinkDescriptor[],
        sourcePath: string
    ): Map<HTMLImageElement, CaptionLinkDescriptor> {
        const resolved = new Map<HTMLImageElement, CaptionLinkDescriptor>();
        const available = new Set(descriptors.map((_descriptor, index) => index));

        for (const image of images) {
            const candidates = this.getImageCandidates(image);
            let matchIndex = descriptors.findIndex((descriptor, index) =>
                available.has(index) && this.matchesDescriptor(descriptor, candidates, sourcePath)
            );

            if (matchIndex < 0 && available.size === 1 && images.length === descriptors.length) {
                matchIndex = available.values().next().value ?? -1;
            }
            if (matchIndex < 0) {
                this.imageLinks.delete(image);
                continue;
            }

            const descriptor = descriptors[matchIndex];
            available.delete(matchIndex);
            resolved.set(image, descriptor);
            this.imageLinks.set(image, descriptor);
        }

        return resolved;
    }

    private getImageCandidates(image: HTMLImageElement): string[] {
        const container = image.closest(
            '.image-resize-container, .image-wrapper, .internal-embed.image-embed, .external-embed, .cm-embed-block'
        );
        const values = [
            image.getAttribute('src'),
            image.getAttribute('data-src'),
            container?.getAttribute('src'),
            container?.getAttribute('data-src')
        ];

        return values
            .filter((value): value is string => !!value?.trim())
            .map(value => value.trim());
    }

    private matchesDescriptor(
        descriptor: CaptionLinkDescriptor,
        candidates: string[],
        sourcePath: string
    ): boolean {
        const descriptorPath = descriptor.path.trim();
        if (!descriptorPath) return false;

        if (isHttpUrl(descriptorPath)) {
            return candidates.some(candidate => isHttpUrl(candidate) && isSameHttpUrl(candidate, descriptorPath));
        }

        const destination = this.app.metadataCache.getFirstLinkpathDest(descriptorPath, sourcePath);
        const destinationPath = destination instanceof TFile ? normalizeLocalPath(destination.path) : null;
        const rawPath = normalizeLocalPath(descriptorPath);

        return candidates.some(candidate => {
            if (isHttpUrl(candidate)) return false;
            const normalized = normalizeLocalPath(candidate);
            if (!normalized) return false;
            if (destinationPath && (normalized === destinationPath || normalized.endsWith(`/${destinationPath}`))) {
                return true;
            }
            return normalized === rawPath
                || normalized.endsWith(`/${rawPath}`)
                || rawPath.endsWith(`/${normalized}`);
        });
    }
}

function normalizeLocalPath(value: string): string {
    const decoded = safeDecode(value).split(/[?#]/, 1)[0]
        .replace(/^app:\/\/local\//i, '')
        .replace(/^app:\/\//i, '')
        .replace(/\\/g, '/');
    return normalizePath(decoded).replace(/^\/+/, '').toLowerCase();
}

function safeDecode(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}
