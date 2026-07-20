import { App, TFile, normalizePath } from 'obsidian';
import {
    getImageLayoutKey,
    getImageSourceKey,
    type CaptionLinkDescriptor
} from '../../utils/MarkdownSourceContext';
import { isHttpUrl, isSameHttpUrl } from '../../utils/NetworkPolicy';
import {
    imageSourceBindingRegistry,
    type ReadingImageSourceBinding
} from '../ImageSourceBindingRegistry';
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

    createSectionBinding(
        sourceText: string | null | undefined,
        sourcePath: string,
        sectionLineStart = 0
    ): CaptionSectionBinding | null {
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
            return this.resolveSectionImages(
                images,
                descriptors,
                sourcePath,
                sectionLineStart
            );
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
                imageSourceBindingRegistry.release(image);
            }
        };
    }

    getLinkText(image: HTMLImageElement): string | null {
        return this.imageLinks.get(image)?.source ?? null;
    }

    forgetImage(image: HTMLImageElement): void {
        this.imageLinks.delete(image);
        imageSourceBindingRegistry.release(image);
    }

    private resolveSectionImages(
        images: readonly HTMLImageElement[],
        descriptors: CaptionLinkDescriptor[],
        sourcePath: string,
        sectionLineStart: number
    ): Map<HTMLImageElement, CaptionLinkDescriptor> {
        const resolved = new Map<HTMLImageElement, CaptionLinkDescriptor>();
        const available = new Set(descriptors.map((_descriptor, index) => index));
        const directDescriptorIndices = new Map<HTMLImageElement, number>();
        const unresolvedImages: Array<{
            image: HTMLImageElement;
            domIndex: number;
        }> = [];

        images.forEach((image, domIndex) => {
            const candidates = this.getImageCandidates(image);
            const matchIndex = descriptors.findIndex((descriptor, index) =>
                available.has(index) && this.matchesDescriptor(descriptor, candidates, sourcePath)
            );

            if (matchIndex < 0) {
                unresolvedImages.push({ image, domIndex });
                return;
            }

            const descriptor = descriptors[matchIndex];
            available.delete(matchIndex);
            directDescriptorIndices.set(image, matchIndex);
            this.bindImage(
                image,
                descriptor,
                sourcePath,
                sectionLineStart,
                resolved
            );
        });

        if (unresolvedImages.length === available.size && unresolvedImages.length > 0) {
            const remainingIndices = [...available].sort((left, right) => left - right);
            const fallbackIndices = new Map(
                unresolvedImages.map(({ image }, index) => [
                    image,
                    remainingIndices[index]
                ])
            );
            const descriptorOrder = images.map(image =>
                directDescriptorIndices.get(image) ?? fallbackIndices.get(image)
            );
            const orderIsStable = descriptorOrder.every((index, position) =>
                index !== undefined
                && (position === 0 || index > (descriptorOrder[position - 1] ?? -1))
            );
            if (orderIsStable) {
                unresolvedImages.forEach(({ image }, index) => {
                    this.bindImage(
                        image,
                        descriptors[remainingIndices[index]],
                        sourcePath,
                        sectionLineStart,
                        resolved
                    );
                });
            } else {
                unresolvedImages.forEach(({ image }) => {
                    this.imageLinks.delete(image);
                    imageSourceBindingRegistry.release(image);
                });
            }
        } else {
            unresolvedImages.forEach(({ image }) => {
                this.imageLinks.delete(image);
                imageSourceBindingRegistry.release(image);
            });
        }

        return resolved;
    }

    private bindImage(
        image: HTMLImageElement,
        descriptor: CaptionLinkDescriptor,
        sourcePath: string,
        sectionLineStart: number,
        resolved: Map<HTMLImageElement, CaptionLinkDescriptor>
    ): void {
        const start = descriptor.index - descriptor.lineStart;
        const binding: ReadingImageSourceBinding = Object.freeze({
            descriptor,
            sourcePath,
            line: sectionLineStart + descriptor.line,
            start,
            end: start + descriptor.source.length,
            sourceKey: getImageSourceKey(descriptor),
            layoutKey: getImageLayoutKey(descriptor)
        });
        resolved.set(image, descriptor);
        this.imageLinks.set(image, descriptor);
        imageSourceBindingRegistry.bindReading(image, binding);
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
