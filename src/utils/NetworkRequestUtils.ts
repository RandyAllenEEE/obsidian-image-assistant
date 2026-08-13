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

const DEFAULT_RESPONSE_LIMIT = 2 * 1024 * 1024;

/** Reads a response without allowing an OCR/model endpoint to buffer unbounded data. */
export async function readResponseTextWithLimit(
    response: Response,
    limitBytes = DEFAULT_RESPONSE_LIMIT
): Promise<string> {
    const declaredLength = Number(response.headers?.get?.("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > limitBytes) {
        throw new Error(`Response exceeded the ${limitBytes}-byte limit`);
    }

    const reader = response.body?.getReader?.();
    if (!reader) {
        const text = typeof response.text === "function"
            ? await response.text()
            : JSON.stringify(await (response as Response & { json: () => Promise<unknown> }).json());
        if (new TextEncoder().encode(text).byteLength > limitBytes) {
            throw new Error(`Response exceeded the ${limitBytes}-byte limit`);
        }
        return text;
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        for (;;) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > limitBytes) {
                await reader.cancel("response size limit exceeded");
                throw new Error(`Response exceeded the ${limitBytes}-byte limit`);
            }
            chunks.push(part.value);
        }
    } finally {
        reader.releaseLock();
    }

    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(combined);
}

export async function fetchWithTimeout(
    input: RequestInfo | URL,
    init: RequestInit = {},
    timeoutMs = 120_000
): Promise<Response> {
    assertCredentialTransport(
        input,
        init.headers ?? (input instanceof Request ? input.headers : undefined)
    );
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
        // OCR/model requests are endpoint-specific. Following a redirect can
        // forward image data or Authorization to a destination the user did
        // not configure, so redirects always fail closed.
        return await fetch(input, {
            ...init,
            redirect: "error",
            signal: controller.signal
        });
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

function assertCredentialTransport(input: RequestInfo | URL, headers: HeadersInit | undefined): void {
    if (!hasAuthorizationHeader(headers)) return;
    const rawUrl = input instanceof URL
        ? input.toString()
        : typeof input === "string"
            ? input
            : input.url;
    let url: URL;
    try {
        url = new URL(rawUrl);
    } catch {
        throw new Error("Credential-bearing requests require an absolute HTTPS or loopback URL");
    }
    if (url.protocol === "https:") return;
    if (url.protocol === "http:" && isLoopbackHost(url.hostname)) return;
    throw new Error("Credential-bearing requests require HTTPS or a loopback HTTP endpoint");
}

function hasAuthorizationHeader(headers: HeadersInit | undefined): boolean {
    if (!headers) return false;
    const normalized = new Headers(headers);
    return normalized.has("authorization");
}

function isLoopbackHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost"
        || host.endsWith(".localhost")
        || host === "::1"
        || /^127(?:\.\d{1,3}){3}$/.test(host);
}
