let fallbackCounter = 0;

/** Generates a process-local collision-resistant identifier without Math.random(). */
export function createUniqueOperationId(prefix = ""): string {
    const cryptoApi = globalThis.crypto;
    if (typeof cryptoApi?.randomUUID === "function") {
        return `${prefix}${cryptoApi.randomUUID()}`;
    }
    if (typeof cryptoApi?.getRandomValues === "function") {
        const bytes = new Uint8Array(16);
        cryptoApi.getRandomValues(bytes);
        const value = Array.from(
            bytes,
            byte => byte.toString(16).padStart(2, "0")
        ).join("");
        return `${prefix}${value}`;
    }
    fallbackCounter = (fallbackCounter + 1) % Number.MAX_SAFE_INTEGER;
    return `${prefix}${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}
