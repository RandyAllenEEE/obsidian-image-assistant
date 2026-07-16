import { App } from "obsidian";
import { OCRProvider, OCRSettings } from "../OCRSettings";
import { fetchWithTimeout } from "../../utils/NetworkRequestUtils";
import { createOcrImagePayload } from "./ImagePayload";

/**
 * AI Model Converter - LLM Provider
 */
export class AIModelConverter implements OCRProvider {
    private isMultiline: boolean;
    private settings: OCRSettings;
    private promptType: "latex" | "markdown";
    private app: App;

    constructor(app: App, isMultiline: boolean, settings: OCRSettings, promptType: "latex" | "markdown") {
        this.app = app;
        this.isMultiline = isMultiline;
        this.settings = settings;
        this.promptType = promptType;
    }

    private async getSecret(secretId?: string): Promise<string | null> {
        const secretStorage = (this.app as any).secretStorage;
        if (!secretStorage || !secretId) return null;

        const value = await secretStorage.getSecret(secretId);
        return typeof value === "string" && value.length > 0 ? value : null;
    }

    async sendRequest(image: Uint8Array): Promise<string> {
        const imagePayload = await createOcrImagePayload(image);
        // Convert Uint8Array to base64 string
        const base64Image = Buffer.from(imagePayload.data).toString('base64');

        // Select appropriate prompt based on prompt type
        let prompt;
        if (this.promptType === "latex") {
            prompt = this.settings.aiModel.prompts.latex;
        } else {
            prompt = this.settings.aiModel.prompts.markdown;
        }

        // Retrieve API Key using linked ID in settings
        const apiKey = await this.getSecret(this.settings.aiModel.apiKeySecretId);

        if (this.settings.aiModel.providerType === "ollama") {
            // Ollama Native API Payload
            const payload = {
                model: this.settings.aiModel.model,
                messages: [
                    {
                        role: "user",
                        content: prompt,
                        images: [base64Image]
                    }
                ],
                stream: false
            };

            const response = await fetchWithTimeout(this.settings.aiModel.endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Ollama request failed with status ${response.status}${await this.readErrorDetail(response)}`);
            }

            const data = await this.readJsonObject(response, "Ollama");
            // Ollama /api/chat returns 'message': { 'content': ... }
            const message = data.message;
            const result = this.isRecord(message) && typeof message.content === "string"
                ? message.content.trim()
                : "";
            if (!result) throw new Error("Ollama returned empty content");

            return this.processResult(result);
        }

        // OpenAI Compatible Payload (default)
        const payload = {
            model: this.settings.aiModel.model,
            messages: [
                {
                    role: "user",
                    content: [
                        {
                            type: "text",
                            text: prompt
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: `data:${imagePayload.mimeType};base64,${base64Image}`
                            }
                        }
                    ]
                }
            ],
            max_tokens: this.settings.aiModel.maxTokens
        };

        const headers: any = {
            "Content-Type": "application/json"
        };
        if (apiKey) {
            headers["Authorization"] = `Bearer ${apiKey}`;
        }

        const response = await fetchWithTimeout(this.settings.aiModel.endpoint, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`AI model request failed with status ${response.status}${await this.readErrorDetail(response)}`);
        }

        const data = await this.readJsonObject(response, "AI model");
        const choices = data.choices;
        if (!Array.isArray(choices) || choices.length === 0 || !this.isRecord(choices[0])) {
            throw new Error("AI model returned no choices");
        }
        const message = choices[0].message;
        const result = this.isRecord(message) && typeof message.content === "string"
            ? message.content.trim()
            : "";
        if (!result) throw new Error("AI model returned empty content");

        return this.processResult(result);
    }

    private async readJsonObject(response: Response, provider: string): Promise<Record<string, unknown>> {
        let data: unknown;
        try {
            data = await response.json();
        } catch {
            throw new Error(`${provider} returned malformed JSON`);
        }
        if (!this.isRecord(data)) throw new Error(`${provider} returned an invalid response`);
        return data;
    }

    private async readErrorDetail(response: Response): Promise<string> {
        try {
            const detail = (await response.text()).trim();
            return detail ? `: ${detail.slice(0, 300)}` : "";
        } catch {
            return "";
        }
    }

    private isRecord(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    private processResult(result: string): string {
        // Data cleaning (prevent LLM from outputting $ or $$)
        // Remove possible markdown code blocks ```latex ... ```
        result = result.replace(/^```(latex)?|```$/g, '').trim();
        // Remove leading/trailing $ or $$
        if (result.startsWith('$$') && result.endsWith('$$')) {
            result = result.slice(2, -2).trim();
        } else if (result.startsWith('$') && result.endsWith('$')) {
            result = result.slice(1, -1).trim();
        }

        // Wrap based on user command mode
        if (this.promptType === "markdown") {
            return result; // Markdown mode doesn't wrap
        }

        if (this.isMultiline) {
            // Multiline mode: Use $$ to wrap, and handle multiline line break logic
            if (result.includes("\\\\") && !result.includes("\\begin{")) {
                // If contains line breaks and no environment wrapping, add gather environment
                return `$$\\begin{gather}\n${result}\n\\end{gather}$$`;
            }
            return `$$\n${result}\n$$`;
        } else {
            // Single line mode: Use $ to wrap
            return `$${result}$`;
        }
    }
}
