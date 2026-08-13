import { requestUrl } from "obsidian";
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import {
    NextAiCapabilityUnavailableError,
    NextAiHttpClient
} from "../../../../../src/drawing/drawio/nextai/NextAiHttpClient";
import { DEFAULT_SETTINGS } from "../../../../../src/settings/defaults";

describe("NextAiHttpClient", () => {
    it("uses the real Node desktop transport in an Obsidian-style renderer", async () => {
        const received: Array<{
            path: string;
            accessCode: string | undefined;
            body: string;
        }> = [];
        await withHttpServer(async (request, response) => {
            const body = await readRequestBody(request);
            received.push({
                path: request.url ?? "",
                accessCode: request.headers["x-access-code"] as string | undefined,
                body
            });
            if (request.url === "/api/config") {
                sendJson(response, { accessCodeRequired: true });
            } else {
                sendJson(response, { valid: true });
            }
        }, async baseUrl => {
            const plugin = makePlugin();
            plugin.settings.drawing.drawio.nextAi.serviceUrl = `${baseUrl}/`;

            await new NextAiHttpClient(plugin as never).testConfiguration();
        });

        expect(received.map(entry => entry.path)).toEqual([
            "/api/config",
            "/api/verify-access-code",
            "/api/validate-model"
        ]);
        expect(received[0].accessCode).toBeUndefined();
        expect(received[1].accessCode).toBe("access-secret");
        expect(received[2].accessCode).toBeUndefined();
        expect(JSON.parse(received[2].body)).toMatchObject({
            provider: "openai",
            apiKey: "provider-secret"
        });
    });

    it("tests config, access code, and the fixed OpenAI provider in order", async () => {
        const plugin = makePlugin();
        const desktop = makeDesktop(
            { data: { accessCodeRequired: true } },
            { data: { valid: true } },
            { data: { valid: true } }
        );

        const client = new NextAiHttpClient(plugin as never, desktop as never);
        await client.testConfiguration();

        expect(requestUrl).not.toHaveBeenCalled();
        expect(desktop.openStream.mock.calls.map((call: [{ url: string }]) => call[0].url)).toEqual([
            "https://next.example/base/api/config",
            "https://next.example/base/api/verify-access-code",
            "https://next.example/base/api/validate-model"
        ]);
        const configRequest = desktop.openStream.mock.calls[0][0];
        const validationRequest = desktop.openStream.mock.calls[2][0];
        expect(configRequest.headers).toEqual({});
        expect(desktop.openStream.mock.calls[1][0].headers).toMatchObject({
            "x-access-code": "access-secret"
        });
        expect(validationRequest.headers).not.toHaveProperty("x-access-code");
        expect(JSON.parse(String(validationRequest.body))).toEqual({
            provider: "openai",
            apiKey: "provider-secret",
            baseUrl: "https://api.example/v1",
            modelId: "diagram-model"
        });
    });

    it("does not read or send an access code when the deployment does not require one", async () => {
        const plugin = makePlugin();
        const desktop = makeDesktop(
            { data: { accessCodeRequired: false } },
            { data: { valid: true } }
        );

        await new NextAiHttpClient(plugin as never, desktop as never).testConfiguration();

        expect(plugin.app.secretStorage.getSecret).toHaveBeenCalledOnce();
        expect(plugin.app.secretStorage.getSecret).toHaveBeenCalledWith("api-id");
        expect(desktop.openStream.mock.calls[1][0].headers)
            .not.toHaveProperty("x-access-code");
    });

    it("blocks secrets over non-loopback HTTP unless explicitly allowed", async () => {
        const plugin = makePlugin();
        plugin.settings.drawing.drawio.nextAi.serviceUrl = "http://next.example/";
        const client = new NextAiHttpClient(plugin as never);

        await expect(client.testConfiguration()).rejects.toThrow(/Remote HTTP is blocked/);
        expect(requestUrl).not.toHaveBeenCalled();
    });

    it("allows loopback HTTP and reports API schema errors", async () => {
        const plugin = makePlugin();
        plugin.settings.drawing.drawio.nextAi.serviceUrl = "http://127.0.0.1:3000/";
        const desktop = makeDesktop(
            { data: { accessCodeRequired: false } },
            { data: { valid: false, error: "Model is unavailable" } }
        );
        const client = new NextAiHttpClient(plugin as never, desktop as never);

        await expect(client.testConfiguration()).rejects.toThrow(/Model is unavailable/);
    });

    it("lazily caches an unavailable optional endpoint across clients", async () => {
        const plugin = makePlugin();
        const desktop = makeDesktop({ data: { error: "not found" }, status: 404 });

        const first = new NextAiHttpClient(plugin as never, desktop as never);
        await expect(first.extractUrl("https://example.com"))
            .rejects.toBeInstanceOf(NextAiCapabilityUnavailableError);
        expect(first.getCapabilityState("parse-url")).toBe("unavailable");
        expect(desktop.openStream.mock.calls[0][0].headers)
            .not.toHaveProperty("x-access-code");

        const second = new NextAiHttpClient(plugin as never, desktop as never);
        await expect(second.extractUrl("https://example.com/again"))
            .rejects.toBeInstanceOf(NextAiCapabilityUnavailableError);
        expect(desktop.openStream).toHaveBeenCalledOnce();
    });

    it("partitions optional endpoint capability state by normalized service URL", async () => {
        const plugin = makePlugin();
        const desktop = makeDesktop(
            { data: { error: "not found" }, status: 404 },
            { data: { title: "Example", content: "Extracted content", charCount: 17 } }
        );
        const client = new NextAiHttpClient(plugin as never, desktop as never);

        await expect(client.extractUrl("https://example.com"))
            .rejects.toBeInstanceOf(NextAiCapabilityUnavailableError);
        expect(client.getCapabilityState("parse-url")).toBe("unavailable");

        plugin.settings.drawing.drawio.nextAi.serviceUrl = "https://other.example/next";
        await expect(client.extractUrl("https://example.com/again")).resolves.toEqual({
            title: "Example",
            content: "Extracted content",
            charCount: 17
        });
        expect(client.getCapabilityState("parse-url")).toBe("available");
        expect(desktop.openStream).toHaveBeenCalledTimes(2);
        expect(desktop.openStream.mock.calls[1][0].url)
            .toBe("https://other.example/next/api/parse-url");

        plugin.settings.drawing.drawio.nextAi.serviceUrl = "HTTPS://NEXT.EXAMPLE:443/base/";
        await expect(client.extractUrl("https://example.com/original"))
            .rejects.toBeInstanceOf(NextAiCapabilityUnavailableError);
        expect(desktop.openStream).toHaveBeenCalledTimes(2);
    });

    it("uses the configured user model directly for visual validation", async () => {
        const plugin = makePlugin();
        plugin.settings.drawing.drawio.nextAi.visualValidationMode = "user-model";
        const desktop = makeDesktop({ data: {
            choices: [{
                message: {
                    content: "```json\n{\"valid\":false,\"issues\":[\"Overlap\"],\"suggestions\":[\"Add spacing\"]}\n```"
                }
            }]
        } });

        const result = await new NextAiHttpClient(plugin as never, desktop as never).validateDiagram(
            "data:image/png;base64,AA==",
            "session-1"
        );

        expect(result).toEqual({
            valid: false,
            issues: ["Overlap"],
            suggestions: ["Add spacing"],
            verification: "performed",
            source: "user-model"
        });
        const request = desktop.openStream.mock.calls[0][0];
        expect(request.url)
            .toBe("https://api.example/v1/chat/completions");
        expect(request.headers).toMatchObject({
            Authorization: "Bearer provider-secret"
        });
        const body = JSON.parse(String(request.body));
        expect(body.model).toBe("diagram-model");
        expect(body.messages[1].content[1].image_url.url).toBe("data:image/png;base64,AA==");
    });

    it("does not treat an empty valid server fallback as a verified VLM pass", async () => {
        const plugin = makePlugin();
        plugin.settings.drawing.drawio.nextAi.visualValidationMode = "next-ai-server";
        const desktop = makeDesktop({ data: {
            valid: true,
            issues: [],
            suggestions: []
        } });

        const result = await new NextAiHttpClient(plugin as never, desktop as never).validateDiagram(
            "data:image/png;base64,AA==",
            "session-1"
        );

        expect(result).toMatchObject({
            valid: true,
            verification: "server-reported",
            source: "next-ai-server"
        });
        expect(desktop.openStream.mock.calls[0][0].headers)
            .not.toHaveProperty("x-access-code");
    });

    it("blocks a direct user-model API key over remote plain HTTP", async () => {
        const plugin = makePlugin();
        Object.assign(plugin.settings.drawing.drawio.nextAi, {
            visualValidationMode: "user-model",
            apiBaseUrl: "http://api.example/v1"
        });

        await expect(new NextAiHttpClient(plugin as never).validateDiagram(
            "data:image/png;base64,AA==",
            "session-1"
        )).rejects.toThrow(/Remote HTTP is blocked/);
        expect(requestUrl).not.toHaveBeenCalled();
    });

    it("never sends header or JSON-body credentials through requestUrl fallback", async () => {
        const plugin = makePlugin();
        const unavailableDesktop = {
            isAvailable: vi.fn(() => false),
            openStream: vi.fn()
        };
        const client = new NextAiHttpClient(plugin as never, unavailableDesktop as never);

        await expect(client.fetch("https://next.example/api/chat", {
            method: "POST",
            headers: { "x-ai-api-key": "provider-secret" },
            body: "{}"
        })).rejects.toThrow(/Only a credential-free GET request/);
        await expect(client.fetch("https://next.example/api/validate-model", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ provider: "openai", apiKey: "provider-secret" })
        })).rejects.toThrow(/Only a credential-free GET request/);
        await expect(client.fetch("https://next.example/api/parse-url", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: "https://private.example/token" })
        })).rejects.toThrow(/Only a credential-free GET request/);

        expect(requestUrl).not.toHaveBeenCalled();
    });

    it("allows only a credential-free config GET through the requestUrl fallback", async () => {
        const plugin = makePlugin();
        vi.mocked(requestUrl).mockResolvedValueOnce(response({ accessCodeRequired: false }));
        const client = new NextAiHttpClient(plugin as never, {
            isAvailable: vi.fn(() => false),
            openStream: vi.fn()
        } as never);

        const configUrl = client.endpoint("api/config");
        const result = await client.fetch(configUrl);

        expect(result.ok).toBe(true);
        expect(requestUrl).toHaveBeenCalledWith(expect.objectContaining({
            url: configUrl,
            method: "GET"
        }));
    });

    it("does not treat another deployment's config path as a safe fallback probe", async () => {
        const plugin = makePlugin();
        const client = new NextAiHttpClient(plugin as never, {
            isAvailable: vi.fn(() => false),
            openStream: vi.fn()
        } as never);

        await expect(client.fetch("https://attacker.example/api/config"))
            .rejects.toThrow(/Only a credential-free GET request/);
        expect(requestUrl).not.toHaveBeenCalled();
    });

    it("does not retry through requestUrl when the secure transport rejects a redirect", async () => {
        const plugin = makePlugin();
        const desktop = {
            isAvailable: vi.fn(() => true),
            openStream: vi.fn(async () => {
                throw new Error("Redirects are not allowed for this request.");
            })
        };
        const client = new NextAiHttpClient(plugin as never, desktop as never);

        await expect(client.fetch("https://next.example/api/chat", {
            method: "POST",
            headers: { "x-ai-api-key": "provider-secret" },
            body: "{}"
        })).rejects.toThrow(/Redirects are not allowed/);
        expect(desktop.openStream).toHaveBeenCalledOnce();
        expect(requestUrl).not.toHaveBeenCalled();
    });

    it("rejects an explicit 302 even for a credential-free compatibility request", async () => {
        const plugin = makePlugin();
        vi.mocked(requestUrl).mockResolvedValueOnce(response({}, 302));
        const client = new NextAiHttpClient(plugin as never, {
            isAvailable: vi.fn(() => false),
            openStream: vi.fn()
        } as never);

        await expect(client.fetch(client.endpoint("api/config")))
            .rejects.toThrow(/fallback config probe returned a redirect/);
    });
});

function makePlugin(): any {
    const settings = structuredClone(DEFAULT_SETTINGS);
    Object.assign(settings.drawing.drawio.nextAi, {
        enabled: true,
        serviceUrl: "https://next.example/base/",
        accessCodeSecretId: "access-id",
        apiBaseUrl: "https://api.example/v1",
        apiKeySecretId: "api-id",
        model: "diagram-model"
    });
    return {
        settings,
        app: {
            secretStorage: {
                getSecret: vi.fn(async (id: string) => id === "access-id"
                    ? "access-secret"
                    : "provider-secret")
            }
        }
    };
}

async function withHttpServer(
    handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
    run: (baseUrl: string) => Promise<void>
): Promise<void> {
    const server = createServer((request, response) => {
        void handler(request, response).catch(error => {
            response.writeHead(500, { "content-type": "text/plain" });
            response.end(error instanceof Error ? error.message : String(error));
        });
    });
    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.off("error", reject);
            resolve();
        });
    });
    try {
        const address = server.address() as AddressInfo;
        await run(`http://127.0.0.1:${address.port}`);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
}

function readRequestBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        request.on("data", chunk => chunks.push(Buffer.from(chunk)));
        request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        request.on("error", reject);
    });
}

function sendJson(response: ServerResponse, data: unknown): void {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(data));
}

function response(data: unknown, status = 200): any {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    return {
        status,
        headers: { "content-type": "application/json" },
        arrayBuffer: bytes.buffer
    };
}

function makeDesktop(...responses: Array<{ data: unknown; status?: number }>): any {
    const queue = [...responses];
    return {
        isAvailable: vi.fn(() => true),
        openStream: vi.fn(async (request: { url: string }) => {
            const next = queue.shift();
            if (!next) throw new Error(`No desktop response was queued for ${request.url}.`);
            const bytes = new TextEncoder().encode(JSON.stringify(next.data));
            return {
                body: new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(bytes);
                        controller.close();
                    }
                }),
                status: next.status ?? 200,
                headers: { "content-type": "application/json" },
                finalUrl: request.url,
                redirects: []
            };
        })
    };
}
