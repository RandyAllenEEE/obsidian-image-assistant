import type { CaptionLinkDescriptor } from "../utils/MarkdownSourceContext";

export interface ReadingImageSourceBinding {
    readonly descriptor: CaptionLinkDescriptor;
    readonly sourcePath: string;
    readonly line: number;
    readonly start: number;
    readonly end: number;
    readonly sourceKey: string;
    readonly layoutKey: string;
}

/** Shared source bindings for rendered images, independent of caption visibility. */
export class ImageSourceBindingRegistry {
    private readonly readingBindings =
        new WeakMap<HTMLImageElement, ReadingImageSourceBinding>();

    getReading(image: HTMLImageElement): ReadingImageSourceBinding | null {
        return this.readingBindings.get(image) ?? null;
    }

    bindReading(
        image: HTMLImageElement,
        binding: ReadingImageSourceBinding
    ): void {
        this.readingBindings.set(image, binding);
    }

    release(image: HTMLImageElement): void {
        this.readingBindings.delete(image);
    }
}

export const imageSourceBindingRegistry = new ImageSourceBindingRegistry();
