import { requestUrl } from "obsidian";
import type ImageConverterPlugin from "../../../main";
import type { NextAiDrawingSettings } from "../../../settings/types";
import {
    AbortableDesktopHttpClient,
    resolveDesktopHttpTransport
} from "../../../utils/AbortableDesktopHttpClient";

const RESPONSE_LIMIT = 24 * 1024 * 1024;
const REQUEST_TIMEOUT = 120_000;

export type NextAiOptionalCapability = "parse-url" | "validate-diagram";
export type NextAiCapabilityState = "unknown" | "available" | "unavailable";

const capabilityCache = new WeakMap<
    object,
    Map<string, Map<NextAiOptionalCapability, NextAiCapabilityState>>
>();

export class NextAiCapabilityUnavailableError extends Error {
    constructor(readonly capability: NextAiOptionalCapability) {
        super(`The configured Next AI deployment does not provide /api/${capability}.`);
        this.name = "NextAiCapabilityUnavailableError";
    }
}

export interface NextAiCredentials {
    readonly accessCode: string;
    readonly apiKey: string;
}

export interface NextAiUrlContent {
    readonly title: string;
    readonly content: string;
    readonly charCount: number;
}

export interface NextAiVisualValidationResult {
    readonly valid: boolean;
    readonly issues: readonly string[];
    readonly suggestions: readonly string[];
    readonly verification: "performed" | "server-reported";
    readonly source: "user-model" | "next-ai-server";
}

export class NextAiHttpClient {
    constructor(
        private readonly plugin: ImageConverterPlugin,
        private readonly desktop = new AbortableDesktopHttpClient(
            resolveDesktopHttpTransport
        )
    ) { }

    getCapabilityState(capability: NextAiOptionalCapability): NextAiCapabilityState {
        return this.capabilities().get(capability) ?? "unknown";
    }

    async getCredentials(): Promise<NextAiCredentials> {
        const settings = this.settings();
        return {
            accessCode: await this.getSecret(settings.accessCodeSecretId),
            apiKey: await this.getSecret(settings.apiKeySecretId)
        };
    }

    endpoint(path: string): string {
        const settings = this.settings();
        const base = validateServiceUrl(settings);
        if (!base.pathname.endsWith("/")) base.pathname += "/";
        return new URL(path.replace(/^\/+/, ""), base).toString();
    }

    providerBaseUrl(): string {
        return validateProviderUrl(this.settings()).toString().replace(/\/$/, "");
    }

    async testConfiguration(signal?: AbortSignal): Promise<void> {
        const settings = this.settings();
        this.providerBaseUrl();
        if (!settings.model.trim()) throw new Error("Enter an OpenAI-compatible model ID.");
        const configResponse = await this.fetch(this.endpoint("api/config"), {
            method: "GET",
            signal
        });
        const config = await parseJson(configResponse);
        if (config.accessCodeRequired === true) {
            const accessCode = await this.getSecret(settings.accessCodeSecretId);
            if (!accessCode) {
                throw new Error("Select a Next AI access code in Obsidian Secret Storage.");
            }
            const accessResponse = await this.fetch(this.endpoint("api/verify-access-code"), {
                method: "POST",
                headers: { "x-access-code": accessCode },
                signal
            });
            const access = await parseJson(accessResponse);
            if (access.valid !== true) throw new Error(readMessage(access, "Invalid Next AI access code."));
        }
        const apiKey = await this.getSecret(settings.apiKeySecretId);
        if (!apiKey) throw new Error("Select an API key in Obsidian Secret Storage.");
        const validationResponse = await this.fetch(this.endpoint("api/validate-model"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                provider: "openai",
                apiKey,
                baseUrl: settings.apiBaseUrl.trim(),
                modelId: settings.model.trim()
            }),
            signal
        });
        const validation = await parseJson(validationResponse);
        if (validation.valid !== true) throw new Error(readMessage(validation, "Next AI model validation failed."));
    }

    async extractUrl(url: string, signal?: AbortSignal): Promise<NextAiUrlContent> {
        this.requireCapability("parse-url");
        const response = await this.fetch(this.endpoint("api/parse-url"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url }),
            signal
        });
        this.recordOptionalResponse("parse-url", response);
        const data = await parseJson(response);
        if (typeof data.content !== "string"
            || typeof data.title !== "string"
            || typeof data.charCount !== "number"
            || !Number.isFinite(data.charCount)) {
            throw new Error("Next AI returned incompatible URL extraction data.");
        }
        return {
            title: data.title,
            content: data.content,
            charCount: Math.max(0, Math.trunc(data.charCount))
        };
    }

    async validateDiagram(
        imageData: string,
        sessionId: string,
        signal?: AbortSignal
    ): Promise<NextAiVisualValidationResult> {
        const mode = this.settings().visualValidationMode;
        if (mode === "user-model") {
            return this.validateDiagramWithUserModel(imageData, signal);
        }
        if (mode !== "next-ai-server") {
            throw new Error("Visual validation is disabled.");
        }
        return this.validateDiagramWithNextAiServer(imageData, sessionId, signal);
    }

    private async validateDiagramWithNextAiServer(
        imageData: string,
        sessionId: string,
        signal?: AbortSignal
    ): Promise<NextAiVisualValidationResult> {
        this.requireCapability("validate-diagram");
        const response = await this.fetch(this.endpoint("api/validate-diagram"), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ imageData, sessionId }),
            signal
        });
        this.recordOptionalResponse("validate-diagram", response);
        const raw = await response.text();
        let data: unknown;
        try {
            data = JSON.parse(raw);
        } catch {
            throw new Error(`Next AI returned invalid visual validation data (HTTP ${response.status}).`);
        }
        if (!response.ok) {
            const record = isRecord(data) ? data : {};
            throw new Error(readMessage(record, `Visual validation failed (HTTP ${response.status}).`));
        }
        if (!isRecord(data) || typeof data.valid !== "boolean") {
            throw new Error("Next AI returned incompatible visual validation data.");
        }
        return {
            valid: data.valid,
            issues: stringArray(data.issues),
            suggestions: stringArray(data.suggestions),
            // The stock endpoint intentionally returns an empty valid result when VLM is
            // disabled, unconfigured, unsupported, or errors. Its response has no marker
            // that can distinguish that fallback from a genuine pass.
            verification: data.valid ? "server-reported" : "performed",
            source: "next-ai-server"
        };
    }

    private async validateDiagramWithUserModel(
        imageData: string,
        signal?: AbortSignal
    ): Promise<NextAiVisualValidationResult> {
        if (!/^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=]+$/i.test(imageData)) {
            throw new Error("Visual validation requires a base64 PNG, JPEG, or WebP image.");
        }
        const settings = this.settings();
        const model = settings.model.trim();
        if (!model) throw new Error("Enter an OpenAI-compatible vision model ID.");
        const apiKey = await this.getSecret(settings.apiKeySecretId);
        if (!apiKey) throw new Error("Select an API key in Obsidian Secret Storage.");
        const base = validateProviderUrl(settings);
        if (!base.pathname.endsWith("/")) base.pathname += "/";
        const response = await this.fetch(new URL("chat/completions", base).toString(), {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                model,
                temperature: 0,
                messages: [
                    {
                        role: "system",
                        content: "You are a strict diagram visual quality inspector. Return only one JSON object with keys valid (boolean), issues (string array), and suggestions (string array). Mark valid false for material overlap, clipping, unreadable labels, broken-looking connectors, or seriously confusing spacing. Do not judge the requested subject matter."
                    },
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Inspect this current-page Draw.io screenshot. Report concrete visible layout problems only."
                            },
                            {
                                type: "image_url",
                                image_url: { url: imageData }
                            }
                        ]
                    }
                ]
            }),
            signal
        });
        const raw = await response.text();
        if (!response.ok) {
            throw new Error(readProviderError(raw, response.status));
        }
        const content = readChatCompletionContent(raw);
        const result = parseVisualValidationContent(content);
        return {
            ...result,
            verification: "performed",
            source: "user-model"
        };
    }

    readonly fetch: typeof fetch = async (input, init = {}) => {
        const url = typeof input === "string"
            ? input
            : input instanceof URL
                ? input.toString()
                : input.url;
        const headers = toHeaderRecord(init.headers);
        const body = normalizeBody(init.body);
        const method = (init.method ?? "GET").toUpperCase();
        if (!["GET", "HEAD", "POST", "PUT", "DELETE"].includes(method)) {
            throw new Error(`Unsupported Next AI HTTP method: ${method}`);
        }
        if (this.desktop.isAvailable()) {
            const response = await this.desktop.openStream({
                url,
                method: method as "GET" | "HEAD" | "POST" | "PUT" | "DELETE",
                headers,
                body,
                responseLimitBytes: RESPONSE_LIMIT,
                totalTimeoutMs: REQUEST_TIMEOUT,
                idleTimeoutMs: 30_000,
                redirectPolicy: "reject",
                signal: init.signal ?? undefined,
                validateUrl: async candidate => validateExactEndpoint(candidate)
            });
            return new Response(response.body, {
                status: response.status,
                headers: response.headers
            });
        }

        if (!isSafeConfigProbe(
            url,
            this.endpoint("api/config"),
            method,
            headers,
            body
        )) {
            throw new Error(
                "Secure Next AI requests require the desktop HTTP transport. "
                + "Only a credential-free GET request to this deployment's /api/config endpoint can use the requestUrl fallback, because it cannot reject redirects before sensitive data is forwarded."
            );
        }
        const response = await withAbortAndTimeout(requestUrl({
            url,
            method,
            headers,
            body,
            throw: false
        }), init.signal ?? undefined, REQUEST_TIMEOUT);
        if (response.status >= 300 && response.status < 400) {
            throw new Error("The Next AI fallback config probe returned a redirect response.");
        }
        if (response.arrayBuffer.byteLength > RESPONSE_LIMIT) {
            throw new Error("Next AI response exceeded the size limit.");
        }
        return new Response(response.arrayBuffer, {
            status: response.status,
            headers: response.headers
        });
    };

    private settings(): NextAiDrawingSettings {
        return this.plugin.settings.drawing.drawio.nextAi;
    }

    private capabilities(): Map<NextAiOptionalCapability, NextAiCapabilityState> {
        const serviceUrl = normalizedServiceUrl(this.settings());
        if (!serviceUrl) return new Map();

        let services = capabilityCache.get(this.plugin);
        if (!services) {
            services = new Map();
            capabilityCache.set(this.plugin, services);
        }
        let value = services.get(serviceUrl);
        if (!value) {
            value = new Map();
            services.set(serviceUrl, value);
        }
        return value;
    }

    private requireCapability(capability: NextAiOptionalCapability): void {
        if (this.getCapabilityState(capability) === "unavailable") {
            throw new NextAiCapabilityUnavailableError(capability);
        }
    }

    private recordOptionalResponse(capability: NextAiOptionalCapability, response: Response): void {
        if (response.status === 404 || response.status === 405) {
            this.capabilities().set(capability, "unavailable");
            throw new NextAiCapabilityUnavailableError(capability);
        }
        if (response.ok) this.capabilities().set(capability, "available");
    }

    private async getSecret(id: string): Promise<string> {
        if (!id.trim()) return "";
        const storage = (this.plugin.app as typeof this.plugin.app & {
            secretStorage?: { getSecret(secretId: string): string | Promise<string | null> | null };
        }).secretStorage;
        if (!storage) throw new Error("Obsidian Secret Storage is unavailable.");
        return (await storage.getSecret(id.trim()))?.trim() ?? "";
    }
}

function validateServiceUrl(settings: NextAiDrawingSettings): URL {
    const url = parseHttpUrl(settings.serviceUrl, "Next AI service URL");
    if (url.protocol === "http:" && !isLoopback(url.hostname) && !settings.allowInsecureRemoteHttp) {
        throw new Error("Remote HTTP is blocked. Enable the insecure HTTP option only for a trusted deployment.");
    }
    return url;
}

function validateProviderUrl(settings: NextAiDrawingSettings): URL {
    const url = parseHttpUrl(settings.apiBaseUrl, "OpenAI-compatible base URL");
    if (url.protocol === "http:" && !isLoopback(url.hostname) && !settings.allowInsecureRemoteHttp) {
        throw new Error("Remote HTTP is blocked. Enable the insecure HTTP option only for a trusted model service.");
    }
    return url;
}

function parseHttpUrl(value: string, label: string): URL {
    let url: URL;
    try {
        url = new URL(value.trim());
    } catch {
        throw new Error(`${label} is invalid.`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error(`${label} must use HTTP or HTTPS.`);
    }
    if (url.username || url.password) throw new Error(`${label} cannot contain credentials.`);
    return url;
}

function validateExactEndpoint(value: string): string | null {
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return "Only HTTP and HTTPS are allowed.";
        if (url.username || url.password) return "Endpoint URLs cannot contain credentials.";
        return null;
    } catch {
        return "Invalid endpoint URL.";
    }
}

function isLoopback(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
    return host === "localhost" || host.endsWith(".localhost") || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host);
}

function toHeaderRecord(value: HeadersInit | undefined): Record<string, string> {
    if (!value) return {};
    return Object.fromEntries(new Headers(value).entries());
}

function normalizeBody(value: BodyInit | null | undefined): string | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string") return value;
    throw new Error("Next AI transport only supports JSON request bodies.");
}

function containsCredential(
    headers: Readonly<Record<string, string>>,
    body: string | undefined
): boolean {
    const secretHeaderNames = new Set([
        "authorization",
        "proxy-authorization",
        "x-access-code",
        "x-ai-api-key"
    ]);
    if (Object.entries(headers).some(([name, value]) =>
        secretHeaderNames.has(name.toLowerCase()) && !!value.trim())) return true;
    if (!body) return false;
    try {
        return objectContainsCredential(JSON.parse(body));
    } catch {
        return false;
    }
}

function isSafeConfigProbe(
    value: string,
    expectedConfigUrl: string,
    method: string,
    headers: Readonly<Record<string, string>>,
    body: string | undefined
): boolean {
    if (method !== "GET" || body !== undefined || containsCredential(headers, body)) {
        return false;
    }
    try {
        return new URL(value).toString() === new URL(expectedConfigUrl).toString();
    } catch {
        return false;
    }
}

function normalizedServiceUrl(settings: NextAiDrawingSettings): string | null {
    try {
        const url = validateServiceUrl(settings);
        if (!url.pathname.endsWith("/")) url.pathname += "/";
        url.search = "";
        url.hash = "";
        return url.toString();
    } catch {
        // Invalid settings must not create a cache bucket or make capability reads throw.
        return null;
    }
}

function objectContainsCredential(value: unknown): boolean {
    if (Array.isArray(value)) return value.some(objectContainsCredential);
    if (!isRecord(value)) return false;
    return Object.entries(value).some(([key, candidate]) => {
        const normalized = key.replace(/[-_]/g, "").toLowerCase();
        if ((normalized === "apikey" || normalized === "accesscode")
            && typeof candidate === "string"
            && !!candidate.trim()) return true;
        return objectContainsCredential(candidate);
    });
}

async function parseJson(response: Response): Promise<Record<string, unknown>> {
    let data: unknown;
    try {
        data = await response.json();
    } catch {
        throw new Error(`Next AI returned invalid JSON (HTTP ${response.status}).`);
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new Error("Next AI returned an incompatible response.");
    }
    const record = data as Record<string, unknown>;
    if (!response.ok) throw new Error(readMessage(record, `Next AI request failed (HTTP ${response.status}).`));
    return record;
}

function readMessage(value: Record<string, unknown>, fallback: string): string {
    return typeof value.error === "string" && value.error.trim()
        ? value.error
        : typeof value.message === "string" && value.message.trim()
            ? value.message
            : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === "string" && !!entry.trim())
            .map(entry => entry.trim().slice(0, 2_000))
            .slice(0, 50)
        : [];
}

function readProviderError(raw: string, status: number): string {
    try {
        const data = JSON.parse(raw) as unknown;
        if (isRecord(data)) {
            if (typeof data.error === "string" && data.error.trim()) return data.error;
            if (isRecord(data.error) && typeof data.error.message === "string") return data.error.message;
            if (typeof data.message === "string" && data.message.trim()) return data.message;
        }
    } catch {
        // Use the bounded plain-text fallback below.
    }
    const detail = raw.trim().slice(0, 500);
    return detail || `Vision model request failed (HTTP ${status}).`;
}

function readChatCompletionContent(raw: string): string {
    let data: unknown;
    try {
        data = JSON.parse(raw);
    } catch {
        throw new Error("The vision model returned invalid JSON at the API boundary.");
    }
    if (!isRecord(data) || !Array.isArray(data.choices) || !isRecord(data.choices[0])) {
        throw new Error("The vision model returned an incompatible chat-completions response.");
    }
    const message = data.choices[0].message;
    if (!isRecord(message)) throw new Error("The vision model response did not contain a message.");
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
        const text = message.content.flatMap(part =>
            isRecord(part) && typeof part.text === "string" ? [part.text] : []
        ).join("\n");
        if (text) return text;
    }
    throw new Error("The vision model response did not contain text output.");
}

function parseVisualValidationContent(content: string): Pick<
    NextAiVisualValidationResult,
    "valid" | "issues" | "suggestions"
> {
    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) {
        throw new Error("The vision model did not return the required validation object.");
    }
    let data: unknown;
    try {
        data = JSON.parse(content.slice(firstBrace, lastBrace + 1));
    } catch {
        throw new Error("The vision model returned malformed validation JSON.");
    }
    if (!isRecord(data) || typeof data.valid !== "boolean") {
        throw new Error("The vision model returned an incompatible validation object.");
    }
    return {
        valid: data.valid,
        issues: stringArray(data.issues),
        suggestions: stringArray(data.suggestions)
    };
}

function withAbortAndTimeout<T>(
    operation: Promise<T>,
    signal: AbortSignal | undefined,
    timeoutMs: number
): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            callback();
        };
        const onAbort = (): void => finish(() => reject(abortError(signal)));
        const timer = setTimeout(() => finish(() => reject(
            new Error("Next AI request timed out.")
        )), timeoutMs);
        signal?.addEventListener("abort", onAbort, { once: true });
        operation.then(
            value => finish(() => resolve(value)),
            error => finish(() => reject(error))
        );
    });
}

function abortError(signal?: AbortSignal): Error {
    return signal?.reason instanceof Error
        ? signal.reason
        : new DOMException("The operation was aborted.", "AbortError");
}
