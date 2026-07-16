/**
 * Convert arbitrary thrown values into a safe, useful message for UI and logs.
 * JavaScript permits `throw "message"` and `Promise.reject(null)`, so catch
 * blocks must not assume an Error-shaped value.
 */
export function getErrorMessage(error: unknown, fallback = "Unknown error"): string {
    if (error instanceof Error && error.message.trim()) {
        return error.message;
    }

    if (typeof error === "string" && error.trim()) {
        return error;
    }

    if (error !== null && error !== undefined) {
        try {
            const message = String(error).trim();
            if (message) return message;
        } catch {
            // Some hostile values can throw during coercion. Fall back safely.
        }
    }

    return fallback;
}
