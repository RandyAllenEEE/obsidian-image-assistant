import type { TFile } from "obsidian";
import type { ProcessedImageResult } from "../local/ImageProcessor";
import { detectImageBinaryType } from "./ImageBinaryType";

/**
 * Preserve the source filename when processing only changes bytes, not format.
 * Extension aliases such as .jpeg/.jpg and .tif/.tiff are therefore kept.
 */
export async function resolveProcessedImageFilename(
    source: TFile,
    sourceData: ArrayBuffer,
    processedImage: ProcessedImageResult
): Promise<string> {
    const sourceType = await detectImageBinaryType(sourceData);
    if (sourceType?.mime === processedImage.mimeType) {
        return source.name;
    }

    return `${source.basename}.${processedImage.extension}`;
}
