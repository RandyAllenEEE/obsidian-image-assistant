export async function withTimeout<T>(
    operation: Promise<T>,
    timeoutMs: number,
    label: string
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            operation,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs / 1000} seconds`)), timeoutMs);
            })
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

export function createBasicAuthorization(username: string, password: string): string {
    return `Basic ${Buffer.from(`${username}:${password}`, "utf8").toString("base64")}`;
}

export async function fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit = {},
    timeoutMs = 120_000
): Promise<Response> {
    const controller = new AbortController();
    const externalSignal = init.signal;
    let timedOut = false;
    const abortFromCaller = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromCaller();
    else externalSignal?.addEventListener("abort", abortFromCaller, { once: true });
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    try {
        return await fetch(input, { ...init, signal: controller.signal });
    } catch (error) {
        if (timedOut) {
            throw new Error(`Request timed out after ${timeoutMs / 1000} seconds`);
        }
        throw error;
    } finally {
        clearTimeout(timer);
        externalSignal?.removeEventListener("abort", abortFromCaller);
    }
}
