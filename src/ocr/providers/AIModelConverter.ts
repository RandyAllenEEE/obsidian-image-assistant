import { OCRProvider, OCRSettings } from "../OCRSettings";

/**
 * AI Model Converter - LLM Provider
 */
export class AIModelConverter implements OCRProvider {
    private isMultiline: boolean;
    private settings: OCRSettings;
    private promptType: "latex" | "markdown";

    constructor(isMultiline: boolean, settings: OCRSettings, promptType: "latex" | "markdown") {
        this.isMultiline = isMultiline;
        this.settings = settings;
        this.promptType = promptType;
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

        const response = await fetch(this.settings.aiModel.endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${this.settings.aiModel.apiKey}`
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`AI model request failed with status ${response.status}`);
        }

        const data = await response.json();
        let result = data.choices[0].message.content.trim();

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