import { normalizePath } from 'obsidian';
import { pipeSyntaxParser } from '../../../utils/PipeSyntaxParser';

/**
 * Utility functions for image path manipulation
 */
export class ImagePathUtils {
    /**
     * Check if an image is a network image (URL starts with http:// or https://)
     */
    static isNetworkImage(img: HTMLImageElement): boolean {
        const src = img.getAttribute('src');
        if (!src) return false;
        return src.startsWith('http://') || src.startsWith('https://');
    }

    /**
     * Normalizes an image path for consistent comparison.
     * Converts backslashes to forward slashes, replaces '%20' with spaces,
     * removes query parameters, converts to lowercase, and trims whitespace.
     *
     * @param path - The image path to normalize.
     * @returns The normalized image path, always starting with a '/'.
     */
    static normalizeImagePath(path: string): string {
        if (!path) return '';

        // Decode URL encoded characters first
        let normalizedPath = decodeURIComponent(path);

        // Remove any URL parameters
        const [pathWithoutQuery] = normalizedPath.split('?');
        normalizedPath = pathWithoutQuery;

        // Convert backslashes to forward slashes
        normalizedPath = normalizedPath.replace(/\\/g, '/');

        // Handle spaces in paths
        normalizedPath = normalizedPath.replace(/%20/g, ' ');

        // Ensure consistent leading slash
        if (!normalizedPath.startsWith('/')) {
            normalizedPath = `/${normalizedPath}`;
        }

        // Normalize any '../' or './' sequences
        normalizedPath = normalizePath(normalizedPath);

        return normalizedPath.toLowerCase();
    }

    /**
     * Extracts the filename from an image link, handling both wiki and markdown formats.
     *
     * @param link - The full image link.
     * @returns The extracted filename, or null if not found.
     */
    static extractFilenameFromLink(link: string): string | null {
        const parsed = pipeSyntaxParser.parsePipeSyntax(link);
        if (parsed && parsed.path) {
            return parsed.path;
        }
        return null;
    }
}
