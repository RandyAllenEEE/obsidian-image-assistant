import { App, TFile, normalizePath } from 'obsidian';
import {
    getImageLayoutKey,
    getImageSourceKey,
    type ImageSourceDescriptor
} from '../../utils/MarkdownSourceContext';
import { isHttpUrl, isSameHttpUrl } from '../../utils/NetworkPolicy';
import {
    imageSourceBindingRegistry,
    type ReadingImageSourceBinding
} from '../ImageSourceBindingRegistry';
import { CaptionSourceScanner } from './CaptionSourceScanner';
import { resolveRenderedMediaLayoutTarget } from '../RenderedMediaLayoutTarget';
import { isHtmlImageElement } from './CaptionDomUtils';

export interface CaptionSectionBinding {
    sourcePath: string;
    descriptors: ImageSourceDescriptor[];
    resolveImage(image: HTMLImageElement): ImageSourceDescriptor | null;
    resolveImages(images: readonly HTMLImageElement[]): ReadonlyMap<HTMLImageElement, ImageSourceDescriptor>;
    resolveMedia(media: readonly Element[]): ReadonlyMap<Element, ImageSourceDescriptor>;
    releaseImage(image: HTMLImageElement): void;
    releaseMedia(media: Element): void;
}

/** Binds rendered Reading Mode images to exact source links in DOM/source order. */
export class CaptionRenderCoordinator {
    private readonly mediaLinks = new WeakMap<Element, ImageSourceDescriptor>();
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

        let trackedMedia: Element[] = [];
        const resolveMedia = (
            media: readonly Element[]
        ): ReadonlyMap<Element, ImageSourceDescriptor> => {
            for (const oldMedia of trackedMedia) {
                if (!media.includes(oldMedia)) this.releaseMediaBinding(oldMedia);
            }
            trackedMedia = [...media];
            return this.resolveSectionMedia(
                media,
                descriptors,
                sourcePath,
                sectionLineStart
            );
        };

        return {
            sourcePath,
            descriptors,
            resolveMedia,
            resolveImages: images => {
                const resolved = resolveMedia(images);
                return new Map(images.flatMap(image => {
                    const descriptor = resolved.get(image);
                    return descriptor ? [[image, descriptor] as const] : [];
                }));
            },
            resolveImage: image => {
                if (!trackedMedia.includes(image)) trackedMedia.push(image);
                return resolveMedia(trackedMedia).get(image) ?? null;
            },
            releaseImage: image => {
                trackedMedia = trackedMedia.filter(candidate => candidate !== image);
                this.releaseMediaBinding(image);
            },
            releaseMedia: media => {
                trackedMedia = trackedMedia.filter(candidate => candidate !== media);
                this.releaseMediaBinding(media);
            }
        };
    }

    getLinkText(image: HTMLImageElement): string | null {
        return this.mediaLinks.get(image)?.source ?? null;
    }

    forgetImage(image: HTMLImageElement): void {
        this.releaseMediaBinding(image);
    }

    private resolveSectionMedia(
        media: readonly Element[],
        descriptors: ImageSourceDescriptor[],
        sourcePath: string,
        sectionLineStart: number
    ): Map<Element, ImageSourceDescriptor> {
        const resolved = new Map<Element, ImageSourceDescriptor>();
        const available = new Set(descriptors.map((_descriptor, index) => index));
        const directDescriptorIndices = new Map<Element, number>();
        const unresolvedMedia: Array<{
            media: Element;
            domIndex: number;
        }> = [];

        media.forEach((element, domIndex) => {
            const candidates = this.getMediaCandidates(element);
            const matchIndex = descriptors.findIndex((descriptor, index) =>
                available.has(index) && this.matchesDescriptor(descriptor, candidates, sourcePath)
            );

            if (matchIndex < 0) {
                unresolvedMedia.push({ media: element, domIndex });
                return;
            }

            const descriptor = descriptors[matchIndex];
            available.delete(matchIndex);
            directDescriptorIndices.set(element, matchIndex);
            this.bindMedia(
                element,
                descriptor,
                sourcePath,
                sectionLineStart,
                resolved
            );
        });

        if (unresolvedMedia.length === available.size && unresolvedMedia.length > 0) {
            const remainingIndices = [...available].sort((left, right) => left - right);
            const fallbackIndices = new Map(
                unresolvedMedia.map(({ media: element }, index) => [
                    element,
                    remainingIndices[index]
                ])
            );
            const descriptorOrder = media.map(element =>
                directDescriptorIndices.get(element) ?? fallbackIndices.get(element)
            );
            const orderIsStable = descriptorOrder.every((index, position) =>
                index !== undefined
                && (position === 0 || index > (descriptorOrder[position - 1] ?? -1))
            );
            if (orderIsStable) {
                unresolvedMedia.forEach(({ media: element }, index) => {
                    this.bindMedia(
                        element,
                        descriptors[remainingIndices[index]],
                        sourcePath,
                        sectionLineStart,
                        resolved
                    );
                });
            } else {
                unresolvedMedia.forEach(({ media: element }) => {
                    this.releaseMediaBinding(element);
                });
            }
        } else {
            unresolvedMedia.forEach(({ media: element }) => {
                this.releaseMediaBinding(element);
            });
        }

        return resolved;
    }

    private bindMedia(
        media: Element,
        descriptor: ImageSourceDescriptor,
        sourcePath: string,
        sectionLineStart: number,
        resolved: Map<Element, ImageSourceDescriptor>
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
        resolved.set(media, descriptor);
        this.mediaLinks.set(media, descriptor);
        if (isHtmlImageElement(media)) {
            imageSourceBindingRegistry.bindReading(media, binding);
        }
    }

    private getMediaCandidates(media: Element): string[] {
        const target = resolveRenderedMediaLayoutTarget(media);
        const container = target?.owner ?? null;
        const values = [
            media.getAttribute('src'),
            media.getAttribute('data-src'),
            target?.visual.getAttribute('fileSource'),
            container?.getAttribute('src'),
            container?.getAttribute('data-src')
        ];

        return values
            .filter((value): value is string => !!value?.trim())
            .map(value => value.trim());
    }

    private releaseMediaBinding(media: Element): void {
        this.mediaLinks.delete(media);
        if (isHtmlImageElement(media)) imageSourceBindingRegistry.release(media);
    }

    private matchesDescriptor(
        descriptor: ImageSourceDescriptor,
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
