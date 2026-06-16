import { App } from "obsidian";
import { OCRProvider, OCRSettings } from "../OCRSettings";

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
        // Convert Uint8Array to base64 string
        const base64Image = Buffer.from(image).toString('base64');

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

            const response = await fetch(this.settings.aiModel.endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`Ollama request failed with status ${response.status}`);
            }

            const data = await response.json();
            // Ollama /api/chat returns 'message': { 'content': ... }
            let result = data.message?.content?.trim();
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
                                url: `data:image/png;base64,${base64Image}`
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

        const response = await fetch(this.settings.aiModel.endpoint, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`AI model request failed with status ${response.status}`);
        }

        const data = await response.json();
        let result = data.choices[0].message.content.trim();

        return this.processResult(result);
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
