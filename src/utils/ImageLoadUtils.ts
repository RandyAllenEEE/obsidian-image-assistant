const DEFAULT_IMAGE_LOAD_TIMEOUT_MS = 30_000;

/**
 * Load an image with handlers installed before assigning `src`, so cached and
 * blob-backed images cannot fire before the caller begins waiting.
 */
export function loadImage(
    image: HTMLImageElement,
    src: string,
    timeoutMs = DEFAULT_IMAGE_LOAD_TIMEOUT_MS
): Promise<void> {
    return new Promise((resolve, reject) => {
        let settled = false;
        let timeout: ReturnType<typeof setTimeout> | null = null;

        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            if (timeout !== null) clearTimeout(timeout);
            image.onload = null;
            image.onerror = null;
            if (error) reject(error);
            else resolve();
        };

        image.onload = () => finish();
        image.onerror = () => finish(new Error("Failed to load image"));
        timeout = setTimeout(
            () => finish(new Error(`Image load timed out after ${timeoutMs / 1000} seconds`)),
            timeoutMs
        );
        image.src = src;
    });
}
